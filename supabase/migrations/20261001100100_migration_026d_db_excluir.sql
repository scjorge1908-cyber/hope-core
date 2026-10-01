-- migration_026d — exclusão de linhas pela tela "Banco de dados" (com auditoria em db_alteracoes)
-- ---------- excluir ----------
create or replace function public.db_excluir(p_esquema text, p_tabela text, p_chave jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_oid oid := public.db_alvo(p_esquema, p_tabela);
  v_kind "char";
  v_tenant boolean;
  v_pk text[];
  v_cond text;
  v_antes jsonb;
begin
  select relkind into v_kind from pg_class where oid = v_oid;
  if public.db_somente_leitura(p_esquema, p_tabela, v_kind) then
    raise exception 'Esta tabela é somente leitura nesta tela';
  end if;
  if p_chave is null then raise exception 'Informe a linha'; end if;
  v_tenant := exists (select 1 from pg_attribute a where a.attrelid = v_oid and a.attname = 'tenant_id' and not a.attisdropped);
  select array_agg(a.attname::text) into v_pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = v_oid and i.indisprimary;
  if v_pk is null then raise exception 'Tabela sem chave primária: exclusão desativada'; end if;
  select string_agg(format('t.%I is not distinct from k.%I', c, c), ' and ') into v_cond from unnest(v_pk) c;
  if v_tenant then
    v_cond := v_cond || format(' and t.tenant_id = %L::uuid', current_tenant_id());
  end if;
  execute format('delete from %I.%I t using jsonb_populate_record(null::%I.%I, $1) k where %s returning to_jsonb(t)',
                 p_esquema, p_tabela, p_esquema, p_tabela, v_cond)
    into v_antes using p_chave;
  if v_antes is null then
    raise exception 'Linha não encontrada';
  end if;
  insert into public.db_alteracoes (tenant_id, user_id, esquema, tabela, operacao, chave, antes)
  values (current_tenant_id(), auth.uid(), p_esquema, p_tabela, 'excluir', p_chave, public.db_limpar_linha(p_esquema, p_tabela, v_oid, v_antes));
  return jsonb_build_object('excluida', true);
end;
$$;
revoke execute on function public.db_excluir(text, text, jsonb) from public, anon;
grant execute on function public.db_excluir(text, text, jsonb) to authenticated;

