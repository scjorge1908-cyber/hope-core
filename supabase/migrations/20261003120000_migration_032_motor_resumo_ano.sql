-- =====================================================================
-- migration_032 — motor financeiro: resumo do ano mês a mês
--
--   fin__fechamento_periodo(tenant, de, até): o MESMO cálculo de
--     fin__fechamento_mes, para vários meses de uma vez (uma linha por
--     competência × profissional).
--   fin__fechamento_mes passa a ser só "período de 1 mês" desse cálculo
--     (regra continua escrita em um lugar só; mesmo resultado).
--   fin_resumo_ano(ano): os 12 meses com totais do motor, foto do mês
--     fechado e total pago — card "Mês a mês" da tela Conciliação.
-- =====================================================================

create or replace function public.fin__fechamento_periodo(p_tenant uuid, p_de date, p_ate date)
returns table (
  competencia date,
  spreadsheet_id text,
  profissional text,
  nome_abreviado text,
  ordem int,
  ativo boolean,
  desligada boolean,
  erro_sincronizacao boolean,
  ultimo_erro text,
  ultima_sincronizacao timestamptz,
  tipo text,
  percentual_cnpj numeric,
  qtd_ok int,
  qtd_pendencias int,
  total_bruto numeric,
  qtd_unimed33 int,
  bruto_unimed33 numeric,
  repasse_unimed33 numeric,
  comissao_padrao numeric,
  repasse_bruto numeric,
  base_inss numeric,
  inss numeric,
  liquido numeric,
  parcela_hope numeric,
  regra_inss text,
  qtd_33_sem_unimed int,
  alertas jsonb
)
language sql stable security definer
set search_path = public, legado, pg_temp
set statement_timeout = '60s'
as $$
  with meses as (
    select g::date as competencia
      from generate_series(date_trunc('month', p_de)::date, date_trunc('month', p_ate)::date, interval '1 month') g
  ), pl as (
    select m.competencia, p.spreadsheet_id,
           coalesce(p.nome_completo, p.nome_abreviado) as profissional,
           p.nome_abreviado, p.ordem, p.ativo, p.desligada,
           (p.ultima_sincronizacao is null or p.ultimo_erro is not null) as erro_sincronizacao,
           p.ultimo_erro, p.ultima_sincronizacao,
           cc.percentual as percentual_cnpj
      from legado.planilhas p
      cross join meses m
      left join public.fin_cnpj_cadastro cc on cc.spreadsheet_id = p.spreadsheet_id
     where p.tenant_id = p_tenant
       and (p.ativo or p.desligada)
  ), it as (
    select a.*
      from public.fin_atendimentos_calculados a
     where a.tenant_id = p_tenant
       and a.competencia between date_trunc('month', p_de)::date and date_trunc('month', p_ate)::date
  ), ag as (
    select it.competencia, it.spreadsheet_id,
           count(*) filter (where it.ok)::int as qtd_ok,
           count(*) filter (where it.pendente)::int as qtd_pendencias,
           coalesce(sum(coalesce(it.valor_bruto, 0)) filter (where it.ok), 0) as total_bruto,
           count(*) filter (where it.ok and it.regra = 'UNIMED_0025_33_18')::int as qtd_unimed33,
           coalesce(sum(it.valor_bruto) filter (where it.ok and it.regra = 'UNIMED_0025_33_18'), 0) as bruto_unimed33,
           coalesce(sum(it.repasse_profissional) filter (where it.ok and it.regra = 'UNIMED_0025_33_18'), 0) as repasse_unimed33,
           coalesce(sum(it.repasse_profissional) filter (where it.ok and it.regra <> 'UNIMED_0025_33_18'), 0) as repasse_outros,
           count(*) filter (where it.ok and 'VALOR_33_SEM_REGRA_UNIMED' = any (it.alertas))::int as qtd_33_sem_unimed,
           -- para o modo float_js (igual ao Apps Script): somas em ponto flutuante NA ORDEM DAS LINHAS
           sum(coalesce(it.valor_bruto, 0)::float8 order by it.linha) filter (where it.ok) as f_total,
           sum(coalesce(it.valor_bruto, 0)::float8 order by it.linha) filter (where it.ok and it.regra = 'UNIMED_0025_33_18') as f_unimed,
           sum(coalesce(it.repasse_profissional, 0)::float8 order by it.linha) filter (where it.ok and it.regra = 'UNIMED_0025_33_18') as f_rep_unimed
      from it
     group by it.competencia, it.spreadsheet_id
  ), al as (
    select x.competencia, x.spreadsheet_id, jsonb_object_agg(x.alerta, x.n) as alertas
      from (
        select it.competencia, it.spreadsheet_id, u.alerta, count(*) as n
          from it
          cross join lateral unnest(it.alertas) u(alerta)
         where it.ok or u.alerta = 'VALOR_PLANILHA_DIVERGENTE'
         group by it.competencia, it.spreadsheet_id, u.alerta
      ) x
     group by x.competencia, x.spreadsheet_id
  ), modo as (
    select m.competencia,
           public.fin_modo_aritmetica(m.competencia) as modo,
           ((public.fin_regra('NORMAL_40_60', m.competencia)).parametros ->> 'percentual_profissional')::numeric as pct_normal
      from meses m
  ), pre as (
    select pl.*,
           coalesce(ag.qtd_ok, 0) as qtd_ok,
           coalesce(ag.qtd_pendencias, 0) as qtd_pendencias,
           round(coalesce(ag.total_bruto, 0), 2) as total_bruto,
           coalesce(ag.qtd_unimed33, 0) as qtd_unimed33,
           round(coalesce(ag.bruto_unimed33, 0), 2) as bruto_unimed33,
           round(coalesce(ag.repasse_unimed33, 0), 2) as repasse_unimed33,
           coalesce(ag.qtd_33_sem_unimed, 0) as qtd_33_sem_unimed,
           coalesce(al.alertas, '{}'::jsonb) as alertas,
           case
             when md.modo = 'float_js' and pl.percentual_cnpj is not null then
               -- CNPJ no Code.gs: Number((total * (percentual / 100)).toFixed(2))
               public.fin_js_fixo2((coalesce(ag.f_total, 0) - coalesce(ag.f_unimed, 0)) * (pl.percentual_cnpj::float8 / 100::float8))
             when md.modo = 'float_js' then
               -- PF no Code.gs: Number(((total100 - total33) * 0.40).toFixed(2))
               public.fin_js_fixo2((coalesce(ag.f_total, 0) - coalesce(ag.f_unimed, 0)) * md.pct_normal::float8)
             else round(coalesce(ag.repasse_outros, 0), 2)
           end as comissao_padrao,
           md.modo,
           coalesce(ag.f_rep_unimed, 0) as f_rep_unimed,
           coalesce(ag.repasse_unimed33, 0) as repasse_unimed33_exato
      from pl
      join modo md on md.competencia = pl.competencia
      left join ag on ag.spreadsheet_id = pl.spreadsheet_id and ag.competencia = pl.competencia
      left join al on al.spreadsheet_id = pl.spreadsheet_id and al.competencia = pl.competencia
  ), calc as (
    select pre.*,
           -- PF: (40% arredondado) + R$ 18 por sessão Unimed; CNPJ: % + R$ 18 por sessão Unimed
           case when pre.modo = 'float_js'
                then public.fin_js_fixo2(pre.comissao_padrao::float8 + pre.f_rep_unimed)
                else round(pre.comissao_padrao + pre.repasse_unimed33_exato, 2)
           end as repasse_bruto
      from pre
  )
  select c.competencia, c.spreadsheet_id, c.profissional, c.nome_abreviado, c.ordem, c.ativo, c.desligada,
         c.erro_sincronizacao, c.ultimo_erro, c.ultima_sincronizacao,
         case when c.percentual_cnpj is not null then 'CNPJ' else 'PF' end,
         c.percentual_cnpj,
         c.qtd_ok, c.qtd_pendencias, c.total_bruto,
         c.qtd_unimed33, c.bruto_unimed33, c.repasse_unimed33, c.comissao_padrao,
         c.repasse_bruto,
         case when c.percentual_cnpj is not null then 0 else ins.base_inss end,
         case when c.percentual_cnpj is not null then 0 else ins.inss end,
         case when c.percentual_cnpj is not null then c.repasse_bruto else ins.liquido end,
         round(c.total_bruto - c.repasse_bruto, 2),
         case when c.percentual_cnpj is not null then 'SEM_INSS_CNPJ' else ins.regra end,
         c.qtd_33_sem_unimed,
         c.alertas
    from calc c
    left join lateral public.fin_calcular_inss(c.competencia, c.repasse_bruto) ins on c.percentual_cnpj is null
   order by c.competencia, c.ordem nulls last, c.nome_abreviado
