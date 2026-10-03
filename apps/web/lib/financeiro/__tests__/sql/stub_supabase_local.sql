-- =====================================================================
-- Stub MÍNIMO do Supabase para testar o motor financeiro num Postgres
-- local (teste diferencial motor × RPA). NÃO é aplicado em produção.
-- Recria só o que a migration_030 usa: auth.uid, tenants, users,
-- legado.*, vault, pgcrypto, catálogo e as funções de acesso.
-- =====================================================================
create extension if not exists pgcrypto;
create schema if not exists extensions;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;

create table if not exists public.tenants (id uuid primary key);
create table if not exists public.users (id uuid primary key, tenant_id uuid, active boolean, role text);
create table if not exists public.platform_admins (user_id uuid primary key);
create table if not exists public.audit_log (
  id bigserial primary key, tenant_id uuid, actor_id uuid, action text, entity_table text, entity_id uuid, details jsonb
);
create table if not exists public.db_catalogo_tabelas (
  esquema text, tabela text, area text, titulo text, para_que text, origem text, usado_em text,
  updated_by uuid, updated_at timestamptz not null default now(), primary key (esquema, tabela)
);

create or replace function public.current_tenant_id() returns uuid language sql stable security definer
set search_path = public, pg_temp as $$ select tenant_id from users where id = auth.uid() $$;
create or replace function public.is_platform_admin() returns boolean language sql stable security definer
set search_path = public, pg_temp as $$ select exists (select 1 from platform_admins where user_id = auth.uid()) $$;
create or replace function public.has_finance_access() returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (select 1 from users where id = auth.uid() and active and role in ('owner', 'manager', 'admin_staff'))
$$;
create or replace function public.write_audit_log() returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  insert into audit_log (tenant_id, actor_id, action, entity_table, entity_id, details)
  values (new.tenant_id, auth.uid(), tg_op, tg_table_name, new.id, to_jsonb(new));
  return new;
end $$;

create schema if not exists vault;
create table if not exists vault.decrypted_secrets (name text, decrypted_secret text);

create schema if not exists legado;
create table if not exists legado.config (id boolean primary key default true, tenant_id uuid not null, token_sha256 text not null,
  updated_at timestamptz not null default now());
create table if not exists legado.planilhas (
  spreadsheet_id text primary key, tenant_id uuid not null, nome_abreviado text, nome_completo text, pix_encrypted bytea,
  aba text not null default 'Atendimentos', cabecalho jsonb not null default '[]'::jsonb, total_linhas int not null default 0,
  ordem int, ativo boolean not null default true, ultima_sincronizacao timestamptz, ultimo_erro text,
  desligada boolean not null default false, desligada_em date
);
create table if not exists legado.atendimentos_raw (
  spreadsheet_id text not null, linha int not null, celulas jsonb not null, sincronizado_em timestamptz not null default now(),
  primary key (spreadsheet_id, linha)
);
create table if not exists legado.exencoes (
  linha int primary key, psicologa_id jsonb, cnpj jsonb, percentual jsonb, sincronizado_em timestamptz not null default now()
);

-- cópias exatas das funções de produção usadas pelo motor
create or replace function legado.rpa_normalizar_cabecalho(p text) returns text language sql immutable
set search_path to 'pg_catalog', 'pg_temp' as $function$
  select upper(btrim(translate(coalesce(p, ''),
    'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN')))
$function$;
create or replace function legado.rpa_indice_carteirinha(p_cabecalho jsonb) returns integer language sql immutable
set search_path to 'legado', 'pg_catalog', 'pg_temp' as $function$
  select coalesce((
           select (h.ord - 1)::int
             from jsonb_array_elements_text(case when jsonb_typeof(p_cabecalho) = 'array' then p_cabecalho else '[]'::jsonb end)
                  with ordinality h(txt, ord)
            where legado.rpa_normalizar_cabecalho(h.txt) like '%CART%'
            order by h.ord
            limit 1
         ), 11)
$function$;

-- versão anterior de db_somente_leitura (a migration substitui)
create or replace function public.db_somente_leitura(p_esquema text, p_tabela text, p_kind "char")
returns boolean language sql immutable set search_path = pg_temp as $$ select p_kind <> 'r' $$;
