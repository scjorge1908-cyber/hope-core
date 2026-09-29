-- =====================================================================
-- migration_017 — Extrato do banco (Cora) + conciliação automática
--   • bank_transactions: cada lançamento do extrato do Cora (espelho;
--     o mesmo lançamento nunca entra duas vezes)
--   • bank_matches: qual entrada do banco pagou qual previsto da Agenda
--     (cashflow_items ou nota fiscal da operadora)
--   • bank_registrar_extrato(p): grava o extrato e concilia
--   • bank_conciliar(): regras automáticas (só entradas):
--       1) mesmo valor (±R$ 0,01) de UM previsto pendente, com data
--          prevista entre 10 dias antes e 30 dias depois do crédito;
--          se o pagador indica o plano (ex.: "BRADESCO", "UNIMED"),
--          só procura nesse plano; empate de valor → fica p/ conferir
--       2) soma de TODOS os previstos pendentes do mesmo plano com a
--          mesma data prevista = valor do crédito (ex.: vários lotes da
--          Orizon pagos num único depósito)
--       3) pagador identificado: o crédito quita os previstos mais antigos
--          do plano, em ordem, quando a soma fecha o valor exato
--   • Confirmado pelo banco: cashflow_items.realized_source = 'banco';
--     nota fiscal fica 'paid' com a data e o valor do crédito.
-- =====================================================================

create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  bank text not null default 'cora',
  external_id text not null,
  occurred_at timestamptz not null,
  occurred_on date not null,
  kind text not null check (kind in ('entrada', 'saida')),
  amount numeric(14, 2) not null check (amount >= 0),
  transaction_type text,
  description text,
  counterparty_name text,
  counterparty_doc text,
  raw jsonb,
  ignored boolean not null default false,
  created_at timestamptz not null default now(),
  constraint uq_bank_transactions unique (tenant_id, bank, external_id)
);
create index if not exists idx_bank_transactions_date on bank_transactions (tenant_id, occurred_on desc);

create table if not exists bank_matches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  bank_transaction_id uuid not null references bank_transactions(id) on delete cascade,
  origem text not null check (origem in ('item', 'nota_fiscal')),
  target_id uuid not null,
  amount numeric(14, 2) not null,
  matched_by text not null check (matched_by in ('auto', 'manual')),
  regra text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint uq_bank_matches_target unique (origem, target_id)
);
create index if not exists idx_bank_matches_tx on bank_matches (bank_transaction_id);

create table if not exists bank_sync (
  tenant_id uuid primary key references tenants(id),
  bank text not null default 'cora',
  last_synced_at timestamptz,
  last_period_start date,
  last_period_end date,
  last_result jsonb
);

do $$
declare
  t text;
begin
  foreach t in array array['bank_transactions', 'bank_matches', 'bank_sync']
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

drop trigger if exists trg_audit_log on bank_matches;
create trigger trg_audit_log after insert or update or delete on bank_matches
  for each row execute function write_audit_log();

-- ----------------------------------------------------------------
-- previstos pendentes (entradas) — mesma base da Agenda
-- ----------------------------------------------------------------
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
$$;
revoke execute on function bank_previstos_pendentes(uuid) from public, anon, authenticated;

