-- =====================================================================
-- migration_030 — MOTOR FINANCEIRO CENTRAL (Fase 3, passo 2 do plano)
--
-- Uma regra financeira só, no banco, consumida por HOPE CORE, RPA,
-- Faturamento e BI. Só ACRÉSCIMOS: nenhuma tabela/função existente é
-- alterada (exceto db_somente_leitura, que ganha as tabelas novas).
--
--   fin_regras                    regras versionadas por vigência (Coluna A)
--   fin_calcular_atendimento()    a regra de UM atendimento
--   fin_calcular_inss()           INSS PF versionado (teto/alíquota/líquido)
--   fin_atendimentos_calculados   visão: 1 linha por atendimento + alertas
--   fin__fechamento_mes()         totais por profissional (INSS mensal)
--   fin_fechamentos / _profissionais / _itens   fotos imutáveis do mês
--   fin_regularizacoes            ação administrativa futura (quem/quando)
--   fin_pendencias()              ALTERADO_APOS_FECHAMENTO (calculado ao vivo)
--   fin_varredura_unimed_33()     Unimed 0025/25 com coluna N ≠ R$ 33
--   fin_fechamento_legado()       para os Apps Scripts (token da sync)
--
-- Decisões (02/10/2026, Morais):
--   • competência = Coluna A (data de lançamento). Data da Sessão só alerta.
--   • UNIMED_0025_33_18 v1: Coluna A >= 01/10/2026 + plano (coluna M) =
--     UNIMED + carteirinha (só dígitos) começando 0025 ou 25 → bruto
--     financeiro SEMPRE R$ 33 (trava), profissional R$ 18, Hope R$ 15.
--     Coluna N ≠ 33 → alerta VALOR_PLANILHA_DIVERGENTE; planilha intocada.
--   • 0025/25 com plano vazio/"NÃO"/"NÃO ENCONTRADO" → regra normal +
--     alerta INCONSISTENCIA_CADASTRAL_PLANO.
--   • INSS_PF v1 (até 09/2026) = cálculo antigo idêntico (teto 7.786,02,
--     líquido sobre a base limitada). v2 (a partir de 10/2026) = teto
--     oficial 2026 R$ 8.475,55 (Portaria Interministerial MPS/MF nº 13,
--     de 09/01/2026, art. 2º) e líquido = repasse − INSS (correção).
--   • valor vazio NÃO vira zero em silêncio: valor_bruto fica nulo e o
--     atendimento ganha SEM_VALOR / VALOR_INVALIDO (soma como 0, igual
--     ao RPA, mas aparece na conciliação).
--   • Profissionais: lista mestre legado.planilhas — entra quem está
--     ativo OU desligado (desligado continua no histórico).
--   • Nenhum nome de paciente sai daqui; "impressao" é um hash.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Regras versionadas
-- ---------------------------------------------------------------------
create table if not exists public.fin_regras (
  id bigserial primary key,
  codigo text not null,
  versao int not null,
  vigente_de date not null,
  vigente_ate date,
  parametros jsonb not null,
  descricao text not null,
  fonte text,
  created_at timestamptz not null default now(),
  constraint uq_fin_regras unique (codigo, versao),
  constraint ck_fin_regras_vigencia check (vigente_ate is null or vigente_ate >= vigente_de)
);

insert into public.fin_regras (codigo, versao, vigente_de, vigente_ate, parametros, descricao, fonte) values
('NORMAL_40_60', 1, '2000-01-01', null,
 '{"percentual_profissional": 0.40}',
 'Atendimento padrão: profissional 40% do bruto, Parcela Bruta Hope 60%.',
 'Sistema Mestre RPA (RPA_PERCENTUAL_PADRAO = 0.40)'),
('CNPJ_PERCENTUAL', 1, '2000-01-01', null,
 '{"percentual_padrao": 45}',
 'Profissional CNPJ (aba ExencaoCNPJ): percentual cadastrado (vazio = 45%), sem INSS.',
 'Sistema Mestre RPA (listarExencoes / calcularIndividual)'),
('UNIMED_0025_33_18', 1, '2026-10-01', null,
 '{"plano": "UNIMED", "prefixos": ["0025", "25"], "valor_bruto": 33.00, "repasse_profissional": 18.00}',
 'Unimed com carteirinha 0025/25, lançada (Coluna A) a partir de 01/10/2026: bruto financeiro R$ 33,00 (mesmo se a coluna N tiver outro valor), profissional R$ 18,00 (54,55%), Parcela Bruta Hope R$ 15,00 (45,45%). PF com INSS; CNPJ sem INSS.',
 'Decisão da direção em 02/10/2026'),
('INSS_PF', 1, '2000-01-01', '2026-09-30',
 '{"aliquota": 0.11, "teto": 7786.02, "liquido_sobre": "base_limitada"}',
 'INSS do profissional PF como o RPA calculava até 09/2026 (teto de 2024 e líquido sobre a base limitada ao teto). Mantido para não alterar fechamentos antigos.',
 'Sistema Mestre RPA (TETO_INSS = 7786.02)'),
('INSS_PF', 2, '2026-10-01', null,
 '{"aliquota": 0.11, "teto": 8475.55, "liquido_sobre": "repasse"}',
 'INSS do profissional PF a partir de 10/2026: 11% limitado ao teto oficial de 2026 (R$ 8.475,55 → retenção máxima R$ 932,31); líquido = repasse bruto − INSS (corrige a perda do excedente acima do teto).',
 'Portaria Interministerial MPS/MF nº 13, de 09/01/2026, art. 2º'),
('ARREDONDAMENTO', 1, '2000-01-01', '2026-09-30',
 '{"modo": "float_js"}',
 'Até 09/2026 o motor reproduz CENTAVO A CENTAVO o Apps Script do RPA: soma e multiplica em ponto flutuante (como o JavaScript) e arredonda como toFixed(2). Garante que os fechamentos antigos não mudem nem 1 centavo.',
 'Sistema Mestre RPA (Number(x.toFixed(2)))'),
('ARREDONDAMENTO', 2, '2026-10-01', null,
 '{"modo": "decimal_exato"}',
 'A partir de 10/2026: aritmética decimal exata e arredondamento comercial (meio centavo para cima). Pode diferir em 1 centavo do Apps Script em casos raros de meio centavo exato; o motor é a fonte oficial.',
 'Decisão de arquitetura do motor financeiro (02/10/2026)')
on conflict (codigo, versao) do nothing;

alter table public.fin_regras enable row level security;
drop policy if exists finance_le_fin_regras on public.fin_regras;
create policy finance_le_fin_regras on public.fin_regras for select
  using (has_finance_access() or is_platform_admin());
revoke all on table public.fin_regras from anon, authenticated;
grant select on table public.fin_regras to authenticated;

-- Regra vigente para a competência (maior versão vigente)
create or replace function public.fin_regra(p_codigo text, p_competencia date)
returns public.fin_regras
language sql stable
set search_path = public, pg_temp
as $$
  select r.*
    from public.fin_regras r
   where r.codigo = p_codigo
     and r.vigente_de <= p_competencia
     and (r.vigente_ate is null or r.vigente_ate >= p_competencia)
   order by r.versao desc
   limit 1
$$;

-- ---------------------------------------------------------------------
-- 2) Leitura das células (mesmas regras do RPA, sem "|| 0" silencioso)
-- ---------------------------------------------------------------------

