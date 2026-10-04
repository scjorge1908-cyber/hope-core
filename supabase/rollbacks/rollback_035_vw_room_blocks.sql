-- ROLLBACK da migration_035. Só leitura derivada: nenhum dado é perdido.
-- Ordem de rollback do Bloco 1: 035 → 034 → 033.
drop view if exists legado.vw_room_blocks;