-- plano indicado pelo pagador (nome da contraparte / descrição)
create or replace function bank_plano_do_pagador(p_tenant uuid, p_texto text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
    from insurance_plans p
   where p.tenant_id = p_tenant
     and length(split_part(coalesce(p.short_name, ''), ' ', 1)) >= 4
     and upper(coalesce(p_texto, '')) like '%' || upper(split_part(p.short_name, ' ', 1)) || '%'
   order by length(p.short_name) desc
   limit 1
$$;
revoke execute on function bank_plano_do_pagador(uuid, text) from public, anon, authenticated;

-- aplica a confirmação no previsto
create or replace function bank_aplicar(p_tenant uuid, p_tx uuid, p_origem text, p_target uuid, p_valor numeric, p_data date, p_por text, p_regra text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_origem = 'nota_fiscal' then
    update operator_invoices set status = 'paid', paid_on = p_data, paid_amount = p_valor
     where id = p_target and tenant_id = p_tenant;
  else
    update cashflow_items
       set status = 'realizado', realized_date = p_data, realized_amount = p_valor, realized_source = 'banco'
     where id = p_target and tenant_id = p_tenant;
  end if;
  insert into bank_matches (tenant_id, bank_transaction_id, origem, target_id, amount, matched_by, regra, created_by)
  values (p_tenant, p_tx, p_origem, p_target, p_valor, p_por, p_regra, auth.uid());
end;
$$;
revoke execute on function bank_aplicar(uuid, uuid, text, uuid, numeric, date, text, text) from public, anon, authenticated;

create or replace function bank_conciliar_tenant(p_tenant uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  t record;
  c record;
  v_plano uuid;
  v_qtd int;
  v_planos int;
  v_alvo record;
  v_soma numeric;
  v_ids text[];
  v_unicos int := 0;
  v_grupos int := 0;
  v_fifo int := 0;
  v_itens int := 0;
  v_feito boolean;
begin
  for t in
    select b.* from bank_transactions b
     where b.tenant_id = p_tenant and b.kind = 'entrada' and not b.ignored
       and not exists (select 1 from bank_matches m where m.bank_transaction_id = b.id)
     order by b.occurred_on, b.occurred_at
  loop
    v_plano := bank_plano_do_pagador(p_tenant, coalesce(t.counterparty_name, '') || ' ' || coalesce(t.description, ''));
    v_feito := false;

    -- regra 1: um previsto com o mesmo valor. Vários iguais (ex.: lotes do
    -- Bradesco, todos R$ 46,83) são intercambiáveis quando são do mesmo
    -- plano: fica o de data prevista mais próxima (e mais antiga).
    select count(*), count(distinct x.insurance_plan_id) into v_qtd, v_planos
      from bank_previstos_pendentes(p_tenant) x
     where abs(x.amount - t.amount) <= 0.01
       and x.expected_date between t.occurred_on - 30 and t.occurred_on + 10
       and (v_plano is null or x.insurance_plan_id = v_plano);
    if v_qtd = 1 or (v_qtd > 1 and v_planos = 1 and (v_plano is not null)) then
      select * into v_alvo
        from bank_previstos_pendentes(p_tenant) x
       where abs(x.amount - t.amount) <= 0.01
         and x.expected_date between t.occurred_on - 30 and t.occurred_on + 10
         and (v_plano is null or x.insurance_plan_id = v_plano)
       order by abs(x.expected_date - t.occurred_on), x.expected_date, x.target_id
       limit 1;
      perform bank_aplicar(p_tenant, t.id, v_alvo.origem, v_alvo.target_id, t.amount, t.occurred_on, 'auto', 'valor igual');
      v_unicos := v_unicos + 1;
      v_itens := v_itens + 1;
      continue;
    end if;
    if v_qtd > 1 and v_plano is null then
      continue; -- mesmo valor em planos diferentes e pagador desconhecido: conferir
    end if;

    -- regra 2: soma de todos os previstos do mesmo plano na mesma data prevista
    for c in
      select x.insurance_plan_id, x.expected_date
        from bank_previstos_pendentes(p_tenant) x
       where x.insurance_plan_id is not null
         and x.expected_date between t.occurred_on - 30 and t.occurred_on + 10
         and (v_plano is null or x.insurance_plan_id = v_plano)
       group by 1, 2
      having count(*) > 1 and abs(sum(x.amount) - t.amount) <= 0.01
       order by abs(x.expected_date - t.occurred_on)
       limit 1
    loop
      for v_alvo in
        select * from bank_previstos_pendentes(p_tenant) x
         where x.insurance_plan_id = c.insurance_plan_id and x.expected_date = c.expected_date
      loop
        perform bank_aplicar(p_tenant, t.id, v_alvo.origem, v_alvo.target_id, v_alvo.amount, t.occurred_on, 'auto', 'soma do dia');
        v_itens := v_itens + 1;
      end loop;
      v_grupos := v_grupos + 1;
      v_feito := true;
    end loop;
    continue when v_feito;

    -- regra 3 (só com o plano identificado pelo pagador): o crédito paga os
    -- previstos mais antigos do plano, em ordem, até fechar o valor exato
    if v_plano is not null then
      v_soma := 0;
      v_ids := array[]::text[];
      for v_alvo in
        select * from bank_previstos_pendentes(p_tenant) x
         where x.insurance_plan_id = v_plano
           and x.expected_date between t.occurred_on - 60 and t.occurred_on + 10
         order by x.expected_date, x.target_id
      loop
        v_soma := v_soma + v_alvo.amount;
        v_ids := v_ids || (v_alvo.origem || ':' || v_alvo.target_id::text);
        exit when v_soma >= t.amount - 0.01;
      end loop;
      if array_length(v_ids, 1) > 1 and abs(v_soma - t.amount) <= 0.01 then
        for v_alvo in
          select * from bank_previstos_pendentes(p_tenant) x
           where (x.origem || ':' || x.target_id::text) = any (v_ids)
        loop
          perform bank_aplicar(p_tenant, t.id, v_alvo.origem, v_alvo.target_id, v_alvo.amount, t.occurred_on, 'auto', 'mais antigos do plano');
          v_itens := v_itens + 1;
        end loop;
        v_fifo := v_fifo + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('creditos_valor_igual', v_unicos, 'creditos_soma', v_grupos, 'creditos_em_ordem', v_fifo,
                            'previstos_confirmados', v_itens);
end;
$$;
revoke execute on function bank_conciliar_tenant(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------
-- Portas para o app (usuário do financeiro)
-- ----------------------------------------------------------------
-- p = {"bank":"cora","inicio":"2026-08-01","fim":"2026-09-29","entries":[{id,type,amount(centavos),createdAt,transaction:{...}}]}
create or replace function bank_registrar_extrato(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_t uuid := current_tenant_id();
  v_bank text := coalesce(nullif(p->>'bank', ''), 'cora');
  e jsonb;
  v_novos int := 0;
  v_quando timestamptz;
  v_res jsonb;
begin
  if not has_finance_access() or v_t is null then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if jsonb_typeof(p->'entries') <> 'array' then
    raise exception 'entries deve ser uma lista';
  end if;

  for e in select * from jsonb_array_elements(p->'entries')
  loop
    continue when coalesce(e->>'id', '') = '' or e->>'amount' is null or coalesce(e->>'createdAt', '') = '';
    -- sem fuso = horário de São Paulo; com Z/offset respeita o fuso
    v_quando := case when (e->>'createdAt') ~ '(Z|[+-]\d{2}:?\d{2})$'
                     then (e->>'createdAt')::timestamptz
                     else (e->>'createdAt')::timestamp at time zone 'America/Sao_Paulo' end;
    insert into bank_transactions (tenant_id, bank, external_id, occurred_at, occurred_on, kind, amount,
                                   transaction_type, description, counterparty_name, counterparty_doc, raw)
    values (v_t, v_bank, e->>'id', v_quando, (v_quando at time zone 'America/Sao_Paulo')::date,
            case when upper(e->>'type') = 'CREDIT' then 'entrada' else 'saida' end,
            round(abs((e->>'amount')::numeric) / 100, 2),
            e#>>'{transaction,type}', e#>>'{transaction,description}',
            e#>>'{transaction,counterParty,name}', e#>>'{transaction,counterParty,identity}', e)
    on conflict (tenant_id, bank, external_id) do nothing;
    if found then v_novos := v_novos + 1; end if;
  end loop;

  v_res := bank_conciliar_tenant(v_t);
  insert into bank_sync (tenant_id, bank, last_synced_at, last_period_start, last_period_end, last_result)
  values (v_t, v_bank, now(), nullif(p->>'inicio', '')::date, nullif(p->>'fim', '')::date,
          v_res || jsonb_build_object('lancamentos_novos', v_novos, 'recebidos', jsonb_array_length(p->'entries')))
  on conflict (tenant_id) do update set
    last_synced_at = excluded.last_synced_at, last_period_start = excluded.last_period_start,
    last_period_end = excluded.last_period_end, last_result = excluded.last_result;

  return v_res || jsonb_build_object('lancamentos_novos', v_novos);
end;
$$;
revoke execute on function bank_registrar_extrato(jsonb) from public, anon;
grant execute on function bank_registrar_extrato(jsonb) to authenticated;

-- vínculo manual: "este crédito pagou este previsto"
create or replace function bank_vincular(p_tx uuid, p_origem text, p_target uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_t uuid := current_tenant_id();
  v_tx bank_transactions;
  v_valor numeric;
  v_ja numeric;
begin
  if not has_finance_access() or v_t is null then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  select * into v_tx from bank_transactions where id = p_tx and tenant_id = v_t;
  if v_tx.id is null or v_tx.kind <> 'entrada' then raise exception 'Crédito não encontrado'; end if;
  select x.amount into v_valor from bank_previstos_pendentes(v_t) x where x.origem = p_origem and x.target_id = p_target;
  if v_valor is null then raise exception 'Previsto não encontrado ou já confirmado'; end if;
  select coalesce(sum(amount), 0) into v_ja from bank_matches where bank_transaction_id = p_tx;
  -- um crédito pode pagar vários previstos; o último leva o que sobra do crédito
  perform bank_aplicar(v_t, p_tx, p_origem, p_target, least(v_valor, greatest(v_tx.amount - v_ja, 0)), v_tx.occurred_on, 'manual', 'manual');
end;
$$;
revoke execute on function bank_vincular(uuid, text, uuid) from public, anon;
grant execute on function bank_vincular(uuid, text, uuid) to authenticated;

-- desfazer: previsto volta a pendente e o crédito volta para "a conferir"
create or replace function bank_desvincular(p_origem text, p_target uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_t uuid := current_tenant_id();
begin
  if not has_finance_access() or v_t is null then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  delete from bank_matches where tenant_id = v_t and origem = p_origem and target_id = p_target;
  if p_origem = 'nota_fiscal' then
    update operator_invoices set status = 'issued', paid_on = null, paid_amount = null where id = p_target and tenant_id = v_t;
  else
    update cashflow_items set status = 'previsto', realized_date = null, realized_amount = null, realized_source = null
     where id = p_target and tenant_id = v_t;
  end if;
end;
$$;
revoke execute on function bank_desvincular(text, uuid) from public, anon;
grant execute on function bank_desvincular(text, uuid) to authenticated;

-- ignorar um crédito que não é de plano (ex.: particular, transferência própria)
create or replace function bank_ignorar(p_tx uuid, p_ignorar boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  update bank_transactions set ignored = p_ignorar where id = p_tx and tenant_id = current_tenant_id();
end;
$$;
revoke execute on function bank_ignorar(uuid, boolean) from public, anon;
grant execute on function bank_ignorar(uuid, boolean) to authenticated;

-- sugestões para um crédito não conciliado (tela de conferência)
create or replace function bank_sugestoes(p_tx uuid)
returns table (origem text, target_id uuid, plano text, amount numeric, expected_date date, descricao text, diferenca numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_t uuid := current_tenant_id();
  v_tx bank_transactions;
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  select * into v_tx from bank_transactions where id = p_tx and tenant_id = v_t;
  if v_tx.id is null then return; end if;
  return query
  select x.origem, x.target_id, x.plano, x.amount, x.expected_date, x.descricao, x.amount - v_tx.amount
    from bank_previstos_pendentes(v_t) x
   where x.expected_date between v_tx.occurred_on - 45 and v_tx.occurred_on + 15
   order by abs(x.amount - v_tx.amount), abs(x.expected_date - v_tx.occurred_on)
   limit 8;
end;
$$;
revoke execute on function bank_sugestoes(uuid) from public, anon;
grant execute on function bank_sugestoes(uuid) to authenticated;
