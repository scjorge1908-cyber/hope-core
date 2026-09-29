-- =====================================================================
-- migration_011 — Agenda de recebimentos e pagamentos (fluxo de caixa)
--
-- Substitui a planilha "A RECEBER / A PAGAR" por mês (dias 1–31 nas
-- colunas, planos e despesas nas linhas):
--   • cashflow_items: cada valor previsto/realizado (entrada ou saída)
--       - origem 'orizon'  → lotes do portal Orizon (Bradesco Saúde),
--         importados do Excel "Lotes Exportados e Liberados" (1 lote = 1 guia)
--       - origem 'manual'  → lançamentos à mão (outros planos, INSS, salas…)
--   • Notas fiscais das operadoras (operator_invoices, ex.: Unimed) entram
--     na agenda automaticamente pela view cashflow_calendar.
--   • Prazo de pagamento por plano (insurance_plans.payment_days/base):
--     Bradesco Saúde = 45 dias corridos da data de envio; se cair em fim
--     de semana ou feriado bancário, vai para o próximo dia útil.
--   • Pagamento confirmado: por enquanto marcado à mão na agenda; no
--     futuro, pela API do banco (realized_source = 'banco').
-- =====================================================================

-- ----------------------------------------------------------------
-- 1. Planos: nome curto (linha da agenda) e prazo de pagamento
-- ----------------------------------------------------------------
alter table insurance_plans add column if not exists short_name text;
alter table insurance_plans add column if not exists payment_days int
  check (payment_days is null or payment_days between 0 and 365);
alter table insurance_plans add column if not exists payment_base text
  check (payment_base is null or payment_base in ('envio', 'liberacao', 'nf'));
alter table insurance_plans add column if not exists payment_business_day boolean not null default true;
alter table insurance_plans add column if not exists display_order int;

comment on column insurance_plans.payment_days is 'Prazo de pagamento em dias corridos, contado a partir de payment_base.';
comment on column insurance_plans.payment_base is 'envio = data de envio do lote; liberacao = data de liberação; nf = emissão da nota fiscal.';
comment on column insurance_plans.payment_business_day is 'Se a data cair em fim de semana/feriado bancário, passa para o próximo dia útil.';

-- Planos da planilha "A RECEBER" (mesma ordem da planilha)
do $$
declare
  v_tenant uuid;
  r record;
begin
  select tenant_id into v_tenant from legado.config where id;
  if v_tenant is null then
    select id into v_tenant from tenants order by created_at limit 1;
  end if;
  if v_tenant is null then return; end if;

  for r in
    select * from (values
      (1, 'Select',         'SELECT',          null::text, null::int, null::text),
      (2, 'Geap',           'GEAP',            null,       null,      null),
      (3, 'Bradesco',       'BRADESCO SAÚDE',  '005711',   45,        'envio'),
      (4, 'SC Saúde',       'SC SAÚDE',        null,       null,      null),
      (5, 'Celos',          'CELOS',           null,       null,      null),
      (6, 'Unimed',         null,              '360449',   null,      null),
      (7, 'Saudesc',        'SAUDESC',         null,       null,      null),
      (8, 'Pladisa',        'PLADISA',         null,       null,      null),
      (9, 'Cassi',          'CASSI',           null,       null,      null)
    ) as t(ordem, curto, nome, ans, dias, base)
  loop
    if r.ans is not null and exists (select 1 from insurance_plans p where p.tenant_id = v_tenant and p.operator_ans_code = r.ans) then
      update insurance_plans p
         set short_name = coalesce(p.short_name, r.curto),
             display_order = coalesce(p.display_order, r.ordem),
             payment_days = coalesce(p.payment_days, r.dias),
             payment_base = coalesce(p.payment_base, r.base)
       where p.tenant_id = v_tenant and p.operator_ans_code = r.ans;
    elsif not exists (select 1 from insurance_plans p
                       where p.tenant_id = v_tenant
                         and (upper(p.short_name) = upper(r.curto) or upper(p.name) = upper(coalesce(r.nome, r.curto)))) then
      insert into insurance_plans (tenant_id, name, short_name, operator_ans_code, active, display_order, payment_days, payment_base)
      values (v_tenant, coalesce(r.nome, r.curto), r.curto, r.ans, true, r.ordem, r.dias, r.base);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------
-- 2. Feriados bancários nacionais (Febraban) — dia útil de pagamento
-- ----------------------------------------------------------------
create table if not exists bank_holidays (
  day date primary key,
  name text not null
);

