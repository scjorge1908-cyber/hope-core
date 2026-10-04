#!/usr/bin/env bash
# Teste LOCAL do Bloco 1 (ORDEM-005). Usa um Postgres descartável — nunca produção.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres ./run.sh
set -euo pipefail
cd "$(dirname "$0")"
MIG=../../migrations
RB=../../rollbacks
DB=hc_bloco1_test
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="psql -q -v ON_ERROR_STOP=1 -d $DB"
$P -f 00_stub_schema.sql
$P -f 01_fixture_anonimizada.sql
$P -f $MIG/20261004100000_migration_033_bootstrap_rooms.sql
$P -f $MIG/20261004100100_migration_034_bootstrap_professional_profiles.sql
$P -f $MIG/20261004100200_migration_035_vw_room_blocks.sql
# reaplicar as migrations não pode falhar (idempotência de DDL)
$P -f $MIG/20261004100000_migration_033_bootstrap_rooms.sql
$P -f $MIG/20261004100100_migration_034_bootstrap_professional_profiles.sql
$P -f $MIG/20261004100200_migration_035_vw_room_blocks.sql
$P -f 02_testes.sql
python3 03_ilhas_independente.py | $P -f -
# R0: rollback 034 tem de ABORTAR (sem apagar nada) se um perfil do bootstrap estiver em uso
$P -c "insert into public.sessions (tenant_id, professional_id) select tenant_id, professional_profile_id from legado.planilhas where professional_profile_id is not null limit 1"
if $P -f $RB/rollback_034_bootstrap_professional_profiles.sql 2>/dev/null; then echo "R0 FALHOU: rollback não abortou com perfil em uso"; exit 1; fi
N=$($P -tAc "select count(*) from public.professional_profiles")
[ "$N" = "24" ] || { echo "R0 FALHOU: rollback abortado apagou perfis ($N)"; exit 1; }
$P -c "delete from public.sessions"
echo "R0 OK: rollback 034 recusa perfil em uso e não apaga nada"
$P -f 04_rollback.sql
echo "TODOS OS TESTES PASSARAM"
