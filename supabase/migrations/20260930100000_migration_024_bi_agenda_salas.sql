-- =====================================================================
-- migration_024 — BI da clínica no HOPE CORE (fase 1: telas de consulta)
--   Espelho, vindo das planilhas das psicólogas pelo Apps Script "Calculo
--   RPA" (SyncSupabase.gs), de:
--     • aba Agenda      → legado.agenda      (só os campos dos indicadores)
--     • aba Cancelados  → legado.cancelados  (só os campos dos indicadores)
--     • aba Painel da planilha de Salas → legado.salas_painel
--   Campos que NÃO vêm (LGPD): CPF, telefone, e-mail, carteirinha, médico,
--   CRM, CID, responsável, anexos, sexo, observações.
--   Regras de classificação iguais às do Sistema Gerencial e BI (Código.gs):
--     💚 → LIVRE | "bloquead" → BLOQUEADO | "reservad" → RESERVADO |
--     vazio → INDETERMINADO | qualquer outro texto → PACIENTE
--   bi_base(): devolve tudo que as telas do BI precisam, com o paciente
--   identificado por um hash do nome (o nome não sai do banco).
-- =====================================================================

create table if not exists legado.agenda (
  spreadsheet_id text not null references legado.planilhas(spreadsheet_id) on delete cascade,
  linha int not null,
  dia text,
  horario text,
  tipo text not null,
  paciente text,            -- só quando tipo = PACIENTE
  plano text,
  psicologa_linha text,
  valor numeric,
  sala text,
  nascimento date,
  cidade text,
  bairro text,
  inicio date,
  sincronizado_em timestamptz not null default now(),
  primary key (spreadsheet_id, linha)
);

create table if not exists legado.cancelados (
  spreadsheet_id text not null references legado.planilhas(spreadsheet_id) on delete cascade,
  linha int not null,
  cancelamento date,
  dia text,
  horario text,
  paciente text,
  plano text,
  valor numeric,
  sala text,
  nascimento date,
  cidade text,
  bairro text,
  inicio date,
  sincronizado_em timestamptz not null default now(),
  primary key (spreadsheet_id, linha)
);

create table if not exists legado.salas_painel (
  linha int primary key,
  celulas jsonb not null,   -- Dia | Horário | sala 1 | sala 2 | ...
  sincronizado_em timestamptz not null default now()
);

create table if not exists legado.salas_meta (
  id boolean primary key default true check (id),
  cabecalho jsonb not null default '[]'::jsonb,
  sincronizado_em timestamptz not null default now()
);

alter table legado.planilhas add column if not exists agenda_sincronizada_em timestamptz;
alter table legado.planilhas add column if not exists agenda_linhas int;
alter table legado.planilhas add column if not exists cancelados_linhas int;

revoke all on legado.agenda, legado.cancelados, legado.salas_painel, legado.salas_meta from public, anon, authenticated;

