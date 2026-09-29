-- =====================================================================
-- migration_022 — DRE gerencial da clínica (regime de caixa, extrato Cora)
--   Cada lançamento do extrato ganha uma categoria do plano de contas:
--     1) regra salva pelo usuário para aquele pagador/recebedor (tela DRE)
--     2) entrada conciliada com um previsto → "Convênio: <plano>"
--     3) regras automáticas por nome (psicólogas da aba ID, Ministério da
--        Fazenda, Celesc, contabilidade, Facebook/Google, etc.)
--   Transferências da própria clínica ficam fora do resultado.
-- =====================================================================

create table if not exists dre_regras (
  tenant_id uuid not null references tenants(id),
  chave text not null,              -- legado.chave_nome(counterparty_name)
  tipo text not null check (tipo in ('entrada', 'saida')),
  categoria text not null,
  exemplo text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, chave, tipo)
);

alter table dre_regras enable row level security;
drop policy if exists finance_access_dre_regras on dre_regras;
create policy finance_access_dre_regras on dre_regras
  using ((tenant_id = current_tenant_id() and has_finance_access()) or is_platform_admin())
  with check ((tenant_id = current_tenant_id() and has_finance_access()) or is_platform_admin());
revoke all on table dre_regras from anon;

-- categorias válidas (a tela usa a mesma lista)
create or replace function dre_categorias()
returns table (grupo text, categoria text, ordem int)
language sql
immutable
as $$
  values
    ('receita', 'Receita de convênios', 10),
    ('receita', 'Receita de particulares', 20),
    ('receita', 'Outras receitas', 30),
    ('deducao', 'Impostos e taxas', 40),
    ('custo', 'Repasse às psicólogas', 50),
    ('despesa', 'Pessoal e pró-labore', 60),
    ('despesa', 'Ocupação (aluguel, condomínio)', 61),
    ('despesa', 'Utilidades (energia, água, gás, internet)', 62),
    ('despesa', 'Serviços profissionais (contábil, jurídico)', 63),
    ('despesa', 'Marketing e anúncios', 64),
    ('despesa', 'Tecnologia e sistemas', 65),
    ('despesa', 'Material, copa e consumo', 66),
    ('despesa', 'Tarifas e juros bancários', 67),
    ('despesa', 'Outras despesas', 68),
    ('nao_operacional', 'Retiradas dos sócios', 80),
    ('nao_operacional', 'Empréstimos e cartões (pagamentos)', 81),
    ('nao_operacional', 'Aportes e empréstimos recebidos', 82),
    ('fora', 'Transferência entre contas (fora do DRE)', 99)
$$;

-- categoria de um lançamento do extrato
create or replace function dre_categoria_lancamento(b bank_transactions)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_nome text := upper(coalesce(b.counterparty_name, '') || ' ' || coalesce(b.description, ''));
  v_chave text := legado.chave_nome(b.counterparty_name);
  v_regra text;
begin
  -- transferência da própria clínica
  if coalesce(regexp_replace(b.counterparty_doc, '\D', '', 'g'), '') = '47283631000129'
     or upper(coalesce(b.counterparty_name, '')) like 'HOPE CLINICA%' then
    return 'Transferência entre contas (fora do DRE)';
  end if;

  select r.categoria into v_regra from dre_regras r
   where r.tenant_id = b.tenant_id and r.chave = v_chave and r.tipo = b.kind;
  if v_regra is not null then return v_regra; end if;

  if b.kind = 'entrada' then
    if exists (select 1 from bank_matches m where m.bank_transaction_id = b.id)
       or bank_plano_do_pagador(b.tenant_id, coalesce(b.counterparty_name, '') || ' ' || coalesce(b.description, '')) is not null then
      return 'Receita de convênios';
    end if;
    return 'Receita de particulares';
  end if;

  -- saídas
  if b.transaction_type = 'FEE' then return 'Tarifas e juros bancários'; end if;
  if exists (select 1 from legado.planilhas p
              where p.tenant_id = b.tenant_id
                and v_chave in (legado.chave_nome(p.nome_completo), legado.chave_nome(p.nome_abreviado)))
     or v_nome like '%PSICOLOG%' then
    return 'Repasse às psicólogas';
  end if;
  if v_nome ~ '(MINISTERIO DA FAZENDA|RECEITA FEDERAL|SECRETARIA DA FAZENDA|SIMPLES NACIONAL|\mDAS\M|MUNICIPIO|PREFEITURA|CONSELHO REGIONAL|DETRAN)' then
    return 'Impostos e taxas';
  end if;
  if v_nome ~ '(CONTABIL|CONTABILIDADE|ADVOCACIA|ADVOGAD|JURIDIC)' then return 'Serviços profissionais (contábil, jurídico)'; end if;
  if v_nome ~ '(CELESC|AGUAS|CASAN|GAS DA|ENERGIA|TELEF|VIVO|CLARO|\mTIM\M|OI S\.A|INTERNET|NET SERVICOS)' then
    return 'Utilidades (energia, água, gás, internet)';
  end if;
  if v_nome ~ '(FACEBOOK|GOOGLE|META PLATFORMS|INSTAGRAM|TIKTOK|DIGITAL PRESENC)' then return 'Marketing e anúncios'; end if;
  if v_nome ~ '(DUPLIQUE|CONDOMIN|ALUGUE|IMOBILI)' then return 'Ocupação (aluguel, condomínio)'; end if;
  if v_nome ~ '(TECNOLOGIA|SOFTWARE|SISTEMAS|HOSTING|MICROSOFT|APPLE|VERCEL|SUPABASE)' then return 'Tecnologia e sistemas'; end if;
  if v_nome ~ '(SUPERMERC|HIPERMERC|ATACAD|RESTAURANTE|PADARIA|POSTO|COMBUST|DROGA|FARMAC|PAPELARIA|PAPER|TINTAS|MATERIAL|ALIMENTOS|MERCADO)' then
    return 'Material, copa e consumo';
  end if;
  if v_nome ~ '(BANCO |SANTANDER|ITAU|BRADESCO|CAIXA ECON|NU PAGAMENTOS|NUBANK|BANCO DO BRASIL)' then
    return 'Empréstimos e cartões (pagamentos)';
  end if;
  return 'Outras despesas';
