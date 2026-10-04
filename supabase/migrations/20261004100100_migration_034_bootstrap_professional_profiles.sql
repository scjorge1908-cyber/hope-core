-- =====================================================================
-- migration_034 — Convergência Bloco 1 (ORDEM-005 C): bootstrap de
--                 PSICÓLOGAS (legado.planilhas → professional_profiles)
--
-- PREPARADA EM BRANCH — NÃO APLICADA EM PRODUÇÃO. NÃO EXECUTAR o
-- bootstrap sem ordem do CX (ORDEM-005 proíbe inserir em produção).
--
-- Chave estável de origem: legado.planilhas.spreadsheet_id (PK; é o ID
-- da planilha da psicóloga, o mesmo usado pelo Mestre RPA e pelo sync).
--
-- Vínculo origem → Core: coluna NOVA e opcional na tabela de TRANSIÇÃO
--   legado.planilhas.professional_profile_id (FK, única quando preenchida).
--   • Nenhuma tabela nova; public.professional_profiles não muda.
--   • O schema legado é transitório (some com "drop schema legado
--     cascade" quando as planilhas saírem), então o mapeamento morre
--     junto, sem deixar resto no Core.
--   • Todas as escritas existentes em legado.planilhas são UPSERT com
--     lista explícita de colunas (legacy_ingest_sheet, legacy_report_error,
--     legacy_ingest_exencoes, legacy_marcar_desligada, legacy_ingest_agenda):
--     nenhuma apaga linha, então o vínculo não se perde no sync.
--
-- public.bootstrap_professional_profiles_from_legado(p_dry_run default true):
--   • IDEMPOTENTE: só trata planilhas com professional_profile_id nulo.
--   • Deduplicação: se já existir, no mesmo tenant, EXATAMENTE 1 perfil
--     ainda não vinculado com o mesmo short_name (comparação sem caixa e
--     espaços), ele é VINCULADO em vez de criar outro. Mais de 1 → erro.
--   • Campos preenchidos: tenant_id, full_name (nome_completo; se vazio,
--     nome_abreviado), short_name (nome_abreviado), active.
--   • active = ativo AND NOT desligada → 17 ativas; as 7 restantes
--     (4 inativas na aba ID + 3 desligadas) entram com active = false.
--     deleted_at fica NULO (desligamento não é exclusão de registro;
--     a data de desligamento continua em legado.planilhas.desligada_em).
--   • Ficam NULOS: user_id (NÃO cria usuário Auth, NÃO ativa login),
--     crp, cpf/cpf_encrypted/cpf_blind_index, rg/rg_encrypted, birth_date,
--     approach, pix_key/pix_key_encrypted (o Pix cifrado do legado NÃO é
--     copiado), min_patient_age.
--   • Vínculo futuro de login: professional_profiles.user_id será
--     preenchido no fluxo de convite (bloco próprio, gate G1/G5).
--   • RASTREÁVEL: a execução real grava em legado.registro_log (log já
--     existente) os IDs CRIADOS e os VINCULADOS. O rollback apaga só os
--     criados; os vinculados (já existiam) são apenas desvinculados.
--   • Execução restrita (sem anon/authenticated).
--
-- Rollback: supabase/rollbacks/rollback_034_bootstrap_professional_profiles.sql
-- =====================================================================

alter table legado.planilhas
  add column if not exists professional_profile_id uuid
  references public.professional_profiles(id) on delete set null;

create unique index if not exists planilhas_professional_profile_uidx
  on legado.planilhas (professional_profile_id)
  where professional_profile_id is not null;

comment on column legado.planilhas.professional_profile_id is
  'Convergência (migration 034): perfil do Core criado/vinculado a partir desta planilha. Transitório.';

create or replace function public.bootstrap_professional_profiles_from_legado(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, legado, pg_temp
as $$
declare
  r record;
  v_existentes uuid[];
  v_id uuid;
  v_criados int := 0;
  v_vinculados int := 0;
  v_ja_vinculados int := 0;
  v_ativos int := 0;
  v_inativos int := 0;
  v_itens jsonb := '[]'::jsonb;
  v_ids_criados jsonb := '[]'::jsonb;
  v_ids_vinculados jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('bootstrap:professional_profiles', 0));

  select count(*) into v_ja_vinculados from legado.planilhas where professional_profile_id is not null;

  for r in
    select p.spreadsheet_id, p.tenant_id,
           trim(p.nome_abreviado) as curto,
           coalesce(nullif(trim(p.nome_completo), ''), trim(p.nome_abreviado)) as completo,
           (p.ativo and not coalesce(p.desligada, false)) as ativa
      from legado.planilhas p
     where p.professional_profile_id is null
     order by p.ordem nulls last, p.spreadsheet_id
  loop
    if r.curto is null or r.curto = '' then
      raise exception 'Planilha sem nome_abreviado: %', left(r.spreadsheet_id, 6) || '…';
    end if;

    select array_agg(pp.id) into v_existentes
      from public.professional_profiles pp
     where pp.tenant_id = r.tenant_id
       and lower(regexp_replace(trim(coalesce(pp.short_name, '')), '\s+', ' ', 'g'))
         = lower(regexp_replace(r.curto, '\s+', ' ', 'g'))
       and not exists (select 1 from legado.planilhas x where x.professional_profile_id = pp.id);

    if coalesce(array_length(v_existentes, 1), 0) > 1 then
      raise exception 'Mais de um perfil livre com o mesmo nome curto (%): resolva manualmente', r.curto;
    end if;

    if r.ativa then v_ativos := v_ativos + 1; else v_inativos := v_inativos + 1; end if;

    if coalesce(array_length(v_existentes, 1), 0) = 1 then
      v_vinculados := v_vinculados + 1;
      v_itens := v_itens || jsonb_build_object('nome_curto', r.curto, 'acao', 'vincular', 'ativa', r.ativa);
      if not p_dry_run then
        update legado.planilhas set professional_profile_id = v_existentes[1]
         where spreadsheet_id = r.spreadsheet_id;
        v_ids_vinculados := v_ids_vinculados || to_jsonb(v_existentes[1]);
      end if;
    else
      v_criados := v_criados + 1;
      v_itens := v_itens || jsonb_build_object('nome_curto', r.curto, 'acao', 'criar', 'ativa', r.ativa);
      if not p_dry_run then
        insert into public.professional_profiles (tenant_id, full_name, short_name, active)
        values (r.tenant_id, r.completo, r.curto, r.ativa)
        returning id into v_id;
        update legado.planilhas set professional_profile_id = v_id
         where spreadsheet_id = r.spreadsheet_id;
        v_ids_criados := v_ids_criados || to_jsonb(v_id);
      end if;
    end if;
  end loop;

  if not p_dry_run and (v_criados + v_vinculados) > 0 then
    insert into legado.registro_log (tenant_id, funcao, args, resposta, linhas_espelhadas)
    values ((select id from public.tenants where is_internal limit 1),
            'bootstrap_professional_profiles_from_legado', jsonb_build_object('p_dry_run', false),
            jsonb_build_object('criados', v_ids_criados, 'vinculados', v_ids_vinculados),
            v_criados + v_vinculados);
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'ja_vinculadas_antes', v_ja_vinculados,
    'a_criar', v_criados,
    'a_vincular', v_vinculados,
    'ativas', v_ativos,
    'inativas', v_inativos,
    'itens', v_itens
  );
end;
$$;

revoke all on function public.bootstrap_professional_profiles_from_legado(boolean) from public;
revoke all on function public.bootstrap_professional_profiles_from_legado(boolean) from anon, authenticated;
