-- ================================================================
-- HOPE CORE — MIGRATION 003 — CORRIGE SEARCH PATH DAS FUNÇÕES CRYPTO
-- Problema: hmac(), pgp_sym_encrypt(), pgp_sym_decrypt() estão no
-- schema 'extensions' (não 'public'). As funções criadas na 002 têm
-- set search_path = public, pg_temp — sem 'extensions', as chamadas
-- falham com "function hmac(text, text, unknown) does not exist".
-- Solução: adicionar 'extensions' ao search_path das 3 funções.
-- ================================================================

create or replace function pgp_encrypt_field(plaintext text)
returns bytea
language plpgsql
security definer
set search_path = public, extensions, pg_temp
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
set search_path = public, extensions, pg_temp
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
set search_path = public, extensions, pg_temp
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
