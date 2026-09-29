-- =====================================================================
-- migration_016 — guias lançadas no ADM Registro de Guia (BD_GUIAS) que
-- NÃO aparecem na aba Atendimentos de nenhuma psicóloga.
-- É o relatório que vai para a psicóloga: "estas guias estão no registro
-- da clínica, mas a sessão não está na sua planilha".
--   • só valores com cara de guia (4+ dígitos; pontos/espaços ignorados);
--     anotações como "carteirinha vencida" ficam de fora
--   • a comparação ignora espaços, pontos e traços dos dois lados
--   • semana = posição na BD_GUIAS (S1..S5, 2 guias por semana; depois extras)
--   • psicóloga ligada à planilha pelo nome (sem diferença de maiúsculas/acentos)
-- =====================================================================
create or replace function legado.chave_nome(t text)
returns text
language sql
immutable
as $f$
  select lower(translate(trim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g')),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
$f$;

create or replace function public.guias_adm_sem_sessao(p_de date, p_ate date)
returns table (
  psicologa text,
  psicologa_adm text,
  spreadsheet_id text,
  desligada boolean,
  paciente text,
  plano text,
  guia text,
  mes int,
  ano int,
  semana text,
  linha_bd int
)
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
  with sess as (
    select distinct regexp_replace(coalesce(a.celulas->>4, ''), '[\s.\-/]', '', 'g') as g
      from legado.atendimentos_raw a
      join legado.planilhas p on p.spreadsheet_id = a.spreadsheet_id
     where p.tenant_id = v_t
  ), bd as (
    select b.linha,
           trim(coalesce(b.celulas->>3, '')) as psi,
           trim(coalesce(b.celulas->>4, '')) as pac,
           nullif(trim(coalesce(b.celulas->>5, '')), '') as plano,
           nullif(regexp_replace(coalesce(b.celulas->>1, ''), '\D', '', 'g'), '')::int as mes,
           nullif(regexp_replace(coalesce(b.celulas->>2, ''), '\D', '', 'g'), '')::int as ano,
           trim(x.v) as bruto,
           regexp_replace(trim(x.v), '[\s.\-/]', '', 'g') as g,
           x.ord::int as ord
      from legado.bd_guias b,
           jsonb_array_elements_text(b.celulas) with ordinality as x(v, ord)
     where x.ord > 6
  ), bd_ok as (
    select * from bd
     where bd.g ~ '^\d{4,}$'
       and (case when bd.mes between 1 and 12 and bd.ano between 2000 and 2100
                 then make_date(bd.ano, bd.mes, 1) end) between date_trunc('month', p_de)::date and date_trunc('month', p_ate)::date
  ), pl as (
    select p.spreadsheet_id, p.nome_abreviado, p.desligada,
           legado.chave_nome(p.nome_abreviado) as k1,
           legado.chave_nome(p.nome_completo) as k2
      from legado.planilhas p
     where p.tenant_id = v_t
  )
  select distinct on (bd_ok.g, bd_ok.mes, bd_ok.ano, legado.chave_nome(bd_ok.psi), legado.chave_nome(bd_ok.pac))
         coalesce(pl.nome_abreviado, bd_ok.psi),
         bd_ok.psi,
         pl.spreadsheet_id,
         coalesce(pl.desligada, false),
         bd_ok.pac,
         bd_ok.plano,
         bd_ok.bruto,
         bd_ok.mes,
         bd_ok.ano,
         case when bd_ok.ord between 7 and 16 then 'S' || ((bd_ok.ord - 7) / 2 + 1)::text else 'extra' end,
         bd_ok.linha::int
    from bd_ok
    left join pl on legado.chave_nome(bd_ok.psi) in (pl.k1, pl.k2)
   where not exists (select 1 from sess where sess.g = bd_ok.g)
   order by bd_ok.g, bd_ok.mes, bd_ok.ano, legado.chave_nome(bd_ok.psi), legado.chave_nome(bd_ok.pac), bd_ok.ord;
end;
$$;

alter function public.guias_adm_sem_sessao(date, date) set statement_timeout = '30s';
revoke execute on function public.guias_adm_sem_sessao(date, date) from public, anon;
grant execute on function public.guias_adm_sem_sessao(date, date) to authenticated;
