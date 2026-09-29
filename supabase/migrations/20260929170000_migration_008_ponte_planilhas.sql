-- ================================================================
-- HOPE CORE — MIGRATION 008 — PONTE DAS PLANILHAS (LEGADO)
-- Depende da migration 005.
--
-- Recebe uma CÓPIA da aba "Atendimentos" de cada psicóloga, enviada por
-- um Apps Script (SyncSupabase.gs) instalado no projeto "Calculo RPA",
-- que usa a mesma aba ID (nome + ID da planilha) do Sistema Mestre RPA.
--
-- Regras:
--  • TEMPORÁRIO e ISOLADO: tudo mora no schema `legado`, que NÃO é
--    exposto pela API. Quando o app das psicólogas substituir as
--    planilhas: `drop schema legado cascade;` e pronto.
--  • ESPELHO por psicóloga: cada envio substitui, numa transação só,
--    tudo o que era daquela planilha. Nunca duplica; o que foi corrigido
--    ou apagado na planilha também se corrige/some aqui. Se o envio
--    falhar, a cópia anterior fica intacta.
--  • CRU: as linhas chegam como estão (cabeçalho + células). O
--    mapeamento de colunas é feito depois, em cima do dado real.
--    Contém nome de paciente em texto — por isso o schema é fechado e
--    só as funções abaixo (security definer) o acessam.
--  • Porta de entrada: public.legacy_ingest_sheet(p_token, p) e
--    public.legacy_ingest_exencoes(p_token, p), chamáveis sem login, mas
--    só aceitam o token cujo SHA-256 está em legado.config.
--  • Datas: células que eram Data na planilha chegam como
--    {"$date": "yyyy-MM-ddTHH:mm:ss"} (fuso SP) para o cálculo do RPA
--    distinguir data de texto exatamente como o Apps Script distinguia.
--  • Repasse: public.legacy_rpa_base() entrega ao financeiro só o que o
--    cálculo do Sistema Mestre RPA usa (colunas A, N e S + isenções +
--    Pix descriptografado). O cálculo em si é a mesma função JavaScript
--    do RPA, portada sem mudanças (apps/web/lib/financeiro/rpa-legado.ts).
-- ================================================================

create schema if not exists legado;
revoke all on schema legado from public, anon, authenticated;

