-- =====================================================================
-- migration_026e — "Banco de dados": colunas que a tela nunca mostra/edita
--   Antes: só bytea (criptografadas) e legado.config.token_sha256.
--   Agora também: colunas de dado pessoal em texto puro que foram
--   substituídas por versões criptografadas (cpf, rg, pix_key,
--   responsible_cpf, card_number, insurance_card_number, auth_password)
--   e os índices cegos (*_blind_index). Hoje essas colunas estão vazias;
--   a regra garante que continuem fora da tela se algum dia forem usadas.
-- =====================================================================

create or replace function public.db_coluna_oculta(p_esquema text, p_tabela text, p_coluna text, p_tipo text)
returns boolean
language sql
immutable
set search_path = pg_temp
as $$
  select p_tipo = 'bytea'
      or (p_esquema = 'legado' and p_tabela = 'config' and p_coluna = 'token_sha256')
      or p_coluna in ('cpf', 'rg', 'pix_key', 'responsible_cpf', 'card_number', 'insurance_card_number', 'auth_password')
      or p_coluna like '%\_blind\_index'
$$;

do $do$
declare
  v_def text;
  f regprocedure;
begin
  foreach f in array array[
    'public.db_tabela(text,text)'::regprocedure,
    'public.db_limpar_linha(text,text,oid,jsonb)'::regprocedure,
    'public.db_salvar(text,text,jsonb,jsonb)'::regprocedure]
  loop
    v_def := pg_get_functiondef(f);
    v_def := replace(v_def,
      $r$format_type(a.atttypid, a.atttypmod) = 'bytea' or (p_esquema = 'legado' and p_tabela = 'config' and a.attname = 'token_sha256')$r$,
      $r$public.db_coluna_oculta(p_esquema, p_tabela, a.attname, format_type(a.atttypid, a.atttypmod))$r$);
    v_def := replace(v_def,
      $r$and format_type(a.atttypid, a.atttypmod) <> 'bytea'$r$,
      $r$and not public.db_coluna_oculta(p_esquema, p_tabela, a.attname, format_type(a.atttypid, a.atttypmod))$r$);
    execute v_def;
  end loop;
end
$do$;