-- Valor monetário: cópia fiel de extrairValorMonetario (Code.gs do RPA),
-- mas devolve NULO quando a célula está vazia ou não tem número
-- (o RPA devolvia 0). "R$ 45,00" → 45; "1.234" → 1234; "45.5" → 45.5.
create or replace function public.fin_valor_monetario(p jsonb)
returns numeric
language plpgsql immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  t text;
  partes text[];
  inteira text;
  deci text;
  ult text;
  m text;
  achado text;
  mm text[];
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) = 'number' then return (p #>> '{}')::numeric; end if;
  if jsonb_typeof(p) <> 'string' then return null; end if;

  t := regexp_replace(p #>> '{}', '^\s+|\s+$', '', 'g');
  if t = '' then return null; end if;

  -- 1. símbolos de moeda e letras soltas
  t := regexp_replace(t, '[Rr][Ss]\$\s*', '', 'g');
  t := regexp_replace(t, 'US\$\s*', '', 'g');
  t := regexp_replace(t, '\$\s*', '', 'g');
  t := regexp_replace(t, '[€£¥]', '', 'g');
  t := regexp_replace(t, '[A-Za-z]\s*', '', 'g');
  -- 2/3. espaços nas pontas
  t := regexp_replace(t, '^\s+|\s+$', '', 'g');
  if t = '' then return null; end if;

  -- 4. vírgula = decimal (BR); ponto: decimal se 1 ponto com 1-2 casas
  if position(',' in t) > 0 then
    partes := string_to_array(t, ',');
    inteira := replace(partes[1], '.', '');
    deci := coalesce(nullif(partes[2], ''), '00');
    if length(deci) > 2 then deci := substr(deci, 1, 2); end if;
    t := inteira || '.' || deci;
  elsif position('.' in t) > 0 then
    partes := string_to_array(t, '.');
    ult := partes[array_length(partes, 1)];
    if not (array_length(partes, 1) = 2 and length(ult) in (1, 2)) then
      t := array_to_string(partes, '');
    end if;
  end if;

  -- 5. parseFloat: número no início do texto
  m := substring(t from '^\s*([+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))');
  if m is not null then return m::numeric; end if;

  -- 6. senão, o último número que aparecer
  achado := null;
  for mm in select regexp_matches(t, '([0-9]+[,.]?[0-9]*)', 'g') loop
    achado := mm[1];
  end loop;
  if achado is not null then
    achado := replace(achado, ',', '.');
    m := substring(achado from '^([0-9]+(?:\.[0-9]*)?)');
    if m is not null then return m::numeric; end if;
  end if;

  -- 7. sem número: NULO (o RPA devolvia 0)
  return null;
end;
$$;

-- Célula de valor vazia (nula, ausente ou só espaços)
create or replace function public.fin_valor_vazio(p jsonb)
returns boolean
language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  select p is null
      or jsonb_typeof(p) = 'null'
      or (jsonb_typeof(p) = 'string' and regexp_replace(p #>> '{}', '^\s+|\s+$', '', 'g') = '')
$$;

-- Status (coluna S) como o RPA lê: String(celula || "").trim()
create or replace function public.fin_status_texto(p jsonb)
returns text
language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
           when p is null or jsonb_typeof(p) = 'null' then ''
           when jsonb_typeof(p) = 'string' then regexp_replace(p #>> '{}', '^\s+|\s+$', '', 'g')
           when jsonb_typeof(p) = 'boolean' then case when (p #>> '{}') = 'true' then 'true' else '' end
           when jsonb_typeof(p) = 'number' then case when (p #>> '{}')::numeric = 0 then '' else p #>> '{}' end
           else ''
         end
$$;

-- Competência (1º dia do mês) pela COLUNA A, igual ao RPA:
--   data → o mês/ano do próprio valor (fuso de SP, já gravado assim);
--   texto "dd/mm/aaaa[ hh:mm]" → split(' ')[0].split('/'), mês = parseInt.
create or replace function public.fin_competencia_coluna_a(p jsonb)
returns date
language plpgsql immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  s text;
  pr text[];
  mes_txt text;
  mes int;
  ano int;
begin
  if p is null then return null; end if;
  if jsonb_typeof(p) = 'object' and p ? '$date' then
    s := p ->> '$date';
    if s !~ '^[0-9]{4}-[0-9]{2}' then return null; end if;
    mes := substr(s, 6, 2)::int;
    ano := substr(s, 1, 4)::int;
    if mes < 1 or mes > 12 or ano < 1900 or ano > 2999 then return null; end if;
    return make_date(ano, mes, 1);
  end if;
  if jsonb_typeof(p) <> 'string' then return null; end if;
  s := p #>> '{}';
  if s = '' then return null; end if;
  s := split_part(s, ' ', 1);
  pr := string_to_array(s, '/');
  if coalesce(array_length(pr, 1), 0) <> 3 then return null; end if;
  if pr[3] !~ '^[0-9]{4}$' then return null; end if;
  mes_txt := substring(pr[2] from '^\s*\+?([0-9]+)');
  if mes_txt is null or length(mes_txt) > 4 then return null; end if;
  mes := mes_txt::int;
  ano := pr[3]::int;
  if mes < 1 or mes > 12 or ano < 1900 or ano > 2999 then return null; end if;
  return make_date(ano, mes, 1);
end;
$$;

-- Coluna do PLANO pelo cabeçalho: "Origen"/"Origem"/"Plano" (coluna M).
-- NÃO usa "Plano (no Registro)" (coluna K, vazia em 2026). Reserva: M.
create or replace function public.fin_indice_plano(p_cabecalho jsonb)
returns int
language sql immutable
set search_path = legado, pg_catalog, pg_temp
as $$
  select coalesce((
           select (h.ord - 1)::int
             from jsonb_array_elements_text(case when jsonb_typeof(p_cabecalho) = 'array' then p_cabecalho else '[]'::jsonb end)
                  with ordinality h(txt, ord)
            where legado.rpa_normalizar_cabecalho(h.txt) in ('ORIGEN', 'ORIGEM', 'PLANO')
            order by h.ord
            limit 1
         ), 12)
$$;

-- Coluna ID_ATENDIMENTO pelo cabeçalho (nula enquanto não existir)
create or replace function public.fin_indice_id_atendimento(p_cabecalho jsonb)
returns int
language sql immutable
set search_path = legado, pg_catalog, pg_temp
as $$
  select (h.ord - 1)::int
    from jsonb_array_elements_text(case when jsonb_typeof(p_cabecalho) = 'array' then p_cabecalho else '[]'::jsonb end)
         with ordinality h(txt, ord)
   where replace(legado.rpa_normalizar_cabecalho(h.txt), ' ', '_') = 'ID_ATENDIMENTO'
   order by h.ord
   limit 1
$$;

-- Carteirinha só com dígitos. Número: a planilha tirou os zeros da
-- frente (0025… virou 25…), então recoloca "00" (igual ao Code.gs).
create or replace function public.fin_carteirinha_digitos(p jsonb)
returns text
language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
           when p is null then ''
           when jsonb_typeof(p) = 'number' then '00' || trunc(abs((p #>> '{}')::numeric))::text
           when jsonb_typeof(p) = 'string' then regexp_replace(p #>> '{}', '[^0-9]', '', 'g')
           else ''
         end
$$;

-- Verdadeiro/falso como o JavaScript ("", 0, false e nulo = falso)
create or replace function public.fin_js_verdadeiro(p jsonb)
returns boolean
language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
           when p is null or jsonb_typeof(p) = 'null' then false
           when jsonb_typeof(p) = 'string' then (p #>> '{}') <> ''
           when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric <> 0
           when jsonb_typeof(p) = 'boolean' then (p #>> '{}') = 'true'
           else true
         end
$$;

-- Percentual da ExencaoCNPJ: vazio = 45 (listarExencoes do RPA)
create or replace function public.fin_percentual_cnpj(p jsonb)
returns numeric
language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
           when p is null or jsonb_typeof(p) = 'null' then 45
           when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric
           when jsonb_typeof(p) = 'string' and (p #>> '{}') = '' then 45
           when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^\s*[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)\s*$'
             then btrim(p #>> '{}')::numeric
           when jsonb_typeof(p) = 'string' and btrim(p #>> '{}') = '' then 0
           else 45
         end
$$;

-- Cadastro CNPJ por planilha (última linha da aba ExencaoCNPJ vence,
-- como o mapa do RPA; só vale linha com ID e CNPJ preenchidos)
create or replace view public.fin_cnpj_cadastro as
select distinct on (btrim(e.psicologa_id #>> '{}'))
       btrim(e.psicologa_id #>> '{}') as spreadsheet_id,
       public.fin_percentual_cnpj(e.percentual) as percentual
  from legado.exencoes e
 where public.fin_js_verdadeiro(e.psicologa_id)
   and public.fin_js_verdadeiro(e.cnpj)
 order by btrim(e.psicologa_id #>> '{}'), e.linha desc;

revoke all on table public.fin_cnpj_cadastro from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) A REGRA de um atendimento
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'fin_resultado') then
    create type public.fin_resultado as (
      valor_bruto numeric,
      regra text,
      versao int,
      repasse_profissional numeric,
      percentual_profissional numeric,
      parcela_hope numeric,
      percentual_hope numeric,
      alertas text[]
    );
  end if;
end;
$$;

-- p_plano: texto já normalizado (maiúsculo, sem acento, sem espaços nas pontas)
-- p_carteirinha_digitos: fin_carteirinha_digitos()
-- p_cnpj_percentual: nulo = PF
create or replace function public.fin_calcular_atendimento(
  p_competencia date,
  p_valor_planilha numeric,
  p_valor_vazio boolean,
  p_plano text,
  p_carteirinha_digitos text,
  p_cnpj_percentual numeric
)
returns public.fin_resultado
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  r public.fin_resultado;
  reg public.fin_regras;
  ref public.fin_regras;
  plano text := upper(coalesce(p_plano, ''));
  dig text := coalesce(p_carteirinha_digitos, '');
  prefixo_unimed boolean;
begin
  r.alertas := '{}'::text[];

  -- prefixos da regra Unimed (última versão cadastrada) para o alerta cadastral
  select * into ref from public.fin_regras where codigo = 'UNIMED_0025_33_18' order by versao desc limit 1;
  prefixo_unimed := ref.id is not null and exists (
    select 1 from jsonb_array_elements_text(ref.parametros -> 'prefixos') x(pref) where dig like x.pref || '%'
  );

  -- TRAVA UNIMED (só na vigência, pela Coluna A)
  if p_competencia is not null then
    reg := public.fin_regra('UNIMED_0025_33_18', p_competencia);
  end if;
  if reg.id is not null
     and plano like '%' || (reg.parametros ->> 'plano') || '%'
     and exists (select 1 from jsonb_array_elements_text(reg.parametros -> 'prefixos') x(pref) where dig like x.pref || '%')
  then
    r.valor_bruto := (reg.parametros ->> 'valor_bruto')::numeric;
    r.regra := reg.codigo;
    r.versao := reg.versao;
    r.repasse_profissional := (reg.parametros ->> 'repasse_profissional')::numeric;
    if p_valor_planilha is distinct from r.valor_bruto then
      r.alertas := r.alertas || 'VALOR_PLANILHA_DIVERGENTE'::text;
    end if;
  else
    if prefixo_unimed and plano in ('', 'NAO', 'NAO ENCONTRADO') then
      r.alertas := r.alertas || 'INCONSISTENCIA_CADASTRAL_PLANO'::text;
    end if;
    r.valor_bruto := p_valor_planilha;
    if p_valor_planilha is null then
      r.alertas := r.alertas || (case when coalesce(p_valor_vazio, true) then 'SEM_VALOR' else 'VALOR_INVALIDO' end)::text;
    elsif p_valor_planilha = 0 then
      r.alertas := r.alertas || 'VALOR_ZERO'::text;
    end if;
    if p_valor_planilha is not null and abs(p_valor_planilha - 33) < 0.009 then
      r.alertas := r.alertas || 'VALOR_33_SEM_REGRA_UNIMED'::text;
    end if;

    if p_cnpj_percentual is not null then
      reg := public.fin_regra('CNPJ_PERCENTUAL', coalesce(p_competencia, current_date));
      r.regra := 'CNPJ_PERCENTUAL';
      r.versao := reg.versao;
      r.repasse_profissional := coalesce(p_valor_planilha, 0) * p_cnpj_percentual / 100;
    else
      reg := public.fin_regra('NORMAL_40_60', coalesce(p_competencia, current_date));
      r.regra := 'NORMAL_40_60';
      r.versao := reg.versao;
      r.repasse_profissional := coalesce(p_valor_planilha, 0) * (reg.parametros ->> 'percentual_profissional')::numeric;
    end if;
  end if;

  r.parcela_hope := coalesce(r.valor_bruto, 0) - r.repasse_profissional;
  if coalesce(r.valor_bruto, 0) <> 0 then
    r.percentual_profissional := round(r.repasse_profissional / r.valor_bruto * 100, 2);
    r.percentual_hope := round(r.parcela_hope / r.valor_bruto * 100, 2);
  end if;
  return r;
end;
$$;

-- Valor EXATO (decimal) de um número de ponto flutuante (float8/double),
-- para arredondar igual ao JavaScript (toFixed usa o valor binário exato:
-- 45 × 0,355 = 15,97499999… → "15.97"; 114,5 × 0,11 = 12,59500…01 → "12.60").
create or replace function public.fin_float8_exato(x float8)
returns numeric
language plpgsql immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  a float8;
  e int;
  k int;
  m float8;
  cinco numeric := 1;
  i int;
  dig text;
  sinal int;
begin
  if x is null or x = 'NaN'::float8 or x = 'Infinity'::float8 or x = '-Infinity'::float8 then return null; end if;
  if x = 0 then return 0; end if;
  sinal := case when x < 0 then -1 else 1 end;
  a := abs(x);
  e := floor(ln(a) / ln(2::float8))::int;
  while power(2::float8, e) > a loop e := e - 1; end loop;
  while power(2::float8, e + 1) <= a loop e := e + 1; end loop;
  k := 52 - e;
  if k <= 0 then return sinal * (a::bigint)::numeric; end if;
  if k > 300 then return sinal * round(a::numeric, 40); end if;
  m := a * power(2::float8, k);           -- inteiro exato (mantissa)
  for i in 1..k loop cinco := cinco * 5; end loop;
  dig := ((m::bigint)::numeric * cinco)::text;   -- valor = dig / 10^k
  if length(dig) <= k then dig := repeat('0', k - length(dig) + 1) || dig; end if;
  return sinal * (substr(dig, 1, length(dig) - k) || '.' || substr(dig, length(dig) - k + 1))::numeric;
end;
$$;

-- Number(x.toFixed(2)) do JavaScript
create or replace function public.fin_js_fixo2(x float8)
returns numeric
language sql immutable
set search_path = public, pg_temp
as $$
  select round(public.fin_float8_exato(x), 2)
$$;

-- Modo de aritmética da competência (regra ARREDONDAMENTO)
create or replace function public.fin_modo_aritmetica(p_competencia date)
returns text
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce((public.fin_regra('ARREDONDAMENTO', p_competencia)).parametros ->> 'modo', 'decimal_exato')
$$;

-- INSS do profissional PF para o repasse bruto do mês (versionado)
create or replace function public.fin_calcular_inss(p_competencia date, p_repasse numeric)
returns table (regra text, aliquota numeric, teto numeric, base_inss numeric, inss numeric, liquido numeric)
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  r public.fin_regras;
  v_aliq numeric;
  v_teto numeric;
  v_modo text;
  v_rep numeric := coalesce(p_repasse, 0);
  v_base numeric;
  v_inss numeric;
  v_max numeric;
  v_liq numeric;
begin
  r := public.fin_regra('INSS_PF', p_competencia);
  if r.id is null then return; end if;
  v_aliq := (r.parametros ->> 'aliquota')::numeric;
  v_teto := (r.parametros ->> 'teto')::numeric;
  v_base := least(v_rep, v_teto);
  if public.fin_modo_aritmetica(p_competencia) = 'float_js' then
    -- igual ao Code.gs: Number((base * 0.11).toFixed(2)) etc.
    v_inss := public.fin_js_fixo2(v_base::float8 * v_aliq::float8);
    v_max := public.fin_js_fixo2(v_teto::float8 * v_aliq::float8);
    if v_inss > v_max then v_inss := v_max; end if;
    if r.parametros ->> 'liquido_sobre' = 'base_limitada' then
      v_liq := public.fin_js_fixo2(v_base::float8 - v_inss::float8);
    else
      v_liq := public.fin_js_fixo2(v_rep::float8 - v_inss::float8);
    end if;
  else
    v_inss := least(round(v_base * v_aliq, 2), round(v_teto * v_aliq, 2));
    if r.parametros ->> 'liquido_sobre' = 'base_limitada' then
      v_liq := round(v_base - v_inss, 2);
    else
      v_liq := round(v_rep - v_inss, 2);
    end if;
  end if;
  regra := r.codigo || ' v' || r.versao;
  aliquota := v_aliq;
  teto := v_teto;
  base_inss := v_base;
  inss := v_inss;
  liquido := v_liq;
  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Visão: um atendimento por linha (uso interno: só o dono do banco
--    lê direto; o app usa as funções abaixo, que conferem o acesso)
-- ---------------------------------------------------------------------
create or replace view public.fin_atendimentos_calculados as
with pl as (
  select p.tenant_id, p.spreadsheet_id,
         coalesce(p.nome_completo, p.nome_abreviado) as profissional,
         p.nome_abreviado, p.ordem, p.ativo, p.desligada,
         (p.ultima_sincronizacao is null or p.ultimo_erro is not null) as erro_sincronizacao,
         legado.rpa_indice_carteirinha(p.cabecalho) as ix_cart,
         public.fin_indice_plano(p.cabecalho) as ix_plano,
         public.fin_indice_id_atendimento(p.cabecalho) as ix_id
    from legado.planilhas p
), base as (
  select pl.*, r.linha, r.celulas as c, cc.percentual as percentual_cnpj,
         public.fin_status_texto(r.celulas -> 18) as status,
         public.fin_competencia_coluna_a(r.celulas -> 0) as competencia,
         public.fin_valor_monetario(r.celulas -> 13) as valor_planilha,
         public.fin_valor_vazio(r.celulas -> 13) as valor_vazio,
         legado.rpa_normalizar_cabecalho(r.celulas ->> pl.ix_plano) as plano,
         public.fin_carteirinha_digitos(r.celulas -> pl.ix_cart) as carteirinha_digitos,
         case when pl.ix_id is not null then nullif(btrim(r.celulas ->> pl.ix_id), '') end as id_atendimento
    from legado.atendimentos_raw r
    join pl on pl.spreadsheet_id = r.spreadsheet_id
    left join public.fin_cnpj_cadastro cc on cc.spreadsheet_id = r.spreadsheet_id
)
select b.tenant_id,
       b.spreadsheet_id,
       b.linha,
       b.profissional,
       b.nome_abreviado,
       b.ordem,
       b.ativo,
       b.desligada,
       b.erro_sincronizacao,
       b.competencia,
       b.status,
       upper(b.status) = 'OK' as ok,
       b.status = '' as pendente,
       b.c -> 13 as valor_registrado,
       b.valor_planilha,
       b.plano,
       left(b.carteirinha_digitos, 4) as carteirinha_prefixo,
       case when jsonb_typeof(b.c -> 3) = 'object' and (b.c -> 3 ->> '$date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            then left(b.c -> 3 ->> '$date', 10)::date end as data_sessao,
       b.id_atendimento,
       case when b.percentual_cnpj is not null then 'CNPJ' else 'PF' end as tipo,
       b.percentual_cnpj,
       md5(jsonb_build_array(b.c -> 0, b.c -> 2, b.c -> 3, b.c -> 4, b.c -> b.ix_cart, b.c -> b.ix_plano,
                             b.c -> 13, upper(b.status))::text) as impressao,
       res.valor_bruto,
       res.regra,
       res.versao,
       res.repasse_profissional,
       res.percentual_profissional,
       res.parcela_hope,
       res.percentual_hope,
       res.alertas
         || case when jsonb_typeof(b.c -> 13) = 'string' and b.valor_planilha is not null
                 then array['VALOR_EM_TEXTO'] else '{}'::text[] end
         || case when jsonb_typeof(b.c -> 0) = 'string'
                 then array['DATA_LANCAMENTO_TEXTO'] else '{}'::text[] end
         || case when upper(b.status) = 'OK'
                  and not (jsonb_typeof(b.c -> 3) = 'object' and (b.c -> 3 ->> '$date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}')
                 then array['DATA_SESSAO_INVALIDA'] else '{}'::text[] end
         || case when b.id_atendimento is not null
                  and count(*) over (partition by b.tenant_id, b.id_atendimento) > 1
                 then array['ID_DUPLICADO'] else '{}'::text[] end
         as alertas
  from base b
  cross join lateral public.fin_calcular_atendimento(
    b.competencia, b.valor_planilha, b.valor_vazio, b.plano, b.carteirinha_digitos, b.percentual_cnpj
  ) res;

revoke all on table public.fin_atendimentos_calculados from anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) Totais do mês por profissional (INSS mensal sobre o total)
-- ---------------------------------------------------------------------
create or replace function public.fin__fechamento_mes(p_tenant uuid, p_competencia date)
returns table (
  spreadsheet_id text,
  profissional text,
  nome_abreviado text,
  ordem int,
  ativo boolean,
  desligada boolean,
  erro_sincronizacao boolean,
  ultimo_erro text,
  ultima_sincronizacao timestamptz,
  tipo text,
  percentual_cnpj numeric,
  qtd_ok int,
  qtd_pendencias int,
  total_bruto numeric,
  qtd_unimed33 int,
  bruto_unimed33 numeric,
  repasse_unimed33 numeric,
  comissao_padrao numeric,
  repasse_bruto numeric,
  base_inss numeric,
  inss numeric,
  liquido numeric,
  parcela_hope numeric,
  regra_inss text,
  qtd_33_sem_unimed int,
  alertas jsonb
)
language sql stable security definer
set search_path = public, legado, pg_temp
set statement_timeout = '30s'
as $$
  with pl as (
    select p.spreadsheet_id,
           coalesce(p.nome_completo, p.nome_abreviado) as profissional,
           p.nome_abreviado, p.ordem, p.ativo, p.desligada,
           (p.ultima_sincronizacao is null or p.ultimo_erro is not null) as erro_sincronizacao,
           p.ultimo_erro, p.ultima_sincronizacao,
           cc.percentual as percentual_cnpj
      from legado.planilhas p
      left join public.fin_cnpj_cadastro cc on cc.spreadsheet_id = p.spreadsheet_id
     where p.tenant_id = p_tenant
       and (p.ativo or p.desligada)
  ), it as (
    select a.*
      from public.fin_atendimentos_calculados a
     where a.tenant_id = p_tenant
       and a.competencia = p_competencia
  ), ag as (
    select it.spreadsheet_id,
           count(*) filter (where it.ok)::int as qtd_ok,
           count(*) filter (where it.pendente)::int as qtd_pendencias,
           coalesce(sum(coalesce(it.valor_bruto, 0)) filter (where it.ok), 0) as total_bruto,
           count(*) filter (where it.ok and it.regra = 'UNIMED_0025_33_18')::int as qtd_unimed33,
           coalesce(sum(it.valor_bruto) filter (where it.ok and it.regra = 'UNIMED_0025_33_18'), 0) as bruto_unimed33,
           coalesce(sum(it.repasse_profissional) filter (where it.ok and it.regra = 'UNIMED_0025_33_18'), 0) as repasse_unimed33,
           coalesce(sum(it.repasse_profissional) filter (where it.ok and it.regra <> 'UNIMED_0025_33_18'), 0) as repasse_outros,
           count(*) filter (where it.ok and 'VALOR_33_SEM_REGRA_UNIMED' = any (it.alertas))::int as qtd_33_sem_unimed,
           -- para o modo float_js (igual ao Apps Script): somas em ponto flutuante NA ORDEM DAS LINHAS
           sum(coalesce(it.valor_bruto, 0)::float8 order by it.linha) filter (where it.ok) as f_total,
           sum(coalesce(it.valor_bruto, 0)::float8 order by it.linha) filter (where it.ok and it.regra = 'UNIMED_0025_33_18') as f_unimed,
           sum(coalesce(it.repasse_profissional, 0)::float8 order by it.linha) filter (where it.ok and it.regra = 'UNIMED_0025_33_18') as f_rep_unimed
      from it
     group by it.spreadsheet_id
  ), al as (
    select x.spreadsheet_id, jsonb_object_agg(x.alerta, x.n) as alertas
      from (
        select it.spreadsheet_id, u.alerta, count(*) as n
          from it
          cross join lateral unnest(it.alertas) u(alerta)
         where it.ok or u.alerta = 'VALOR_PLANILHA_DIVERGENTE'
         group by it.spreadsheet_id, u.alerta
      ) x
     group by x.spreadsheet_id
  ), modo as (
    select public.fin_modo_aritmetica(p_competencia) as modo,
           ((public.fin_regra('NORMAL_40_60', p_competencia)).parametros ->> 'percentual_profissional')::numeric as pct_normal
  ), pre as (
    select pl.*,
           coalesce(ag.qtd_ok, 0) as qtd_ok,
           coalesce(ag.qtd_pendencias, 0) as qtd_pendencias,
           round(coalesce(ag.total_bruto, 0), 2) as total_bruto,
           coalesce(ag.qtd_unimed33, 0) as qtd_unimed33,
           round(coalesce(ag.bruto_unimed33, 0), 2) as bruto_unimed33,
           round(coalesce(ag.repasse_unimed33, 0), 2) as repasse_unimed33,
           coalesce(ag.qtd_33_sem_unimed, 0) as qtd_33_sem_unimed,
           coalesce(al.alertas, '{}'::jsonb) as alertas,
           case
             when md.modo = 'float_js' and pl.percentual_cnpj is not null then
               -- CNPJ no Code.gs: Number((total * (percentual / 100)).toFixed(2))
               public.fin_js_fixo2((coalesce(ag.f_total, 0) - coalesce(ag.f_unimed, 0)) * (pl.percentual_cnpj::float8 / 100::float8))
             when md.modo = 'float_js' then
               -- PF no Code.gs: Number(((total100 - total33) * 0.40).toFixed(2))
               public.fin_js_fixo2((coalesce(ag.f_total, 0) - coalesce(ag.f_unimed, 0)) * md.pct_normal::float8)
             else round(coalesce(ag.repasse_outros, 0), 2)
           end as comissao_padrao,
           md.modo,
           coalesce(ag.f_rep_unimed, 0) as f_rep_unimed,
           coalesce(ag.repasse_unimed33, 0) as repasse_unimed33_exato
      from pl
      cross join modo md
      left join ag on ag.spreadsheet_id = pl.spreadsheet_id
      left join al on al.spreadsheet_id = pl.spreadsheet_id
  ), calc as (
    select pre.*,
           -- PF: (40% arredondado) + R$ 18 por sessão Unimed; CNPJ: % + R$ 18 por sessão Unimed
           case when pre.modo = 'float_js'
                then public.fin_js_fixo2(pre.comissao_padrao::float8 + pre.f_rep_unimed)
                else round(pre.comissao_padrao + pre.repasse_unimed33_exato, 2)
           end as repasse_bruto
      from pre
  )
  select c.spreadsheet_id, c.profissional, c.nome_abreviado, c.ordem, c.ativo, c.desligada,
         c.erro_sincronizacao, c.ultimo_erro, c.ultima_sincronizacao,
         case when c.percentual_cnpj is not null then 'CNPJ' else 'PF' end,
         c.percentual_cnpj,
         c.qtd_ok, c.qtd_pendencias, c.total_bruto,
         c.qtd_unimed33, c.bruto_unimed33, c.repasse_unimed33, c.comissao_padrao,
         c.repasse_bruto,
         case when c.percentual_cnpj is not null then 0 else ins.base_inss end,
         case when c.percentual_cnpj is not null then 0 else ins.inss end,
         case when c.percentual_cnpj is not null then c.repasse_bruto else ins.liquido end,
         round(c.total_bruto - c.repasse_bruto, 2),
         case when c.percentual_cnpj is not null then 'SEM_INSS_CNPJ' else ins.regra end,
         c.qtd_33_sem_unimed,
         c.alertas
    from calc c
    left join lateral public.fin_calcular_inss(p_competencia, c.repasse_bruto) ins on c.percentual_cnpj is null
   order by c.ordem nulls last, c.nome_abreviado
$$;

revoke execute on function public.fin__fechamento_mes(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6) Fotos imutáveis do fechamento (o app só lê; grava via função)
-- ---------------------------------------------------------------------
create table if not exists public.fin_fechamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  competencia date not null check (extract(day from competencia) = 1),
  origem text not null,
  observacao text,
  qtd_ok int not null,
  total_bruto numeric(14, 2) not null,
  repasse_bruto numeric(14, 2) not null,
  inss numeric(14, 2) not null,
  liquido numeric(14, 2) not null,
  parcela_hope numeric(14, 2) not null,
  fechado_por uuid,
  fechado_em timestamptz not null default now(),
  constraint uq_fin_fechamentos unique (tenant_id, competencia)
);

create table if not exists public.fin_fechamento_profissionais (
  id bigserial primary key,
  fechamento_id uuid not null references public.fin_fechamentos(id),
  tenant_id uuid not null references tenants(id),
  competencia date not null,
  spreadsheet_id text not null,
  profissional text not null,
  tipo text not null check (tipo in ('PF', 'CNPJ')),
  percentual_cnpj numeric,
  qtd_ok int not null,
  qtd_unimed33 int not null,
  total_bruto numeric(14, 2) not null,
  comissao_padrao numeric(14, 2) not null,
  repasse_bruto numeric(14, 2) not null,
  base_inss numeric(14, 2) not null,
  inss numeric(14, 2) not null,
  liquido numeric(14, 2) not null,
  parcela_hope numeric(14, 2) not null,
  regra_inss text not null,
  alertas jsonb not null default '{}'::jsonb,
  constraint uq_fin_fechamento_profissionais unique (fechamento_id, spreadsheet_id)
);
create index if not exists idx_fin_fech_prof_comp on public.fin_fechamento_profissionais (tenant_id, competencia);

create table if not exists public.fin_fechamento_itens (
  id bigserial primary key,
  fechamento_id uuid not null references public.fin_fechamentos(id),
  tenant_id uuid not null references tenants(id),
  competencia date not null,
  spreadsheet_id text not null,
  linha int not null,
  id_atendimento text,
  impressao text not null,
  data_sessao date,
  valor_registrado jsonb,
  valor_bruto numeric(14, 2),
  regra text not null,
  versao int,
  repasse_profissional numeric(14, 4) not null,
  inss_rateado numeric(14, 2) not null default 0,
  parcela_hope numeric(14, 4) not null,
  alertas text[] not null default '{}'::text[]
);
create index if not exists idx_fin_fech_itens_comp on public.fin_fechamento_itens (tenant_id, competencia, spreadsheet_id);
create index if not exists idx_fin_fech_itens_fech on public.fin_fechamento_itens (fechamento_id);

-- Regularização administrativa (decisão humana sobre ALTERADO_APOS_FECHAMENTO)
create table if not exists public.fin_regularizacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  competencia_original date not null check (extract(day from competencia_original) = 1),
  competencia_ajuste date check (competencia_ajuste is null or extract(day from competencia_ajuste) = 1),
  spreadsheet_id text not null,
  linha int,
  id_atendimento text,
  impressao text,
  tipo text not null,
  valor numeric(14, 2),
  motivo text not null,
  autorizado_por uuid not null,
  autorizado_em timestamptz not null default now()
);
create index if not exists idx_fin_regularizacoes_comp on public.fin_regularizacoes (tenant_id, competencia_original);

do $$
declare
  t text;
begin
  foreach t in array array['fin_fechamentos', 'fin_fechamento_profissionais', 'fin_fechamento_itens', 'fin_regularizacoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists finance_le_%s on public.%I', t, t);
    execute format(
      'create policy finance_le_%s on public.%I for select using ((tenant_id = current_tenant_id() and has_finance_access()) or is_platform_admin())',
      t, t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;

drop trigger if exists trg_audit_log on public.fin_fechamentos;
create trigger trg_audit_log after insert or update on public.fin_fechamentos
  for each row execute function write_audit_log();
drop trigger if exists trg_audit_log on public.fin_regularizacoes;
create trigger trg_audit_log after insert or update on public.fin_regularizacoes
  for each row execute function write_audit_log();

-- Grava a foto de uma competência (interna). Recusa se já existe ou se
-- alguma planilha do mês está com erro de sincronização.
create or replace function public.fin__fechar_mes(
  p_tenant uuid, p_competencia date, p_usuario uuid, p_origem text, p_observacao text
)
returns uuid
language plpgsql volatile security definer
set search_path = public, legado, pg_temp
set statement_timeout = '60s'
as $$
declare
  v_id uuid;
  v_erros text;
begin
  if p_competencia is null or extract(day from p_competencia) <> 1 then
    raise exception 'Competência inválida';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fin_fechamento:' || p_tenant::text || ':' || p_competencia::text, 0));
  if exists (select 1 from public.fin_fechamentos where tenant_id = p_tenant and competencia = p_competencia) then
    raise exception 'A competência % já está fechada', to_char(p_competencia, 'MM/YYYY');
  end if;

  create temporary table if not exists fin_tmp_mes on commit drop as
    select * from public.fin__fechamento_mes(p_tenant, p_competencia) limit 0;
  truncate fin_tmp_mes;
  insert into fin_tmp_mes select * from public.fin__fechamento_mes(p_tenant, p_competencia);

  select string_agg(profissional, ', ') into v_erros from fin_tmp_mes where erro_sincronizacao;
  if v_erros is not null then
    raise exception 'Não é possível fechar: planilha(s) com erro de sincronização: %', v_erros;
  end if;

  insert into public.fin_fechamentos (tenant_id, competencia, origem, observacao, qtd_ok, total_bruto,
                                      repasse_bruto, inss, liquido, parcela_hope, fechado_por)
  select p_tenant, p_competencia, p_origem, p_observacao,
         coalesce(sum(qtd_ok), 0), coalesce(sum(total_bruto), 0), coalesce(sum(repasse_bruto), 0),
         coalesce(sum(inss), 0), coalesce(sum(liquido), 0), coalesce(sum(parcela_hope), 0), p_usuario
    from fin_tmp_mes
  returning id into v_id;

  insert into public.fin_fechamento_profissionais (fechamento_id, tenant_id, competencia, spreadsheet_id, profissional,
         tipo, percentual_cnpj, qtd_ok, qtd_unimed33, total_bruto, comissao_padrao, repasse_bruto, base_inss, inss,
         liquido, parcela_hope, regra_inss, alertas)
  select v_id, p_tenant, p_competencia, m.spreadsheet_id, m.profissional, m.tipo, m.percentual_cnpj, m.qtd_ok,
         m.qtd_unimed33, m.total_bruto, m.comissao_padrao, m.repasse_bruto, coalesce(m.base_inss, 0),
         coalesce(m.inss, 0), m.liquido, m.parcela_hope, m.regra_inss, m.alertas
    from fin_tmp_mes m;

  insert into public.fin_fechamento_itens (fechamento_id, tenant_id, competencia, spreadsheet_id, linha, id_atendimento,
         impressao, data_sessao, valor_registrado, valor_bruto, regra, versao, repasse_profissional, inss_rateado,
         parcela_hope, alertas)
  select v_id, p_tenant, p_competencia, a.spreadsheet_id, a.linha, a.id_atendimento, a.impressao, a.data_sessao,
         a.valor_registrado, a.valor_bruto, a.regra, a.versao, a.repasse_profissional,
         case when m.repasse_bruto > 0 and coalesce(m.inss, 0) > 0
              then round(m.inss * a.repasse_profissional / m.repasse_bruto, 2) else 0 end,
         a.parcela_hope, a.alertas
    from public.fin_atendimentos_calculados a
    join fin_tmp_mes m on m.spreadsheet_id = a.spreadsheet_id
   where a.tenant_id = p_tenant
     and a.competencia = p_competencia
     and a.ok;

  return v_id;
end;
$$;

revoke execute on function public.fin__fechar_mes(uuid, date, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7) Funções para o app (conferem acesso e clínica)
-- ---------------------------------------------------------------------

-- Fechamento do mês calculado AGORA pelo motor (+ chave Pix, como o RPA)
create or replace function public.fin_fechamento_mes(p_ano int, p_mes int)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions, legado, pg_temp
set statement_timeout = '30s'
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_comp date;
  v_key text;
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  v_comp := make_date(p_ano, p_mes, 1);
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'hope_core_field_enc_key';

  return jsonb_build_object(
    'competencia', v_comp,
    'fechado', exists (select 1 from public.fin_fechamentos f where f.tenant_id = v_tenant and f.competencia = v_comp),
    'profissionais', coalesce((
      select jsonb_agg(to_jsonb(m) || jsonb_build_object(
               'pix_key', case when p.pix_encrypted is not null and v_key is not null
                               then pgp_sym_decrypt(p.pix_encrypted, v_key) else '' end)
             order by m.ordem nulls last, m.nome_abreviado)
        from public.fin__fechamento_mes(v_tenant, v_comp) m
        join legado.planilhas p on p.spreadsheet_id = m.spreadsheet_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.fin_fechamento_mes(int, int) from public, anon;
grant execute on function public.fin_fechamento_mes(int, int) to authenticated;

-- Atendimentos do mês COM ALERTA (sem nome de paciente) — tela Conciliação
create or replace function public.fin_alertas_mes(p_ano int, p_mes int)
returns jsonb
language plpgsql stable security definer
set search_path = public, legado, pg_temp
set statement_timeout = '30s'
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_comp date;
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  v_comp := make_date(p_ano, p_mes, 1);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'spreadsheet_id', a.spreadsheet_id, 'profissional', a.profissional, 'linha', a.linha,
             'id_atendimento', a.id_atendimento, 'data_sessao', a.data_sessao, 'status', a.status, 'ok', a.ok,
             'valor_registrado', a.valor_registrado, 'valor_bruto', a.valor_bruto, 'regra', a.regra,
             'repasse_profissional', round(a.repasse_profissional, 2), 'parcela_hope', round(a.parcela_hope, 2),
             'plano', a.plano, 'alertas', to_jsonb(a.alertas))
           order by a.profissional, a.linha)
      from public.fin_atendimentos_calculados a
     where a.tenant_id = v_tenant
       and a.competencia = v_comp
       and (a.ativo or a.desligada)
       and cardinality(a.alertas) > 0
       and (a.ok or 'VALOR_PLANILHA_DIVERGENTE' = any (a.alertas) or 'INCONSISTENCIA_CADASTRAL_PLANO' = any (a.alertas))
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.fin_alertas_mes(int, int) from public, anon;
grant execute on function public.fin_alertas_mes(int, int) to authenticated;

-- Varredura: Unimed 0025/25 na vigência com coluna N ≠ R$ 33 (só leitura)
create or replace function public.fin_varredura_unimed_33()
returns jsonb
language plpgsql stable security definer
set search_path = public, legado, pg_temp
set statement_timeout = '30s'
as $$
declare
  v_tenant uuid := current_tenant_id();
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'profissional', a.profissional, 'competencia', a.competencia,
             'id_atendimento', coalesce(a.id_atendimento, 'provisório: linha ' || a.linha),
             'linha', a.linha, 'data_sessao', a.data_sessao, 'status', a.status,
             'valor_registrado', a.valor_registrado, 'valor_esperado', a.valor_bruto)
           order by a.competencia, a.profissional, a.linha)
      from public.fin_atendimentos_calculados a
     where a.tenant_id = v_tenant
       and (a.ativo or a.desligada)
       and a.regra = 'UNIMED_0025_33_18'
       and 'VALOR_PLANILHA_DIVERGENTE' = any (a.alertas)
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.fin_varredura_unimed_33() from public, anon;
grant execute on function public.fin_varredura_unimed_33() to authenticated;

-- Pendências: competência FECHADA cujo conteúdo mudou depois da foto.
-- Compara pela "impressão" (hash do atendimento), não pela linha — ordenar
-- ou mover linhas não gera pendência falsa. Calculado ao vivo (não se perde).
create or replace function public.fin__pendencias(p_tenant uuid)
returns table (
  tipo text, competencia date, spreadsheet_id text, profissional text, situacao text,
  qtd_atual int, qtd_fechada int, linha int, id_atendimento text, impressao text,
  valor_atual numeric, valor_fechado numeric, regularizado boolean
)
language sql stable security definer
set search_path = public, legado, pg_temp
set statement_timeout = '30s'
as $$
  with f as (
    select id, competencia from public.fin_fechamentos where tenant_id = p_tenant
  ), cur as (
    select a.competencia, a.spreadsheet_id, a.impressao, count(*)::int as n, min(a.linha) as linha,
           max(a.profissional) as profissional, max(a.id_atendimento) as id_atendimento,
           sum(coalesce(a.valor_bruto, 0)) as valor
      from public.fin_atendimentos_calculados a
      join f on f.competencia = a.competencia
     where a.tenant_id = p_tenant and a.ok and (a.ativo or a.desligada)
     group by a.competencia, a.spreadsheet_id, a.impressao
  ), snap as (
    select i.competencia, i.spreadsheet_id, i.impressao, count(*)::int as n, min(i.linha) as linha,
           max(i.id_atendimento) as id_atendimento, sum(coalesce(i.valor_bruto, 0)) as valor
      from public.fin_fechamento_itens i
      join f on f.id = i.fechamento_id
     group by i.competencia, i.spreadsheet_id, i.impressao
  ), dif as (
    select coalesce(c.competencia, s.competencia) as competencia,
           coalesce(c.spreadsheet_id, s.spreadsheet_id) as spreadsheet_id,
           c.profissional, coalesce(c.n, 0) as qtd_atual, coalesce(s.n, 0) as qtd_fechada,
           coalesce(c.linha, s.linha) as linha, coalesce(c.id_atendimento, s.id_atendimento) as id_atendimento,
           coalesce(c.impressao, s.impressao) as impressao, c.valor as valor_atual, s.valor as valor_fechado
      from cur c
      full join snap s on s.competencia = c.competencia and s.spreadsheet_id = c.spreadsheet_id and s.impressao = c.impressao
     where coalesce(c.n, 0) <> coalesce(s.n, 0)
  )
  select 'ALTERADO_APOS_FECHAMENTO',
         d.competencia, d.spreadsheet_id,
         coalesce(d.profissional, (select coalesce(p.nome_completo, p.nome_abreviado) from legado.planilhas p where p.spreadsheet_id = d.spreadsheet_id)),
         case when d.qtd_atual > d.qtd_fechada then 'NOVO_OU_ALTERADO' else 'REMOVIDO_OU_ALTERADO' end,
         d.qtd_atual, d.qtd_fechada, d.linha, d.id_atendimento, d.impressao, d.valor_atual, d.valor_fechado,
         exists (select 1 from public.fin_regularizacoes r
                  where r.tenant_id = p_tenant and r.competencia_original = d.competencia and r.impressao = d.impressao)
    from dif d
   order by d.competencia, 4, d.linha
$$;
revoke execute on function public.fin__pendencias(uuid) from public, anon, authenticated;

create or replace function public.fin_pendencias()
returns jsonb
language plpgsql stable security definer
set search_path = public, legado, pg_temp
as $$
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from public.fin__pendencias(current_tenant_id()) x), '[]'::jsonb);
end;
$$;
revoke execute on function public.fin_pendencias() from public, anon;
grant execute on function public.fin_pendencias() to authenticated;

-- Foto de um mês fechado (cabeçalho + profissionais)
create or replace function public.fin_fechamento_foto(p_ano int, p_mes int)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_comp date;
  v_f public.fin_fechamentos;
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  v_comp := make_date(p_ano, p_mes, 1);
  select * into v_f from public.fin_fechamentos where tenant_id = v_tenant and competencia = v_comp;
  if v_f.id is null then return null; end if;
  return to_jsonb(v_f) || jsonb_build_object(
    'profissionais', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.profissional)
        from public.fin_fechamento_profissionais p where p.fechamento_id = v_f.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.fin_fechamento_foto(int, int) from public, anon;
grant execute on function public.fin_fechamento_foto(int, int) to authenticated;

-- Fechar um mês pelo app (só competência já encerrada no calendário)
create or replace function public.fin_fechar_mes(p_ano int, p_mes int, p_observacao text default null)
returns uuid
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  v_comp date;
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  v_comp := make_date(p_ano, p_mes, 1);
  if v_comp >= date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date then
    raise exception 'Só é possível fechar competência de mês já encerrado';
  end if;
  return public.fin__fechar_mes(current_tenant_id(), v_comp, auth.uid(), 'app', p_observacao);
end;
$$;
revoke execute on function public.fin_fechar_mes(int, int, text) from public, anon;
grant execute on function public.fin_fechar_mes(int, int, text) to authenticated;

-- Para os Apps Scripts (RPA/Faturamento): mesmo token da sincronização
create or replace function public.fin_fechamento_legado(p_token text, p_ano int, p_mes int)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions, legado, pg_temp
set statement_timeout = '30s'
as $$
declare
  v_cfg legado.config;
  v_comp date;
begin
  select * into v_cfg from legado.config where id;
  if v_cfg is null or p_token is null
     or encode(digest(p_token, 'sha256'), 'hex') <> v_cfg.token_sha256 then
    raise exception 'Token inválido' using errcode = '42501';
  end if;
  v_comp := make_date(p_ano, p_mes, 1);
  return jsonb_build_object(
    'competencia', v_comp,
    'gerado_em', now(),
    'fechado', exists (select 1 from public.fin_fechamentos f where f.tenant_id = v_cfg.tenant_id and f.competencia = v_comp),
    'profissionais', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.ordem nulls last, m.nome_abreviado)
        from public.fin__fechamento_mes(v_cfg.tenant_id, v_comp) m
    ), '[]'::jsonb),
    'divergencias_unimed', coalesce((
      select count(*) from public.fin_atendimentos_calculados a
       where a.tenant_id = v_cfg.tenant_id and a.competencia = v_comp and (a.ativo or a.desligada)
         and a.regra = 'UNIMED_0025_33_18' and 'VALOR_PLANILHA_DIVERGENTE' = any (a.alertas)
    ), 0)
  );
end;
$$;
revoke execute on function public.fin_fechamento_legado(text, int, int) from public;
grant execute on function public.fin_fechamento_legado(text, int, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8) Tela Banco de dados: tabelas novas de configuração/log = só leitura
-- ---------------------------------------------------------------------
create or replace function public.db_somente_leitura(p_esquema text, p_tabela text, p_kind "char")
returns boolean
language sql immutable
set search_path = pg_temp
as $$
  select p_kind <> 'r'
      or (p_esquema, p_tabela) in (
           ('public', 'audit_log'), ('public', 'users'), ('public', 'tenants'), ('public', 'platform_admins'),
           ('public', 'db_alteracoes'), ('public', 'db_catalogo_tabelas'), ('public', 'db_catalogo_colunas'),
           ('legado', 'config'), ('legado', 'sync_log'), ('legado', 'registro_log'),
           ('public', 'fin_regras'), ('public', 'fin_fechamentos'), ('public', 'fin_fechamento_profissionais'),
           ('public', 'fin_fechamento_itens'), ('public', 'fin_regularizacoes'))
$$;

insert into public.db_catalogo_tabelas (esquema, tabela, area, titulo, para_que, origem, usado_em) values
('public', 'fin_regras', 'Repasse às psicólogas', 'Regras financeiras (versionadas)',
 'As regras de divisão entre profissional e Hope e do INSS, cada uma com versão e vigência (pela data de lançamento, coluna A). Ex.: NORMAL_40_60, CNPJ_PERCENTUAL, UNIMED_0025_33_18 (a partir de 01/10/2026) e INSS_PF (teto e alíquota). Regra nova = versão nova; a antiga continua valendo para os meses anteriores.',
 'Migrations do motor financeiro (decisões da direção)',
 'Motor financeiro: Repasse, Pagamentos de repasse, Conciliação, BI, RPA e Faturamento'),
('public', 'fin_cnpj_cadastro', 'Repasse às psicólogas', 'Cadastro CNPJ (leitura)',
 'Quem é CNPJ e com qual percentual, lido da aba ExencaoCNPJ do RPA (linha vazia de percentual = 45%).',
 'Espelho legado.exencoes (SyncSupabase)', 'Motor financeiro'),
('public', 'fin_atendimentos_calculados', 'Repasse às psicólogas', 'Atendimentos calculados (motor)',
 'Cada atendimento das planilhas com a regra financeira aplicada: valor bruto financeiro, regra e versão, repasse do profissional, Parcela Bruta Hope e alertas (ex.: VALOR_PLANILHA_DIVERGENTE). Sem nome de paciente.',
 'Calculado a partir do espelho das planilhas (legado.atendimentos_raw)',
 'Conciliação, fechamento do mês, varredura Unimed'),
('public', 'fin_fechamentos', 'Repasse às psicólogas', 'Fechamentos do mês (fotos)',
 'Foto imutável dos totais de cada competência fechada (bruto, repasse, INSS, líquido, Parcela Bruta Hope). Mês fechado nunca é recalculado; mudança posterior vira pendência ALTERADO_APOS_FECHAMENTO.',
 'Função fin_fechar_mes (app) / foto inicial de 08 e 09/2026', 'Conciliação, Repasse'),
('public', 'fin_fechamento_profissionais', 'Repasse às psicólogas', 'Fechamento por profissional (foto)',
 'Valores de cada profissional na competência fechada: tipo PF/CNPJ, bruto, repasse, INSS, líquido, regra do INSS usada.',
 'Função fin_fechar_mes', 'Conciliação, Pagamentos de repasse'),
('public', 'fin_fechamento_itens', 'Repasse às psicólogas', 'Fechamento por atendimento (foto)',
 'Cada atendimento que entrou no fechamento, com regra, versão, valores e INSS rateado (para auditoria). Guarda só um hash do atendimento, nunca o nome do paciente.',
 'Função fin_fechar_mes', 'Conciliação (pendências após fechamento)'),
('public', 'fin_regularizacoes', 'Repasse às psicólogas', 'Regularizações de mês fechado',
 'Decisão administrativa sobre atendimento alterado depois do fechamento: quem autorizou, quando, competência original e competência do ajuste.',
 'Ação administrativa (tela Conciliação — etapa seguinte)', 'Conciliação')
on conflict (esquema, tabela) do nothing;
