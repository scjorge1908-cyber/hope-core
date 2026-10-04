-- =====================================================================
-- migration_033 — Convergência Bloco 1 (ORDEM-005 B): bootstrap de SALAS
--
-- PREPARADA EM BRANCH — NÃO APLICADA EM PRODUÇÃO.
-- Aplicar só com ordem do CX que autorize (piloto/ORDEM-006).
--
-- O que faz:
--   • legado.sala_chave(text): chave determinística de sala
--     (trim + espaços colapsados + maiúsculas). Usada aqui e na view
--     legado.vw_room_blocks (migration 035).
--   • public.bootstrap_rooms_from_legado(p_dry_run boolean default true):
--     cria em public.rooms, no tenant interno, as salas reais que estão
--     no cabeçalho do painel de salas (legado.salas_meta), uma vez cada.
--       - IDEMPOTENTE: só insere a sala cuja chave ainda não existe no
--         tenant; reexecutar não duplica.
--       - p_dry_run = true (padrão): só DEVOLVE o que faria, não grava.
--       - Sem PII: só nomes de sala.
--       - Exige exatamente 1 tenant interno (is_internal).
--       - RASTREÁVEL: cada execução real que insere grava em
--         legado.registro_log (tabela de log JÁ EXISTENTE, migration 010)
--         a linha funcao = 'bootstrap_rooms_from_legado' com os IDs
--         criados. O rollback apaga SÓ esses IDs (nunca uma sala
--         cadastrada à mão com o mesmo nome).
--   • NÃO cria tabela, coluna, índice, constraint nem RLS.
--   • Execução restrita (sem anon/authenticated): roda pelo SQL Editor
--     ou service_role, nunca pelo navegador.
--
-- Rollback: supabase/rollbacks/rollback_033_bootstrap_rooms.sql
-- =====================================================================

create or replace function legado.sala_chave(p text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select nullif(upper(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g')), '')
$$;

create or replace function public.bootstrap_rooms_from_legado(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, legado, pg_temp
as $$
declare
  v_qtd_internos int;
  v_tenant uuid;
  v_candidatas jsonb;
  v_ja_existiam jsonb;
  v_inseridas jsonb := '[]'::jsonb;
begin
  select count(*) into v_qtd_internos from public.tenants where is_internal;
  if v_qtd_internos <> 1 then
    raise exception 'Esperado exatamente 1 tenant interno; encontrados %', v_qtd_internos;
  end if;
  select id into v_tenant from public.tenants where is_internal;

  perform pg_advisory_xact_lock(hashtextextended('bootstrap:rooms:' || v_tenant::text, 0));

  -- Salas do cabeçalho do painel: colunas a partir da 3ª (1ª = dia, 2ª = horário)
  with cab as (
    select trim(e.v) as nome, e.i
      from legado.salas_meta m,
           jsonb_array_elements_text(m.cabecalho) with ordinality as e(v, i)
     where e.i > 2 and legado.sala_chave(e.v) is not null
  ), unicas as (
    select distinct on (legado.sala_chave(nome)) nome, legado.sala_chave(nome) as chave, i
      from cab
     order by legado.sala_chave(nome), i
  )
  select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'chave', chave) order by i), '[]'::jsonb)
    into v_candidatas
    from unicas;

  if jsonb_array_length(v_candidatas) = 0 then
    raise exception 'Cabeçalho do painel de salas vazio: nada a criar (sincronize as Salas antes)';
  end if;

  select coalesce(jsonb_agg(c->>'nome'), '[]'::jsonb)
    into v_ja_existiam
    from jsonb_array_elements(v_candidatas) c
   where exists (select 1 from public.rooms r
                  where r.tenant_id = v_tenant and legado.sala_chave(r.name) = c->>'chave');

  if not p_dry_run then
    with novas as (
      insert into public.rooms (tenant_id, name)
      select v_tenant, c->>'nome'
        from jsonb_array_elements(v_candidatas) c
       where not exists (select 1 from public.rooms r
                          where r.tenant_id = v_tenant and legado.sala_chave(r.name) = c->>'chave')
      returning id, name
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', name) order by name), '[]'::jsonb)
      into v_inseridas
      from novas;

    if jsonb_array_length(v_inseridas) > 0 then
      insert into legado.registro_log (tenant_id, funcao, args, resposta, linhas_espelhadas)
      values (v_tenant, 'bootstrap_rooms_from_legado', jsonb_build_object('p_dry_run', false),
              jsonb_build_object('inseridas', v_inseridas), jsonb_array_length(v_inseridas));
    end if;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'tenant_id', v_tenant,
    'candidatas', v_candidatas,
    'ja_existiam', v_ja_existiam,
    'inseridas', v_inseridas
  );
end;
$$;

revoke all on function public.bootstrap_rooms_from_legado(boolean) from public;
revoke all on function public.bootstrap_rooms_from_legado(boolean) from anon, authenticated;
revoke all on function legado.sala_chave(text) from public;