$$;

revoke execute on function public.fin__fechamento_periodo(uuid, date, date) from public, anon, authenticated;

-- O mês passa a ser um período de 1 mês do MESMO cálculo (regra única).
create or replace function public.fin__fechamento_mes(p_tenant uuid, p_competencia date)
returns table (
  spreadsheet_id text,
  profissional text,
  nome_abreviado text,
  ordem int,
  ativo boolean,
  desligada boolean,
  erro_sincronizacao boolean,
  ultimo_erro text,
  ultima_sincronizacao timestamptz,
  tipo text,
  percentual_cnpj numeric,
  qtd_ok int,
  qtd_pendencias int,
  total_bruto numeric,
  qtd_unimed33 int,
  bruto_unimed33 numeric,
  repasse_unimed33 numeric,
  comissao_padrao numeric,
  repasse_bruto numeric,
  base_inss numeric,
  inss numeric,
  liquido numeric,
  parcela_hope numeric,
  regra_inss text,
  qtd_33_sem_unimed int,
  alertas jsonb
)
language sql stable security definer
set search_path = public, legado, pg_temp
set statement_timeout = '30s'
as $$
  select f.spreadsheet_id, f.profissional, f.nome_abreviado, f.ordem, f.ativo, f.desligada,
         f.erro_sincronizacao, f.ultimo_erro, f.ultima_sincronizacao, f.tipo, f.percentual_cnpj,
         f.qtd_ok, f.qtd_pendencias, f.total_bruto, f.qtd_unimed33, f.bruto_unimed33, f.repasse_unimed33,
         f.comissao_padrao, f.repasse_bruto, f.base_inss, f.inss, f.liquido, f.parcela_hope, f.regra_inss,
         f.qtd_33_sem_unimed, f.alertas
    from public.fin__fechamento_periodo(p_tenant, p_competencia, p_competencia) f
   order by f.ordem nulls last, f.nome_abreviado
