-- =====================================================================
-- migration_031 — motor financeiro: desempenho da visão
--
-- A detecção de ID_ATENDIMENTO repetido usava uma função de janela
-- (count(*) over …) dentro de fin_atendimentos_calculados. Isso obrigava
-- o banco a calcular TODOS os atendimentos de todos os meses a cada
-- consulta (~6 s por mês). Agora a duplicidade vem de uma visão auxiliar
-- leve (só lê o ID das planilhas, sem a regra financeira) e o filtro por
-- competência volta a ser aplicado antes do cálculo.
-- Mesmas colunas, mesma ordem, mesmo resultado.
-- =====================================================================

-- IDs repetidos (mesma clínica, mesmo ID em mais de uma linha)
create or replace view public.fin_ids_duplicados as
select x.tenant_id, x.id_atendimento
  from (
    select p.tenant_id,
           nullif(btrim(r.celulas ->> public.fin_indice_id_atendimento(p.cabecalho)), '') as id_atendimento
      from legado.atendimentos_raw r
      join legado.planilhas p on p.spreadsheet_id = r.spreadsheet_id
     where public.fin_indice_id_atendimento(p.cabecalho) is not null
  ) x
 where x.id_atendimento is not null
 group by x.tenant_id, x.id_atendimento
having count(*) > 1;

revoke all on table public.fin_ids_duplicados from anon, authenticated;

create or replace view public.fin_atendimentos_calculados as
with pl as (
  select p.tenant_id, p.spreadsheet_id,
         coalesce(p.nome_completo, p.nome_abreviado) as profissional,
         p.nome_abreviado, p.ordem, p.ativo, p.desligada,
         (p.ultima_sincronizacao is null or p.ultimo_erro is not null) as erro_sincronizacao,
         legado.rpa_indice_carteirinha(p.cabecalho) as ix_cart,
         public.fin_indice_plano(p.cabecalho) as ix_plano,
         public.fin_indice_id_atendimento(p.cabecalho) as ix_id
    from legado.planilhas p
), base as (
  select pl.*, r.linha, r.celulas as c, cc.percentual as percentual_cnpj,
         public.fin_status_texto(r.celulas -> 18) as status,
         public.fin_competencia_coluna_a(r.celulas -> 0) as competencia,
         public.fin_valor_monetario(r.celulas -> 13) as valor_planilha,
         public.fin_valor_vazio(r.celulas -> 13) as valor_vazio,
         legado.rpa_normalizar_cabecalho(r.celulas ->> pl.ix_plano) as plano,
         public.fin_carteirinha_digitos(r.celulas -> pl.ix_cart) as carteirinha_digitos,
         case when pl.ix_id is not null then nullif(btrim(r.celulas ->> pl.ix_id), '') end as id_atendimento
    from legado.atendimentos_raw r
    join pl on pl.spreadsheet_id = r.spreadsheet_id
    left join public.fin_cnpj_cadastro cc on cc.spreadsheet_id = r.spreadsheet_id
)
select b.tenant_id,
       b.spreadsheet_id,
       b.linha,
       b.profissional,
       b.nome_abreviado,
       b.ordem,
       b.ativo,
       b.desligada,
       b.erro_sincronizacao,
       b.competencia,
       b.status,
       upper(b.status) = 'OK' as ok,
       b.status = '' as pendente,
       b.c -> 13 as valor_registrado,
       b.valor_planilha,
       b.plano,
       left(b.carteirinha_digitos, 4) as carteirinha_prefixo,
       case when jsonb_typeof(b.c -> 3) = 'object' and (b.c -> 3 ->> '$date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            then left(b.c -> 3 ->> '$date', 10)::date end as data_sessao,
       b.id_atendimento,
       case when b.percentual_cnpj is not null then 'CNPJ' else 'PF' end as tipo,
       b.percentual_cnpj,
       md5(jsonb_build_array(b.c -> 0, b.c -> 2, b.c -> 3, b.c -> 4, b.c -> b.ix_cart, b.c -> b.ix_plano,
                             b.c -> 13, upper(b.status))::text) as impressao,
       res.valor_bruto,
       res.regra,
       res.versao,
       res.repasse_profissional,
       res.percentual_profissional,
       res.parcela_hope,
       res.percentual_hope,
       res.alertas
         || case when jsonb_typeof(b.c -> 13) = 'string' and b.valor_planilha is not null
                 then array['VALOR_EM_TEXTO'] else '{}'::text[] end
         || case when jsonb_typeof(b.c -> 0) = 'string'
                 then array['DATA_LANCAMENTO_TEXTO'] else '{}'::text[] end
         || case when upper(b.status) = 'OK'
                  and not (jsonb_typeof(b.c -> 3) = 'object' and (b.c -> 3 ->> '$date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}')
                 then array['DATA_SESSAO_INVALIDA'] else '{}'::text[] end
         || case when dup.id_atendimento is not null
                 then array['ID_DUPLICADO'] else '{}'::text[] end
         as alertas
  from base b
  left join public.fin_ids_duplicados dup
         on dup.tenant_id = b.tenant_id and dup.id_atendimento = b.id_atendimento
  cross join lateral public.fin_calcular_atendimento(
    b.competencia, b.valor_planilha, b.valor_vazio, b.plano, b.carteirinha_digitos, b.percentual_cnpj
  ) res;

revoke all on table public.fin_atendimentos_calculados from anon, authenticated;

insert into public.db_catalogo_tabelas (esquema, tabela, area, titulo, para_que, origem, usado_em) values
('public', 'fin_ids_duplicados', 'Repasse às psicólogas', 'IDs de atendimento repetidos (leitura)',
 'Lista os ID_ATENDIMENTO que aparecem em mais de uma linha das planilhas (ex.: linha copiada e colada). Vira o alerta ID_DUPLICADO; nada é corrigido sozinho.',
 'Espelho das planilhas (legado.atendimentos_raw)', 'Motor financeiro, Conciliação')
on conflict (esquema, tabela) do nothing;
