-- =====================================================================
-- ROLLBACK da migration_033 (bootstrap de salas). Rodar no SQL Editor
-- (contém DELETE: o conector MCP bloqueia).
-- Ordem do Bloco 1: rollback 035 → 034 → 033.
--
-- Apaga SÓ as salas cujos IDs o bootstrap registrou em legado.registro_log
-- (funcao = 'bootstrap_rooms_from_legado'). Salas cadastradas à mão,
-- mesmo com o mesmo nome, ficam. Se alguma sala do bootstrap já estiver
-- em uso por appointments, ABORTA sem apagar nada.
-- =====================================================================
begin;

create temporary table _rb_salas on commit drop as
  select distinct (x->>'id')::uuid as id
    from legado.registro_log l, jsonb_array_elements(l.resposta->'inseridas') x
   where l.funcao = 'bootstrap_rooms_from_legado';

do $$
declare v_em_uso int;
begin
  select count(*) into v_em_uso
    from public.appointments a where a.room_id in (select id from _rb_salas);
  if v_em_uso > 0 then
    raise exception 'Rollback abortado: salas do bootstrap usadas em % appointment(s)', v_em_uso;
  end if;
end $$;

delete from public.rooms where id in (select id from _rb_salas);

insert into legado.registro_log (funcao, args, resposta, linhas_espelhadas)
select 'rollback_033_bootstrap_rooms', null, jsonb_build_object('apagadas', coalesce(jsonb_agg(id), '[]'::jsonb)), count(*)::int
  from _rb_salas;

drop function if exists public.bootstrap_rooms_from_legado(boolean);
drop function if exists legado.sala_chave(text);   -- a view 035 depende dela: rode o rollback 035 antes

commit;
