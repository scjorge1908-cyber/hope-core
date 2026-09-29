-- =====================================================================
-- migration_015 — psicólogas desligadas da clínica
-- A planilha continua no banco (histórico, repasse de meses antigos),
-- mas quem foi desligada NÃO entra mais no filtro do Registro de Guias.
-- A sincronização das planilhas nunca mexe nestas colunas.
-- =====================================================================
alter table legado.planilhas add column if not exists desligada boolean not null default false;
alter table legado.planilhas add column if not exists desligada_em date;

-- informado pelo Morais em 29/09/2026: não fazem mais parte da clínica
update legado.planilhas
   set desligada = true, desligada_em = coalesce(desligada_em, date '2026-09-29')
 where spreadsheet_id in (
   '1AnOhX3oQXJTm8RaKYSjoSPW8X477yLq0f2h7mS9CLp4', -- PSI Amanda (Amanda de oliveira Rodrigues)
   '1B51AyOtjHgMOkXXTNOMKkuSkgz9f7U0GZMw0PTC0gzQ', -- PSI CELEJANE
   '1Q45yKqydwj7jgoQK7X1XPKSVORO0MAAHUY-mrQXAKtw'  -- PSI João
 );

drop function if exists public.legacy_planilhas_nomes();
create function public.legacy_planilhas_nomes()
returns table (spreadsheet_id text, nome_abreviado text, nome_completo text, ativo boolean, desligada boolean, desligada_em date)
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
  select p.spreadsheet_id, p.nome_abreviado, p.nome_completo, p.ativo, p.desligada, p.desligada_em
    from legado.planilhas p
   where p.tenant_id = current_tenant_id();
end;
$$;
revoke execute on function public.legacy_planilhas_nomes() from public, anon;
grant execute on function public.legacy_planilhas_nomes() to authenticated;

-- marcar / desmarcar pela tela (Repasse → Sincronização das planilhas)
create or replace function public.legacy_marcar_desligada(p_spreadsheet_id text, p_desligada boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  update legado.planilhas
     set desligada = p_desligada,
         desligada_em = case when p_desligada then coalesce(desligada_em, (now() at time zone 'America/Sao_Paulo')::date) else null end
   where spreadsheet_id = p_spreadsheet_id
     and tenant_id = current_tenant_id();
  if not found then
    raise exception 'Planilha não encontrada';
  end if;
end;
$$;
revoke execute on function public.legacy_marcar_desligada(text, boolean) from public, anon;
grant execute on function public.legacy_marcar_desligada(text, boolean) to authenticated;
