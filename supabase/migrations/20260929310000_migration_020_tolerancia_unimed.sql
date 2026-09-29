-- =====================================================================
-- migration_020 — tolerância da regra 4 (pagador identificado + um único
-- previsto do plano no período) passa de 2% para 5%.
--   Extrato real da Unimed × demonstrativos (2026):
--     25/02 R$ 12.393,61 × 259595 R$ 12.894,55 (−3,9%)
--     25/03 R$ 13.589,84 × 260931 R$ 13.990,06 (−2,9%)
--     27/04 R$ 20.074,23 × 263817 R$ 20.347,47 (−1,3% = glosa declarada R$ 273,24)
--     25/05 e 25/06 valores iguais; 25/09 −0,4%
-- =====================================================================
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
  v_aprox int := 0;
  v_manuais int := 0;
  v_itens int := 0;
  v_feito boolean;
  v_item uuid;
begin
  for t in
    select b.* from bank_transactions b
     where b.tenant_id = p_tenant and b.kind = 'entrada' and not b.ignored
       and not exists (select 1 from bank_matches m where m.bank_transaction_id = b.id)
     order by b.occurred_on, b.occurred_at
  loop
    v_plano := bank_plano_do_pagador(p_tenant, coalesce(t.counterparty_name, '') || ' ' || coalesce(t.description, ''));
    v_feito := false;

    -- regra 0: já confirmado à mão, mesmo plano e mesmo valor, sem vínculo com o banco
    if v_plano is not null then
      select c2.id into v_item
        from cashflow_items c2
       where c2.tenant_id = p_tenant and c2.kind = 'entrada' and c2.status = 'realizado'
         and coalesce(c2.realized_source, 'manual') = 'manual'
         and c2.insurance_plan_id = v_plano
         and (abs(c2.amount - t.amount) <= 0.01 or abs(coalesce(c2.realized_amount, -1) - t.amount) <= 0.01)
         and c2.expected_date between t.occurred_on - 45 and t.occurred_on + 15
         and not exists (select 1 from bank_matches m where m.origem = 'item' and m.target_id = c2.id)
       order by abs(c2.expected_date - t.occurred_on)
       limit 1;
      if v_item is not null then
        perform bank_aplicar(p_tenant, t.id, 'item', v_item, t.amount, t.occurred_on, 'auto', 'já confirmado à mão');
        v_manuais := v_manuais + 1;
        v_itens := v_itens + 1;
        continue;
      end if;
    end if;

    -- regra 1: valor igual
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
      continue;
    end if;

    -- regra 2: soma do dia do mesmo plano
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

    if v_plano is null then
      continue;
    end if;

    -- regra 3: mais antigos do plano até fechar o valor exato
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
      continue;
    end if;

    -- regra 4: um único previsto do plano no período, diferença de até 2%
    select count(*) into v_qtd
      from bank_previstos_pendentes(p_tenant) x
     where x.insurance_plan_id = v_plano
       and x.expected_date between t.occurred_on - 30 and t.occurred_on + 10
       and abs(x.amount - t.amount) <= greatest(x.amount * 0.05, 0.01);
    if v_qtd = 1 then
      select * into v_alvo
        from bank_previstos_pendentes(p_tenant) x
       where x.insurance_plan_id = v_plano
         and x.expected_date between t.occurred_on - 30 and t.occurred_on + 10
         and abs(x.amount - t.amount) <= greatest(x.amount * 0.05, 0.01);
      perform bank_aplicar(p_tenant, t.id, v_alvo.origem, v_alvo.target_id, t.amount, t.occurred_on, 'auto',
                           'valor aproximado (dif. ' || to_char(t.amount - v_alvo.amount, 'FM999G990D00') || ')');
      v_aprox := v_aprox + 1;
      v_itens := v_itens + 1;
    end if;
  end loop;

  return jsonb_build_object('creditos_valor_igual', v_unicos, 'creditos_soma', v_grupos, 'creditos_em_ordem', v_fifo,
                            'creditos_aproximados', v_aprox, 'ja_confirmados_vinculados', v_manuais,
                            'previstos_confirmados', v_itens);
end;
$$;
revoke execute on function bank_conciliar_tenant(uuid) from public, anon, authenticated;
