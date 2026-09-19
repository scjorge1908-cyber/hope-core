-- ================================================================
-- HOPE CORE — SCHEMA INICIAL (migration 001)
-- Multi-tenant (schema compartilhado + RLS por tenant_id)
-- Consolida: Hope Painel, Sistema Unificado PSI, Gestão de Salas,
-- Sistema Mestre RPA, ADM Registro de Guia, Bradesco Token,
-- Faturamento Guia, Gestão de RPA, Corpo Clínico, Novo Paciente,
-- Gerador de Declaração, Validação de Guias (Unimed)
-- ================================================================

create extension if not exists "pgcrypto";

-- ================================================================
-- MÓDULO: TENANTS E IDENTIDADE
-- Resolve: ~15 cópias divergentes da tabela nome↔ID de profissional
-- espalhadas pelo ecossistema legado (Hope Painel, Gestão de Salas,
-- RPA Mestre, ADM Registro de Guia, Bradesco Token, Faturamento
-- Guia, Gestão de RPA, Corpo Clínico, Gerador de Declaração,
-- Validação de Guias, entre outras) — aqui vira fonte única.
-- ================================================================

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  cnpj text,
  created_at timestamptz not null default now()
);

create type user_role as enum ('owner', 'manager', 'admin_staff', 'professional');

-- Espelha auth.users do Supabase Auth (id = auth.users.id)
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  role user_role not null,
  full_name text not null,
  email text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_users_tenant on users(tenant_id);

-- Substitui DadosPsi (por psicóloga) + Corpo Clínico (CPF/RG/diploma)
-- num único cadastro profissional por tenant.
create table professional_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  full_name text not null,
  short_name text,               -- "nomeAbreviado" visto no legado
  crp text,
  cpf text,                      -- sensível — proteger via RLS/coluna criptografada
  rg text,                       -- sensível
  birth_date date,
  approach text,                 -- abordagem terapêutica
  pix_key text,                  -- sensível
  min_patient_age int,           -- "idade de atendimento" visto em várias cópias legadas
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_prof_tenant on professional_profiles(tenant_id);

-- Substitui os anexos RG/Diploma do Corpo Clínico
create table professional_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  professional_id uuid not null references professional_profiles(id) on delete cascade,
  doc_type text not null,        -- 'RG' | 'DIPLOMA' | outro
  storage_path text not null,    -- Supabase Storage — arquivo ORIGINAL, sem recompressão destrutiva
  legacy_drive_url text,         -- ponte pra migração gradual do histórico
  uploaded_at timestamptz not null default now()
);

-- ================================================================
-- MÓDULO: PACIENTES, CONVÊNIOS, SALAS
-- ================================================================

create table patients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  full_name text not null,
  cpf text,
  birth_date date,
  sex text,
  city text,
  neighborhood text,
  phone text,
  emergency_phone text,
  responsible_name text,
  responsible_cpf text,
  created_at timestamptz not null default now()
);

create index idx_patients_tenant on patients(tenant_id);

create table insurance_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,            -- ex: "Bradesco", "Unimed"
  session_value numeric(10,2),
  requires_weekly_auth_token boolean not null default false, -- regra Bradesco generalizada
  weekly_session_limit int,      -- regra "2x/semana Bradesco" generalizada
  active boolean not null default true
);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,            -- ex: "311-1"
  visible_in_availability_summary boolean not null default true
);

-- ================================================================
-- MÓDULO: AGENDA
-- Substitui as ~20+ abas "Agenda" divergentes (31 a 38 colunas cada)
-- por um schema único e travado.
-- ================================================================

create type appointment_status as enum ('scheduled', 'cancelled', 'discharged', 'transferred');

create table appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  professional_id uuid not null references professional_profiles(id),
  patient_id uuid not null references patients(id),
  room_id uuid references rooms(id),
  insurance_plan_id uuid references insurance_plans(id),
  weekday int,                    -- 0-6, facilita view de Gestão de Salas
  start_time time not null,
  scheduled_date date,            -- null = horário fixo recorrente
  status appointment_status not null default 'scheduled',
  insurance_card_number text,
  physician_name text,
  physician_crm text,
  cid_code text,                  -- dado clínico sensível
  attachment_card_path text,
  attachment_guide_path text,
  attachment_rg_path text,
  admin_notes text,
  admin_block boolean not null default false,
  admin_block_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_appt_tenant on appointments(tenant_id);
create index idx_appt_professional on appointments(professional_id);
create index idx_appt_room_day on appointments(room_id, weekday, start_time);

create table professional_availability_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  professional_id uuid not null references professional_profiles(id),
  start_date date not null,
  end_date date not null,
  reason text
);

create table waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  patient_name text not null,
  patient_phone text,
  preferred_weekday int,
  preferred_period text,          -- manhã/tarde/noite
  min_age int,
  created_at timestamptz not null default now(),
  matched_appointment_id uuid references appointments(id)
);

-- ================================================================
-- MÓDULO: ATENDIMENTOS / SESSÕES E GUIAS TISS
-- Substitui a aba "Atendimentos" de cada psicóloga + BD_GUIAS
-- central + XML_Import/XML_Consolidado da Validação de Guias.
-- status é ENUM controlado — elimina o bug de texto livre
-- ("OK"/"ok"/"Faturada") que causava divergência entre RPA Mestre,
-- ADM Registro de Guia e Validação de Guias.
-- ================================================================

