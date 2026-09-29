-- ================================================================
-- HOPE CORE — MIGRATION 007 — LIMITE DE TEMPO DA IMPORTAÇÃO
-- Depende da migration 006.
--
-- O papel `authenticated` tem statement_timeout = 8s (padrão Supabase).
-- No plano gratuito, logo após o projeto ser religado, o mesmo import
-- de ~350 sessões variou de 0,7 s a 7,4 s (CPU do servidor), e a primeira
-- tentativa pela página estourou o limite.
--
-- O PostgREST aplica o statement_timeout configurado NA FUNÇÃO quando
-- ela é chamada via RPC. Damos 60 s só à importação — o resto da API
-- continua com 8 s.
-- ================================================================

alter function import_claim_statement(jsonb) set statement_timeout = '60s';
