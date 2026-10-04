-- =====================================================================
-- Teste local (Postgres 16 descartável) — ORDEM-005 / Bloco 1
-- Esqueleto MÍNIMO das tabelas de produção usadas pelas migrations
-- 033–035, com as MESMAS colunas, tipos, nulidade e defaults lidos do
-- banco de produção em 2026-10-03 (information_schema). Não é o schema
-- completo: só o necessário para provar idempotência e o resultado.
-- NUNCA rodar em produção.
-- =====================================================================
create extension if not exists pgcrypto;
create schema if not exists legado;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  cnpj text,
  created_at timestamptz not null default now(),
  is_internal boolean not null default false,
  plan text,
  billing_status text not null default 'active'
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  visible_in_availability_summary boolean not null default true
);

create table public.professional_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid,
  full_name text not null,
  short_name text,
  crp text,
  cpf text,
  rg text,
  birth_date date,
  approach text,
  pix_key text,
  min_patient_age int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  cpf_encrypted bytea,
  cpf_blind_index text,
  cpf_key_version smallint not null default 1,
  rg_encrypted bytea,
  rg_key_version smallint not null default 1,
  pix_key_encrypted bytea,
  pix_key_key_version smallint not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table legado.planilhas (
  spreadsheet_id text primary key,
  tenant_id uuid not null references public.tenants(id),
  nome_abreviado text not null,
  nome_completo text,
  pix_encrypted bytea,
  aba text,
  cabecalho jsonb,
  total_linhas int,
  ordem int,
  ativo boolean not null default true,
  ultima_sincronizacao timestamptz,
  ultimo_erro text,
  desligada boolean not null default false,
  desligada_em date,
  agenda_sincronizada_em timestamptz,
  agenda_linhas int,
  cancelados_linhas int
);

create table legado.salas_painel (
  linha int primary key,
  celulas jsonb not null,
  sincronizado_em timestamptz not null default now()
);

create table legado.salas_meta (
  id boolean primary key default true check (id),
  cabecalho jsonb not null default '[]'::jsonb,
  sincronizado_em timestamptz not null default now()
);

create table legado.registro_log (
  id bigint generated always as identity primary key,
  tenant_id uuid,
  user_id uuid,
  funcao text not null,
  args jsonb,
  resposta jsonb,
  linhas_espelhadas int not null default 0,
  criado_em timestamptz not null default now()
);

-- Papéis do Supabase (para os GRANT/REVOKE das migrations não falharem)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

-- Mínimo das tabelas que os scripts de ROLLBACK consultam (checagem de uso)
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  professional_id uuid not null references public.professional_profiles(id),
  room_id uuid references public.rooms(id)
);
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  professional_id uuid not null references public.professional_profiles(id)
);
create table public.guides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  professional_id uuid not null references public.professional_profiles(id)
);
