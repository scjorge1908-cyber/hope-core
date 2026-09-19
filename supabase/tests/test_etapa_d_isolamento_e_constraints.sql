-- ================================================================
-- HOPE CORE — TESTE EXECUTÁVEL (Etapa D)
-- Não modifica dado real — usa tenants/usuários de teste descartáveis.
-- Resultado via tabela temporária (RAISE NOTICE não é capturado por
-- execute_sql remoto). Cleanup em ordem FK-segura (sem CASCADE conflict
-- com o trigger write_audit_log).
-- ================================================================

create temp table if not exists _test_results (
  seq    serial,
  test_num int,
  status text,
  message text
);
delete from _test_results;

do $$
declare
  v_tenant_a uuid;
  v_tenant_b uuid;
  v_user_a   uuid := gen_random_uuid();
  v_user_b   uuid := gen_random_uuid();
  v_prof_a   uuid;
  v_patient_a uuid;
  v_patient_b uuid;
  v_room_a   uuid;
  v_count    int;
  v_pass     int := 0;
  v_fail     int := 0;
  v_errmsg   text;
begin

  -- ================================================================
  -- SETUP
  -- ================================================================
  insert into tenants (name, legal_name, cnpj)
    values ('Tenant Teste A', 'Clinica A LTDA', '00000000000191')
    returning id into v_tenant_a;
  insert into tenants (name, legal_name, cnpj)
    values ('Tenant Teste B', 'Clinica B LTDA', '00000000000272')
    returning id into v_tenant_b;

  -- Em auth.users real isso é criado via Supabase Auth signup.
  -- Para teste isolado inserimos direto (ambiente de teste apenas).
  insert into auth.users (id, email) values (v_user_a, 'teste-a@example.com')
    on conflict (id) do nothing;
  insert into auth.users (id, email) values (v_user_b, 'teste-b@example.com')
    on conflict (id) do nothing;

  insert into users (id, tenant_id, role, full_name, email)
    values (v_user_a, v_tenant_a, 'owner', 'Usuário A', 'teste-a@example.com');
  insert into users (id, tenant_id, role, full_name, email)
    values (v_user_b, v_tenant_b, 'owner', 'Usuário B', 'teste-b@example.com');

  insert into professional_profiles (tenant_id, full_name, crp)
    values (v_tenant_a, 'Profissional Teste A', '00/00000')
    returning id into v_prof_a;

  insert into rooms (tenant_id, name)
    values (v_tenant_a, 'Sala Teste')
    returning id into v_room_a;

  insert into patients (tenant_id, full_name) values (v_tenant_a, 'Paciente A')
    returning id into v_patient_a;
  insert into patients (tenant_id, full_name) values (v_tenant_b, 'Paciente B')
    returning id into v_patient_b;

  -- ================================================================
  -- TESTE 1: isolamento de leitura entre tenants
  -- ================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_a::text)::text, true);
  execute format('set local role authenticated');

  select count(*) into v_count from patients where tenant_id = v_tenant_a;
  if v_count = 1 then
    insert into _test_results (test_num, status, message)
      values (1, 'PASS', 'tenant A enxerga exatamente 1 paciente (o seu)');
    v_pass := v_pass + 1;
  else
    insert into _test_results (test_num, status, message)
      values (1, 'FAIL', format('tenant A deveria ver 1 paciente, viu %s', v_count));
    v_fail := v_fail + 1;
  end if;

  select count(*) into v_count
    from patients where tenant_id = v_tenant_a and id = v_patient_b;
  if v_count = 0 then
    insert into _test_results (test_num, status, message)
      values (1, 'PASS', 'tenant A não enxerga paciente de B por filtro direto');
    v_pass := v_pass + 1;
  else
    insert into _test_results (test_num, status, message)
      values (1, 'FAIL', 'paciente de B vazou pro filtro de A');
    v_fail := v_fail + 1;
  end if;

  -- ================================================================
  -- TESTE 2: duplicidade de profissional por CPF (blind index)
  -- ================================================================
  begin
    update professional_profiles
      set cpf_blind_index = hmac_blind_index('11111111111')
      where id = v_prof_a;
    insert into professional_profiles (tenant_id, full_name, cpf_blind_index)
      values (v_tenant_a, 'Duplicata Proposital', hmac_blind_index('11111111111'));
    insert into _test_results (test_num, status, message)
      values (2, 'FAIL', 'constraint de CPF duplicado não bloqueou');
    v_fail := v_fail + 1;
  exception when unique_violation then
    insert into _test_results (test_num, status, message)
      values (2, 'PASS', 'CPF duplicado bloqueado (unique_violation)');
    v_pass := v_pass + 1;
  when others then
    get stacked diagnostics v_errmsg = message_text;
    insert into _test_results (test_num, status, message)
      values (2, 'AVISO', format('erro inesperado no teste de CPF profissional: %s', v_errmsg));
  end;

  -- ================================================================
  -- TESTE 3: duplicidade de paciente por CPF (blind index)
  -- ================================================================
  begin
    update patients
      set cpf_blind_index = hmac_blind_index('22222222222')
      where id = v_patient_a;
    insert into patients (tenant_id, full_name, cpf_blind_index)
      values (v_tenant_a, 'Paciente Duplicado', hmac_blind_index('22222222222'));
    insert into _test_results (test_num, status, message)
      values (3, 'FAIL', 'constraint de CPF de paciente duplicado não bloqueou');
    v_fail := v_fail + 1;
  exception when unique_violation then
    insert into _test_results (test_num, status, message)
      values (3, 'PASS', 'CPF de paciente duplicado bloqueado');
    v_pass := v_pass + 1;
  when others then
    get stacked diagnostics v_errmsg = message_text;
    insert into _test_results (test_num, status, message)
      values (3, 'AVISO', format('erro inesperado no teste de CPF paciente: %s', v_errmsg));
  end;

  -- ================================================================
  -- TESTE 4: payout duplicado (mesmo profissional/mês/ano)
  -- ================================================================
  begin
    insert into payouts
      (tenant_id, professional_id, reference_month, reference_year, gross_value, net_value)
      values (v_tenant_a, v_prof_a, 9, 2026, 1000, 900);
    insert into payouts
      (tenant_id, professional_id, reference_month, reference_year, gross_value, net_value)
      values (v_tenant_a, v_prof_a, 9, 2026, 1000, 900);
    insert into _test_results (test_num, status, message)
      values (4, 'FAIL', 'payout duplicado não foi bloqueado');
    v_fail := v_fail + 1;
  exception when unique_violation then
    insert into _test_results (test_num, status, message)
      values (4, 'PASS', 'payout duplicado bloqueado');
    v_pass := v_pass + 1;
  when others then
    get stacked diagnostics v_errmsg = message_text;
    insert into _test_results (test_num, status, message)
      values (4, 'AVISO', format('erro inesperado no teste de payout: %s', v_errmsg));
  end;

  -- ================================================================
  -- TESTE 5: sala com 2 agendamentos no mesmo (weekday, horário)
  -- ================================================================
  begin
    insert into appointments
      (tenant_id, professional_id, patient_id, room_id, weekday, start_time)
      values (v_tenant_a, v_prof_a, v_patient_a, v_room_a, 1, '09:00');
    insert into appointments
      (tenant_id, professional_id, patient_id, room_id, weekday, start_time)
      values (v_tenant_a, v_prof_a, v_patient_a, v_room_a, 1, '09:00');
    insert into _test_results (test_num, status, message)
      values (5, 'FAIL', 'conflito de sala/horário não foi bloqueado');
    v_fail := v_fail + 1;
  exception when unique_violation then
    insert into _test_results (test_num, status, message)
      values (5, 'PASS', 'conflito de sala/horário bloqueado');
    v_pass := v_pass + 1;
  when others then
    get stacked diagnostics v_errmsg = message_text;
    insert into _test_results (test_num, status, message)
      values (5, 'AVISO', format('erro inesperado no teste de sala/horário: %s', v_errmsg));
  end;

  -- ================================================================
  -- TESTE 6: payout_rules com vigência sobreposta
  -- ================================================================
  begin
    insert into payout_rules
      (tenant_id, professional_id, pf_percentage, valid_from, valid_until)
      values (v_tenant_a, v_prof_a, 40, '2026-01-01', '2026-06-30');
    insert into payout_rules
      (tenant_id, professional_id, pf_percentage, valid_from, valid_until)
      values (v_tenant_a, v_prof_a, 45, '2026-06-01', '2026-12-31');
    insert into _test_results (test_num, status, message)
      values (6, 'FAIL', 'sobreposição de vigência não foi bloqueada');
    v_fail := v_fail + 1;
  exception when exclusion_violation then
    insert into _test_results (test_num, status, message)
      values (6, 'PASS', 'sobreposição de vigência bloqueada (exclusion_violation)');
    v_pass := v_pass + 1;
  when others then
    get stacked diagnostics v_errmsg = message_text;
    insert into _test_results (test_num, status, message)
      values (6, 'AVISO', format('erro inesperado no teste de payout_rules: %s', v_errmsg));
  end;

  -- ================================================================
  -- TESTE 7: RLS habilitada em todas as tabelas de public
  -- ================================================================
  select count(*) into v_count
  from pg_tables t
  join pg_class c on c.relname = t.tablename
  where t.schemaname = 'public'
    and c.relrowsecurity = false
    and t.tablename not in ('schema_migrations');
  if v_count = 0 then
    insert into _test_results (test_num, status, message)
      values (7, 'PASS', 'nenhuma tabela em public sem RLS habilitada');
    v_pass := v_pass + 1;
  else
    insert into _test_results (test_num, status, message)
      values (7, 'FAIL', format('%s tabela(s) em public sem RLS habilitada', v_count));
    v_fail := v_fail + 1;
  end if;

  -- ================================================================
  -- TESTE 8: current_tenant_id / is_platform_admin são SECURITY DEFINER
  -- ================================================================
  select count(*) into v_count
  from pg_proc
  where proname in ('current_tenant_id','is_platform_admin')
    and prosecdef = true;
  if v_count = 2 then
    insert into _test_results (test_num, status, message)
      values (8, 'PASS', 'as duas funções são security definer');
    v_pass := v_pass + 1;
  else
    insert into _test_results (test_num, status, message)
      values (8, 'FAIL', format('esperava 2 funções security definer, achou %s', v_count));
    v_fail := v_fail + 1;
  end if;

  -- ================================================================
  -- RESULTADO FINAL
  -- ================================================================
  insert into _test_results (test_num, status, message)
    values (99, 'RESULTADO FINAL',
            format('%s PASS / %s FAIL', v_pass, v_fail));

  -- ================================================================
  -- LIMPEZA em ordem FK-segura
  -- Deletar tabelas auditadas ANTES do tenant para que o trigger
  -- write_audit_log encontre o tenant ainda existente.
  -- Ao deletar o tenant, o CASCADE limpa audit_log + users residuais.
  -- ================================================================
  delete from appointments      where tenant_id in (v_tenant_a, v_tenant_b);
  delete from payouts           where tenant_id in (v_tenant_a, v_tenant_b);
  delete from payout_rules      where tenant_id in (v_tenant_a, v_tenant_b);
  delete from professional_profiles where tenant_id in (v_tenant_a, v_tenant_b);
  delete from patients          where tenant_id in (v_tenant_a, v_tenant_b);
  delete from rooms             where tenant_id in (v_tenant_a, v_tenant_b);
  -- CASCADE em tenants remove: audit_log, users, insurance_plans,
  -- waitlist_entries, notifications (já todos vazios para estes tenants)
  delete from tenants           where id in (v_tenant_a, v_tenant_b);
  delete from users             where id in (v_user_a, v_user_b); -- no-op (CASCADE já removeu)
  delete from auth.users        where id in (v_user_a, v_user_b);

end $$;

select seq, test_num, status, message
  from _test_results
  order by seq;

drop table if exists _test_results;