insert into bank_holidays (day, name) values
  ('2026-01-01', 'Confraternização Universal'),
  ('2026-02-16', 'Carnaval'),
  ('2026-02-17', 'Carnaval'),
  ('2026-04-03', 'Sexta-feira Santa'),
  ('2026-04-21', 'Tiradentes'),
  ('2026-05-01', 'Dia do Trabalho'),
  ('2026-06-04', 'Corpus Christi'),
  ('2026-09-07', 'Independência do Brasil'),
  ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'),
  ('2026-11-15', 'Proclamação da República'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Confraternização Universal'),
  ('2027-02-08', 'Carnaval'),
  ('2027-02-09', 'Carnaval'),
  ('2027-03-26', 'Sexta-feira Santa'),
  ('2027-04-21', 'Tiradentes'),
  ('2027-05-01', 'Dia do Trabalho'),
  ('2027-05-27', 'Corpus Christi'),
  ('2027-09-07', 'Independência do Brasil'),
  ('2027-10-12', 'Nossa Senhora Aparecida'),
  ('2027-11-02', 'Finados'),
  ('2027-11-15', 'Proclamação da República'),
  ('2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2027-12-25', 'Natal')
on conflict (day) do nothing;

alter table bank_holidays enable row level security;
drop policy if exists bank_holidays_read on bank_holidays;
create policy bank_holidays_read on bank_holidays for select to authenticated using (true);
revoke all on table bank_holidays from anon;

create or replace function next_business_day(p date)
returns date
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  d date := p;
begin
  if d is null then return null; end if;
  while extract(isodow from d) in (6, 7) or exists (select 1 from bank_holidays h where h.day = d) loop
    d := d + 1;
  end loop;
  return d;
end;
$$;

-- Data prevista de pagamento pelas regras do plano (null = plano sem prazo cadastrado)
create or replace function cashflow_expected_date(p_plan uuid, p_sent date, p_released date, p_nf date)
returns date
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v insurance_plans;
  v_base date;
  v_d date;
begin
  select * into v from insurance_plans where id = p_plan;
  if v.id is null or v.payment_days is null then return null; end if;
  v_base := case coalesce(v.payment_base, 'envio')
              when 'envio' then coalesce(p_sent, p_released)
              when 'liberacao' then coalesce(p_released, p_sent)
              when 'nf' then p_nf
            end;
  if v_base is null then return null; end if;
  v_d := v_base + v.payment_days;
  if v.payment_business_day then v_d := next_business_day(v_d); end if;
  return v_d;
end;
$$;

-- ----------------------------------------------------------------
-- 3. Importações e lançamentos
-- ----------------------------------------------------------------
create table if not exists cashflow_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  source text not null check (source in ('orizon')),
  file_name text not null,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  rows_total int not null default 0,
  rows_new int not null default 0,
  rows_updated int not null default 0,
  rows_unchanged int not null default 0,
  imported_by uuid,
  imported_at timestamptz not null default now()
);

