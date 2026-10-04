-- =====================================================================
-- migration_035 — Convergência Bloco 1 (ORDEM-005 D): legado.vw_room_blocks
--
-- PREPARADA EM BRANCH — NÃO APLICADA EM PRODUÇÃO.
-- Especificação: ENTREGA-004 §4.2.
--
-- Blocos de ocupação das salas DERIVADOS do painel de salas
-- (legado.salas_painel + legado.salas_meta), por gaps-and-islands:
-- horas consecutivas da mesma sala, no mesmo dia, com o mesmo ocupante,
-- viram UM bloco [bloco_inicio, bloco_fim). Nada é persistido.
--
--   • Somente leitura. Schema legado (fechado: sem anon/authenticated).
--   • Sem PII: não devolve nome de paciente nem de profissional; a
--     profissional sai só como referência interna (planilha_ref e, se a
--     migration 034 tiver sido executada, professional_profile_id).
--   • O painel vem por getDisplayValues() e NÃO tem o defeito DATA-01.
--   • Seguro com public.rooms vazia: room_ref fica nulo.
--   • Tenant: o tenant interno (subconsulta escalar: se houver mais de
--     um tenant interno a view falha em vez de duplicar blocos).
--   • confianca: ALTA = célula igual ao nome_abreviado de uma planilha;
--     MEDIA = célula contém o nome_abreviado; LIVRE/BAIXA = livre ou sem
--     correspondência (DESCONHECIDO).
--
-- Rollback: supabase/rollbacks/rollback_035_vw_room_blocks.sql
-- Depende de: migration 033 (legado.sala_chave) e 034 (coluna de vínculo).
-- =====================================================================

create or replace view legado.vw_room_blocks
with (security_invoker = on)
as
with cab as (
  select m.cabecalho, m.sincronizado_em from legado.salas_meta m where m.id
),
celulas as (
  select p.linha,
         trim(p.celulas->>0) as dia_txt,
         case when (p.celulas->>1) ~ '^\s*\d{1,2}:\d{2}' then trim(p.celulas->>1)::time end as hora,
         trim(c.cabecalho->>(e.i - 1)::int) as sala_nome,
         trim(e.v) as conteudo
    from legado.salas_painel p
    cross join cab c
    cross join lateral jsonb_array_elements_text(p.celulas) with ordinality as e(v, i)
   where e.i > 2
),
classificadas as (
  select ce.*,
         case lower(ce.dia_txt)
           when 'domingo' then 0 when 'segunda' then 1 when 'terça' then 2 when 'terca' then 2
           when 'quarta' then 3 when 'quinta' then 4 when 'sexta' then 5
           when 'sábado' then 6 when 'sabado' then 6
         end::smallint as weekday,
         exato.spreadsheet_id  as sid_exato,
         contem.spreadsheet_id as sid_contem,
         (ce.conteudo = '' or ce.conteudo ilike '%livre%' or ce.conteudo like '%💚%'
          or ce.conteudo ilike '%dispon%') as eh_livre
    from celulas ce
    left join lateral (
      select pl.spreadsheet_id from legado.planilhas pl
       where lower(trim(pl.nome_abreviado)) = lower(ce.conteudo)
       order by pl.spreadsheet_id limit 1
    ) exato on true
    left join lateral (
      select pl.spreadsheet_id from legado.planilhas pl
       where exato.spreadsheet_id is null
         and length(trim(pl.nome_abreviado)) >= 3
         and lower(ce.conteudo) like '%' || lower(trim(pl.nome_abreviado)) || '%'
       order by length(pl.nome_abreviado) desc, pl.spreadsheet_id limit 1
    ) contem on true
   where ce.hora is not null
),
ocupacao as (
  select weekday, hora, sala_nome,
         case when sid_exato is not null or sid_contem is not null then 'PROFISSIONAL'
              when eh_livre then 'LIVRE'
              else 'DESCONHECIDO' end as ocupante_tipo,
         coalesce(sid_exato, sid_contem) as planilha_ref,
         case when sid_exato is not null then 3
              when sid_contem is not null then 2
              else 1 end as confianca_n,
         -- chave do ocupante para formar as ilhas (texto bruto só p/ DESCONHECIDO)
         coalesce(coalesce(sid_exato, sid_contem),
                  case when eh_livre then '#LIVRE' else '#?' || lower(conteudo) end) as ocupante_chave
    from classificadas
   where weekday is not null
),
ilhas as (
  select o.*,
         (extract(epoch from o.hora)::int / 3600)
           - row_number() over (partition by o.sala_nome, o.weekday, o.ocupante_chave order by o.hora) as grupo
    from ocupacao o
)
select (select t.id from public.tenants t where t.is_internal) as tenant_id,
       legado.sala_chave(i.sala_nome)                         as sala_norm,
       r.id                                                   as room_ref,
       i.weekday,
       min(i.ocupante_tipo)                                   as ocupante_tipo,
       i.planilha_ref,
       pl.professional_profile_id,
       min(i.hora)                                            as bloco_inicio,
       (max(i.hora) + interval '1 hour')::time                as bloco_fim,
       count(*)::int                                          as horas,
       case min(i.confianca_n) when 3 then 'ALTA' when 2 then 'MEDIA' else 'BAIXA' end
                                                              as confianca,  -- a pior do bloco
       'salas_painel'::text                                   as origem,
       (select c.sincronizado_em from cab c)                  as sincronizado_em
  from ilhas i
  left join legado.planilhas pl on pl.spreadsheet_id = i.planilha_ref
  left join public.rooms r
         on r.tenant_id = (select t.id from public.tenants t where t.is_internal)
        and legado.sala_chave(r.name) = legado.sala_chave(i.sala_nome)
 group by i.sala_nome, r.id, i.weekday, i.ocupante_chave, i.grupo, i.planilha_ref, pl.professional_profile_id;

revoke all on legado.vw_room_blocks from public, anon, authenticated;

comment on view legado.vw_room_blocks is
  'Convergência (migration 035): blocos de ocupação das salas derivados do painel (gaps-and-islands). Somente leitura, sem PII, não persistido.';
