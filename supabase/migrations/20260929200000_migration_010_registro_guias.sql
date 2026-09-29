-- =====================================================================
-- migration_010 — ADM Registro de Guia no HOPE CORE (fase de transição)
--
-- Contexto: o financeiro digita as guias de cada paciente por semana no
-- "ADM Registro de Guia" (Apps Script, aba BD_GUIAS) e marca OK/GLOSA na
-- coluna S da aba Atendimentos da planilha de cada psicóloga — é essa
-- coluna S que o repasse (RPA) conta.
--
-- Decisão (29/09/2026): "grava nos dois". A página nova usa as MESMAS
-- funções do Apps Script (via PonteRegistroGuias.gs, protegida por token)
-- e, quando a planilha confirma a gravação, o banco é atualizado na hora:
--   • OK/GLOSA/FALTA  → coluna S da cópia legado.atendimentos_raw
--   • guias digitadas → cópia da aba BD_GUIAS (legado.bd_guias)
-- A sincronização de hora em hora continua corrigindo qualquer diferença.
--
-- Novidades para o financeiro:
--   • claim_status_por_guias(): o que a Unimed fez com cada guia
--     (pagou, glosou, ainda não processou) — guia da planilha (coluna E)
--     = "guia do prestador" do XML TISS.
--   • guia_divergencias(): OK na planilha mas glosado pela Unimed; pago
--     pela Unimed sem OK na planilha; FALTA na planilha mas faturada.
-- =====================================================================

-- ----------------------------------------------------------------
-- Tabelas (schema legado: fora da API; acesso só pelas funções)
-- ----------------------------------------------------------------
create table if not exists legado.bd_guias (
  linha int primary key,             -- número da linha na aba BD_GUIAS (2 = 1ª linha de dados)
  celulas jsonb not null,            -- Data | Mês | Ano | Psicóloga | Paciente | Plano | S1 G1 | S1 G2 | ... | extras
  sincronizado_em timestamptz not null default now()
);

create table if not exists legado.registro_log (
  id bigint generated always as identity primary key,
  tenant_id uuid,
  user_id uuid,
  funcao text not null,
  args jsonb,
  resposta jsonb,
  linhas_espelhadas int not null default 0,
  criado_em timestamptz not null default now()
);

create index if not exists idx_legado_registro_log_data on legado.registro_log (criado_em desc);

revoke all on all tables in schema legado from public, anon, authenticated;

