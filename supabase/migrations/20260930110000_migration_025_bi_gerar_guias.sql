-- =====================================================================
-- migration_025 — "Gerar guias" (guias previstas × já geradas, por semana)
--   Tela administrativa: precisa do nome do paciente para cruzar a Agenda
--   de cada psicóloga com a BD_GUIAS do Registro de Guias (mesma regra do
--   Guiasprevistassemanais.gs). Só para quem tem acesso ao financeiro.
-- =====================================================================
create or replace function public.bi_gerar_guias_base()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_t uuid := current_tenant_id();
begin
  if not has_finance_access() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'hoje', (now() at time zone 'America/Sao_Paulo')::date,
    'psicologas', coalesce((select jsonb_agg(jsonb_build_array(p.spreadsheet_id, coalesce(p.nome_abreviado, p.nome_completo), p.nome_completo) order by p.ordem nulls last)
        from legado.planilhas p where p.tenant_id = v_t and p.ativo and not p.desligada), '[]'::jsonb),
    'agenda', coalesce((
      select jsonb_agg(jsonb_build_array(a.spreadsheet_id, a.paciente, a.plano, a.dia, a.inicio) order by a.spreadsheet_id, a.linha)
        from legado.agenda a
        join legado.planilhas p on p.spreadsheet_id = a.spreadsheet_id
       where p.tenant_id = v_t and p.ativo and not p.desligada and a.tipo = 'PACIENTE'
    ), '[]'::jsonb),
    'bd', coalesce((
      select jsonb_agg(jsonb_build_array(
               trim(coalesce(b.celulas->>3, '')), trim(coalesce(b.celulas->>4, '')), b.celulas->1, b.celulas->2,
               (select coalesce(jsonb_agg(coalesce(b.celulas->>k, '') order by k), '[]'::jsonb) from generate_series(6, 15) k))
             order by b.linha)
        from legado.bd_guias b
    ), '[]'::jsonb),
    'bdSincronizado', (select max(sincronizado_em) from legado.bd_guias)
  );
end;
$$;
alter function public.bi_gerar_guias_base() set statement_timeout = '30s';
revoke execute on function public.bi_gerar_guias_base() from public, anon;
grant execute on function public.bi_gerar_guias_base() to authenticated;