create type billing_status as enum (
  'not_billed', 'billed', 'awaiting_operator', 'paid', 'glossed', 'missed'
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  appointment_id uuid references appointments(id),
  professional_id uuid not null references professional_profiles(id),
  patient_id uuid not null references patients(id),
  session_date date not null,
  session_type text,
  insurance_plan_id uuid references insurance_plans(id),
  value numeric(10,2),
  billing_status billing_status not null default 'not_billed',
  created_at timestamptz not null default now()
);

create index idx_sessions_tenant on sessions(tenant_id);
create index idx_sessions_professional on sessions(professional_id);

create type guide_status as enum (
  'registered', 'billed', 'missing_registration', 'missed', 'glossed', 'glossed_pending', 'excluded'
);

create table guides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  session_id uuid references sessions(id),
  professional_id uuid not null references professional_profiles(id),
  patient_name text not null,      -- mantido além de patient_id p/ conciliação com operadora
  provider_guide_number text,
  operator_guide_number text,
  status guide_status not null default 'registered',
  informed_value numeric(10,2),
  released_value numeric(10,2),
  gloss_value numeric(10,2),
  gloss_type text,
  attachment_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_guides_tenant on guides(tenant_id);
create unique index idx_guides_provider_number on guides(tenant_id, provider_guide_number) where provider_guide_number is not null;

-- Substitui os manuais Ajustes_Manuais da Validação de Guias —
-- vira trilha nativa em vez de aba à parte.
create table guide_status_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  guide_id uuid not null references guides(id) on delete cascade,
  previous_status guide_status,
  new_status guide_status not null,
  note text,
  overridden_by uuid references users(id),
  overridden_at timestamptz not null default now()
);

-- Substitui XML_Import — retorno bruto do demonstrativo da operadora
create table insurance_claim_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  insurance_plan_id uuid references insurance_plans(id),
  provider_guide_number text,
  operator_guide_number text,
  beneficiary_name text,
  card_number text,
  informed_value numeric(10,2),
  processed_value numeric(10,2),
  released_value numeric(10,2),
  gloss_value numeric(10,2),
  gloss_type text,
  statement_number text,
  statement_emission_date date,
  source_file text,
  realization_date date,
  imported_at timestamptz not null default now()
);

-- ================================================================
-- MÓDULO: FINANCEIRO / REPASSE
-- Fonte única — resolve a divergência real encontrada no inventário
-- (40% bruto − INSS no RPA Mestre vs. 60/40 no Faturamento Guia).
-- payout_rules é config por profissional, não mais hardcoded no
-- código (ex: nomes "LANA"/"SUELLEN" hardcoded no legado).
-- ================================================================

create table payout_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  professional_id uuid not null references professional_profiles(id),
  is_cnpj boolean not null default false,
  cnpj_percentage numeric(5,2),        -- se is_cnpj = true
  pf_percentage numeric(5,2) default 40.00,
  inss_percentage numeric(5,2) default 11.00,
  inss_ceiling_value numeric(10,2) default 7786.02,
  valid_from date not null default current_date,
  valid_until date
);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  professional_id uuid not null references professional_profiles(id),
  reference_month int not null,
  reference_year int not null,
  gross_value numeric(10,2) not null,
  inss_deduction numeric(10,2) default 0,
  net_value numeric(10,2) not null,
  calculated_at timestamptz not null default now(),
  calculated_by uuid references users(id)
);

create table fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  professional_id uuid not null references professional_profiles(id),
  payout_id uuid references payouts(id),
  doc_type text not null,           -- 'RPA' | 'NOTA'
  storage_path text,
  legacy_drive_url text,
  reference_month int,
  reference_year int,
  sent_at timestamptz
);

-- ================================================================
-- MÓDULO: DOCUMENTOS/DECLARAÇÕES
-- Substitui o Gerador de Declaração — hash de verificação passa a
-- ser gerado no servidor (uuid real), não mais Math.random() no
-- navegador.
-- ================================================================

create table document_declarations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  verification_code uuid not null default gen_random_uuid(),
  declaration_type text not null,   -- 'attendance' | 'companion'
  appointment_id uuid references appointments(id),
  patient_name text not null,
  professional_id uuid not null references professional_profiles(id),
  companion_name text,
  entry_time time,
  exit_time time,
  storage_path text,
  generated_at timestamptz not null default now(),
  generated_by uuid references users(id)
);

create unique index idx_declaration_verification on document_declarations(verification_code);

-- ================================================================
-- MÓDULO: NOTIFICAÇÕES E AUDITORIA
-- Substitui a planilha externa de notificações do Hope Painel e a
-- lógica duplicada de alerta do sistema "Novo Paciente".
-- ================================================================

create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  appointment_id uuid references appointments(id),
  professional_id uuid references professional_profiles(id),
  kind text not null,               -- 'new_appointment' | 'transfer' | 'guide_pending' | etc
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_id uuid references users(id),
  action text not null,
  entity_table text not null,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_tenant on audit_log(tenant_id, created_at desc);

-- ================================================================
-- ROW LEVEL SECURITY
-- Padrão: toda tabela filtra por tenant_id = tenant do usuário logado
-- ================================================================

create or replace function current_tenant_id()
returns uuid
language sql stable
as $$
  select tenant_id from users where id = auth.uid()
$$;

-- Exemplo de política — repetir para cada tabela acima
alter table patients enable row level security;
create policy tenant_isolation_patients on patients
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table appointments enable row level security;
create policy tenant_isolation_appointments on appointments
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

alter table professional_profiles enable row level security;
create policy tenant_isolation_professionals on professional_profiles
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

-- TODO: aplicar a mesma política tenant_isolation_<tabela> em todas
-- as demais tabelas com tenant_id antes de ir para produção.
