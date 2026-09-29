-- =====================================================================
-- migration_012 — Painel de gestão (tela inicial do HOPE CORE)
--
-- Uma função só, public.painel_gestao(), que cruza TUDO o que já está no
-- banco e devolve os números prontos (nenhum nome de paciente sai daqui —
-- pacientes são contados por um hash do nome):
--   • Atendimentos das planilhas das psicólogas (legado.atendimentos_raw):
--       coluna A = registro, C = paciente, D = data da sessão, E = guia,
--       G = tipo de atendimento, N = valor (tabela), S = status/faturamento
--   • Demonstrativos Unimed (claim_items_current / claim_monthly_summary)
--   • Lotes Bradesco/Orizon e agenda financeira (cashflow_items / cashflow_calendar)
--   • Registro de Guias (legado.bd_guias) e divergências (guia_divergencias)
-- Plano de cada sessão: confirmado pelo XML da Unimed ou pelo lote da
-- Orizon; se ainda não apareceu, pelo formato do número da guia
-- (Unimed = 11 dígitos começando com 50; Bradesco = 10 dígitos começando com 1).
-- =====================================================================

create or replace function public.painel_gestao()
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
  v_out jsonb := '{}'::jsonb;
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  create temp table if not exists _pg_s (
    spreadsheet_id text, psi text, ativo boolean, d date, reg date, mes date,
    sit text, fat text, valor numeric, guia text, pac text, plano text, plano_confirmado boolean
  ) on commit drop;
  truncate _pg_s;

  insert into _pg_s
  with base as (
    select p.spreadsheet_id,
           coalesce(p.nome_abreviado, p.nome_completo) as psi,
           p.ativo,
           legado.celula_data(a.celulas->3) as d,
           legado.celula_data(a.celulas->0) as reg,
           upper(trim(coalesce(a.celulas->>6, ''))) as tipo,
           upper(trim(coalesce(a.celulas->>18, ''))) as st,
           case when jsonb_typeof(a.celulas->13) = 'number' then (a.celulas->>13)::numeric end as valor,
           trim(coalesce(a.celulas->>4, '')) as guia,
           md5(upper(regexp_replace(trim(coalesce(a.celulas->>2, '')), '\s+', ' ', 'g'))) as pac
      from legado.atendimentos_raw a
      join legado.planilhas p on p.spreadsheet_id = a.spreadsheet_id
     where p.tenant_id = v_t
  ), unimed as (
    select distinct provider_guide_number as g from claim_items_current where tenant_id = v_t
  ), brad as (
    select distinct external_ref as g from cashflow_items where tenant_id = v_t and source = 'orizon'
  )
  select b.spreadsheet_id, b.psi, b.ativo, b.d, b.reg, date_trunc('month', b.d)::date,
         case
           when b.tipo like '%FALTA%' or b.st like '%FALTA%' or b.st = 'FALTOU' then 'falta'
           when b.tipo like 'SEM COMPARECIMENTO%' then 'justificada'
           when b.tipo like 'SESS%REALIZADA' then 'realizada'
           else 'outro'
         end,
         case
           when b.st = 'OK' then 'faturada'
           when b.st = '' then 'pendente'
           when b.st like '%FALTA%' or b.st = 'FALTOU' then 'falta'
           when b.st like '%GLOSA%' then 'glosa'
           else 'outro'
         end,
         b.valor, b.guia, b.pac,
         case
           when u.g is not null then 'Unimed'
           when br.g is not null then 'Bradesco'
           when b.guia ~ '^50\d{9}$' then 'Unimed'
           when b.guia ~ '^1\d{9}$' then 'Bradesco'
           when b.guia = '' then 'Sem guia'
           else 'Outros planos'
         end,
         (u.g is not null or br.g is not null)
    from base b
    left join unimed u on u.g = b.guia and b.guia <> ''
    left join brad br on br.g = b.guia and b.guia <> ''
   where b.d is not null and b.d <= v_hoje + 7;

  -- ---------- produção mensal (12 meses) ----------
  v_out := v_out || jsonb_build_object('mensal', coalesce((
    with primeira as (select pac, min(d) as d1 from _pg_s where sit = 'realizada' group by pac)
    select jsonb_agg(x order by x.mes) from (
      select s.mes,
             count(*) filter (where s.sit = 'realizada') as realizadas,
             count(*) filter (where s.sit = 'falta') as faltas,
             count(*) filter (where s.sit = 'justificada') as justificadas,
             count(distinct s.pac) filter (where s.sit = 'realizada') as pacientes,
             count(distinct s.pac) filter (where s.sit = 'realizada' and date_trunc('month', pr.d1) = s.mes) as novos,
             count(*) filter (where s.fat = 'faturada') as faturadas,
             count(*) filter (where s.fat = 'pendente' and s.sit = 'realizada') as pendentes,
             coalesce(sum(s.valor) filter (where s.fat = 'faturada'), 0) as valor_ok,
             count(distinct s.spreadsheet_id) filter (where s.sit = 'realizada') as psicologas
        from _pg_s s
        left join primeira pr on pr.pac = s.pac
       where s.mes >= (v_mes - interval '11 months')::date and s.mes <= v_mes
       group by s.mes
    ) x
  ), '[]'::jsonb));

  -- ---------- por psicóloga ----------
  v_out := v_out || jsonb_build_object('psicologas', coalesce((
    select jsonb_agg(x order by x.realizadas_mes_anterior desc, x.psi) from (
      select s.spreadsheet_id, s.psi, bool_or(s.ativo) as ativo,
             count(*) filter (where s.sit = 'realizada' and s.mes = v_mes and s.d <= v_hoje) as realizadas_mes,
             count(*) filter (where s.sit = 'realizada' and s.mes = (v_mes - interval '1 month')::date) as realizadas_mes_anterior,
             round(count(*) filter (where s.sit = 'realizada' and s.mes between (v_mes - interval '3 months')::date and (v_mes - interval '1 month')::date) / 3.0, 1) as media_3m,
             count(*) filter (where s.sit = 'falta' and s.d > v_hoje - 90) as faltas_90,
             count(*) filter (where s.sit in ('realizada', 'falta', 'justificada') and s.d > v_hoje - 90) as agendadas_90,
             count(distinct s.pac) filter (where s.sit = 'realizada' and s.d > v_hoje - 30 and s.d <= v_hoje) as pacientes_ativos,
             count(*) filter (where s.fat = 'pendente' and s.sit = 'realizada' and s.d < v_hoje - 30) as pendentes_antigas,
             coalesce(sum(s.valor) filter (where s.fat = 'pendente' and s.sit = 'realizada' and s.d < v_hoje - 30), 0) as valor_pendente_antigo,
             percentile_cont(0.5) within group (order by (s.reg - s.d))
               filter (where s.reg is not null and s.reg >= s.d and s.d > v_hoje - 90) as dias_para_registrar,
             coalesce(sum(s.valor) filter (where s.fat = 'faturada' and s.mes = (v_mes - interval '1 month')::date), 0) as valor_ok_mes_anterior
        from _pg_s s
       group by s.spreadsheet_id, s.psi
      having bool_or(s.ativo) or count(*) filter (where s.d > v_hoje - 90) > 0
    ) x
  ), '[]'::jsonb));

  -- ---------- por plano (6 meses) ----------
  v_out := v_out || jsonb_build_object('planos', coalesce((
    select jsonb_agg(x order by x.mes, x.plano) from (
      select s.mes, s.plano,
             count(*) filter (where s.sit = 'realizada') as realizadas,
             count(*) filter (where s.sit = 'realizada' and s.plano_confirmado) as confirmadas,
             coalesce(sum(s.valor) filter (where s.fat = 'faturada'), 0) as valor_ok
        from _pg_s s
       where s.mes >= (v_mes - interval '5 months')::date and s.mes <= v_mes
       group by s.mes, s.plano
    ) x
  ), '[]'::jsonb));

  -- ---------- dia da semana (90 dias) ----------
  v_out := v_out || jsonb_build_object('semana', coalesce((
    select jsonb_agg(x order by x.dow) from (
      select extract(isodow from s.d)::int as dow,
             count(*) filter (where s.sit = 'realizada') as realizadas,
             count(*) filter (where s.sit = 'falta') as faltas
        from _pg_s s
       where s.d > v_hoje - 90 and s.d <= v_hoje
       group by 1
    ) x
  ), '[]'::jsonb));

  -- ---------- retenção de pacientes ----------
  v_out := v_out || jsonb_build_object('retencao', (
    with p30 as (select distinct pac from _pg_s where sit = 'realizada' and d > v_hoje - 30 and d <= v_hoje),
         p60 as (select distinct pac from _pg_s where sit = 'realizada' and d > v_hoje - 60 and d <= v_hoje - 30),
         prim as (select pac, min(d) d1 from _pg_s where sit = 'realizada' group by pac)
    select jsonb_build_object(
      'ativos_30', (select count(*) from p30),
      'ativos_31_60', (select count(*) from p60),
      'sem_sessao_ha_30', (select count(*) from p60 where pac not in (select pac from p30)),
      'novos_30', (select count(*) from prim where d1 > v_hoje - 30 and d1 <= v_hoje),
      'total_historico', (select count(*) from prim)
    )
  ));

  -- ---------- sessões sem status (faturamento parado) ----------
  v_out := v_out || jsonb_build_object('pendencias', (
    select jsonb_build_object(
      'ate_30_dias', count(*) filter (where d >= v_hoje - 30),
      'mais_30_dias', count(*) filter (where d < v_hoje - 30),
      'valor_mais_30_dias', coalesce(sum(valor) filter (where d < v_hoje - 30), 0),
      'mais_antiga', min(d)
    )
    from _pg_s where fat = 'pendente' and sit = 'realizada' and d <= v_hoje
  ));

  -- ---------- valor da planilha × valor pago pela Unimed (sessões conferidas, 6 meses) ----------
  v_out := v_out || jsonb_build_object('valor_real', coalesce((
    select jsonb_agg(x) from (
      select 'Unimed' as plano,
             count(*) as sessoes,
             round(avg(s.valor), 2) as media_planilha,
             round(avg(c.released_value), 2) as media_pago,
             round(avg(c.informed_value), 2) as media_informado
        from _pg_s s
        join claim_items_current c on c.provider_guide_number = s.guia and c.realization_date = s.d and c.tenant_id = v_t
       where s.sit = 'realizada' and s.d > v_hoje - 180 and s.valor > 0
      union all
      select 'Bradesco',
             count(*),
             round(avg(s.valor), 2),
             round(avg(ci.amount), 2),
             round(avg(ci.amount), 2)
        from _pg_s s
        join cashflow_items ci on ci.external_ref = s.guia and ci.source = 'orizon' and ci.tenant_id = v_t
       where s.sit = 'realizada' and s.d > v_hoje - 180 and s.valor > 0
    ) x where x.sessoes > 0
  ), '[]'::jsonb));

  -- ---------- guias registradas no ADM Registro de Guia (mês anterior) ----------
  v_out := v_out || jsonb_build_object('registro_guias', (
    with bd as (
      select distinct trim(x.v) as g
        from legado.bd_guias b, jsonb_array_elements_text(b.celulas) with ordinality as x(v, ord)
       where x.ord > 6 and trim(x.v) <> ''
    ), alvo as (
      select distinct guia from _pg_s
       where sit = 'realizada' and guia <> '' and mes = (v_mes - interval '1 month')::date
    )
    select jsonb_build_object(
      'guias_mes_anterior', (select count(*) from alvo),
      'registradas', (select count(*) from alvo where guia in (select g from bd)),
      'linhas_bd', (select count(*) from legado.bd_guias)
    )
  ));

  -- ---------- Unimed: demonstrativos por mês de atendimento ----------
  v_out := v_out || jsonb_build_object('unimed', coalesce((
    select jsonb_agg(x order by x.month) from (
      select m.month, m.sessions, m.informed, m.released, m.gloss, m.glossed_sessions, m.median_days_to_statement
        from claim_monthly_summary m
       where m.tenant_id = v_t and m.month >= (v_mes - interval '11 months')::date
    ) x
  ), '[]'::jsonb));

  -- ---------- divergências planilhas × Unimed ----------
  v_out := v_out || jsonb_build_object('divergencias', coalesce((
    select jsonb_agg(x) from (
      select tipo, count(*) as qtd, sum(glosado) as glosado, sum(liberado) as liberado
        from guia_divergencias() group by tipo
    ) x
  ), '[]'::jsonb));

  -- ---------- caixa (agenda financeira) ----------
  v_out := v_out || jsonb_build_object('caixa', (
    select jsonb_build_object(
      'receber_30', coalesce(sum(amount) filter (where kind = 'entrada' and status <> 'realizado' and calendar_date between v_hoje and v_hoje + 30), 0),
      'atrasado', coalesce(sum(amount) filter (where kind = 'entrada' and status <> 'realizado' and calendar_date < v_hoje), 0),
      'recebido_mes', coalesce(sum(coalesce(realized_amount, amount)) filter (where kind = 'entrada' and status = 'realizado' and date_trunc('month', calendar_date) = v_mes), 0),
      'pagar_30', coalesce(sum(amount) filter (where kind = 'saida' and status <> 'realizado' and calendar_date between v_hoje and v_hoje + 30), 0),
      'por_plano_30', coalesce((
        select jsonb_agg(y order by y.valor desc) from (
          select category as plano, sum(amount) as valor
            from cashflow_calendar
           where tenant_id = v_t and kind = 'entrada' and status <> 'realizado' and calendar_date <= v_hoje + 30
           group by category
        ) y
      ), '[]'::jsonb)
    )
    from cashflow_calendar where tenant_id = v_t
  ));

  -- ---------- atualização dos dados ----------
  v_out := v_out || jsonb_build_object('atualizacao', jsonb_build_object(
    'planilhas', (select max(ultima_sincronizacao) from legado.planilhas where tenant_id = v_t),
    'planilhas_com_erro', (select count(*) from legado.planilhas where tenant_id = v_t and ativo and ultimo_erro is not null),
    'bd_guias', (select max(sincronizado_em) from legado.bd_guias),
    'ultimo_demonstrativo', (select max(emission_date) from claim_statements where tenant_id = v_t),
    'ultima_orizon', (select max(imported_at) from cashflow_imports where tenant_id = v_t),
    'hoje', v_hoje
  ));

  return v_out;
end;
$$;

alter function public.painel_gestao() set statement_timeout = '30s';
revoke execute on function public.painel_gestao() from public, anon;
grant execute on function public.painel_gestao() to authenticated;
