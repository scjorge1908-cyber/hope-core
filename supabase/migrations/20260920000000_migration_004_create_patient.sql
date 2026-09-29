-- ================================================================
-- HOPE CORE — MIGRATION 004 — RPC create_patient
--
-- REGISTRO RETROATIVO: esta função já estava aplicada no banco
-- (projeto clinica-hope-admin) pelo editor SQL, mas nunca tinha sido
-- versionada. Definição copiada de pg_get_functiondef em 29/09/2026.
-- Idempotente (create or replace) — rodar de novo não muda nada.
-- ================================================================

create or replace function public.create_patient(
  p_full_name text,
  p_cpf text default null::text,
  p_birth_date date default null::date,
  p_sex text default null::text,
  p_city text default null::text,
  p_neighborhood text default null::text,
  p_phone text default null::text,
  p_emergency_phone text default null::text,
  p_responsible_name text default null::text,
  p_responsible_cpf text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_tenant_id uuid;
  v_new_id    uuid;
  v_blind     text;
begin
  v_tenant_id := current_tenant_id();
  if v_tenant_id is null then
    raise exception 'Usuário sem tenant associado';
  end if;

  -- Unicidade de CPF por tenant (usa blind index, não texto puro)
  if p_cpf is not null then
    v_blind := hmac_blind_index(p_cpf);
    if exists (
      select 1 from patients
      where tenant_id = v_tenant_id
        and cpf_blind_index = v_blind
    ) then
      raise exception 'Já existe um paciente cadastrado com este CPF';
    end if;
  end if;

  insert into patients (
    tenant_id,
    full_name,
    birth_date,
    sex,
    city,
    neighborhood,
    phone,
    emergency_phone,
    responsible_name,
    cpf_encrypted,
    cpf_blind_index,
    responsible_cpf_encrypted
  ) values (
    v_tenant_id,
    p_full_name,
    p_birth_date,
    p_sex,
    p_city,
    p_neighborhood,
    p_phone,
    p_emergency_phone,
    p_responsible_name,
    case when p_cpf is not null then pgp_encrypt_field(p_cpf) end,
    v_blind,
    case when p_responsible_cpf is not null then pgp_encrypt_field(p_responsible_cpf) end
  )
  returning id into v_new_id;

  return v_new_id;
end;
$function$;

-- Permissões como estão no banco: só usuário logado executa.
revoke execute on function public.create_patient(text, text, date, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_patient(text, text, date, text, text, text, text, text, text, text) to authenticated;
