-- =====================================================================
-- migration_013 — Conferência de guias (3 pontas)
--
-- Para cada sessão da aba Atendimentos de cada psicóloga, no mês:
--   • PSICÓLOGA: guia (col. E), anexo da guia (col. H: "Guia 123…"/"Guia_…"
--     = anexou; "-", vazio ou "#ERROR!" = sem anexo), status (col. S)
--   • ADMIN: a guia foi lançada no ADM Registro de Guia (legado.bd_guias)?
--     Plano informado pelo admin (col. F da BD_GUIAS)
--   • PLANO: Unimed (XML, sessão a sessão: guia + data) ou Bradesco (lote
--     Orizon = nº da guia; pago quando confirmado na Agenda)
-- E o caminho inverso: guias lançadas pelo admin no mês que não existem
-- em nenhuma aba Atendimentos (sessão não registrada pela psicóloga).
-- =====================================================================

create or replace function public.conferencia_guias(p_ano int, p_mes int)
returns table (
  origem text,              -- 'sessao' | 'so_admin'
  spreadsheet_id text,
  psicologa text,
  paciente text,
  data_sessao date,
  guia text,
  tipo_atendimento text,
  anexo text,               -- 'sim' | 'nao'
  anexo_texto text,
  status_s text,
  status_classe text,       -- faturada | pendente | falta | glosa | outro
  admin_registrou boolean,
  plano text,
  plano_fonte text,         -- admin | unimed_xml | orizon | formato_guia | desconhecido
  operadora_status text,    -- pago | glosado | parcial | guia_sem_esta_sessao | aguardando | lote_enviado | lote_pago | sem_retorno_integrado
  operadora_valor numeric,
  operadora_glosa numeric,
  operadora_codigos text,
  operadora_ref text,       -- demonstrativo / lote
  valor_planilha numeric
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_t uuid := current_tenant_id();
  v_ini date := make_date(p_ano, p_mes, 1);
  v_fim date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  -- guias lançadas pelo admin (qualquer mês) + plano e mês/ano da linha
  create temp table if not exists _cg_bd (g text, plano text, mes int, ano int, psi text, paciente text) on commit drop;
  truncate _cg_bd;
  insert into _cg_bd
  select distinct trim(x.v), nullif(trim(b.celulas->>5), ''),
         nullif(regexp_replace(coalesce(b.celulas->>1, ''), '\D', '', 'g'), '')::int,
         nullif(regexp_replace(coalesce(b.celulas->>2, ''), '\D', '', 'g'), '')::int,
         trim(coalesce(b.celulas->>3, '')), trim(coalesce(b.celulas->>4, ''))
    from legado.bd_guias b, jsonb_array_elements_text(b.celulas) with ordinality as x(v, ord)
   where x.ord > 6 and trim(x.v) <> '' and upper(trim(x.v)) <> 'GUIA';

  return query
  with s as (
    select a.spreadsheet_id,
           coalesce(p.nome_abreviado, p.nome_completo) as psi,
           trim(coalesce(a.celulas->>2, '')) as pac,
           legado.celula_data(a.celulas->3) as d,
           trim(coalesce(a.celulas->>4, '')) as g,
           trim(coalesce(a.celulas->>6, '')) as tipo,
           trim(coalesce(a.celulas->>7, '')) as anexo_txt,
           trim(coalesce(a.celulas->>18, '')) as st,
           case when jsonb_typeof(a.celulas->13) = 'number' then (a.celulas->>13)::numeric end as valor
      from legado.atendimentos_raw a
      join legado.planilhas p on p.spreadsheet_id = a.spreadsheet_id
     where p.tenant_id = v_t
  ), s_mes as (
    select * from s where s.d between v_ini and v_fim
  ), bd1 as (
    select distinct on (g) g, plano from _cg_bd order by g, (plano is null)
  ), xml as (
    select c.provider_guide_number as g, c.realization_date as d,
           sum(c.released_value) as lib, sum(coalesce(c.gloss_value, 0)) as glo,
           string_agg(distinct c.statement_number, ', ') as dem,
           array_agg(c.id) as ids
      from claim_items_current c
     where c.tenant_id = v_t
     group by 1, 2
  ), xml_g as (
    select distinct provider_guide_number as g from claim_items_current where tenant_id = v_t
  ), lote as (
    select external_ref as g, sum(amount) as valor, bool_and(status = 'realizado') as pago,
           min(expected_date) as prev, string_agg(distinct coalesce(protocol, external_ref), ', ') as ref
      from cashflow_items
     where tenant_id = v_t and source = 'orizon' and status <> 'cancelado'
     group by 1
  )
  select 'sessao'::text,
         s.spreadsheet_id, s.psi, s.pac, s.d, s.g, s.tipo,
         case when s.anexo_txt = '' or s.anexo_txt in ('-', '#ERROR!') then 'nao' else 'sim' end,
         s.anexo_txt,
         s.st,
         case
           when upper(s.st) = 'OK' then 'faturada'
           when s.st = '' then 'pendente'
           when upper(s.st) like '%FALTA%' or upper(s.st) = 'FALTOU' then 'falta'
           when upper(s.st) like '%GLOSA%' then 'glosa'
           else 'outro'
         end,
         (s.g <> '' and exists (select 1 from _cg_bd b where b.g = s.g)),
         coalesce(bd1.plano,
                  case when xg.g is not null then 'Unimed'
                       when l.g is not null then 'Bradesco'
                       when s.g ~ '^50\d{9}$' then 'Unimed'
                       when s.g ~ '^1\d{9}$' then 'Bradesco' end),
         case when bd1.plano is not null then 'admin'
              when xg.g is not null then 'unimed_xml'
              when l.g is not null then 'orizon'
              when s.g ~ '^50\d{9}$' or s.g ~ '^1\d{9}$' then 'formato_guia'
              else 'desconhecido' end,
         case
           when x.g is not null and x.lib > 0 and x.glo > 0 then 'parcial'
           when x.g is not null and x.lib > 0 then 'pago'
           when x.g is not null then 'glosado'
           when xg.g is not null then 'guia_sem_esta_sessao'
           when l.g is not null and l.pago then 'lote_pago'
           when l.g is not null then 'lote_enviado'
           when s.g ~ '^50\d{9}$' or upper(coalesce(bd1.plano, '')) like 'UNIMED%' then 'aguardando'
           when s.g ~ '^1\d{9}$' or upper(coalesce(bd1.plano, '')) like 'BRADESCO%' then 'aguardando'
           else 'sem_retorno_integrado'
         end,
         coalesce(x.lib, l.valor),
         x.glo,
         (select string_agg(distinct gl.gloss_code, ', ') from claim_return_glosses gl where gl.claim_return_id = any (x.ids)),
         coalesce(x.dem, case when l.g is not null then 'lote ' || l.ref || case when not l.pago then ' · previsto ' || to_char(l.prev, 'DD/MM') else '' end end),
         s.valor
    from s_mes s
    left join bd1 on bd1.g = s.g and s.g <> ''
    left join xml x on x.g = s.g and x.d = s.d and s.g <> ''
    left join xml_g xg on xg.g = s.g and s.g <> ''
    left join lote l on l.g = s.g and s.g <> ''
  union all
  -- admin lançou a guia neste mês, mas nenhuma psicóloga registrou sessão com ela
  select 'so_admin'::text, null, b.psi, b.paciente, null::date, b.g, null, null, null, null, null,
         true, b.plano, 'admin',
         case when xg.g is not null then 'guia_no_xml' when l.g is not null then 'lote_enviado' else 'sem_retorno_integrado' end,
         l.valor, null, null, null, null
    from (select distinct g, plano, psi, paciente from _cg_bd where mes = p_mes and ano = p_ano) b
    left join xml_g xg on xg.g = b.g
    left join lote l on l.g = b.g
   where not exists (select 1 from s where s.g = b.g);
end;
$$;

alter function public.conferencia_guias(int, int) set statement_timeout = '30s';
revoke execute on function public.conferencia_guias(int, int) from public, anon;
grant execute on function public.conferencia_guias(int, int) to authenticated;