create table if not exists cashflow_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('entrada', 'saida')),
  insurance_plan_id uuid references insurance_plans(id),
  category text not null,                 -- linha da agenda (nome curto do plano ou da despesa)
  source text not null check (source in ('orizon', 'manual')),
  external_ref text,                      -- Orizon: número do lote (= número da guia)
  protocol text,
  guide_type text,
  guide_count int,
  reference_date date,                    -- Orizon: data de envio
  released_at timestamptz,                -- Orizon: data de liberação
  origin_status text,                     -- Orizon: Exportado/Liberado/…
  amount numeric(12,2) not null check (amount >= 0),
  expected_date date not null,            -- data prevista de pagamento/recebimento
  status text not null default 'previsto' check (status in ('previsto', 'realizado', 'glosado', 'cancelado')),
  realized_date date,
  realized_amount numeric(12,2),
  realized_source text check (realized_source is null or realized_source in ('manual', 'banco')),
  description text,
  import_id uuid references cashflow_imports(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_cashflow_imports_file on cashflow_imports (tenant_id, source, file_sha256);
create unique index if not exists uq_cashflow_items_ref on cashflow_items (tenant_id, source, insurance_plan_id, external_ref)
  where external_ref is not null;
create index if not exists idx_cashflow_items_date on cashflow_items (tenant_id, expected_date);

do $$
declare
  t text;
begin
  foreach t in array array['cashflow_imports', 'cashflow_items']
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

drop trigger if exists trg_set_updated_at on cashflow_items;
create trigger trg_set_updated_at before update on cashflow_items
  for each row execute function set_updated_at();

drop trigger if exists trg_audit_log on cashflow_items;
create trigger trg_audit_log after insert or update or delete on cashflow_items
  for each row execute function write_audit_log();

-- ----------------------------------------------------------------
-- 4. Importação do Excel da Orizon (tudo ou nada)
-- p = {"fileName": "...", "sha256": "...", "linhas": [
--       {"lote": "1828225952", "protocolo": "230135794", "envio": "2026-08-07",
--        "liberacao": "2026-08-07T10:28:53", "operadora": "BRADESCO SAÚDE",
--        "tipoGuia": "SADT", "qtdGuias": 1, "valor": 46.83, "status": "Exportado",
--        "cnpj": "47283631000129"}, ...]}
-- ----------------------------------------------------------------
create or replace function import_orizon_lotes(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_user uuid := auth.uid();
  v_import uuid;
  v_plan uuid;
  v_cat text;
  l jsonb;
  v_old cashflow_items;
  v_env date;
  v_lib timestamptz;
  v_val numeric(12,2);
  v_exp date;
  n_new int := 0;
  n_upd int := 0;
  n_same int := 0;
  n_total int := 0;
  v_primeira date;
  v_ultima date;
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if jsonb_typeof(p->'linhas') <> 'array' or jsonb_array_length(p->'linhas') = 0 then
    raise exception 'Arquivo sem lotes.';
  end if;
  if coalesce(p->>'sha256', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Identificador do arquivo inválido.';
  end if;
  if exists (select 1 from cashflow_imports i where i.tenant_id = v_tenant and i.source = 'orizon' and i.file_sha256 = p->>'sha256') then
    raise exception 'Este arquivo já foi importado.' using errcode = '23505';
  end if;

  -- Operadora: hoje o Orizon da clínica é só Bradesco Saúde
  if exists (select 1 from jsonb_array_elements(p->'linhas') x
              where upper(coalesce(x->>'operadora', '')) not like 'BRADESCO%') then
    raise exception 'O arquivo tem lotes de outra operadora além do Bradesco Saúde.';
  end if;
  select id, coalesce(short_name, name) into v_plan, v_cat
    from insurance_plans
   where tenant_id = v_tenant and operator_ans_code = '005711'
   limit 1;
  if v_plan is null then
    raise exception 'Plano Bradesco Saúde (ANS 005711) não cadastrado.';
  end if;

  insert into cashflow_imports (tenant_id, source, file_name, file_sha256, imported_by)
  values (v_tenant, 'orizon', coalesce(p->>'fileName', 'orizon.xlsx'), p->>'sha256', v_user)
  returning id into v_import;

  for l in select * from jsonb_array_elements(p->'linhas')
  loop
    n_total := n_total + 1;
    if coalesce(l->>'lote', '') = '' then
      raise exception 'Linha % sem número de lote.', n_total;
    end if;
    v_env := (l->>'envio')::date;
    v_lib := nullif(l->>'liberacao', '')::timestamp at time zone 'America/Sao_Paulo';
    v_val := (l->>'valor')::numeric;
    v_exp := cashflow_expected_date(v_plan, v_env, (v_lib at time zone 'America/Sao_Paulo')::date, null);
    if v_exp is null then
      raise exception 'Lote %: sem data de envio para calcular o pagamento.', l->>'lote';
    end if;
    v_primeira := least(coalesce(v_primeira, v_exp), v_exp);
    v_ultima := greatest(coalesce(v_ultima, v_exp), v_exp);

    select * into v_old from cashflow_items c
     where c.tenant_id = v_tenant and c.source = 'orizon'
       and c.insurance_plan_id = v_plan and c.external_ref = l->>'lote';

    if v_old.id is null then
      insert into cashflow_items (
        tenant_id, kind, insurance_plan_id, category, source, external_ref, protocol, guide_type, guide_count,
        reference_date, released_at, origin_status, amount, expected_date, import_id, created_by)
      values (
        v_tenant, 'entrada', v_plan, v_cat, 'orizon', l->>'lote', nullif(l->>'protocolo', ''), nullif(l->>'tipoGuia', ''),
        nullif(l->>'qtdGuias', '')::int, v_env, v_lib, nullif(l->>'status', ''), v_val, v_exp, v_import, v_user);
      n_new := n_new + 1;
    elsif v_old.amount is distinct from v_val
       or v_old.reference_date is distinct from v_env
       or v_old.released_at is distinct from v_lib
       or v_old.origin_status is distinct from nullif(l->>'status', '')
       or v_old.protocol is distinct from nullif(l->>'protocolo', '') then
      -- reenvio/atualização do lote: atualiza dados; o que já foi recebido fica como está
      update cashflow_items c
         set amount = v_val,
             reference_date = v_env,
             released_at = v_lib,
             origin_status = nullif(l->>'status', ''),
             protocol = nullif(l->>'protocolo', ''),
             expected_date = case when c.status = 'previsto' then v_exp else c.expected_date end,
             import_id = v_import
       where c.id = v_old.id;
      n_upd := n_upd + 1;
    else
      n_same := n_same + 1;
    end if;
  end loop;

  update cashflow_imports
     set rows_total = n_total, rows_new = n_new, rows_updated = n_upd, rows_unchanged = n_same
   where id = v_import;

  return jsonb_build_object(
    'importId', v_import, 'total', n_total, 'novos', n_new, 'atualizados', n_upd, 'semMudanca', n_same,
    'primeiroPagamento', v_primeira, 'ultimoPagamento', v_ultima);
end;
$$;

alter function import_orizon_lotes(jsonb) set statement_timeout = '60s';
revoke execute on function import_orizon_lotes(jsonb) from public, anon;
grant execute on function import_orizon_lotes(jsonb) to authenticated;

-- ----------------------------------------------------------------
-- 5. Agenda: lançamentos + notas fiscais das operadoras
-- ----------------------------------------------------------------
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
where i.status <> 'cancelled';

grant select on cashflow_calendar to authenticated;
revoke all on cashflow_calendar from anon;
