-- =====================================================================
-- migration_014 — nomes das psicólogas com planilha sincronizada
-- Usado pela Conferência de guias para marcar "planilha não sincronizada"
-- só para quem de fato não está na aba ID do Cálculo RPA (antes a tela
-- comparava só com quem teve sessão no mês e marcava errado).
-- =====================================================================
create or replace function public.legacy_planilhas_nomes()
returns table (spreadsheet_id text, nome_abreviado text, nome_completo text, ativo boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
  select p.spreadsheet_id, p.nome_abreviado, p.nome_completo, p.ativo
    from legado.planilhas p
   where p.tenant_id = current_tenant_id();
end;
$$;

revoke execute on function public.legacy_planilhas_nomes() from public, anon;
grant execute on function public.legacy_planilhas_nomes() to authenticated;