-- ----------------------------------------------------------------
-- Auxiliares
-- ----------------------------------------------------------------
-- Troca a célula de índice p_idx (0 = coluna A) de uma linha crua,
-- completando com "" quando a linha tem menos colunas.
create or replace function legado.set_celula(p_celulas jsonb, p_idx int, p_valor jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  v jsonb := case when jsonb_typeof(p_celulas) = 'array' then p_celulas else '[]'::jsonb end;
begin
  while jsonb_array_length(v) <= p_idx loop
    v := v || '[""]'::jsonb;
  end loop;
  return jsonb_set(v, array[p_idx::text], p_valor);
end;
$$;

-- Data de uma célula crua: {"$date": "..."} ou texto dd/mm/aaaa.
-- Datas antes de 2000 (célula vazia virando 1969) contam como sem data.
create or replace function legado.celula_data(p jsonb)
returns date
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  v_d date;
  m text[];
begin
  if p is null then return null; end if;
  if jsonb_typeof(p) = 'object' and p ? '$date' then
    begin
      v_d := substr(p->>'$date', 1, 10)::date;
    exception when others then
      return null;
    end;
  elsif jsonb_typeof(p) = 'string' then
    m := regexp_match(p #>> '{}', '(\d{1,2})/(\d{1,2})/(\d{4})');
    if m is null then return null; end if;
    begin
      v_d := make_date(m[3]::int, m[2]::int, m[1]::int);
    exception when others then
      return null;
    end;
  else
    return null;
  end if;
  if v_d < date '2000-01-01' then return null; end if;
  return v_d;
end;
$$;

-- ----------------------------------------------------------------
-- Espelho completo da aba BD_GUIAS (enviado pelo Apps Script, com token)
-- p = {"linhas": [{"linha": 2, "celulas": [...]}, ...]}
-- ----------------------------------------------------------------
create or replace function public.legacy_ingest_bd_guias(p_token text, p jsonb)
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

  perform pg_advisory_xact_lock(hashtextextended('legado:bd_guias', 0));
  delete from legado.bd_guias where true;
  insert into legado.bd_guias (linha, celulas)
  select (l->>'linha')::int, l->'celulas'
    from jsonb_array_elements(p->'linhas') l
   where jsonb_typeof(l->'celulas') = 'array';
  get diagnostics v_n = row_count;

  insert into legado.sync_log (nome, linhas, status, mensagem) values ('BD_GUIAS', v_n, 'ok', null);
  return jsonb_build_object('status', 'ok', 'linhas', v_n);
end;
$$;

alter function public.legacy_ingest_bd_guias(text, jsonb) set statement_timeout = '60s';
revoke execute on function public.legacy_ingest_bd_guias(text, jsonb) from public;
grant execute on function public.legacy_ingest_bd_guias(text, jsonb) to anon, authenticated;

-- ----------------------------------------------------------------
-- Espelha no banco o que a página nova acabou de gravar na planilha
-- (só depois que o Apps Script confirmou). Só financeiro.
-- p = {"funcao": "...", "args": [...], "resposta": {...}, "extra": {...}}
-- ----------------------------------------------------------------
create or replace function public.legacy_registro_espelhar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_fn text := p->>'funcao';
  v_res jsonb := coalesce(p->'resposta', '{}'::jsonb);
  v_extra jsonb := coalesce(p->'extra', '{}'::jsonb);
  v_n int := 0;
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  if v_fn = 'salvarStatusGuia'
     and jsonb_typeof(v_res) = 'object'
     and (v_res->>'sucesso') = 'true'
     and coalesce(v_extra->>'idPlanilha', '') <> '' then
    update legado.atendimentos_raw r
       set celulas = legado.set_celula(r.celulas, 18, to_jsonb(coalesce(v_res->>'valorSalvo', ''))),
           sincronizado_em = now()
     where r.spreadsheet_id = v_extra->>'idPlanilha'
       and exists (select 1 from legado.planilhas pl
                    where pl.spreadsheet_id = r.spreadsheet_id and pl.tenant_id = v_tenant)
       and r.linha in (select x::int from jsonb_array_elements_text(
                         case when jsonb_typeof(v_res->'linhas') = 'array' then v_res->'linhas' else '[]'::jsonb end) x)
       and trim(coalesce(r.celulas->>4, '')) = trim(coalesce(p->'args'->>1, ''));
    get diagnostics v_n = row_count;

  elsif v_fn = 'salvarDadosPaciente'
     and jsonb_typeof(v_res) = 'object'
     and (v_res->>'sucesso') = 'true'
     and coalesce(v_res->>'linha', '') ~ '^\d+$'
     and jsonb_typeof(v_extra->'linhaValores') = 'array' then
    insert into legado.bd_guias (linha, celulas)
    values ((v_res->>'linha')::int, v_extra->'linhaValores')
    on conflict (linha) do update set celulas = excluded.celulas, sincronizado_em = now();
    v_n := 1;
  end if;

  insert into legado.registro_log (tenant_id, user_id, funcao, args, resposta, linhas_espelhadas)
  values (v_tenant, auth.uid(), coalesce(v_fn, '?'), p->'args', v_res, v_n);

  return jsonb_build_object('espelhadas', v_n);
end;
$$;

revoke execute on function public.legacy_registro_espelhar(jsonb) from public, anon;
grant execute on function public.legacy_registro_espelhar(jsonb) to authenticated;

-- ----------------------------------------------------------------
-- O que a Unimed fez com cada guia (guia do prestador), a partir da
-- versão mais recente de cada sessão nos demonstrativos. Só financeiro.
-- ----------------------------------------------------------------
create or replace function public.claim_status_por_guias(p_guias text[])
returns table (
  guia text,
  sessoes int,
  informado numeric,
  liberado numeric,
  glosado numeric,
  codigos_glosa text,
  demonstrativos text,
  ultima_emissao date,
  datas_sessao text
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if coalesce(array_length(p_guias, 1), 0) > 3000 then
    raise exception 'Máximo de 3000 guias por consulta';
  end if;

  return query
  with alvo as (
    select distinct trim(g) as g from unnest(p_guias) g where coalesce(trim(g), '') <> ''
  ), itens as (
    select c.*
      from claim_items_current c
      join alvo a on a.g = c.provider_guide_number
     where c.tenant_id = current_tenant_id()
  )
  select i.provider_guide_number,
         count(*)::int,
         sum(i.informed_value),
         sum(i.released_value),
         sum(coalesce(i.gloss_value, 0)),
         (select string_agg(distinct gl.gloss_code, ', ' order by gl.gloss_code)
            from claim_return_glosses gl
           where gl.claim_return_id in (select i2.id from itens i2 where i2.provider_guide_number = i.provider_guide_number)),
         string_agg(distinct i.statement_number, ', ' order by i.statement_number),
         max(i.emission_date),
         string_agg(distinct to_char(i.realization_date, 'DD/MM'), ', ')
    from itens i
   group by i.provider_guide_number;
end;
$$;

revoke execute on function public.claim_status_por_guias(text[]) from public, anon;
grant execute on function public.claim_status_por_guias(text[]) to authenticated;

-- ----------------------------------------------------------------
-- Divergências planilhas × Unimed (só guias que aparecem nos XMLs)
--   ok_glosado     : OK na planilha, mas a Unimed glosou (valor glosado > 0)
--   pago_sem_ok    : a Unimed liberou valor, mas a planilha não tem OK
--   falta_faturada : FALTA na planilha, mas a guia foi faturada
-- ----------------------------------------------------------------
create or replace function public.guia_divergencias()
returns table (
  tipo text,
  spreadsheet_id text,
  psicologa text,
  guia text,
  paciente text,
  datas_planilha text,
  status_planilha text,
  mes int,
  ano int,
  informado numeric,
  liberado numeric,
  glosado numeric,
  codigos_glosa text,
  demonstrativos text,
  datas_unimed text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_tenant uuid := current_tenant_id();
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  return query
  with pl as (
    select r.spreadsheet_id,
           trim(r.celulas->>4) as g,
           trim(coalesce(r.celulas->>2, '')) as pac,
           legado.celula_data(r.celulas->3) as d,
           upper(trim(coalesce(r.celulas->>18, ''))) as st,
           trim(coalesce(r.celulas->>18, '')) as st_original
      from legado.atendimentos_raw r
      join legado.planilhas p on p.spreadsheet_id = r.spreadsheet_id
     where p.tenant_id = v_tenant
       and coalesce(trim(r.celulas->>4), '') <> ''
  ), sg as (
    select pl.spreadsheet_id, pl.g,
           min(pl.pac) as pac,
           string_agg(distinct to_char(pl.d, 'DD/MM/YYYY'), ', ') as datas,
           string_agg(distinct nullif(pl.st_original, ''), ' | ') as status,
           min(pl.d) as primeira,
           bool_or(pl.st = 'OK') as tem_ok,
           bool_or(pl.st like '%FALTA%') as tem_falta
      from pl
     group by pl.spreadsheet_id, pl.g
  ), x as (
    select c.provider_guide_number as g,
           sum(c.informed_value) as inf,
           sum(c.released_value) as lib,
           sum(coalesce(c.gloss_value, 0)) as glo,
           string_agg(distinct c.statement_number, ', ' order by c.statement_number) as dem,
           string_agg(distinct to_char(c.realization_date, 'DD/MM'), ', ') as datas,
           array_agg(c.id) as ids
      from claim_items_current c
     where c.tenant_id = v_tenant
     group by c.provider_guide_number
  ), junta as (
    select case
             when sg.tem_falta then 'falta_faturada'
             when sg.tem_ok and x.glo > 0 then 'ok_glosado'
             when not sg.tem_ok and x.lib > 0 then 'pago_sem_ok'
           end as tipo,
           sg.*, x.inf, x.lib, x.glo, x.dem, x.datas as datas_x, x.ids
      from sg
      join x on x.g = sg.g
  )
  select j.tipo,
         j.spreadsheet_id,
         coalesce(p.nome_abreviado, p.nome_completo),
         j.g,
         j.pac,
         j.datas,
         coalesce(j.status, ''),
         extract(month from j.primeira)::int,
         extract(year from j.primeira)::int,
         j.inf, j.lib, j.glo,
         (select string_agg(distinct gl.gloss_code, ', ' order by gl.gloss_code)
            from claim_return_glosses gl where gl.claim_return_id = any (j.ids)),
         j.dem,
         j.datas_x
    from junta j
    join legado.planilhas p on p.spreadsheet_id = j.spreadsheet_id
   where j.tipo is not null
   order by j.tipo, p.ordem nulls last, j.primeira;
end;
$$;

alter function public.guia_divergencias() set statement_timeout = '30s';
revoke execute on function public.guia_divergencias() from public, anon;
grant execute on function public.guia_divergencias() to authenticated;