create table if not exists legado.config (
  id boolean primary key default true check (id),   -- linha única
  tenant_id uuid not null references public.tenants(id),
  token_sha256 text not null check (token_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

create table if not exists legado.planilhas (
  spreadsheet_id text primary key,
  tenant_id uuid not null references public.tenants(id),
  nome_abreviado text,
  nome_completo text,
  pix_encrypted bytea,               -- DadosPsi!O2, criptografado
  aba text not null default 'Atendimentos',
  cabecalho jsonb not null default '[]'::jsonb,
  total_linhas int not null default 0,
  ordem int,                         -- posição na aba ID (mesma ordem do relatório do RPA)
  ativo boolean not null default true, -- está na aba ID hoje?
  ultima_sincronizacao timestamptz,
  ultimo_erro text
);

create table if not exists legado.atendimentos_raw (
  spreadsheet_id text not null references legado.planilhas(spreadsheet_id) on delete cascade,
  linha int not null,                 -- número da linha na planilha (2 = primeira linha de dados)
  celulas jsonb not null,             -- array com as células, na ordem das colunas
  sincronizado_em timestamptz not null default now(),
  primary key (spreadsheet_id, linha)
);

-- Espelho da aba ExencaoCNPJ do "Calculo RPA" (psicologaId = ID da planilha)
create table if not exists legado.exencoes (
  linha int primary key,
  psicologa_id jsonb,                -- valores crus, para replicar o RPA à risca
  cnpj jsonb,
  percentual jsonb,
  sincronizado_em timestamptz not null default now()
);

create table if not exists legado.sync_log (
  id bigint generated always as identity primary key,
  spreadsheet_id text,
  nome text,
  linhas int,
  status text not null check (status in ('ok', 'erro')),
  mensagem text,
  recebido_em timestamptz not null default now()
);

create index if not exists idx_legado_sync_log_data on legado.sync_log (recebido_em desc);

revoke all on all tables in schema legado from public, anon, authenticated;

-- ----------------------------------------------------------------
-- Porta de entrada do Apps Script
-- p = {
--   "spreadsheetId": "...", "nomeAbreviado": "...", "nomeCompleto": "...",
--   "aba": "Atendimentos",
--   "cabecalho": ["...", ...],
--   "linhas": [ {"linha": 2, "celulas": [...]}, ... ]
-- }
-- ----------------------------------------------------------------
create or replace function public.legacy_ingest_sheet(p_token text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_cfg legado.config;
  v_sid text := nullif(trim(p->>'spreadsheetId'), '');
  v_n int;
  v_key text;
begin
  select * into v_cfg from legado.config where id;
  if v_cfg is null
     or p_token is null
     or length(p_token) < 32
     or encode(digest(p_token, 'sha256'), 'hex') <> v_cfg.token_sha256 then
    raise exception 'Token inválido' using errcode = '42501';
  end if;

  if v_sid is null or v_sid !~ '^[A-Za-z0-9_-]{20,80}$' then
    raise exception 'spreadsheetId inválido';
  end if;
  if jsonb_typeof(p->'linhas') <> 'array' then
    raise exception 'linhas deve ser uma lista';
  end if;

  -- uma sincronização por planilha de cada vez
  perform pg_advisory_xact_lock(hashtextextended('legado:' || v_sid, 0));

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'hope_core_field_enc_key';

  insert into legado.planilhas as t (spreadsheet_id, tenant_id, nome_abreviado, nome_completo, pix_encrypted, aba, cabecalho, total_linhas, ultima_sincronizacao, ultimo_erro)
  values (
    v_sid, v_cfg.tenant_id,
    nullif(p->>'nomeAbreviado', ''), nullif(p->>'nomeCompleto', ''),
    case when nullif(p->>'pixKey', '') is not null and v_key is not null then pgp_sym_encrypt(p->>'pixKey', v_key) end,
    coalesce(nullif(p->>'aba', ''), 'Atendimentos'),
    coalesce(p->'cabecalho', '[]'::jsonb),
    jsonb_array_length(p->'linhas'), now(), null
  )
  on conflict (spreadsheet_id) do update set
    nome_abreviado = excluded.nome_abreviado,
    nome_completo = excluded.nome_completo,
    pix_encrypted = excluded.pix_encrypted,
    aba = excluded.aba,
    cabecalho = excluded.cabecalho,
    total_linhas = excluded.total_linhas,
    ultima_sincronizacao = excluded.ultima_sincronizacao,
    ultimo_erro = null;

  -- espelho: troca tudo daquela planilha de uma vez
  delete from legado.atendimentos_raw where spreadsheet_id = v_sid;

  insert into legado.atendimentos_raw (spreadsheet_id, linha, celulas)
  select v_sid, (l->>'linha')::int, l->'celulas'
    from jsonb_array_elements(p->'linhas') l
   where jsonb_typeof(l->'celulas') = 'array';
  get diagnostics v_n = row_count;

  insert into legado.sync_log (spreadsheet_id, nome, linhas, status)
  values (v_sid, coalesce(nullif(p->>'nomeCompleto', ''), p->>'nomeAbreviado'), v_n, 'ok');

  return jsonb_build_object('status', 'ok', 'linhas', v_n);
end;
$$;

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
  delete from legado.exencoes;
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

-- Registro de erro vindo do Apps Script (ex.: planilha sem aba Atendimentos)
create or replace function public.legacy_report_error(p_token text, p_spreadsheet_id text, p_nome text, p_mensagem text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_cfg legado.config;
begin
  select * into v_cfg from legado.config where id;
  if v_cfg is null or p_token is null
     or encode(digest(p_token, 'sha256'), 'hex') <> v_cfg.token_sha256 then
    raise exception 'Token inválido' using errcode = '42501';
  end if;
  insert into legado.sync_log (spreadsheet_id, nome, status, mensagem)
  values (left(p_spreadsheet_id, 80), left(p_nome, 200), 'erro', left(p_mensagem, 1000));
  if coalesce(p_spreadsheet_id, '') ~ '^[A-Za-z0-9_-]{20,80}$' then
    insert into legado.planilhas (spreadsheet_id, tenant_id, nome_abreviado, ultimo_erro)
    values (p_spreadsheet_id, v_cfg.tenant_id, left(p_nome, 200), left(p_mensagem, 1000))
    on conflict (spreadsheet_id) do update set ultimo_erro = excluded.ultimo_erro;
  end if;
end;
$$;

-- Planilhas grandes: até 60 s por envio (PostgREST aplica o timeout da função).
alter function public.legacy_ingest_sheet(text, jsonb) set statement_timeout = '60s';

revoke execute on function public.legacy_ingest_sheet(text, jsonb) from public;
revoke execute on function public.legacy_ingest_exencoes(text, jsonb) from public;
revoke execute on function public.legacy_report_error(text, text, text, text) from public;
grant execute on function public.legacy_ingest_sheet(text, jsonb) to anon, authenticated;
grant execute on function public.legacy_ingest_exencoes(text, jsonb) to anon, authenticated;
grant execute on function public.legacy_report_error(text, text, text, text) to anon, authenticated;

-- ----------------------------------------------------------------
-- Painel de acompanhamento (só financeiro)
-- ----------------------------------------------------------------
create or replace function public.legacy_sync_status()
returns table (
  spreadsheet_id text,
  nome text,
  total_linhas int,
  ultima_sincronizacao timestamptz,
  ultimo_erro text
)
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
  select p.spreadsheet_id, coalesce(p.nome_completo, p.nome_abreviado), p.total_linhas, p.ultima_sincronizacao, p.ultimo_erro
    from legado.planilhas p
   where p.tenant_id = current_tenant_id() and p.ativo
   order by p.ordem nulls last, 2;
end;
$$;

revoke execute on function public.legacy_sync_status() from public, anon;
grant execute on function public.legacy_sync_status() to authenticated;

-- ----------------------------------------------------------------
-- Base do cálculo de repasse (Sistema Mestre RPA) — só financeiro.
-- Devolve SÓ o que calcularIndividual() usa: coluna A (índice 0),
-- N (13) e S (18). Nenhum nome de paciente sai daqui.
-- ----------------------------------------------------------------
create or replace function public.legacy_rpa_base()
returns jsonb
language plpgsql stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key text;
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'hope_core_field_enc_key';

  return jsonb_build_object(
    'psicologas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.spreadsheet_id,
        'nomeAbreviado', p.nome_abreviado,
        'nomeCompleto', coalesce(p.nome_completo, p.nome_abreviado),
        'pixKey', case when p.pix_encrypted is not null then pgp_sym_decrypt(p.pix_encrypted, v_key) else '' end,
        'ultimaSincronizacao', p.ultima_sincronizacao,
        'ultimoErro', p.ultimo_erro,
        'linhas', coalesce((
          select jsonb_agg(jsonb_build_array(r.celulas->0, r.celulas->13, r.celulas->18) order by r.linha)
            from legado.atendimentos_raw r
           where r.spreadsheet_id = p.spreadsheet_id
        ), '[]'::jsonb)
      ) order by p.ordem nulls last, p.nome_abreviado)
      from legado.planilhas p
      where p.tenant_id = v_tenant and p.ativo
    ), '[]'::jsonb),
    'exencoes', coalesce((
      select jsonb_agg(jsonb_build_array(e.psicologa_id, e.cnpj, e.percentual) order by e.linha)
        from legado.exencoes e
    ), '[]'::jsonb)
  );
end;
$$;

alter function public.legacy_rpa_base() set statement_timeout = '30s';
revoke execute on function public.legacy_rpa_base() from public, anon;
grant execute on function public.legacy_rpa_base() to authenticated;
