-- ================================================================
-- HOPE CORE — MIGRATION 005 — FINANCEIRO: RETORNO DAS OPERADORAS
-- Depende das migrations 001–004.
--
-- SÓ ACRESCENTA. Nenhuma coluna, tabela ou dado existente é removido.
--
-- Desenhada a partir de 5 demonstrativos reais da Unimed (mai–set/2026):
--  • Uma guia tem várias sessões → chave da sessão = operadora + guia +
--    data de realização + procedimento + ocorrência (item_key).
--  • Cada arquivo importado vira um claim_statements (com hash SHA-256):
--    o mesmo arquivo nunca entra duas vezes.
--  • Cada sessão de cada demonstrativo é gravada como aconteceu
--    (histórico imutável). A "situação atual" de uma sessão é a da
--    aparição mais recente → view claim_items_current. Assim uma sessão
--    reprocessada em outro demonstrativo ATUALIZA, não duplica.
--  • Várias glosas por sessão → claim_return_glosses.
--  • Nota fiscal da Hope PARA a operadora → operator_invoices
--    (fiscal_documents continua sendo NF/RPA das psicólogas).
--  • Teto do INSS por vigência → inss_ceilings (o default antigo era 2024).
--  • Endurecimento: funções de criptografia deixam de ser executáveis
--    por usuário anônimo.
-- ================================================================

-- ================================================================
-- 1. Quem pode mexer no financeiro
-- ================================================================

create or replace function has_finance_access()
returns boolean
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from users
    where id = auth.uid()
      and active
      and role in ('owner', 'manager', 'admin_staff')
  )
$$;

comment on function has_finance_access() is
  'true se o usuário logado é owner/manager/admin_staff ativo. Profissionais (psicólogas) NÃO acessam o financeiro da clínica.';

-- ================================================================
-- 2. Operadora: identificação oficial no plano
-- ================================================================

alter table insurance_plans
  add column if not exists operator_ans_code text,   -- registro ANS (Unimed Grande Fpolis = 360449)
  add column if not exists operator_cnpj text,
  add column if not exists provider_code text;       -- código da clínica na operadora (Unimed = 301036)

create unique index if not exists idx_insurance_plans_ans
  on insurance_plans(tenant_id, operator_ans_code)
  where operator_ans_code is not null;

-- ================================================================
-- 3. Demonstrativos importados (um por arquivo XML)
-- ================================================================

create table if not exists claim_statements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  insurance_plan_id uuid not null references insurance_plans(id),
  statement_kind text not null default 'analise_conta'
    check (statement_kind in ('analise_conta')),
  tiss_version text,
  operator_ans_code text not null,
  operator_name text,
  operator_cnpj text,
  provider_code text,
  statement_number text not null,
  emission_date date not null,
  -- totais declarados no cabeçalho do arquivo (já convertidos para reais)
  declared_informed numeric(12,2),
  declared_processed numeric(12,2),
  declared_released numeric(12,2),
  declared_gloss numeric(12,2),
  -- totais somando sessão por sessão
  items_informed numeric(12,2) not null,
  items_processed numeric(12,2) not null,
  items_released numeric(12,2) not null,
  items_gloss numeric(12,2) not null,
  item_count int not null check (item_count > 0),
  divergences jsonb not null default '[]'::jsonb,
  file_name text not null,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text,
  imported_by uuid references users(id),
  imported_at timestamptz not null default now(),
  constraint uq_claim_statements_file unique (tenant_id, file_sha256),
  constraint uq_claim_statements_number unique (tenant_id, operator_ans_code, statement_number)
);

create index if not exists idx_claim_statements_plan
  on claim_statements(tenant_id, insurance_plan_id, emission_date desc);

comment on table claim_statements is
  'Um demonstrativo de análise de conta importado (1 arquivo XML). Imutável depois de importado.';

-- ================================================================
-- 4. Sessões do demonstrativo: completa insurance_claim_returns
-- ================================================================

