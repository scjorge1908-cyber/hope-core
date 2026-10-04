-- =====================================================================
-- ROLLBACK da migration_034 (bootstrap de psicólogas). SQL Editor.
-- Ordem do Bloco 1: rollback 035 → 034 → 033.
--
-- • Perfis CRIADOS pelo bootstrap (IDs em legado.registro_log,
--   funcao = 'bootstrap_professional_profiles_from_legado', chave
--   'criados') são apagados — só se nenhum estiver em uso (user_id,
--   appointments, sessions, guides). Em uso → ABORTA sem apagar nada.
-- • Perfis que já existiam e foram só VINCULADOS ficam intactos.
-- • Depois remove a coluna de vínculo, o índice e a função.
-- =====================================================================
begin;

create temporary table _rb_perfis on commit drop as
  select distinct (x #>> '{}')::uuid as id
    from legado.registro_log l, jsonb_array_elements(l.resposta->'criados') x
   where l.funcao = 'bootstrap_professional_profiles_from_legado';

do $$
declare v_em_uso int;
begin
  select count(*) into v_em_uso
    from public.professional_profiles pp
   where pp.id in (select id from _rb_perfis)
     and (pp.user_id is not null
          or exists (select 1 from public.appointments a where a.professional_id = pp.id)
          or exists (select 1 from public.sessions s where s.professional_id = pp.id)
          or exists (select 1 from public.guides g where g.professional_id = pp.id));
  if v_em_uso > 0 then
    raise exception 'Rollback abortado: % perfil(is) do bootstrap já em uso', v_em_uso;
  end if;
end $$;

update legado.planilhas set professional_profile_id = null where professional_profile_id is not null;
delete from public.professional_profiles where id in (select id from _rb_perfis);

insert into legado.registro_log (funcao, args, resposta, linhas_espelhadas)
select 'rollback_034_bootstrap_professional_profiles', null,
       jsonb_build_object('apagados', coalesce(jsonb_agg(id), '[]'::jsonb)), count(*)::int
  from _rb_perfis;

drop function if exists public.bootstrap_professional_profiles_from_legado(boolean);
drop index if exists legado.planilhas_professional_profile_uidx;
alter table legado.planilhas drop column if exists professional_profile_id;   -- a view 035 lê esta coluna: rode o rollback 035 antes

commit;
