-- =====================================================================
-- migration_028 — Pagamento do repasse (tela Pagamentos de repasse)
--
--   1) legacy_rpa_base(): cada linha passa a levar um 4º item com a
--      CARTEIRINHA (coluna L), para a regra nova do RPA (02/10/2026):
--      sessão "OK" de R$ 33 com carteirinha começando em 0025 (Unimed)
--      = R$ 18,00 fixo (PF). A coluna é escolhida pelo CABEÇALHO, com a
--      mesma regra do Code.gs corrigido: 1º cabeçalho (maiúsculo, sem
--      acento) que contém "CART" (Carterinha/Carteirinha); senão a
--      coluna L (índice 11). O teste do 0025 é feito no app (TS), igual
--      ao Code.gs. Continua sem devolver nome de paciente.
--
--   2) repasse_pagamentos: um registro por psicóloga × mês de
--      competência dizendo se o repasse foi pago, quanto, quando, por
--      quem e (quando achado) qual Pix do extrato do Cora pagou.
--      O valor a pagar NÃO fica aqui — continua sendo calculado pelo
--      RPA sobre o espelho das planilhas (fonte única). Aqui fica só o
--      fato "pago", com o valor do momento, para conferir divergência
--      se a planilha mudar depois.
--      "Desfazer" não apaga: volta pago = false (histórico + auditoria).
--      Sem permissão de exclusão para o app (só select/insert/update).
-- =====================================================================

-- ----------------------------------------------------------------
-- 1) legacy_rpa_base com a carteirinha (coluna L)
-- ----------------------------------------------------------------
create or replace function legado.rpa_normalizar_cabecalho(p text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select upper(btrim(translate(coalesce(p, ''),
    'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN')))
$$;

create or replace function legado.rpa_indice_carteirinha(p_cabecalho jsonb)
returns int
language sql
immutable
set search_path = legado, pg_catalog, pg_temp
as $$
  select coalesce((
           select (h.ord - 1)::int
             from jsonb_array_elements_text(case when jsonb_typeof(p_cabecalho) = 'array' then p_cabecalho else '[]'::jsonb end)
                  with ordinality h(txt, ord)
            where legado.rpa_normalizar_cabecalho(h.txt) like '%CART%'
            order by h.ord
            limit 1
         ), 11)
$$;

revoke execute on function legado.rpa_normalizar_cabecalho(text) from public, anon;
revoke execute on function legado.rpa_indice_carteirinha(jsonb) from public, anon;

create or replace function public.legacy_rpa_base()
returns jsonb
language plpgsql stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tenant uuid := current_tenant_id();
  v_key text;
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'hope_core_field_enc_key';

  return jsonb_build_object(
    'psicologas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.spreadsheet_id,
        'nomeAbreviado', p.nome_abreviado,
        'nomeCompleto', coalesce(p.nome_completo, p.nome_abreviado),
        'pixKey', case when p.pix_encrypted is not null then pgp_sym_decrypt(p.pix_encrypted, v_key) else '' end,
        'ultimaSincronizacao', p.ultima_sincronizacao,
        'ultimoErro', p.ultimo_erro,
        'linhas', coalesce((
          select jsonb_agg(jsonb_build_array(
                   r.celulas->0, r.celulas->13, r.celulas->18,
                   coalesce(r.celulas->ix.idx, '""'::jsonb)
                 ) order by r.linha)
            from legado.atendimentos_raw r
           where r.spreadsheet_id = p.spreadsheet_id
        ), '[]'::jsonb)
      ) order by p.ordem nulls last, p.nome_abreviado)
      from legado.planilhas p
      cross join lateral (select legado.rpa_indice_carteirinha(p.cabecalho) as idx) ix
      where p.tenant_id = v_tenant and p.ativo
    ), '[]'::jsonb),
    'exencoes', coalesce((
      select jsonb_agg(jsonb_build_array(e.psicologa_id, e.cnpj, e.percentual) order by e.linha)
        from legado.exencoes e
    ), '[]'::jsonb)
  );
end;
$$;

alter function public.legacy_rpa_base() set statement_timeout = '30s';
revoke execute on function public.legacy_rpa_base() from public, anon;
grant execute on function public.legacy_rpa_base() to authenticated;

-- ----------------------------------------------------------------
-- 2) repasse_pagamentos
-- ----------------------------------------------------------------
create table if not exists public.repasse_pagamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  competencia date not null check (extract(day from competencia) = 1),
  spreadsheet_id text not null,
  psicologa_nome text not null,
  tipo text not null check (tipo in ('PF', 'CNPJ')),
  valor_pago numeric(14, 2) not null check (valor_pago >= 0),
  pago boolean not null default true,
  data_pagamento date,
  forma text not null default 'pix_qrcode' check (forma in ('pix_qrcode', 'pix_copia_cola', 'extrato', 'outro')),
  bank_transaction_id uuid references bank_transactions(id),
  observacao text,
  marcado_por uuid,
  marcado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint uq_repasse_pagamentos unique (tenant_id, spreadsheet_id, competencia)
);
create index if not exists idx_repasse_pagamentos_comp on public.repasse_pagamentos (tenant_id, competencia);
create unique index if not exists uq_repasse_pagamentos_tx
  on public.repasse_pagamentos (bank_transaction_id) where bank_transaction_id is not null and pago;

alter table public.repasse_pagamentos enable row level security;
drop policy if exists finance_access_repasse_pagamentos on public.repasse_pagamentos;
create policy finance_access_repasse_pagamentos on public.repasse_pagamentos
  using ((tenant_id = current_tenant_id() and has_finance_access()) or is_platform_admin())
  with check ((tenant_id = current_tenant_id() and has_finance_access()) or is_platform_admin());
revoke all on table public.repasse_pagamentos from anon;
grant select, insert, update on table public.repasse_pagamentos to authenticated;

drop trigger if exists trg_audit_log on public.repasse_pagamentos;
create trigger trg_audit_log after insert or update on public.repasse_pagamentos
  for each row execute function write_audit_log();

insert into public.db_catalogo_tabelas (esquema, tabela, area, titulo, para_que, origem, usado_em) values
('public', 'repasse_pagamentos', 'Repasse às psicólogas', 'Pagamentos de repasse',
 'Se o repasse de cada psicóloga em cada mês já foi pago: valor pago, data, forma (QR Code Pix, copia e cola, extrato) e o Pix do Cora que pagou. O valor a pagar vem sempre do cálculo do RPA; aqui fica só o registro do pagamento.',
 'Tela Pagamentos de repasse (botão Marcar como pago / vincular Pix do extrato)',
 'Pagamentos de repasse, relatório Pagos × não pagos')
on conflict (esquema, tabela) do nothing;