alter table insurance_claim_returns
  add column if not exists statement_id uuid references claim_statements(id) on delete restrict,
  add column if not exists lot_number text,
  add column if not exists protocol_number text,
  add column if not exists protocol_situation text,
  add column if not exists procedure_table text,
  add column if not exists procedure_code text,
  add column if not exists procedure_description text,
  add column if not exists participation_degree text,
  add column if not exists quantity numeric(10,2),
  add column if not exists guide_item_sequence int,
  add column if not exists occurrence int,
  add column if not exists item_key text,
  add column if not exists content_hash text,
  add column if not exists card_blind_index text,
  add column if not exists card_origin_code text;  -- 4 primeiros dígitos da carteirinha (Unimed de origem)

comment on column insurance_claim_returns.item_key is
  'Identidade da sessão: ANS|guia prestador|data realização|tabela:procedimento|ocorrência. Igual entre demonstrativos → é a MESMA sessão.';
comment on column insurance_claim_returns.content_hash is
  'SHA-256 dos valores + glosas. Mesmo item_key com hash diferente = sessão reprocessada pela operadora.';
comment on column insurance_claim_returns.card_origin_code is
  'Prefixo da carteirinha. Na Unimed identifica a singular de origem (0025 = Grande Florianópolis; demais = intercâmbio) e explica preços diferentes.';

create unique index if not exists idx_claim_returns_statement_item
  on insurance_claim_returns(tenant_id, statement_id, item_key)
  where statement_id is not null;

create index if not exists idx_claim_returns_item_key
  on insurance_claim_returns(tenant_id, item_key);

create index if not exists idx_claim_returns_card_date
  on insurance_claim_returns(tenant_id, card_blind_index, realization_date);

-- ================================================================
-- 5. Glosas (várias por sessão) e acompanhamento de recurso
-- ================================================================

create table if not exists claim_return_glosses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  claim_return_id uuid not null references insurance_claim_returns(id) on delete restrict,
  gloss_code text not null,
  gloss_value numeric(10,2) not null check (gloss_value >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_claim_glosses_return on claim_return_glosses(claim_return_id);
create index if not exists idx_claim_glosses_code on claim_return_glosses(tenant_id, gloss_code);

create table if not exists gloss_appeals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  item_key text not null,
  status text not null default 'not_evaluated'
    check (status in ('not_evaluated', 'appealing', 'recovered', 'partial', 'lost')),
  recovered_value numeric(10,2) check (recovered_value is null or recovered_value >= 0),
  notes text,
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_gloss_appeals_item unique (tenant_id, item_key)
);

comment on table gloss_appeals is
  'Situação do recurso de uma sessão glosada. Glosa NUNCA é tratada como perda automática: sem linha aqui = não avaliada.';

-- ================================================================
-- 6. Notas fiscais da Hope para a operadora
-- Unimed: a Hope emite NF do valor liberado no demonstrativo e a
-- operadora paga a nota integralmente.
-- ================================================================

create table if not exists operator_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  insurance_plan_id uuid not null references insurance_plans(id),
  statement_id uuid references claim_statements(id) on delete restrict,
  invoice_number text not null,
  issue_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  expected_payment_date date,
  status text not null default 'issued'
    check (status in ('issued', 'paid', 'cancelled')),
  paid_on date,
  paid_amount numeric(12,2) check (paid_amount is null or paid_amount >= 0),
  storage_path text,
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_operator_invoices_number unique (tenant_id, invoice_number),
  constraint ck_operator_invoices_paid check (status <> 'paid' or (paid_on is not null and paid_amount is not null))
);

create index if not exists idx_operator_invoices_statement on operator_invoices(statement_id);
create index if not exists idx_operator_invoices_plan on operator_invoices(tenant_id, insurance_plan_id, issue_date desc);

comment on table operator_invoices is
  'Nota fiscal emitida pela clínica PARA a operadora. Não confundir com fiscal_documents (NF/RPA das psicólogas).';

-- ================================================================
-- 7. Teto do INSS por vigência
-- ================================================================

create table if not exists inss_ceilings (
  valid_from date primary key,
  ceiling numeric(10,2) not null check (ceiling > 0)
);

insert into inss_ceilings (valid_from, ceiling) values
  ('2024-01-01', 7786.02),
  ('2025-01-01', 8157.41),
  ('2026-01-01', 8475.55)
on conflict (valid_from) do nothing;

alter table payout_rules alter column inss_ceiling_value set default 8475.55;

