-- =====================================================================
-- Testes do motor financeiro (migration_030). SÓ LEITURA: não grava nada.
-- Pode rodar no SQL Editor de produção ou no Postgres local de teste.
-- Qualquer falha interrompe com "FALHOU: ...".
-- =====================================================================
do $$
declare
  r public.fin_resultado;
  i record;
begin
  -- ---------------- valor monetário (igual ao RPA, sem 0 silencioso) ----
  if public.fin_valor_monetario('45') <> 45 then raise exception 'FALHOU: número 45'; end if;
  if public.fin_valor_monetario('"R$ 45,00"') <> 45 then raise exception 'FALHOU: R$ 45,00'; end if;
  if public.fin_valor_monetario('"R$45.00"') <> 45 then raise exception 'FALHOU: R$45.00'; end if;
  if public.fin_valor_monetario('"1.234"') <> 1234 then raise exception 'FALHOU: 1.234 milhar'; end if;
  if public.fin_valor_monetario('"1.234,50"') <> 1234.50 then raise exception 'FALHOU: 1.234,50'; end if;
  if public.fin_valor_monetario('"45.5"') <> 45.5 then raise exception 'FALHOU: 45.5'; end if;
  if public.fin_valor_monetario('"31,9"') <> 31.9 then raise exception 'FALHOU: 31,9'; end if;
  if public.fin_valor_monetario('""') is not null then raise exception 'FALHOU: vazio deve ser nulo'; end if;
  if public.fin_valor_monetario('"   "') is not null then raise exception 'FALHOU: espaços deve ser nulo'; end if;
  if public.fin_valor_monetario('"abc"') is not null then raise exception 'FALHOU: texto sem número deve ser nulo'; end if;
  if public.fin_valor_monetario('0') <> 0 then raise exception 'FALHOU: zero digitado é zero'; end if;
  if public.fin_valor_monetario(null) is not null then raise exception 'FALHOU: nulo'; end if;

  -- ---------------- competência pela coluna A ---------------------------
  if public.fin_competencia_coluna_a('{"$date":"2026-09-30T04:00:00"}') <> '2026-09-01' then raise exception 'FALHOU: data 30/09'; end if;
  if public.fin_competencia_coluna_a('{"$date":"2026-10-02T04:00:00"}') <> '2026-10-01' then raise exception 'FALHOU: data 02/10'; end if;
  if public.fin_competencia_coluna_a('"15/09/2026 10:30"') <> '2026-09-01' then raise exception 'FALHOU: texto 15/09/2026'; end if;
  if public.fin_competencia_coluna_a('"31/02/2026"') <> '2026-02-01' then raise exception 'FALHOU: texto 31/02/2026 (igual ao RPA)'; end if;
  if public.fin_competencia_coluna_a('""') is not null then raise exception 'FALHOU: A vazia'; end if;

  -- ---------------- carteirinha -----------------------------------------
  if public.fin_carteirinha_digitos('25012345678901') <> '0025012345678901' then raise exception 'FALHOU: carteirinha número'; end if;
  if public.fin_carteirinha_digitos('"0025.0250.001387.30-7"') <> '00250250001387307' then raise exception 'FALHOU: carteirinha texto'; end if;

  -- ---------------- regra de um atendimento -----------------------------
  -- Unimed 0025, lançado 01/10/2026, N = 45 → trava: 33 / 18 / 15 + alerta
  r := public.fin_calcular_atendimento('2026-10-01', 45, false, 'UNIMED', '0025123', null);
  if r.regra <> 'UNIMED_0025_33_18' or r.valor_bruto <> 33 or r.repasse_profissional <> 18 or r.parcela_hope <> 15
     or not ('VALOR_PLANILHA_DIVERGENTE' = any (r.alertas)) or r.percentual_profissional <> 54.55 or r.percentual_hope <> 45.45 then
    raise exception 'FALHOU: Unimed N=45 → %', r;
  end if;
  -- N = 33 → sem alerta
  r := public.fin_calcular_atendimento('2026-10-01', 33, false, 'UNIMED', '0025123', null);
  if r.regra <> 'UNIMED_0025_33_18' or r.valor_bruto <> 33 or cardinality(r.alertas) <> 0 then raise exception 'FALHOU: Unimed N=33 → %', r; end if;
  -- N = 31,90 / vazio → 33 + alerta
  r := public.fin_calcular_atendimento('2026-11-01', 31.9, false, 'UNIMED', '0025123', null);
  if r.valor_bruto <> 33 or not ('VALOR_PLANILHA_DIVERGENTE' = any (r.alertas)) then raise exception 'FALHOU: Unimed 31,90 → %', r; end if;
  r := public.fin_calcular_atendimento('2026-11-01', null, true, 'UNIMED', '0025123', null);
  if r.valor_bruto <> 33 or r.repasse_profissional <> 18 or not ('VALOR_PLANILHA_DIVERGENTE' = any (r.alertas)) then raise exception 'FALHOU: Unimed vazio → %', r; end if;
  -- carteirinha texto começando com 25
  r := public.fin_calcular_atendimento('2026-10-01', 45, false, 'UNIMED', '25999', null);
  if r.regra <> 'UNIMED_0025_33_18' then raise exception 'FALHOU: prefixo 25 → %', r; end if;
  -- CNPJ Unimed → 18 (sem INSS é no mês)
  r := public.fin_calcular_atendimento('2026-10-01', 45, false, 'UNIMED', '0025123', 40);
  if r.regra <> 'UNIMED_0025_33_18' or r.repasse_profissional <> 18 then raise exception 'FALHOU: CNPJ Unimed → %', r; end if;
  -- setembro (antes da vigência) → regra antiga, sem trava
  r := public.fin_calcular_atendimento('2026-09-01', 45, false, 'UNIMED', '0025123', null);
  if r.regra <> 'NORMAL_40_60' or r.valor_bruto <> 45 or r.repasse_profissional <> 18 then raise exception 'FALHOU: setembro → %', r; end if;
  r := public.fin_calcular_atendimento('2026-09-01', 33, false, 'UNIMED', '0025123', null);
  if r.regra <> 'NORMAL_40_60' or r.repasse_profissional <> 13.2 then raise exception 'FALHOU: setembro R$33 → %', r; end if;
  -- Unimed sem 0025 → normal 18 / 27
  r := public.fin_calcular_atendimento('2026-10-01', 45, false, 'UNIMED', '0865001', null);
  if r.regra <> 'NORMAL_40_60' or r.repasse_profissional <> 18 or r.parcela_hope <> 27 then raise exception 'FALHOU: Unimed sem 0025 → %', r; end if;
  -- 0025 com outro plano → normal; com plano vazio/"NÃO" → normal + alerta cadastral
  r := public.fin_calcular_atendimento('2026-10-01', 45, false, 'SELECT', '0025123', null);
  if r.regra <> 'NORMAL_40_60' or 'INCONSISTENCIA_CADASTRAL_PLANO' = any (r.alertas) then raise exception 'FALHOU: SELECT 0025 → %', r; end if;
  r := public.fin_calcular_atendimento('2026-10-01', 45, false, 'NAO', '0025123', null);
  if r.regra <> 'NORMAL_40_60' or not ('INCONSISTENCIA_CADASTRAL_PLANO' = any (r.alertas)) then raise exception 'FALHOU: NAO 0025 → %', r; end if;
  r := public.fin_calcular_atendimento('2026-10-01', 45, false, '', '0025123', null);
  if not ('INCONSISTENCIA_CADASTRAL_PLANO' = any (r.alertas)) then raise exception 'FALHOU: plano vazio 0025 → %', r; end if;
  -- valor ausente ≠ zero
  r := public.fin_calcular_atendimento('2026-10-01', null, true, 'BRADESCO', '0084', null);
  if r.valor_bruto is not null or not ('SEM_VALOR' = any (r.alertas)) or r.repasse_profissional <> 0 then raise exception 'FALHOU: sem valor → %', r; end if;
  r := public.fin_calcular_atendimento('2026-10-01', null, false, 'BRADESCO', '0084', null);
  if not ('VALOR_INVALIDO' = any (r.alertas)) then raise exception 'FALHOU: valor inválido → %', r; end if;
  -- CNPJ 40% normal
  r := public.fin_calcular_atendimento('2026-10-01', 45, false, 'BRADESCO', '0084', 40);
  if r.regra <> 'CNPJ_PERCENTUAL' or r.repasse_profissional <> 18 then raise exception 'FALHOU: CNPJ 40%% → %', r; end if;

  -- ---------------- INSS ------------------------------------------------
  select * into i from public.fin_calcular_inss('2026-09-01', 3126.00);
  if i.inss <> 343.86 or i.liquido <> 2782.14 or i.regra <> 'INSS_PF v1' then raise exception 'FALHOU: INSS set 3126 → %', i; end if;
  select * into i from public.fin_calcular_inss('2026-10-01', 3126.00);
  if i.inss <> 343.86 or i.liquido <> 2782.14 or i.regra <> 'INSS_PF v2' then raise exception 'FALHOU: INSS out 3126 → %', i; end if;
  select * into i from public.fin_calcular_inss('2026-10-01', 18.00);
  if i.inss <> 1.98 or i.liquido <> 16.02 then raise exception 'FALHOU: INSS 18 → %', i; end if;
  select * into i from public.fin_calcular_inss('2026-09-01', 9000.00);
  if i.base_inss <> 7786.02 or i.inss <> 856.46 or i.liquido <> 6929.56 then raise exception 'FALHOU: INSS v1 9000 (histórico) → %', i; end if;
  select * into i from public.fin_calcular_inss('2026-10-01', 9000.00);
  if i.inss <> 932.31 or i.liquido <> 8067.69 then raise exception 'FALHOU: INSS v2 9000 → %', i; end if;
  select * into i from public.fin_calcular_inss('2026-10-01', 8000.00);
  if i.inss <> 880.00 or i.liquido <> 7120.00 then raise exception 'FALHOU: INSS v2 8000 → %', i; end if;

  raise notice 'OK: todos os testes do motor passaram';
end;
$$;
