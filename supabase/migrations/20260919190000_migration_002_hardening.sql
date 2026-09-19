-- ================================================================
-- HOPE CORE — MIGRATION 002 — HARDENING
-- Depende da migration 001.
-- ================================================================

create extension if not exists pgcrypto;
create extension if not exists vault;
create extension if not exists btree_gist;

-- ================================================================
-- 4. PLATFORM ADMIN (fora do isolamento de tenant)
-- ================================================================

create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 17. tenants.is_internal / plan / billing_status
alter table tenants
  add column if not exists is_internal boolean not null default false,
  add column if not exists plan text,
  add column if not exists billing_status text not null default 'active';

-- ================================================================
-- 2. current_tenant_id() security definer / 4. is_platform_admin()
-- ================================================================

create or replace function current_tenant_id()
returns uuid
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select tenant_id from users where id = auth.uid()
$$;

create or replace function is_platform_admin()
returns boolean
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from platform_admins where user_id = auth.uid())
$$;

-- ================================================================
-- 11. Funções de criptografia (chave em vault.secrets)
-- Segredos esperados no Vault (criar fora desta migration):
--   'hope_core_field_enc_key'   -> valor
--   'hope_core_blind_index_key' -> HMAC (só CPF)
-- ================================================================

create or replace function pgp_encrypt_field(plaintext text)
returns bytea
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  if plaintext is null then return null; end if;
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'hope_core_field_enc_key';
  if v_key is null then
    raise exception 'Chave de criptografia não configurada no Vault';
  end if;
  return pgp_sym_encrypt(plaintext, v_key);
end;
$$;

create or replace function pgp_decrypt_field(ciphertext bytea)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  if ciphertext is null then return null; end if;
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'hope_core_field_enc_key';
  if v_key is null then
    raise exception 'Chave de criptografia não configurada no Vault';
  end if;
  return pgp_sym_decrypt(ciphertext, v_key);
end;
$$;