comment on column payout_rules.inss_ceiling_value is
  'LEGADO: preferir o teto vigente em inss_ceilings na data de competência. Default atualizado para 2026.';

-- ================================================================
-- 8. RLS — tabelas novas só para o financeiro da clínica
-- ================================================================

do $$
declare
  t text;
  finance_tables text[] := array['claim_statements', 'claim_return_glosses', 'gloss_appeals', 'operator_invoices'];
begin
  foreach t in array finance_tables
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'drop policy if exists finance_access_%1$s on %1$s;
       create policy finance_access_%1$s on %1$s
         using ((tenant_id = current_tenant_id() and has_finance_access()) or is_platform_admin())
         with check ((tenant_id = current_tenant_id() and has_finance_access()) or is_platform_admin());',
      t
    );
    execute format('revoke all on table %I from anon;', t);
  end loop;
end $$;

alter table inss_ceilings enable row level security;
drop policy if exists inss_ceilings_read on inss_ceilings;
create policy inss_ceilings_read on inss_ceilings for select to authenticated using (true);
revoke all on table inss_ceilings from anon;

-- ================================================================
-- 9. Triggers (updated_at + auditoria)
-- ================================================================

drop trigger if exists trg_set_updated_at on operator_invoices;
create trigger trg_set_updated_at before update on operator_invoices
  for each row execute function set_updated_at();

drop trigger if exists trg_set_updated_at on gloss_appeals;
create trigger trg_set_updated_at before update on gloss_appeals
  for each row execute function set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array['claim_statements', 'operator_invoices', 'gloss_appeals']
  loop
    execute format(
      'drop trigger if exists trg_audit_log on %I;
       create trigger trg_audit_log after insert or update or delete on %I
       for each row execute function write_audit_log();', t, t
    );
  end loop;
end $$;

-- ================================================================
-- 10. Importação atômica de um demonstrativo
-- O leitor (apps/web/lib/financeiro/tiss-parser.ts) transforma o XML
-- em JSON; esta função grava TUDO ou NADA, criptografa nome/carteirinha/
-- senha e classifica cada sessão como nova, atualizada ou sem mudança.
-- ================================================================

