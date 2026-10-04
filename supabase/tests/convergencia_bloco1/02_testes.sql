-- =====================================================================
-- Testes do Bloco 1 (ORDEM-005). Cada bloco DO falha com exceção se o
-- resultado não for o esperado. Rodar só no Postgres local (run.sh).
-- =====================================================================
\set ON_ERROR_STOP 1

-- ---------- B. Salas ----------
do $$
declare j jsonb; n int;
begin
  -- dry-run não grava
  j := public.bootstrap_rooms_from_legado();
  if (j->>'dry_run')::boolean is not true then raise exception 'B0: padrão deveria ser dry-run'; end if;
  if jsonb_array_length(j->'candidatas') <> 5 then raise exception 'B1: esperadas 5 salas candidatas, veio %', j->'candidatas'; end if;
  select count(*) into n from public.rooms;
  if n <> 0 then raise exception 'B2: dry-run gravou % sala(s)', n; end if;

  -- execução real
  j := public.bootstrap_rooms_from_legado(false);
  if jsonb_array_length(j->'inseridas') <> 5 then raise exception 'B3: esperadas 5 inseridas, veio %', j; end if;

  -- idempotência: 2ª e 3ª execução não inserem
  j := public.bootstrap_rooms_from_legado(false);
  if jsonb_array_length(j->'inseridas') <> 0 or jsonb_array_length(j->'ja_existiam') <> 5 then
    raise exception 'B4: reexecução não é idempotente: %', j;
  end if;
  perform public.bootstrap_rooms_from_legado(false);
  select count(*) into n from public.rooms;
  if n <> 5 then raise exception 'B5: esperadas 5 salas após 3 execuções, há %', n; end if;

  -- tenant correto (interno) e nenhuma sala no outro tenant
  select count(*) into n from public.rooms r join public.tenants t on t.id = r.tenant_id where not t.is_internal;
  if n <> 0 then raise exception 'B6: sala criada em tenant não interno'; end if;

  -- sala já cadastrada à mão com grafia diferente NÃO duplica
  delete from public.rooms where name = 'Sala 507 Consultório 5';
  insert into public.rooms (tenant_id, name) select id, '  SALA 507   CONSULTÓRIO 5 ' from public.tenants where is_internal;
  j := public.bootstrap_rooms_from_legado(false);
  if jsonb_array_length(j->'inseridas') <> 0 then raise exception 'B7: duplicou sala com grafia diferente: %', j; end if;
  raise notice 'B OK: 5 salas, idempotente, normalização de grafia OK';
end $$;

-- ---------- C. Psicólogas ----------
do $$
declare j jsonb; n int; a int; i int;
begin
  j := public.bootstrap_professional_profiles_from_legado();   -- dry-run
  if (j->>'a_criar')::int <> 24 or (j->>'ativas')::int <> 17 or (j->>'inativas')::int <> 7 then
    raise exception 'C1: dry-run esperado 24/17/7, veio %', j - 'itens';
  end if;
  select count(*) into n from public.professional_profiles;
  if n <> 0 then raise exception 'C2: dry-run gravou % perfil(is)', n; end if;

  j := public.bootstrap_professional_profiles_from_legado(false);
  select count(*), count(*) filter (where active), count(*) filter (where not active)
    into n, a, i from public.professional_profiles;
  if n <> 24 or a <> 17 or i <> 7 then raise exception 'C3: esperado 24/17/7, há %/%/%', n, a, i; end if;

  -- sem Auth, sem dado sensível, sem exclusão lógica
  select count(*) into n from public.professional_profiles
   where user_id is not null or cpf is not null or cpf_encrypted is not null or pix_key is not null
      or pix_key_encrypted is not null or rg is not null or deleted_at is not null;
  if n <> 0 then raise exception 'C4: % perfil(is) com user_id/CPF/Pix/RG/deleted_at', n; end if;

  -- todo vínculo preenchido e 1:1
  select count(*) into n from legado.planilhas where professional_profile_id is null;
  if n <> 0 then raise exception 'C5: % planilha(s) sem vínculo', n; end if;
  select count(distinct professional_profile_id) into n from legado.planilhas;
  if n <> 24 then raise exception 'C6: vínculo não é 1:1 (%)', n; end if;

  -- active coerente com o legado (ativo AND NOT desligada)
  select count(*) into n from legado.planilhas pl join public.professional_profiles pp on pp.id = pl.professional_profile_id
   where pp.active <> (pl.ativo and not pl.desligada) or pp.short_name <> pl.nome_abreviado;
  if n <> 0 then raise exception 'C7: % perfil(is) divergentes do legado', n; end if;

  -- idempotência
  j := public.bootstrap_professional_profiles_from_legado(false);
  if (j->>'a_criar')::int <> 0 or (j->>'ja_vinculadas_antes')::int <> 24 then raise exception 'C8: não idempotente: %', j - 'itens'; end if;
  select count(*) into n from public.professional_profiles;
  if n <> 24 then raise exception 'C9: duplicou perfis (%)', n; end if;
  raise notice 'C OK: 24 perfis (17 ativos / 7 inativos), sem Auth/PII, vínculo 1:1, idempotente';
end $$;