-- ---------- helpers ----------
create or replace function legado.celula_texto(p jsonb)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select case
           when p is null or jsonb_typeof(p) = 'null' then null
           when jsonb_typeof(p) = 'object' and p ? '$date' then p->>'$date'
           else nullif(trim(p #>> '{}'), '')
         end
$$;

-- horário: data do Sheets (1899-12-30T08:00:00) → '08:00'; texto fica como está
create or replace function legado.celula_hora(p jsonb)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select case
           when p is null or jsonb_typeof(p) = 'null' then null
           when jsonb_typeof(p) = 'object' and p ? '$date' then substr(p->>'$date', 12, 5)
           else nullif(trim(p #>> '{}'), '')
         end
$$;

create or replace function legado.celula_numero(p jsonb)
returns numeric
language plpgsql
immutable
set search_path = pg_temp
as $$
begin
  if p is null or jsonb_typeof(p) <> 'number' then return null; end if;
  return (p #>> '{}')::numeric;
end;
$$;

create or replace function legado.classificar_agenda(t text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select case
           when t is null or t = '' then 'INDETERMINADO'
           when position('💚' in t) > 0 then 'LIVRE'
           when legado.chave_nome(t) = '' then 'INDETERMINADO'
           when legado.chave_nome(t) like '%bloquead%' then 'BLOQUEADO'
           when legado.chave_nome(t) like '%reservad%' then 'RESERVADO'
           else 'PACIENTE'
         end
$$;

-- ---------- porta de entrada: Agenda + Cancelados de uma psicóloga ----------
-- p = {
--   "spreadsheetId": "...",
--   "agenda":     [ {"linha": 2, "c": [dia, horario, paciente, plano, psicologa, valor, sala, nascimento, cidade, bairro, inicio]} ],
--   "cancelados": [ {"linha": 2, "c": [cancelamento, dia, horario, paciente, plano, valor, sala, nascimento, cidade, bairro, inicio]} ]
-- }
create or replace function public.legacy_ingest_agenda(p_token text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_cfg legado.config;
  v_sid text := nullif(trim(p->>'spreadsheetId'), '');
  v_na int := 0;
  v_nc int := 0;
begin
  select * into v_cfg from legado.config where id;
  if v_cfg is null or p_token is null or length(p_token) < 32
     or encode(digest(p_token, 'sha256'), 'hex') <> v_cfg.token_sha256 then
    raise exception 'Token inválido' using errcode = '42501';
  end if;
  if v_sid is null or v_sid !~ '^[A-Za-z0-9_-]{20,80}$' then
    raise exception 'spreadsheetId inválido';
  end if;
  if not exists (select 1 from legado.planilhas where spreadsheet_id = v_sid) then
    raise exception 'Planilha ainda não sincronizada (Atendimentos primeiro)';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('legado-agenda:' || v_sid, 0));

  if jsonb_typeof(p->'agenda') = 'array' then
    delete from legado.agenda where spreadsheet_id = v_sid;
    insert into legado.agenda (spreadsheet_id, linha, dia, horario, tipo, paciente, plano, psicologa_linha, valor, sala, nascimento, cidade, bairro, inicio)
    select v_sid, (l->>'linha')::int,
           legado.celula_texto(l->'c'->0),
           legado.celula_hora(l->'c'->1),
           legado.classificar_agenda(legado.celula_texto(l->'c'->2)),
           case when legado.classificar_agenda(legado.celula_texto(l->'c'->2)) = 'PACIENTE' then legado.celula_texto(l->'c'->2) end,
           legado.celula_texto(l->'c'->3),
           legado.celula_texto(l->'c'->4),
           legado.celula_numero(l->'c'->5),
           legado.celula_texto(l->'c'->6),
           legado.celula_data(l->'c'->7),
           legado.celula_texto(l->'c'->8),
           legado.celula_texto(l->'c'->9),
           legado.celula_data(l->'c'->10)
      from jsonb_array_elements(p->'agenda') l
     where jsonb_typeof(l->'c') = 'array' and (l->>'linha') ~ '^\d+$'
    on conflict (spreadsheet_id, linha) do nothing;
    get diagnostics v_na = row_count;
  end if;

  if jsonb_typeof(p->'cancelados') = 'array' then
    delete from legado.cancelados where spreadsheet_id = v_sid;
    insert into legado.cancelados (spreadsheet_id, linha, cancelamento, dia, horario, paciente, plano, valor, sala, nascimento, cidade, bairro, inicio)
    select v_sid, (l->>'linha')::int,
           legado.celula_data(l->'c'->0),
           legado.celula_texto(l->'c'->1),
           legado.celula_hora(l->'c'->2),
           legado.celula_texto(l->'c'->3),
           legado.celula_texto(l->'c'->4),
           legado.celula_numero(l->'c'->5),
           legado.celula_texto(l->'c'->6),
           legado.celula_data(l->'c'->7),
           legado.celula_texto(l->'c'->8),
           legado.celula_texto(l->'c'->9),
           legado.celula_data(l->'c'->10)
      from jsonb_array_elements(p->'cancelados') l
     where jsonb_typeof(l->'c') = 'array' and (l->>'linha') ~ '^\d+$'
       and legado.celula_texto(l->'c'->3) is not null
    on conflict (spreadsheet_id, linha) do nothing;
    get diagnostics v_nc = row_count;
  end if;

  update legado.planilhas
     set agenda_sincronizada_em = now(), agenda_linhas = v_na, cancelados_linhas = v_nc
   where spreadsheet_id = v_sid;

  return jsonb_build_object('status', 'ok', 'agenda', v_na, 'cancelados', v_nc);
end;
$$;
revoke execute on function public.legacy_ingest_agenda(text, jsonb) from public;
grant execute on function public.legacy_ingest_agenda(text, jsonb) to anon, authenticated;

-- ---------- porta de entrada: aba Painel da planilha de Salas ----------
-- p = {"cabecalho": ["Dia", "Horário", "311 Consultório 1", ...], "linhas": [{"linha": 2, "celulas": [...]}]}
create or replace function public.legacy_ingest_salas(p_token text, p jsonb)
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
  if v_cfg is null or p_token is null or length(p_token) < 32
     or encode(digest(p_token, 'sha256'), 'hex') <> v_cfg.token_sha256 then
    raise exception 'Token inválido' using errcode = '42501';
  end if;
  if jsonb_typeof(p->'linhas') <> 'array' or jsonb_typeof(p->'cabecalho') <> 'array' then
    raise exception 'cabecalho e linhas devem ser listas';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('legado:salas', 0));
  delete from legado.salas_painel;
  insert into legado.salas_painel (linha, celulas)
  select (l->>'linha')::int, l->'celulas'
    from jsonb_array_elements(p->'linhas') l
   where jsonb_typeof(l->'celulas') = 'array' and (l->>'linha') ~ '^\d+$';
  get diagnostics v_n = row_count;

  insert into legado.salas_meta (id, cabecalho, sincronizado_em) values (true, p->'cabecalho', now())
  on conflict (id) do update set cabecalho = excluded.cabecalho, sincronizado_em = excluded.sincronizado_em;

  return jsonb_build_object('status', 'ok', 'linhas', v_n);
end;
$$;
revoke execute on function public.legacy_ingest_salas(text, jsonb) from public;
grant execute on function public.legacy_ingest_salas(text, jsonb) to anon, authenticated;

-- ---------- leitura: base do BI ----------
create or replace function public.bi_base()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_t uuid := current_tenant_id();
  v_out jsonb;
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  with psi as (
    select p.spreadsheet_id, coalesce(p.nome_abreviado, p.nome_completo) as nome, p.nome_completo, p.ordem,
           p.ativo, p.desligada, p.agenda_sincronizada_em
      from legado.planilhas p
     where p.tenant_id = v_t
  )
  select jsonb_build_object(
    'hoje', (now() at time zone 'America/Sao_Paulo')::date,
    'psicologas', coalesce((select jsonb_agg(jsonb_build_object(
        'sid', spreadsheet_id, 'nome', nome, 'nomeCompleto', nome_completo, 'ordem', ordem,
        'ativo', ativo, 'desligada', desligada, 'agendaEm', agenda_sincronizada_em) order by ordem nulls last, nome)
      from psi), '[]'::jsonb),
    'agenda', coalesce((select jsonb_agg(jsonb_build_array(
        a.spreadsheet_id, a.linha, a.dia, a.horario, a.tipo,
        case when a.paciente is not null then md5(legado.chave_nome(a.paciente)) end,
        a.plano, a.valor, a.sala, a.nascimento, a.cidade, a.bairro, a.inicio) order by a.spreadsheet_id, a.linha)
      from legado.agenda a join psi on psi.spreadsheet_id = a.spreadsheet_id), '[]'::jsonb),
    'cancelados', coalesce((select jsonb_agg(jsonb_build_array(
        c.spreadsheet_id, c.linha, md5(legado.chave_nome(c.paciente)), c.plano, c.valor,
        c.nascimento, c.cidade, c.bairro, c.inicio, c.cancelamento, c.dia) order by c.spreadsheet_id, c.linha)
      from legado.cancelados c join psi on psi.spreadsheet_id = c.spreadsheet_id), '[]'::jsonb),
    'atendimentos', coalesce((select jsonb_agg(jsonb_build_array(
        r.spreadsheet_id,
        md5(legado.chave_nome(r.celulas->>2)),
        r.celulas->>6,
        legado.celula_data(r.celulas->0),
        legado.celula_data(r.celulas->3),
        nullif(trim(coalesce(r.celulas->>4, '')), ''),
        upper(trim(coalesce(r.celulas->>18, ''))),
        case when jsonb_typeof(r.celulas->13) = 'number' then (r.celulas->>13)::numeric
             else nullif(regexp_replace(coalesce(r.celulas->>13, ''), '[^0-9.]', '', 'g'), '')::numeric end))
      from legado.atendimentos_raw r join psi on psi.spreadsheet_id = r.spreadsheet_id
     where coalesce(trim(r.celulas->>2), '') <> ''), '[]'::jsonb),
    'bdGuias', coalesce((select jsonb_agg(jsonb_build_array(
        legado.chave_nome(b.celulas->>3),
        b.celulas->1, b.celulas->2,
        (select coalesce(jsonb_agg(trim(x.v)), '[]'::jsonb)
           from jsonb_array_elements_text(b.celulas) with ordinality as x(v, ord)
          where x.ord > 6 and trim(x.v) <> '')))
      from legado.bd_guias b), '[]'::jsonb),
    'salas', jsonb_build_object(
      'cabecalho', coalesce((select cabecalho from legado.salas_meta where id), '[]'::jsonb),
      'sincronizadoEm', (select sincronizado_em from legado.salas_meta where id),
      'linhas', coalesce((select jsonb_agg(s.celulas order by s.linha) from legado.salas_painel s), '[]'::jsonb)),
    'sync', jsonb_build_object(
      'atendimentos', (select max(ultima_sincronizacao) from legado.planilhas where tenant_id = v_t),
      'agenda', (select max(agenda_sincronizada_em) from legado.planilhas where tenant_id = v_t),
      'bdGuias', (select max(sincronizado_em) from legado.bd_guias))
  ) into v_out;

  return v_out;
end;
$$;
alter function public.bi_base() set statement_timeout = '30s';
revoke execute on function public.bi_base() from public, anon;
grant execute on function public.bi_base() to authenticated;