create or replace function import_claim_statement(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user uuid := auth.uid();
  v_plan uuid;
  v_stmt uuid;
  v_existing record;
  v_item jsonb;
  v_prev_hash text;
  v_ret uuid;
  v_card text;
  v_new int := 0;
  v_upd int := 0;
  v_same int := 0;
begin
  if v_tenant is null or not has_finance_access() then
    raise exception 'Sem permissão para importar demonstrativos' using errcode = '42501';
  end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'Demonstrativo sem sessões';
  end if;
  if coalesce(p->>'fileSha256', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Hash do arquivo inválido';
  end if;

  -- uma importação por vez por clínica
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':claim_import', 0));

  select id, statement_number, imported_at into v_existing
    from claim_statements
   where tenant_id = v_tenant and file_sha256 = p->>'fileSha256';
  if found then
    return jsonb_build_object(
      'status', 'duplicate_file',
      'statement_id', v_existing.id,
      'statement_number', v_existing.statement_number,
      'imported_at', v_existing.imported_at
    );
  end if;

  if exists (
    select 1 from claim_statements
     where tenant_id = v_tenant
       and operator_ans_code = p->>'operatorAnsCode'
       and statement_number = p->>'statementNumber'
  ) then
    return jsonb_build_object('status', 'statement_number_conflict', 'statement_number', p->>'statementNumber');
  end if;

  -- plano identificado pelo registro ANS; criado na primeira importação
  select id into v_plan
    from insurance_plans
   where tenant_id = v_tenant and operator_ans_code = p->>'operatorAnsCode';
  if v_plan is null then
    insert into insurance_plans (tenant_id, name, operator_ans_code, operator_cnpj, provider_code)
    values (
      v_tenant,
      coalesce(nullif(p->>'operatorName', ''), 'Operadora ANS ' || (p->>'operatorAnsCode')),
      p->>'operatorAnsCode',
      p->>'operatorCnpj',
      p->>'providerCode'
    )
    returning id into v_plan;
  end if;

  insert into claim_statements (
    tenant_id, insurance_plan_id, tiss_version, operator_ans_code, operator_name, operator_cnpj,
    provider_code, statement_number, emission_date,
    declared_informed, declared_processed, declared_released, declared_gloss,
    items_informed, items_processed, items_released, items_gloss, item_count,
    divergences, file_name, file_sha256, imported_by
  ) values (
    v_tenant, v_plan, p->>'tissVersion', p->>'operatorAnsCode', p->>'operatorName', p->>'operatorCnpj',
    p->>'providerCode', p->>'statementNumber', (p->>'emissionDate')::date,
    (p->'declaredTotals'->>'informedCents')::numeric / 100,
    (p->'declaredTotals'->>'processedCents')::numeric / 100,
    (p->'declaredTotals'->>'releasedCents')::numeric / 100,
    (p->'declaredTotals'->>'glossCents')::numeric / 100,
    (p->'itemTotals'->>'informedCents')::numeric / 100,
    (p->'itemTotals'->>'processedCents')::numeric / 100,
    (p->'itemTotals'->>'releasedCents')::numeric / 100,
    (p->'itemTotals'->>'glossCents')::numeric / 100,
    jsonb_array_length(p->'items'),
    coalesce(p->'divergences', '[]'::jsonb),
    p->>'fileName', p->>'fileSha256', v_user
  )
  returning id into v_stmt;

  for v_item in select value from jsonb_array_elements(p->'items')
  loop
    -- aparição anterior mais recente da mesma sessão (em outro demonstrativo)
    v_prev_hash := null;
    select r.content_hash into v_prev_hash
      from insurance_claim_returns r
      join claim_statements s on s.id = r.statement_id
     where r.tenant_id = v_tenant
       and r.item_key = v_item->>'itemKey'
     order by s.emission_date desc, s.imported_at desc
     limit 1;

    if v_prev_hash is null then
      v_new := v_new + 1;
    elsif v_prev_hash = v_item->>'contentHash' then
      v_same := v_same + 1;
    else
      v_upd := v_upd + 1;
    end if;

    v_card := nullif(v_item->>'cardNumber', '');

    insert into insurance_claim_returns (
      tenant_id, insurance_plan_id, statement_id,
      provider_guide_number, operator_guide_number,
      informed_value, processed_value, released_value, gloss_value, gloss_type,
      statement_number, statement_emission_date, source_file, realization_date,
      billing_start_date, billing_start_time, billing_end_date, billing_end_time,
      guide_situation, contracted_party,
      beneficiary_name_encrypted, card_number_encrypted, auth_password_encrypted,
      card_blind_index, card_origin_code,
      lot_number, protocol_number, protocol_situation,
      procedure_table, procedure_code, procedure_description, participation_degree, quantity,
      guide_item_sequence, occurrence, item_key, content_hash
    ) values (
      v_tenant, v_plan, v_stmt,
      v_item->>'providerGuideNumber', v_item->>'operatorGuideNumber',
      (v_item->>'informedCents')::numeric / 100,
      (v_item->>'processedCents')::numeric / 100,
      (v_item->>'releasedCents')::numeric / 100,
      (v_item->>'glossCents')::numeric / 100,
      nullif((select string_agg(g->>'code', ',') from jsonb_array_elements(coalesce(v_item->'glosses', '[]'::jsonb)) g), ''),
      p->>'statementNumber', (p->>'emissionDate')::date, p->>'fileName', (v_item->>'realizationDate')::date,
      (v_item->>'billingStartDate')::date, (v_item->>'billingStartTime')::time,
      (v_item->>'billingEndDate')::date, (v_item->>'billingEndTime')::time,
      v_item->>'guideSituation', p->>'contractedName',
      pgp_encrypt_field(nullif(v_item->>'beneficiaryName', '')),
      pgp_encrypt_field(v_card),
      pgp_encrypt_field(nullif(v_item->>'authPassword', '')),
      hmac_blind_index(v_card), left(v_card, 4),
      v_item->>'lotNumber', v_item->>'protocolNumber', v_item->>'protocolSituation',
      v_item->>'procedureTable', v_item->>'procedureCode', v_item->>'procedureDescription',
      v_item->>'participationDegree', (v_item->>'quantity')::numeric,
      (v_item->>'guideItemSequence')::int, (v_item->>'occurrence')::int,
      v_item->>'itemKey', v_item->>'contentHash'
    )
    returning id into v_ret;

    insert into claim_return_glosses (tenant_id, claim_return_id, gloss_code, gloss_value)
    select v_tenant, v_ret, g->>'code', (g->>'valueCents')::numeric / 100
      from jsonb_array_elements(coalesce(v_item->'glosses', '[]'::jsonb)) g;
  end loop;

  return jsonb_build_object(
    'status', 'imported',
    'statement_id', v_stmt,
    'plan_id', v_plan,
    'items', jsonb_array_length(p->'items'),
    'new', v_new,
    'updated', v_upd,
    'unchanged', v_same
  );
