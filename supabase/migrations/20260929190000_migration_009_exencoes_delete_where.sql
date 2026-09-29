-- =====================================================================
-- migration_009 — correção da ponte das planilhas (aba ExencaoCNPJ)
--
-- No Supabase, chamadas vindas da API (anon/authenticated) passam pelo
-- pg_safeupdate, que recusa DELETE sem WHERE ("DELETE requires a WHERE
-- clause", código 21000). A função legacy_ingest_exencoes limpava o
-- espelho com "delete from legado.exencoes;" e falhava na 1ª sincronização.
-- Única mudança: o DELETE passa a ter "where true" (mesmo efeito: espelho
-- completo da aba). Permissões (grants) da função são preservadas pelo
-- create or replace.
-- =====================================================================

-- Espelho da aba ExencaoCNPJ + lista atual da aba ID:
-- p = {"linhas": [{"linha": 2, "celulas": [id, cnpj, percentual]}, ...],
--      "psicologas": [{"id": "...", "nomeAbreviado": "..."}, ...]}   -- na ordem da aba ID
create or replace function public.legacy_ingest_exencoes(p_token text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_cfg legado.config;
  v_n int;
begin
  select * into v_cfg from legado.config where id;
  if v_cfg is null or p_token is null
     or encode(digest(p_token, 'sha256'), 'hex') <> v_cfg.token_sha256 then
    raise exception 'Token inválido' using errcode = '42501';
  end if;
  if jsonb_typeof(p->'linhas') <> 'array' then
    raise exception 'linhas deve ser uma lista';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('legado:exencoes', 0));
  delete from legado.exencoes where true;
  insert into legado.exencoes (linha, psicologa_id, cnpj, percentual)
  select (l->>'linha')::int, l->'celulas'->0, l->'celulas'->1, l->'celulas'->2
    from jsonb_array_elements(p->'linhas') l;
  get diagnostics v_n = row_count;

  -- lista da aba ID: ordem do relatório e quem está ativo
  if jsonb_typeof(p->'psicologas') = 'array' then
    insert into legado.planilhas (spreadsheet_id, tenant_id, nome_abreviado, ordem, ativo)
    select x->>'id', v_cfg.tenant_id, x->>'nomeAbreviado', (o - 1)::int, true
      from jsonb_array_elements(p->'psicologas') with ordinality as t(x, o)
     where coalesce(x->>'id', '') ~ '^[A-Za-z0-9_-]{20,80}$'
    on conflict (spreadsheet_id) do update set
      nome_abreviado = excluded.nome_abreviado, ordem = excluded.ordem, ativo = true;
    update legado.planilhas set ativo = false
     where tenant_id = v_cfg.tenant_id
       and spreadsheet_id not in (select x->>'id' from jsonb_array_elements(p->'psicologas') x where x->>'id' is not null);
  end if;

  insert into legado.sync_log (nome, linhas, status, mensagem) values ('ExencaoCNPJ', v_n, 'ok', null);
  return jsonb_build_object('status', 'ok', 'linhas', v_n);
end;
$$;