-- C10. Deduplicação: perfil pré-existente com o mesmo nome curto é VINCULADO, não duplicado
do $$
declare j jsonb; v_pp uuid; n int;
begin
  insert into legado.planilhas (spreadsheet_id, tenant_id, nome_abreviado, nome_completo, ordem, ativo, desligada)
  select 'TESTE_PLANILHA_P25_xxxxxxxx', id, 'P25', 'Profissional P25', 25, true, false from public.tenants where is_internal;
  insert into public.professional_profiles (tenant_id, full_name, short_name)
  select id, 'Cadastro manual P25', ' p25 ' from public.tenants where is_internal returning id into v_pp;
  j := public.bootstrap_professional_profiles_from_legado(false);
  if (j->>'a_vincular')::int <> 1 or (j->>'a_criar')::int <> 0 then raise exception 'C10: dedup falhou: %', j - 'itens'; end if;
  select count(*) into n from legado.planilhas where spreadsheet_id = 'TESTE_PLANILHA_P25_xxxxxxxx' and professional_profile_id = v_pp;
  if n <> 1 then raise exception 'C10b: vínculo do perfil pré-existente não gravado'; end if;
  -- limpa o caso de teste
  update legado.planilhas set professional_profile_id = null where spreadsheet_id = 'TESTE_PLANILHA_P25_xxxxxxxx';
  delete from legado.planilhas where spreadsheet_id = 'TESTE_PLANILHA_P25_xxxxxxxx';
  delete from public.professional_profiles where id = v_pp;
  raise notice 'C10 OK: deduplicação por nome curto vincula em vez de duplicar';
end $$;

-- ---------- D. vw_room_blocks ----------
do $$
declare n int; t int;
begin
  -- toda célula do painel cai em exatamente um bloco (soma das horas = 415)
  select coalesce(sum(horas), 0) into t from legado.vw_room_blocks;
  if t <> 415 then raise exception 'D1: soma de horas dos blocos = %, esperado 415', t; end if;

  -- nenhum bloco sobreposto na mesma sala/dia
  select count(*) into n from legado.vw_room_blocks a join legado.vw_room_blocks b
    on a.sala_norm = b.sala_norm and a.weekday = b.weekday
   and (a.bloco_inicio, a.planilha_ref, a.ocupante_tipo) is distinct from (b.bloco_inicio, b.planilha_ref, b.ocupante_tipo)
   and a.bloco_inicio < b.bloco_fim and b.bloco_inicio < a.bloco_fim;
  if n <> 0 then raise exception 'D2: % par(es) de blocos sobrepostos', n; end if;

  -- células de profissional: 215, todas com confiança ALTA
  select coalesce(sum(horas), 0) into t from legado.vw_room_blocks where ocupante_tipo = 'PROFISSIONAL' and confianca = 'ALTA';
  if t <> 215 then raise exception 'D3: horas de profissional (ALTA) = %, esperado 215', t; end if;

  -- após o bootstrap de salas, room_ref resolvido em 100% dos blocos
  select count(*) into n from legado.vw_room_blocks where room_ref is null;
  if n <> 0 then raise exception 'D4: % bloco(s) sem room_ref com rooms populada', n; end if;

  -- após o bootstrap de perfis, todo bloco de profissional tem professional_profile_id
  select count(*) into n from legado.vw_room_blocks where ocupante_tipo = 'PROFISSIONAL' and professional_profile_id is null;
  if n <> 0 then raise exception 'D5: % bloco(s) de profissional sem perfil', n; end if;

  -- sem PII: a view não tem colunas de nome
  select count(*) into n from information_schema.columns
   where table_schema = 'legado' and table_name = 'vw_room_blocks'
     and column_name ~ '(nome|name|paciente|cpf|conteudo)';
  if n <> 0 then raise exception 'D6: view expõe coluna de nome'; end if;
  raise notice 'D OK: 415 horas cobertas, sem sobreposição, 215 h de profissional ALTA, room_ref e perfil resolvidos, sem PII';
end $$;

-- D7. Comportamento com rooms VAZIA: a view continua funcionando, room_ref nulo
begin;
  delete from public.rooms;
  do $$
  declare n int; t int;
  begin
    select count(*), count(*) filter (where room_ref is null) into t, n from legado.vw_room_blocks;
    if t = 0 or n <> t then raise exception 'D7: com rooms vazia esperado room_ref nulo em todos (%/%)', n, t; end if;
    raise notice 'D7 OK: com rooms vazia a view funciona e room_ref fica nulo (% blocos)', t;
  end $$;
rollback;

-- D8. Permissões: anon/authenticated não leem a view nem executam os bootstraps
do $$
begin
  if has_table_privilege('anon', 'legado.vw_room_blocks', 'select')
     or has_table_privilege('authenticated', 'legado.vw_room_blocks', 'select') then
    raise exception 'D8: view legível por anon/authenticated';
  end if;
  if has_function_privilege('anon', 'public.bootstrap_rooms_from_legado(boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.bootstrap_rooms_from_legado(boolean)', 'execute')
     or has_function_privilege('anon', 'public.bootstrap_professional_profiles_from_legado(boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.bootstrap_professional_profiles_from_legado(boolean)', 'execute') then
    raise exception 'D8b: bootstrap executável por anon/authenticated';
  end if;
  raise notice 'D8 OK: sem acesso para anon/authenticated';
end $$;

-- Resumo para a entrega
select ocupante_tipo, confianca, count(*) as blocos, sum(horas) as horas
  from legado.vw_room_blocks group by 1, 2 order by 1, 2;