$$;

revoke execute on function public.fin__fechamento_mes(uuid, date) from public, anon, authenticated;

-- Resumo do ANO, mês a mês (tela Conciliação): totais do motor, foto do
-- mês fechado e total pago. Profissional com erro de leitura fica fora.
create or replace function public.fin_resumo_ano(p_ano int)
returns jsonb
language plpgsql stable security definer
set search_path = public, legado, pg_temp
set statement_timeout = '60s'
as $$
declare
  v_tenant uuid := current_tenant_id();
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return coalesce((
    with f as (
      select * from public.fin__fechamento_periodo(v_tenant, make_date(p_ano, 1, 1), make_date(p_ano, 12, 1))
    ), m as (
      select f.competencia,
             count(*) filter (where f.erro_sincronizacao and (f.ativo or f.qtd_ok > 0))::int as qtd_erro,
             coalesce(sum(f.qtd_ok) filter (where not f.erro_sincronizacao), 0)::int as qtd_ok,
             coalesce(sum(f.qtd_pendencias) filter (where not f.erro_sincronizacao), 0)::int as qtd_pendencias,
             coalesce(sum(f.total_bruto) filter (where not f.erro_sincronizacao), 0) as total_bruto,
             coalesce(sum(f.repasse_bruto) filter (where not f.erro_sincronizacao), 0) as repasse_bruto,
             coalesce(sum(f.inss) filter (where not f.erro_sincronizacao), 0) as inss,
             coalesce(sum(f.liquido) filter (where not f.erro_sincronizacao), 0) as liquido,
             coalesce(sum(f.parcela_hope) filter (where not f.erro_sincronizacao), 0) as parcela_hope,
             coalesce(sum(f.qtd_unimed33) filter (where not f.erro_sincronizacao), 0)::int as qtd_unimed33,
             coalesce(sum((f.alertas ->> 'VALOR_PLANILHA_DIVERGENTE')::int), 0)::int as divergencias_unimed,
             count(*) filter (where not f.erro_sincronizacao and f.liquido > 0)::int as profissionais_a_pagar
        from f
       group by f.competencia
    ), pg as (
      select rp.competencia, sum(rp.valor_pago) as pago, count(*)::int as profissionais_pagos
        from public.repasse_pagamentos rp
       where rp.tenant_id = v_tenant and rp.pago
         and rp.competencia between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 1)
       group by rp.competencia
    )
    select jsonb_agg(jsonb_build_object(
             'competencia', m.competencia,
             'qtd_ok', m.qtd_ok, 'qtd_pendencias', m.qtd_pendencias, 'qtd_erro', m.qtd_erro,
             'total_bruto', m.total_bruto, 'repasse_bruto', m.repasse_bruto, 'inss', m.inss,
             'liquido', m.liquido, 'parcela_hope', m.parcela_hope, 'qtd_unimed33', m.qtd_unimed33,
             'divergencias_unimed', m.divergencias_unimed, 'profissionais_a_pagar', m.profissionais_a_pagar,
             'pago', coalesce(pg.pago, 0), 'profissionais_pagos', coalesce(pg.profissionais_pagos, 0),
             'foto', case when ff.id is null then null else jsonb_build_object(
                       'qtd_ok', ff.qtd_ok, 'total_bruto', ff.total_bruto, 'repasse_bruto', ff.repasse_bruto,
                       'inss', ff.inss, 'liquido', ff.liquido, 'parcela_hope', ff.parcela_hope,
                       'fechado_em', ff.fechado_em) end)
           order by m.competencia)
      from m
      left join pg on pg.competencia = m.competencia
      left join public.fin_fechamentos ff on ff.tenant_id = v_tenant and ff.competencia = m.competencia
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.fin_resumo_ano(int) from public, anon;
grant execute on function public.fin_resumo_ano(int) to authenticated;
