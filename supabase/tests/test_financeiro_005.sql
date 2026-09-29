-- ================================================================
-- HOPE CORE — TESTE EXECUTÁVEL — MIGRATION 005 (financeiro)
-- Só dados inventados. Roda dentro de uma transação e desfaz tudo
-- no final (ROLLBACK) — seguro para rodar no banco real.
--
-- Uso: psql ... -f supabase/tests/test_financeiro_005.sql
-- Resultado: tabela com PASS/FAIL por teste.
-- ================================================================

begin;

create temp table _r (n int, ok boolean, msg text) on commit drop;
grant all on _r to authenticated, anon;

insert into tenants (id, name) values
  ('f0000000-0000-0000-0000-00000000000a', 'Teste Fin A'),
  ('f0000000-0000-0000-0000-00000000000b', 'Teste Fin B');
insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'fin-owner@teste'),
  ('f1000000-0000-0000-0000-000000000002', 'fin-psi@teste'),
  ('f1000000-0000-0000-0000-000000000003', 'fin-outra@teste');
insert into users (id, tenant_id, role, full_name, email) values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'owner', 'Dono', 'fin-owner@teste'),
  ('f1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a', 'professional', 'Psi', 'fin-psi@teste'),
  ('f1000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-00000000000b', 'owner', 'Outra', 'fin-outra@teste');

create temp table _payload on commit drop as
select $j${
  "fileName":"teste.xml","fileSha256":"1111111111111111111111111111111111111111111111111111111111111111",
  "tissVersion":"3.03.01","operatorAnsCode":"000001","operatorName":"OPERADORA TESTE","operatorCnpj":"0",
  "providerCode":"1","contractedName":"CLINICA TESTE","statementNumber":"T1","emissionDate":"2026-09-25",
  "declaredTotals":{"informedCents":6620,"processedCents":6620,"releasedCents":3310,"glossCents":3310},
  "itemTotals":{"informedCents":6620,"processedCents":6620,"releasedCents":3310,"glossCents":3310},
  "divergences":[],
  "items":[
    {"providerGuideNumber":"001","realizationDate":"2026-08-04","procedureTable":"22","procedureCode":"50000470",
     "beneficiaryName":"FICTICIO A","cardNumber":"00250000000000001","informedCents":3310,"processedCents":3310,
     "releasedCents":3310,"glossCents":0,"glosses":[],"occurrence":1,"guideItemSequence":1,
     "itemKey":"000001|001|2026-08-04|22:50000470|1","contentHash":"h1"},
    {"providerGuideNumber":"002","realizationDate":"2026-08-04","procedureTable":"22","procedureCode":"50000470",
     "beneficiaryName":"FICTICIO A","cardNumber":"00250000000000001","informedCents":3310,"processedCents":3310,
     "releasedCents":0,"glossCents":3310,"glosses":[{"code":"1702","valueCents":3310}],"occurrence":1,"guideItemSequence":1,
     "itemKey":"000001|002|2026-08-04|22:50000470|1","contentHash":"h2"}
  ]}$j$::jsonb as p;
grant select on _payload to authenticated;

-- ---------- como DONO da clínica A ----------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000001', true);

insert into _r select 1, (import_claim_statement(p)->>'new')::int = 2, 'importa 2 sessões novas' from _payload;
insert into _r select 2, import_claim_statement(p)->>'status' = 'duplicate_file', 'mesmo arquivo é recusado' from _payload;
insert into _r select 3, import_claim_statement(jsonb_set(p, '{fileSha256}', '"2222222222222222222222222222222222222222222222222222222222222222"'))->>'status'
  = 'statement_number_conflict', 'mesmo nº de demonstrativo com outro arquivo é recusado' from _payload;

-- reapresentação: a sessão glosada volta liberada em outro demonstrativo
insert into _r select 4, (r->>'updated')::int = 1 and (r->>'new')::int = 0, 'sessão reapresentada = atualização, não nova'
from (
  select import_claim_statement(
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(p,
      '{fileSha256}', '"3333333333333333333333333333333333333333333333333333333333333333"'),
      '{statementNumber}', '"T2"'),
      '{emissionDate}', '"2026-10-25"'),
      '{items}', jsonb_build_array(
        (p->'items'->1) || '{"releasedCents":3310,"glossCents":0,"glosses":[],"contentHash":"h2b"}'::jsonb))
  ) as r from _payload
) x;

insert into _r select 5, count(*) = 2, 'sessões atuais não duplicam (2)' from claim_items_current;
insert into _r select 6, coalesce(sum(gloss_value), 0) = 0, 'glosa atual zerada após recurso' from claim_items_current;
insert into _r select 7, count(*) = 1, 'duplicidade mesmo paciente+data detectada'
  from claim_duplicate_billing();
insert into _r select 8, (select name from insurance_plans where operator_ans_code = '000001') = 'OPERADORA TESTE',
  'plano criado pelo registro ANS';

insert into operator_invoices (tenant_id, insurance_plan_id, statement_id, invoice_number, issue_date, amount)
select tenant_id, insurance_plan_id, id, 'TESTE-NF-1', '2026-09-26', items_released from claim_statements where statement_number = 'T1';
update operator_invoices set status = 'paid', paid_on = '2026-10-10', paid_amount = 33.10 where invoice_number = 'TESTE-NF-1';
insert into _r select 9, financial_status = 'paga', 'demonstrativo com nota paga' from claim_statement_overview where statement_number = 'T1';

-- ---------- como PSICÓLOGA da clínica A ----------
select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000002', true);
insert into _r select 10, count(*) = 0, 'psicóloga não vê demonstrativos' from claim_statements;
do $$ begin
  perform import_claim_statement('{"items":[{}],"fileSha256":"4444444444444444444444444444444444444444444444444444444444444444"}');
  insert into _r values (11, false, 'psicóloga NÃO pode importar');
exception when insufficient_privilege then
  insert into _r values (11, true, 'psicóloga NÃO pode importar');
end $$;

-- ---------- como DONO da clínica B ----------
select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000003', true);
insert into _r select 12, count(*) = 0, 'outra clínica não vê nada' from claim_items_current;
insert into _r select 13, count(*) = 0, 'outra clínica: detalhe de glosa vazio' from claim_gloss_details();

-- ---------- anônimo ----------
reset role;
set local role anon;
do $$ begin
  perform pgp_decrypt_field('\x00'::bytea);
  insert into _r values (14, false, 'anônimo não descriptografa');
exception when insufficient_privilege then
  insert into _r values (14, true, 'anônimo não descriptografa');
end $$;

reset role;
select n, case when ok then 'PASS' else 'FAIL' end as status, msg from _r order by n;

rollback;