end;
$$;

-- ================================================================
-- 11. Visões (respeitam RLS de quem consulta: security_invoker)
-- ================================================================

-- Situação ATUAL de cada sessão = aparição mais recente
create or replace view claim_items_current with (security_invoker = true) as
select distinct on (r.tenant_id, r.item_key)
  r.id,
  r.tenant_id,
  r.insurance_plan_id,
  r.statement_id,
  s.statement_number,
  s.emission_date,
  r.item_key,
  r.provider_guide_number,
  r.operator_guide_number,
  r.realization_date,
  r.procedure_code,
  r.procedure_description,
  r.card_origin_code,
  r.card_blind_index,
  r.informed_value,
  r.processed_value,
  r.released_value,
  r.gloss_value,
  r.gloss_type,
  (s.emission_date - r.realization_date) as days_to_statement,
  count(*) over (partition by r.tenant_id, r.item_key) as appearances
from insurance_claim_returns r
join claim_statements s on s.id = r.statement_id
order by r.tenant_id, r.item_key, s.emission_date desc, s.imported_at desc;

-- Produção por mês DO ATENDIMENTO (não do demonstrativo)
create or replace view claim_monthly_summary with (security_invoker = true) as
select
  tenant_id,
  insurance_plan_id,
  date_trunc('month', realization_date)::date as month,
  count(*) as sessions,
  sum(informed_value) as informed,
  sum(released_value) as released,
  sum(gloss_value) as gloss,
  count(*) filter (where gloss_value > 0) as glossed_sessions,
  percentile_cont(0.5) within group (order by days_to_statement) as median_days_to_statement,
  min(days_to_statement) as min_days_to_statement,
  max(days_to_statement) as max_days_to_statement
from claim_items_current
group by tenant_id, insurance_plan_id, date_trunc('month', realization_date);

-- Demonstrativo → nota fiscal → pagamento
create or replace view claim_statement_overview with (security_invoker = true) as
select
  s.id,
  s.tenant_id,
  s.insurance_plan_id,
  p.name as plan_name,
  s.statement_number,
  s.emission_date,
  s.item_count,
  s.items_informed,
  s.items_released,
  s.items_gloss,
  s.declared_gloss,
  s.divergences,
  s.file_name,
  s.imported_at,
  coalesce(sum(i.amount) filter (where i.status <> 'cancelled'), 0) as invoiced,
  coalesce(sum(i.paid_amount) filter (where i.status = 'paid'), 0) as paid,
  max(i.paid_on) as last_paid_on,
  string_agg(i.invoice_number, ', ' order by i.issue_date) filter (where i.status <> 'cancelled') as invoice_numbers,
  case
    when count(i.id) filter (where i.status <> 'cancelled') = 0 then 'sem_nota'
    when bool_and(i.status = 'paid') filter (where i.status <> 'cancelled') then 'paga'
    else 'nota_emitida'
  end as financial_status
from claim_statements s
join insurance_plans p on p.id = s.insurance_plan_id
left join operator_invoices i on i.statement_id = s.id
group by s.id, p.name;

-- Glosas por código (situação atual)
create or replace view claim_gloss_by_code with (security_invoker = true) as
select
  c.tenant_id,
  c.insurance_plan_id,
  g.gloss_code,
  count(distinct c.item_key) as sessions,
  sum(g.gloss_value) as gloss,
  count(distinct c.card_blind_index) as beneficiaries
