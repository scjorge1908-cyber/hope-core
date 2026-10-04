-- Executa os 3 rollbacks na ordem 035 → 034 → 033 e confere o estado final.
\set ON_ERROR_STOP 1
\i ../../rollbacks/rollback_035_vw_room_blocks.sql
\i ../../rollbacks/rollback_034_bootstrap_professional_profiles.sql
\i ../../rollbacks/rollback_033_bootstrap_rooms.sql
do $$
declare n int;
begin
  select count(*) into n from public.rooms where name <> '  SALA 507   CONSULTÓRIO 5 ';
  if n <> 0 then raise exception 'R1: sobraram % salas', n; end if;
  select count(*) into n from public.professional_profiles;
  if n <> 0 then raise exception 'R2: sobraram % perfis', n; end if;
  select count(*) into n from information_schema.columns where table_schema = 'legado' and table_name = 'planilhas' and column_name = 'professional_profile_id';
  if n <> 0 then raise exception 'R3: coluna de vínculo não removida'; end if;
  select count(*) into n from pg_proc where proname in ('bootstrap_rooms_from_legado', 'bootstrap_professional_profiles_from_legado', 'sala_chave');
  if n <> 0 then raise exception 'R4: funções não removidas'; end if;
  select count(*) into n from legado.planilhas;
  if n <> 24 then raise exception 'R5: legado.planilhas alterada (% linhas)', n; end if;
  raise notice 'R OK: rollback 035→034→033 limpa tudo e preserva o legado';
end $$;
