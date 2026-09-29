-- =====================================================================
-- migration_018 — Demonstrativo (XML) da Unimed vira recebimento previsto
-- na Agenda, sem depender da nota fiscal.
--   Regra informada pelo Morais: o XML é o que a Unimed vai pagar; o
--   pagamento do valor TOTAL liberado cai entre os dias 25 e 30 do mês
--   seguinte à emissão do demonstrativo. Previsão = dia 25 do mês seguinte
--   (se não for dia útil, o próximo dia útil).
--   • cashflow_items.source ganha 'unimed_xml' (external_ref = nº do
--     demonstrativo, valor = total liberado do XML)
--   • a nota fiscal do mesmo demonstrativo não aparece em dobro: a Agenda
--     e a conciliação do banco usam o previsto do XML; quando a NF é
--     marcada como paga em Notas fiscais, o previsto do XML fica realizado
--   • previstos_demonstrativos_sync(): cria/atualiza os previstos a partir
--     dos demonstrativos importados (roda na importação e ao abrir a Agenda)
-- =====================================================================

alter table cashflow_items drop constraint if exists cashflow_items_source_check;
alter table cashflow_items add constraint cashflow_items_source_check
  check (source in ('orizon', 'manual', 'unimed_xml'));

create or replace function unimed_previsao_pagamento(p_emissao date)
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select next_business_day(((date_trunc('month', p_emissao) + interval '1 month')::date + 24))
$$;