end;
$$;
revoke execute on function dre_categoria_lancamento(bank_transactions) from public, anon, authenticated;

-- DRE do ano: valor por mês × categoria (+ plano, nas receitas de convênio)
create or replace function dre_caixa(p_ano int)
returns table (mes int, grupo text, categoria text, detalhe text, valor numeric, qtd int)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_t uuid := current_tenant_id();
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
  with l as (
    select b.*, dre_categoria_lancamento(b) as cat
      from bank_transactions b
     where b.tenant_id = v_t and extract(year from b.occurred_on) = p_ano
  ), plano as (
    select l.id,
           coalesce(
             (select coalesce(p.short_name, p.name) from bank_matches m
                join cashflow_items c on m.origem = 'item' and c.id = m.target_id
                join insurance_plans p on p.id = c.insurance_plan_id
               where m.bank_transaction_id = l.id limit 1),
             (select coalesce(p.short_name, p.name) from insurance_plans p
               where p.id = bank_plano_do_pagador(v_t, coalesce(l.counterparty_name, '') || ' ' || coalesce(l.description, ''))),
             'Outros convênios') as plano
      from l
     where l.cat = 'Receita de convênios'
  )
  select extract(month from l.occurred_on)::int,
         k.grupo,
         l.cat,
         case when l.cat = 'Receita de convênios' then (select pl.plano from plano pl where pl.id = l.id) end,
         sum(case when l.kind = 'entrada' then l.amount else -l.amount end),
         count(*)::int
    from l
    join dre_categorias() k on k.categoria = l.cat
   group by 1, 2, 3, 4;
end;
$$;
alter function dre_caixa(int) set statement_timeout = '30s';
revoke execute on function dre_caixa(int) from public, anon;
grant execute on function dre_caixa(int) to authenticated;

-- pagadores/recebedores do ano com a categoria atual (para classificar)
create or replace function dre_contrapartes(p_ano int)
returns table (chave text, nome text, tipo text, categoria text, por_regra boolean, valor numeric, qtd int, ultimo date)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_t uuid := current_tenant_id();
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
  select legado.chave_nome(b.counterparty_name),
         max(coalesce(b.counterparty_name, '(sem nome)')),
         b.kind,
         max(dre_categoria_lancamento(b)),
         bool_or(exists (select 1 from dre_regras r where r.tenant_id = v_t and r.chave = legado.chave_nome(b.counterparty_name) and r.tipo = b.kind)),
         sum(b.amount),
         count(*)::int,
         max(b.occurred_on)
    from bank_transactions b
   where b.tenant_id = v_t and extract(year from b.occurred_on) = p_ano
   group by 1, 3
   order by 6 desc;
end;
$$;
alter function dre_contrapartes(int) set statement_timeout = '30s';
revoke execute on function dre_contrapartes(int) from public, anon;
grant execute on function dre_contrapartes(int) to authenticated;

-- salvar/remover a regra de um pagador/recebedor
create or replace function dre_classificar(p_chave text, p_tipo text, p_categoria text)
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
  if p_tipo not in ('entrada', 'saida') then raise exception 'Tipo inválido'; end if;
  if coalesce(p_categoria, '') = '' then
    delete from dre_regras where tenant_id = v_t and chave = p_chave and tipo = p_tipo;
    return;
  end if;
  if not exists (select 1 from dre_categorias() k where k.categoria = p_categoria) then
    raise exception 'Categoria inválida: %', p_categoria;
  end if;
  insert into dre_regras (tenant_id, chave, tipo, categoria, exemplo, updated_by)
  values (v_t, p_chave, p_tipo, p_categoria,
          (select counterparty_name from bank_transactions where tenant_id = v_t and legado.chave_nome(counterparty_name) = p_chave limit 1),
          auth.uid())
  on conflict (tenant_id, chave, tipo) do update
    set categoria = excluded.categoria, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke execute on function dre_classificar(text, text, text) from public, anon;
grant execute on function dre_classificar(text, text, text) to authenticated;
