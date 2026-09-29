-- ================================================================
-- HOPE CORE — MIGRATION 006 — IMPORTAÇÃO MAIS RÁPIDA
-- Depende da migration 005.
--
-- Problema (29/09/2026): a primeira importação pela página caiu no
-- limite de 8 s do papel `authenticated` ("canceling statement due to
-- statement timeout"). A função lia o Vault 4 vezes por sessão
-- (pgp_encrypt_field ×3 + hmac_blind_index), ~1.400 leituras num
-- demonstrativo de 345 sessões — lento com o banco recém-religado.
--
-- Correção: as duas chaves são lidas uma vez por arquivo e a
-- criptografia usa pgp_sym_encrypt / hmac direto. Resultado idêntico
-- (mesmas chaves, mesmo algoritmo) e legível por pgp_decrypt_field.
-- Nenhuma outra mudança de comportamento.
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
  v_enc_key text;
  v_idx_key text;
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

  -- Chaves lidas do Vault UMA vez por arquivo (antes: 4 leituras por sessão,
  -- o que estourava o limite de 8 s do Supabase com o banco "frio").
  select decrypted_secret into v_enc_key from vault.decrypted_secrets where name = 'hope_core_field_enc_key';
  select decrypted_secret into v_idx_key from vault.decrypted_secrets where name = 'hope_core_blind_index_key';
  if v_enc_key is null or v_idx_key is null then
    raise exception 'Chaves de criptografia não configuradas no Vault';
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
      -- mesmo algoritmo de pgp_encrypt_field / hmac_blind_index (compatível com pgp_decrypt_field)
      pgp_sym_encrypt(nullif(v_item->>'beneficiaryName', ''), v_enc_key),
      pgp_sym_encrypt(v_card, v_enc_key),
      pgp_sym_encrypt(nullif(v_item->>'authPassword', ''), v_enc_key),
      encode(hmac(v_card, v_idx_key, 'sha256'), 'hex'), left(v_card, 4),
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


revoke execute on function import_claim_statement(jsonb) from public, anon;
grant execute on function import_claim_statement(jsonb) to authenticated;