create or replace function previstos_demonstrativos_sync_tenant(p_tenant uuid)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int := 0;
begin
  with dem as (
    select s.id, s.tenant_id, s.insurance_plan_id, s.statement_number, s.emission_date, s.items_released,
           coalesce(p.short_name, p.name) as plano,
           nf.paid_on, nf.paid_amount, nf.pago
      from claim_statements s
      join insurance_plans p on p.id = s.insurance_plan_id
      left join lateral (
        select max(i.paid_on) as paid_on, sum(i.paid_amount) as paid_amount, bool_and(i.status = 'paid') as pago
          from operator_invoices i
         where i.statement_id = s.id and i.status <> 'cancelled'
      ) nf on true
     where s.tenant_id = p_tenant and s.items_released > 0
  ), ins as (
    insert into cashflow_items as c (tenant_id, kind, insurance_plan_id, category, source, external_ref, reference_date,
                                     amount, expected_date, status, realized_date, realized_amount, realized_source, description)
    select d.tenant_id, 'entrada', d.insurance_plan_id, d.plano, 'unimed_xml', d.statement_number, d.emission_date,
           d.items_released, unimed_previsao_pagamento(d.emission_date),
           case when d.pago then 'realizado' else 'previsto' end,
           case when d.pago then d.paid_on end,
           case when d.pago then d.paid_amount end,
           case when d.pago then 'manual' end,
           'Demonstrativo ' || d.statement_number || ' (XML) — emitido em ' || to_char(d.emission_date, 'DD/MM/YYYY')
      from dem d
    on conflict (tenant_id, source, insurance_plan_id, external_ref) where external_ref is not null
    do update set
      amount = case when c.status = 'previsto' then excluded.amount else c.amount end,
      expected_date = case when c.status = 'previsto' then excluded.expected_date else c.expected_date end,
      reference_date = excluded.reference_date,
      description = excluded.description,
      -- NF paga em "Notas fiscais" → realizado (não mexe no que o banco já confirmou)
      status = case when excluded.status = 'realizado' and c.status = 'previsto' then 'realizado' else c.status end,
      realized_date = case when excluded.status = 'realizado' and c.status = 'previsto' then excluded.realized_date else c.realized_date end,
      realized_amount = case when excluded.status = 'realizado' and c.status = 'previsto' then excluded.realized_amount else c.realized_amount end,
      realized_source = case when excluded.status = 'realizado' and c.status = 'previsto' then 'manual' else c.realized_source end
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end;
$$;
revoke execute on function previstos_demonstrativos_sync_tenant(uuid) from public, anon, authenticated;

create or replace function previstos_demonstrativos_sync()
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not has_finance_access() or current_tenant_id() is null then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return previstos_demonstrativos_sync_tenant(current_tenant_id());
end;
$$;
revoke execute on function previstos_demonstrativos_sync() from public, anon;
grant execute on function previstos_demonstrativos_sync() to authenticated;

-- NF do demonstrativo marcada como paga / desfeita → reflete no previsto do XML
create or replace function trg_nf_reflete_xml()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_num text;
begin
  if new.statement_id is null then return new; end if;
  select statement_number into v_num from claim_statements where id = new.statement_id;
  if v_num is null then return new; end if;
  if new.status = 'paid' then
    update cashflow_items
       set status = 'realizado', realized_date = new.paid_on, realized_amount = new.paid_amount, realized_source = 'manual'
     where tenant_id = new.tenant_id and source = 'unimed_xml' and insurance_plan_id = new.insurance_plan_id
       and external_ref = v_num and status = 'previsto';
  elsif tg_op = 'UPDATE' and old.status = 'paid' and new.status <> 'paid' then
    update cashflow_items
       set status = 'previsto', realized_date = null, realized_amount = null, realized_source = null
     where tenant_id = new.tenant_id and source = 'unimed_xml' and insurance_plan_id = new.insurance_plan_id
       and external_ref = v_num and status = 'realizado' and realized_source = 'manual';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_nf_reflete_xml on operator_invoices;
create trigger trg_nf_reflete_xml after insert or update of status, paid_on, paid_amount on operator_invoices
  for each row execute function trg_nf_reflete_xml();

-- Agenda: a NF de um demonstrativo que já tem previsto do XML não entra em dobro
create or replace view cashflow_calendar with (security_invoker = true) as
select
  c.id,
  c.tenant_id,
  'item'::text as origem,
  c.kind,
  c.insurance_plan_id,
  c.category,
  coalesce(p.display_order, case when c.kind = 'entrada' then 100 else 200 end) as category_order,
  c.source,
  c.external_ref,
  c.reference_date,
  c.amount,
  c.expected_date,
  coalesce(c.realized_date, c.expected_date) as calendar_date,
  c.status,
  c.realized_date,
  c.realized_amount,
  c.description
from cashflow_items c
left join insurance_plans p on p.id = c.insurance_plan_id
where c.status <> 'cancelado'
union all
select
  i.id,
  i.tenant_id,
  'nota_fiscal'::text,
  'entrada'::text,
  i.insurance_plan_id,
  coalesce(p.short_name, p.name),
  coalesce(p.display_order, 100),
  'nf'::text,
  i.invoice_number,
  i.issue_date,
  i.amount,
  coalesce(i.expected_payment_date, cashflow_expected_date(i.insurance_plan_id, null, null, i.issue_date), i.issue_date),
  coalesce(i.paid_on, i.expected_payment_date, cashflow_expected_date(i.insurance_plan_id, null, null, i.issue_date), i.issue_date),
  case when i.status = 'paid' then 'realizado' else 'previsto' end,
  i.paid_on,
  i.paid_amount,
  case when i.expected_payment_date is null and p.payment_days is null
       then 'NF ' || i.invoice_number || ' — sem data prevista de pagamento (mostrada na emissão)'
       else 'NF ' || i.invoice_number end
from operator_invoices i
join insurance_plans p on p.id = i.insurance_plan_id
where i.status <> 'cancelled'
  and not exists (
    select 1
      from claim_statements cs
      join cashflow_items ci on ci.tenant_id = cs.tenant_id and ci.source = 'unimed_xml'
                            and ci.insurance_plan_id = cs.insurance_plan_id and ci.external_ref = cs.statement_number
     where cs.id = i.statement_id
  );

grant select on cashflow_calendar to authenticated;
revoke all on cashflow_calendar from anon;

-- conciliação do banco: mesma exclusão (senão o XML e a NF concorreriam pelo mesmo crédito)
create or replace function bank_previstos_pendentes(p_tenant uuid)
returns table (origem text, target_id uuid, insurance_plan_id uuid, plano text, amount numeric, expected_date date, descricao text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select 'item', c.id, c.insurance_plan_id, coalesce(p.short_name, p.name, c.category), c.amount, c.expected_date,
         coalesce(c.description, c.category || coalesce(' · ' || c.external_ref, ''))
    from cashflow_items c
    left join insurance_plans p on p.id = c.insurance_plan_id
   where c.tenant_id = p_tenant and c.kind = 'entrada' and c.status = 'previsto'
     and not exists (select 1 from bank_matches m where m.origem = 'item' and m.target_id = c.id)
  union all
  select 'nota_fiscal', i.id, i.insurance_plan_id, coalesce(p.short_name, p.name), i.amount,
         coalesce(i.expected_payment_date, cashflow_expected_date(i.insurance_plan_id, null, null, i.issue_date), i.issue_date),
         'NF ' || i.invoice_number
    from operator_invoices i
    join insurance_plans p on p.id = i.insurance_plan_id
   where i.tenant_id = p_tenant and i.status = 'issued'
     and not exists (select 1 from bank_matches m where m.origem = 'nota_fiscal' and m.target_id = i.id)
     and not exists (
       select 1
         from claim_statements cs
         join cashflow_items ci on ci.tenant_id = cs.tenant_id and ci.source = 'unimed_xml'
                               and ci.insurance_plan_id = cs.insurance_plan_id and ci.external_ref = cs.statement_number
        where cs.id = i.statement_id
     )
$$;
revoke execute on function bank_previstos_pendentes(uuid) from public, anon, authenticated;

-- carga inicial: todos os demonstrativos já importados
do $$
declare
  r record;
begin
  for r in select distinct tenant_id from claim_statements loop
    perform previstos_demonstrativos_sync_tenant(r.tenant_id);
  end loop;
end $$;