create or replace function hmac_blind_index(plaintext text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  if plaintext is null then return null; end if;
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'hope_core_blind_index_key';
  if v_key is null then
    raise exception 'Chave de blind index não configurada no Vault';
  end if;
  return encode(hmac(plaintext, v_key, 'sha256'), 'hex');
end;
$$;

-- ================================================================
-- 10. Colunas criptografadas
-- Padrão: *_encrypted + *_key_version sempre.
-- *_blind_index só onde precisa unicidade/busca exata (CPF).
-- ================================================================

-- patients --------------------------------------------------------
alter table patients
  add column if not exists cpf_encrypted bytea,
  add column if not exists cpf_blind_index text,
  add column if not exists cpf_key_version smallint not null default 1,
  add column if not exists responsible_cpf_encrypted bytea,
  add column if not exists responsible_cpf_key_version smallint not null default 1;

comment on column patients.cpf is
  'DEPRECATED — dado real vive em cpf_encrypted. Mantida até backfill; não usar em código novo.';

create unique index if not exists idx_patients_cpf_blind
  on patients(tenant_id, cpf_blind_index) where cpf_blind_index is not null;

-- professional_profiles --------------------------------------------
alter table professional_profiles
  add column if not exists cpf_encrypted bytea,
  add column if not exists cpf_blind_index text,
  add column if not exists cpf_key_version smallint not null default 1,
  add column if not exists rg_encrypted bytea,
  add column if not exists rg_key_version smallint not null default 1,
  add column if not exists pix_key_encrypted bytea,
  add column if not exists pix_key_key_version smallint not null default 1;

comment on column professional_profiles.cpf is 'DEPRECATED — ver cpf_encrypted.';
comment on column professional_profiles.rg is 'DEPRECATED — ver rg_encrypted.';
comment on column professional_profiles.pix_key is 'DEPRECATED — ver pix_key_encrypted.';

create unique index if not exists idx_professionals_cpf_blind
  on professional_profiles(tenant_id, cpf_blind_index) where cpf_blind_index is not null;

-- guides — patient_name (única coluna real de guides a criptografar) --
alter table guides
  add column if not exists patient_id uuid references patients(id),
  add column if not exists patient_name_encrypted bytea,
  add column if not exists patient_name_key_version smallint not null default 1;

comment on column guides.patient_name is 'DEPRECATED — ver patient_name_encrypted.';

-- insurance_claim_returns — completar ficha real + criptografia -------
alter table insurance_claim_returns
  add column if not exists guide_id uuid references guides(id),
  add column if not exists auth_password text,
  add column if not exists card_number text,
  add column if not exists billing_start_date date,
  add column if not exists billing_start_time time,
  add column if not exists billing_end_date date,
  add column if not exists billing_end_time time,
  add column if not exists guide_situation text,
  add column if not exists contracted_party text,
  add column if not exists beneficiary_name_encrypted bytea,
  add column if not exists beneficiary_name_key_version smallint not null default 1,
  add column if not exists card_number_encrypted bytea,
  add column if not exists card_number_key_version smallint not null default 1,
  add column if not exists auth_password_encrypted bytea,
  add column if not exists auth_password_key_version smallint not null default 1;

comment on column insurance_claim_returns.beneficiary_name is 'DEPRECATED — ver beneficiary_name_encrypted.';
comment on column insurance_claim_returns.card_number is 'DEPRECATED — ver card_number_encrypted.';
comment on column insurance_claim_returns.auth_password is 'DEPRECATED — ver auth_password_encrypted.';

-- appointments — CID: dívida técnica declarada -------------------
comment on column appointments.cid_code is
  'DÍVIDA TÉCNICA: RLS-only por ora — dado clínico sensível sem criptografia de coluna. '
  'Motivo: precisa permanecer filtrável/agrupável em relatório clínico; criptografia '
  'não-determinística inviabilizaria isso sem esquema de busca dedicado (fora de escopo). '
  'Resolver antes de produção com dado real de paciente.';

-- ================================================================
-- 8/9. Snapshots imutáveis
-- ================================================================

alter table document_declarations
  add column if not exists consultation_date date,
  add column if not exists consultation_time time,
  add column if not exists professional_name_snapshot text,
  add column if not exists professional_crp_snapshot text,
  add column if not exists clinic_name_snapshot text,
  add column if not exists clinic_cnpj_snapshot text;

alter table fiscal_documents
  add column if not exists professional_name_snapshot text,
  add column if not exists professional_cpf_encrypted bytea,
  add column if not exists professional_cpf_key_version smallint not null default 1,
  add column if not exists pix_key_encrypted bytea,
  add column if not exists pix_key_key_version smallint not null default 1,
  add column if not exists gross_value_snapshot numeric(10,2),
  add column if not exists net_value_snapshot numeric(10,2),
  add column if not exists inss_deduction_snapshot numeric(10,2),
  add column if not exists clinic_name_snapshot text,
  add column if not exists clinic_cnpj_snapshot text;

comment on table professional_credentials is
  'Sem snapshot: armazena o arquivo-fonte (RG/diploma), não documento gerado de dado derivado.';

-- ================================================================
-- 6/7. FK real insurance_claim_returns -> guides + índices
-- ================================================================

create index if not exists idx_claim_returns_guide_id on insurance_claim_returns(guide_id);
create index if not exists idx_claim_returns_provider_number
  on insurance_claim_returns(tenant_id, provider_guide_number);

-- ================================================================
-- 12. Constraints de unicidade / integridade
-- ================================================================

alter table payouts
  add constraint uq_payouts_professional_month_year
  unique (tenant_id, professional_id, reference_month, reference_year);

create unique index if not exists idx_appt_unique_recurring
  on appointments(tenant_id, room_id, weekday, start_time)
  where scheduled_date is null and status = 'scheduled';

create unique index if not exists idx_appt_unique_dated
  on appointments(tenant_id, room_id, scheduled_date, start_time)
  where scheduled_date is not null and status = 'scheduled';

create unique index if not exists idx_sessions_unique_appointment
  on sessions(appointment_id) where appointment_id is not null;

alter table payout_rules
  add constraint excl_payout_rules_overlap
  exclude using gist (
    tenant_id with =,
    professional_id with =,
    daterange(valid_from, coalesce(valid_until, 'infinity'::date), '[]') with &&
  );

-- ================================================================
-- 13. Trigger set_updated_at
-- ================================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table patients add column if not exists updated_at timestamptz not null default now();
alter table professional_profiles add column if not exists updated_at timestamptz not null default now();
alter table sessions add column if not exists updated_at timestamptz not null default now();

do $$
declare
  t text;
begin
  foreach t in array array['appointments','guides','patients','professional_profiles','sessions']
  loop
    execute format(
      'drop trigger if exists trg_set_updated_at on %I;
       create trigger trg_set_updated_at before update on %I
       for each row execute function set_updated_at();', t, t
    );
  end loop;
end $$;

-- ================================================================
-- 15. Soft delete
-- ================================================================

alter table patients add column if not exists deleted_at timestamptz;
alter table professional_profiles add column if not exists deleted_at timestamptz;
alter table appointments add column if not exists deleted_at timestamptz;
alter table sessions add column if not exists deleted_at timestamptz;

comment on column patients.deleted_at is
  'Soft delete — dado de saúde pode ter obrigação legal de retenção; nunca hard delete sem checar prazo.';

-- ================================================================
-- 14. Trigger de audit_log — lista corrigida (9 tabelas)
-- patients, professional_profiles, appointments, sessions, guides,
-- payouts, fiscal_documents, document_declarations, insurance_claim_returns
-- ================================================================

create or replace function write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);
  insert into audit_log (tenant_id, actor_id, action, entity_table, entity_id, details)
  values (
    v_tenant_id,
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(new.id, old.id),
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
  audited_tables text[] := array[
    'patients','professional_profiles','appointments','sessions','guides',
    'payouts','fiscal_documents','document_declarations','insurance_claim_returns'
  ];
begin
  foreach t in array audited_tables
  loop
    execute format(
      'drop trigger if exists trg_audit_log on %I;
       create trigger trg_audit_log after insert or update or delete on %I
       for each row execute function write_audit_log();', t, t
    );
  end loop;
end $$;

-- ================================================================
-- 16. Índices de performance
-- ================================================================

create index if not exists idx_payouts_lookup
  on payouts(tenant_id, professional_id, reference_month, reference_year);

create index if not exists idx_guides_status
  on guides(tenant_id, status);

create index if not exists idx_patients_cpf_blind_lookup
  on patients(tenant_id, cpf_blind_index);

create index if not exists idx_professionals_cpf_blind_lookup
  on professional_profiles(tenant_id, cpf_blind_index);

-- ================================================================
-- 1/3. RLS em todas as tabelas — tenants e users com policy especial
-- ================================================================

alter table tenants enable row level security;
create policy tenant_self_access on tenants
  using (id = current_tenant_id() or is_platform_admin())
  with check (is_platform_admin());

alter table users enable row level security;
create policy users_tenant_access on users
  using (tenant_id = current_tenant_id() or is_platform_admin())
  with check (tenant_id = current_tenant_id() or is_platform_admin());

alter table platform_admins enable row level security;
create policy platform_admins_self_only on platform_admins
  using (is_platform_admin())
  with check (is_platform_admin());

do $$
declare
  t text;
  standard_tables text[] := array[
    'professional_profiles','professional_credentials','patients',
    'insurance_plans','rooms','appointments',
    'professional_availability_blocks','waitlist_entries','sessions',
    'guides','guide_status_overrides','insurance_claim_returns',
    'payout_rules','payouts','fiscal_documents','document_declarations',
    'notifications','audit_log'
  ];
begin
  foreach t in array standard_tables
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'drop policy if exists tenant_isolation_%1$s on %1$s;
       create policy tenant_isolation_%1$s on %1$s
         using (tenant_id = current_tenant_id() or is_platform_admin())
         with check (tenant_id = current_tenant_id() or is_platform_admin());',
      t
    );
  end loop;
end $$;

-- audit_log: sem policy de INSERT — única via de escrita é o trigger
-- write_audit_log (security definer), que bypassa RLS naturalmente.

-- ================================================================
-- FIM. Pendência fora deste arquivo: criar os segredos no Vault
-- ('hope_core_field_enc_key', 'hope_core_blind_index_key') e rodar
-- o backfill de dado (não-schema) para *_encrypted/*_blind_index.
-- ================================================================
