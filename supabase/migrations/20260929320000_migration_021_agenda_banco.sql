-- =====================================================================
-- migration_021 — Agenda mostra o que entrou no banco
--   • coluna realized_source na view: 'banco' = conciliado automaticamente
--     (ou vinculado) com o extrato do Cora; 'manual' = confirmado à mão
--   • entradas do extrato que não casaram com nenhum previsto aparecem na
--     Agenda como "Recebido no Cora sem previsão" (origem 'banco'), na linha
--     do plano identificado pelo pagador (ex.: Geap) ou em "Outras entradas".
--     Transferências da própria clínica (CNPJ 47.283.631/0001-29) e créditos
--     marcados como "não é de plano" ficam de fora.
-- =====================================================================
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
  c.description,
  c.realized_source
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
       else 'NF ' || i.invoice_number end,
  case when i.status <> 'paid' then null
       when exists (select 1 from bank_matches m where m.origem = 'nota_fiscal' and m.target_id = i.id) then 'banco'
       else 'manual' end
from operator_invoices i
join insurance_plans p on p.id = i.insurance_plan_id
where i.status <> 'cancelled'
  and not exists (
    select 1
      from claim_statements cs
      join cashflow_items ci on ci.tenant_id = cs.tenant_id and ci.source = 'unimed_xml'
                            and ci.insurance_plan_id = cs.insurance_plan_id and ci.external_ref = cs.statement_number
     where cs.id = i.statement_id
  )
union all
select
  b.id,
  b.tenant_id,
  'banco'::text,
  'entrada'::text,
  pl.id,
  coalesce(pl.short_name, 'Particulares e outras (banco)'),
  coalesce(pl.display_order, 150),
  'banco'::text,
  b.counterparty_name,
  b.occurred_on,
  b.amount::numeric(12, 2),
  b.occurred_on,
  b.occurred_on,
  'realizado'::text,
  b.occurred_on,
  b.amount::numeric(12, 2),
  'Recebido no Cora sem previsão — ' || coalesce(b.counterparty_name, 'pagador não informado')
    || coalesce(' · ' || nullif(b.description, ''), ''),
  'banco'::text
from bank_transactions b
left join lateral (
  select p.id, p.short_name, p.display_order
    from insurance_plans p
   where p.tenant_id = b.tenant_id
     and length(split_part(coalesce(p.short_name, ''), ' ', 1)) >= 4
     and upper(coalesce(b.counterparty_name, '') || ' ' || coalesce(b.description, ''))
         like '%' || upper(split_part(p.short_name, ' ', 1)) || '%'
   order by length(p.short_name) desc
   limit 1
) pl on true
where b.kind = 'entrada'
  and not b.ignored
  and coalesce(regexp_replace(b.counterparty_doc, '\D', '', 'g'), '') <> '47283631000129'
  and upper(coalesce(b.counterparty_name, '')) not like 'HOPE CLINICA%'
  and not exists (select 1 from bank_matches m where m.bank_transaction_id = b.id);

grant select on cashflow_calendar to authenticated;
revoke all on cashflow_calendar from anon;
