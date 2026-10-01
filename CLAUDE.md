# HOPE CORE — regras do projeto

## Banco de dados (tela Sistema → Banco de dados)

A tela `/sistema/banco` lê a lista de tabelas direto do Postgres (schemas `public` e `legado`), então toda tabela nova aparece sozinha. A descrição de cada uma fica em `public.db_catalogo_tabelas`, e a de cada coluna em `public.db_catalogo_colunas`.

**Toda migration que cria uma tabela deve, na mesma migration, inserir a descrição dela:**

```sql
insert into public.db_catalogo_tabelas (esquema, tabela, area, titulo, para_que, origem, usado_em) values
('public', 'nova_tabela', 'Financeiro e banco', 'Nome amigável',
 'Para que serve, em linguagem simples.',
 'De onde vêm os dados (tela, importação, Apps Script…)',
 'Telas/relatórios que usam')
on conflict (esquema, tabela) do nothing;
```

Áreas existentes: `Espelho das planilhas`, `Faturamento de convênios`, `Financeiro e banco`, `Repasse às psicólogas`, `Clínica (sistema novo)`, `Sistema e segurança`.

Regras da tela:

- Só o dono (`users.role = 'owner'`) abre.
- Tabelas com `tenant_id` mostram apenas a clínica do usuário.
- Toda mudança é registrada em `public.db_alteracoes`.
- As tabelas somente leitura estão em `db_somente_leitura()`. Se uma tabela nova for de log ou de configuração, acrescente-a lá.
- As colunas que nunca aparecem estão em `db_coluna_oculta()`: bytea, CPF/RG/PIX/cartão/senha em texto e `*_blind_index`.

## Migrations

- Aplicar migrations via Supabase MCP (`apply_migration`). O arquivo em `supabase/migrations/` deve espelhar exatamente o que foi aplicado.
- O conector bloqueia SQL que contém `DELETE`. Uma migration assim precisa ser rodada no SQL Editor do Supabase.
