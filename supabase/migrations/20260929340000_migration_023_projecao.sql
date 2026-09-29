-- =====================================================================
-- migration_023 — Base da Projeção (curva de vendas + probabilidades)
--   Uma função só, projecao_base(), devolve as séries históricas que o
--   simulador (Monte Carlo, lib/financeiro/projecao.ts) usa. Nenhum nome
--   de paciente sai daqui — pacientes são contados por hash.
--     • semanas: sessões realizadas/faltas por semana × plano (planilhas)
--     • atraso de registro: % das sessões já lançadas k dias depois
--       (corrige as últimas semanas, que ainda não foram todas lançadas)
--     • pacientes por mês: ativos, novos, perdidos
--     • Unimed: demonstrativos (XML) e quanto o banco pagou de cada um
--     • Bradesco: lotes Orizon por mês de referência
--     • previstos futuros da Agenda
--     • DRE de caixa (extrato Cora) deste ano e do anterior
-- =====================================================================

create or replace function public.projecao_base()
returns jsonb
language plpgsql
volatile  -- usa tabela temporária
security definer
set search_path = public, pg_temp
as $$
declare
  v_t uuid := current_tenant_id();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_ano int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
  v_out jsonb := '{}'::jsonb;
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  create temp table if not exists _pj_s (
    d date, reg date, sit text, guia text, pac text, plano text, psi text
  ) on commit drop;
  truncate _pj_s;

  insert into _pj_s
  with base as (
    select legado.celula_data(a.celulas->3) as d,
           legado.celula_data(a.celulas->0) as reg,
           upper(trim(coalesce(a.celulas->>6, ''))) as tipo,
           upper(trim(coalesce(a.celulas->>18, ''))) as st,
           trim(coalesce(a.celulas->>4, '')) as guia,
           md5(upper(regexp_replace(trim(coalesce(a.celulas->>2, '')), '\s+', ' ', 'g'))) as pac,
           a.spreadsheet_id as psi
      from legado.atendimentos_raw a
      join legado.planilhas p on p.spreadsheet_id = a.spreadsheet_id
     where p.tenant_id = v_t
  )
  select b.d, b.reg,
         case
           when b.tipo like '%FALTA%' or b.st like '%FALTA%' or b.st = 'FALTOU' then 'falta'
           when b.tipo like 'SEM COMPARECIMENTO%' then 'justificada'
           when b.tipo like 'SESS%REALIZADA' then 'realizada'
           else 'outro'
         end,
         b.guia, b.pac,
         case
           when b.guia ~ '^50\d{9}$' then 'unimed'
           when b.guia ~ '^1\d{9}$' then 'bradesco'
           else 'outros'
         end,
         b.psi
    from base b
   where b.d is not null and b.d >= (v_mes - interval '14 months')::date;

  v_out := jsonb_build_object('hoje', v_hoje, 'ano', v_ano);

  -- ---------- sessões por semana × plano ----------
  v_out := v_out || jsonb_build_object('semanas', coalesce((
    select jsonb_agg(x order by x.semana, x.plano) from (
      select date_trunc('week', s.d)::date as semana, s.plano,
             count(*) filter (where s.sit = 'realizada' and s.d <= v_hoje) as realizadas,
             count(*) filter (where s.sit = 'falta' and s.d <= v_hoje) as faltas,
             count(*) filter (where s.sit = 'justificada' and s.d <= v_hoje) as justificadas,
             count(*) filter (where s.d > v_hoje) as agendadas
        from _pj_s s
       where s.d >= (v_hoje - 7 * 52)
       group by 1, 2
    ) x
  ), '[]'::jsonb));

  -- ---------- sessões por mês × plano ----------
  v_out := v_out || jsonb_build_object('mensal_plano', coalesce((
    select jsonb_agg(x order by x.mes, x.plano) from (
      select date_trunc('month', s.d)::date as mes, s.plano,
             count(*) filter (where s.sit = 'realizada') as realizadas,
             count(*) filter (where s.sit = 'falta') as faltas,
             count(*) filter (where s.sit = 'justificada') as justificadas
        from _pj_s s
       where s.d <= v_hoje
       group by 1, 2
    ) x
  ), '[]'::jsonb));

  -- ---------- atraso de registro: % lançado até k dias após a sessão ----------
  v_out := v_out || jsonb_build_object('atraso_registro', (
    with amostra as (
      select greatest(s.reg - s.d, 0) as dias
        from _pj_s s
       where s.sit = 'realizada' and s.reg is not null
         and s.d between v_hoje - 150 and v_hoje - 45
    )
    select jsonb_build_object(
      'amostra', (select count(*) from amostra),
      'acumulado', coalesce((
        select jsonb_agg(round(((select count(*) from amostra where dias <= k)::numeric
                                / nullif((select count(*) from amostra), 0)), 4) order by k)
          from generate_series(0, 40) k
      ), '[]'::jsonb)
    )
  ));

  -- ---------- pacientes por mês ----------
  v_out := v_out || jsonb_build_object('pacientes', coalesce((
    with pm as (
      select distinct date_trunc('month', d)::date as mes, pac from _pj_s where sit = 'realizada' and d <= v_hoje
    ), prim as (
      select pac, min(mes) as m1 from pm group by pac
    )
    select jsonb_agg(x order by x.mes) from (
      select m.mes,
             count(*) as ativos,
             count(*) filter (where pr.m1 = m.mes) as novos,
             (select count(*) from pm a
               where a.mes = (m.mes - interval '1 month')::date
                 and not exists (select 1 from pm b where b.pac = a.pac and b.mes = m.mes)) as perdidos,
             (select count(*) from _pj_s s where s.sit = 'realizada' and s.d <= v_hoje
                and date_trunc('month', s.d)::date = m.mes) as sessoes,
             (select count(distinct s.psi) from _pj_s s where s.sit = 'realizada' and s.d <= v_hoje
                and date_trunc('month', s.d)::date = m.mes) as psicologas
        from pm m
        join prim pr on pr.pac = m.pac
       group by m.mes
    ) x
  ), '[]'::jsonb));

  -- ---------- Unimed: demonstrativos (XML) × pago no banco ----------
  v_out := v_out || jsonb_build_object('unimed_xml', coalesce((
    select jsonb_agg(x order by x.emissao) from (
      select s.statement_number as numero, s.emission_date as emissao,
             s.items_informed as informado, s.items_released as liberado, s.items_gloss as glosa,
             s.item_count as itens,
             c.status, c.expected_date as previsto_para, c.realized_date as pago_em,
             c.realized_amount as pago, c.realized_source as fonte
        from claim_statements s
        left join cashflow_items c on c.tenant_id = s.tenant_id and c.source = 'unimed_xml'
                                  and c.insurance_plan_id = s.insurance_plan_id and c.external_ref = s.statement_number
       where s.tenant_id = v_t and s.items_released > 0
    ) x
  ), '[]'::jsonb));

  v_out := v_out || jsonb_build_object('unimed_mensal', coalesce((
    select jsonb_agg(x order by x.month) from (
      select m.month, m.sessions, m.informed, m.released, m.gloss, m.median_days_to_statement
        from claim_monthly_summary m
       where m.tenant_id = v_t
    ) x
  ), '[]'::jsonb));

  -- valor liberado por sessão Unimed (sessões conferidas nos últimos 180 dias)
  v_out := v_out || jsonb_build_object('unimed_sessao', (
    select jsonb_build_object('sessoes', count(*), 'media', round(avg(c.released_value), 2),
                              'dp', round(stddev_samp(c.released_value), 2))
      from _pj_s s
      join claim_items_current c on c.tenant_id = v_t and c.provider_guide_number = s.guia and c.realization_date = s.d
     where s.sit = 'realizada' and s.d > v_hoje - 180
  ));

  -- ---------- Bradesco: lotes Orizon ----------
  v_out := v_out || jsonb_build_object('bradesco', coalesce((
    select jsonb_agg(x order by x.mes) from (
      select date_trunc('month', c.reference_date)::date as mes, count(*) as guias, sum(c.amount) as valor,
             round(avg(c.expected_date - c.reference_date)) as dias_ate_pagar,
             sum(c.amount) filter (where c.status = 'realizado') as recebido
        from cashflow_items c
       where c.tenant_id = v_t and c.source = 'orizon' and c.status <> 'cancelado'
       group by 1
    ) x
  ), '[]'::jsonb));

  -- ---------- Bradesco: lotes pelo mês previsto de pagamento ----------
  v_out := v_out || jsonb_build_object('bradesco_pagto', coalesce((
    select jsonb_agg(x order by x.mes) from (
      select date_trunc('month', c.expected_date)::date as mes,
             sum(c.amount) filter (where c.expected_date <= v_hoje) as ate_hoje,
             sum(c.amount) filter (where c.expected_date > v_hoje) as futuro,
             count(*) as guias
        from cashflow_items c
       where c.tenant_id = v_t and c.source = 'orizon' and c.status <> 'cancelado'
       group by 1
    ) x
  ), '[]'::jsonb));

  -- ---------- previstos futuros da Agenda (ainda não realizados) ----------
  v_out := v_out || jsonb_build_object('previstos', coalesce((
    select jsonb_agg(x order by x.mes, x.kind, x.fonte) from (
      select date_trunc('month', greatest(c.calendar_date, v_hoje))::date as mes, c.kind,
             case when c.source = 'unimed_xml' then 'unimed'
                  when c.source in ('orizon') then 'bradesco'
                  else coalesce(c.category, c.source) end as fonte,
             sum(c.amount) as valor, count(*) as qtd,
             sum(c.amount) filter (where c.calendar_date < v_hoje) as atrasado
        from cashflow_calendar c
       where c.tenant_id = v_t and c.status = 'previsto'
         and c.calendar_date >= v_hoje - 60
       group by 1, 2, 3
    ) x
  ), '[]'::jsonb));

  -- ---------- DRE de caixa (Cora) deste ano e do anterior ----------
  v_out := v_out || jsonb_build_object('dre', coalesce((
    select jsonb_agg(x) from (
      select v_ano as ano, d.* from dre_caixa(v_ano) d
      union all
      select v_ano - 1, d.* from dre_caixa(v_ano - 1) d
    ) x
  ), '[]'::jsonb));

  v_out := v_out || jsonb_build_object('banco', (
    select jsonb_build_object('primeiro', min(occurred_on), 'ultimo', max(occurred_on),
                              'saldo_movimento_ano', sum(case when kind = 'entrada' then amount else -amount end)
                                filter (where extract(year from occurred_on) = v_ano))
      from bank_transactions where tenant_id = v_t
  ));

  return v_out;
end;
$$;

alter function public.projecao_base() set statement_timeout = '30s';
revoke execute on function public.projecao_base() from public, anon;
grant execute on function public.projecao_base() to authenticated;