from claim_items_current c
join claim_return_glosses g on g.claim_return_id = c.id
group by c.tenant_id, c.insurance_plan_id, g.gloss_code;

-- ================================================================
-- 12. Relatórios que mostram nome do paciente (descriptografado)
-- Só para o financeiro — checagem explícita dentro da função.
-- ================================================================

create or replace function claim_gloss_details(p_plan_id uuid default null)
returns table (
  item_key text,
  statement_number text,
  emission_date date,
  realization_date date,
  provider_guide_number text,
  beneficiary_name text,
  card_last4 text,
  card_origin_code text,
  informed_value numeric,
  released_value numeric,
  gloss_value numeric,
  gloss_codes text,
  appeal_status text,
  recovered_value numeric
)
language plpgsql stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
  select
    c.item_key,
    c.statement_number,
    c.emission_date,
    c.realization_date,
    c.provider_guide_number,
    pgp_decrypt_field(r.beneficiary_name_encrypted),
    right(pgp_decrypt_field(r.card_number_encrypted), 4),
    c.card_origin_code,
    c.informed_value,
    c.released_value,
    c.gloss_value,
    c.gloss_type,
    coalesce(a.status, 'not_evaluated'),
    a.recovered_value
  from claim_items_current c
  join insurance_claim_returns r on r.id = c.id
  left join gloss_appeals a on a.tenant_id = c.tenant_id and a.item_key = c.item_key
  where c.tenant_id = current_tenant_id()
    and c.gloss_value > 0
    and (p_plan_id is null or c.insurance_plan_id = p_plan_id)
  order by c.realization_date desc, c.provider_guide_number;
end;
$$;

-- Mesmo paciente cobrado mais de uma vez na mesma data (guias diferentes).
-- Nos dados reais, TODA glosa 1702 caiu nesse padrão.
create or replace function claim_duplicate_billing(p_plan_id uuid default null)
returns table (
  realization_date date,
  beneficiary_name text,
  card_last4 text,
  sessions bigint,
  guides text,
  released_value numeric,
  gloss_value numeric
)
language plpgsql stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
  select
    c.realization_date,
    max(pgp_decrypt_field(r.beneficiary_name_encrypted)),
    max(right(pgp_decrypt_field(r.card_number_encrypted), 4)),
    count(*),
    string_agg(c.provider_guide_number, ', ' order by c.provider_guide_number),
    sum(c.released_value),
    sum(c.gloss_value)
  from claim_items_current c
  join insurance_claim_returns r on r.id = c.id
  where c.tenant_id = current_tenant_id()
    and c.card_blind_index is not null
    and (p_plan_id is null or c.insurance_plan_id = p_plan_id)
  group by c.card_blind_index, c.realization_date
  having count(*) > 1
  order by c.realization_date desc;
end;
$$;

-- ================================================================
-- 13. Permissões
-- ================================================================

revoke execute on function has_finance_access() from public, anon;
revoke execute on function import_claim_statement(jsonb) from public, anon;
revoke execute on function claim_gloss_details(uuid) from public, anon;
revoke execute on function claim_duplicate_billing(uuid) from public, anon;
grant execute on function has_finance_access() to authenticated;
grant execute on function import_claim_statement(jsonb) to authenticated;
grant execute on function claim_gloss_details(uuid) to authenticated;
grant execute on function claim_duplicate_billing(uuid) to authenticated;

revoke all on claim_items_current, claim_monthly_summary, claim_statement_overview, claim_gloss_by_code from anon;
grant select on claim_items_current, claim_monthly_summary, claim_statement_overview, claim_gloss_by_code to authenticated;

-- Endurecimento: criptografia NÃO deve ser chamável sem login.
-- (Encontrado em 29/09/2026: pgp_decrypt_field estava liberada para anon.)
-- Funções security definer internas (create_patient, triggers, as acima)
-- continuam funcionando porque rodam como dono.
revoke execute on function pgp_decrypt_field(bytea) from public, anon;
revoke execute on function pgp_encrypt_field(text) from public, anon;
revoke execute on function hmac_blind_index(text) from public, anon;
grant execute on function pgp_decrypt_field(bytea) to authenticated;
grant execute on function pgp_encrypt_field(text) to authenticated;
grant execute on function hmac_blind_index(text) to authenticated;
