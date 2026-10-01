-- =====================================================================
-- migration_026 — "Banco de dados" dentro do HOPE CORE
--   Tela que mostra TODAS as tabelas reais do Supabase (schemas public e
--   legado), com descrição (para que serve, de onde vêm os dados, quem usa),
--   colunas, relações, e uma grade estilo Excel para ver, criar, editar e
--   excluir linhas direto no banco.
--   • A lista de tabelas é lida do próprio Postgres: tabela nova aparece
--     sozinha. As descrições ficam em db_catalogo_tabelas / _colunas
--     (editáveis na tela; toda migration nova que cria tabela deve inserir
--     a descrição dela aqui).
--   • Só o DONO (users.role = 'owner') abre e edita.
--   • Tabelas com tenant_id: só as linhas da clínica do usuário.
--   • Toda alteração fica registrada em db_alteracoes (antes/depois).
--   • Somente leitura: visões, logs, usuários/tenants, config e o próprio
--     catálogo/auditoria. Colunas criptografadas (bytea) nunca são exibidas
--     nem editadas.
-- =====================================================================

create table if not exists public.db_catalogo_tabelas (
  esquema text not null,
  tabela text not null,
  area text,
  titulo text,
  para_que text,
  origem text,
  usado_em text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (esquema, tabela)
);

create table if not exists public.db_catalogo_colunas (
  esquema text not null,
  tabela text not null,
  coluna text not null,
  descricao text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (esquema, tabela, coluna)
);

create table if not exists public.db_alteracoes (
  id bigint generated always as identity primary key,
  tenant_id uuid,
  user_id uuid,
  feito_em timestamptz not null default now(),
  esquema text not null,
  tabela text not null,
  operacao text not null check (operacao in ('inserir', 'editar', 'excluir')),
  chave jsonb,
  antes jsonb,
  depois jsonb
);
create index if not exists idx_db_alteracoes_tabela on public.db_alteracoes (esquema, tabela, feito_em desc);

alter table public.db_catalogo_tabelas enable row level security;
alter table public.db_catalogo_colunas enable row level security;
alter table public.db_alteracoes enable row level security;
revoke all on public.db_catalogo_tabelas, public.db_catalogo_colunas, public.db_alteracoes from anon, authenticated;

-- ---------- quem pode ----------
create or replace function public.db_e_dono()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from users where id = auth.uid() and active and role = 'owner')
$$;
revoke execute on function public.db_e_dono() from public, anon;
grant execute on function public.db_e_dono() to authenticated;

-- tabela permitida? devolve o oid (ou erro)
create or replace function public.db_alvo(p_esquema text, p_tabela text)
returns oid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_oid oid;
begin
  if not public.db_e_dono() then
    raise exception 'Só o dono da clínica acessa o banco de dados' using errcode = '42501';
  end if;
  if p_esquema not in ('public', 'legado') then
    raise exception 'Esquema não permitido';
  end if;
  select c.oid into v_oid
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = p_esquema and c.relname = p_tabela and c.relkind in ('r', 'v', 'm', 'p');
  if v_oid is null then
    raise exception 'Tabela não encontrada: %.%', p_esquema, p_tabela;
  end if;
  return v_oid;
end;
$$;
revoke execute on function public.db_alvo(text, text) from public, anon, authenticated;

-- somente leitura?
create or replace function public.db_somente_leitura(p_esquema text, p_tabela text, p_kind "char")
returns boolean
language sql
immutable
set search_path = pg_temp
as $$
  select p_kind <> 'r'
      or (p_esquema, p_tabela) in (
           ('public', 'audit_log'), ('public', 'users'), ('public', 'tenants'), ('public', 'platform_admins'),
           ('public', 'db_alteracoes'), ('public', 'db_catalogo_tabelas'), ('public', 'db_catalogo_colunas'),
           ('legado', 'config'), ('legado', 'sync_log'), ('legado', 'registro_log'))
$$;

-- ---------- catálogo: lista de tabelas ----------
create or replace function public.db_catalogo()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_out jsonb := '[]'::jsonb;
  v_n bigint;
  v_tenant boolean;
begin
  if not public.db_e_dono() then
    raise exception 'Só o dono da clínica acessa o banco de dados' using errcode = '42501';
  end if;
  for r in
    select n.nspname as esquema, c.relname as tabela, c.relkind as kind, c.oid,
           obj_description(c.oid, 'pg_class') as comentario,
           d.area, d.titulo, d.para_que, d.origem, d.usado_em
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      left join public.db_catalogo_tabelas d on d.esquema = n.nspname and d.tabela = c.relname
     where n.nspname in ('public', 'legado') and c.relkind in ('r', 'v', 'm', 'p')
     order by n.nspname, c.relname
  loop
    v_tenant := exists (select 1 from pg_attribute a where a.attrelid = r.oid and a.attname = 'tenant_id' and not a.attisdropped);
    begin
      if v_tenant then
        execute format('select count(*) from %I.%I where tenant_id = $1', r.esquema, r.tabela) into v_n using current_tenant_id();
      else
        execute format('select count(*) from %I.%I', r.esquema, r.tabela) into v_n;
      end if;
    exception when others then
      v_n := null;
    end;
    v_out := v_out || jsonb_build_object(
      'esquema', r.esquema,
      'tabela', r.tabela,
      'tipo', case r.kind when 'r' then 'tabela' when 'p' then 'tabela' when 'v' then 'visão' else 'visão materializada' end,
      'linhas', v_n,
      'porClinica', v_tenant,
      'somenteLeitura', public.db_somente_leitura(r.esquema, r.tabela, r.kind),
      'colunas', (select count(*) from pg_attribute a where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped),
      'area', r.area,
      'titulo', r.titulo,
      'paraQue', coalesce(r.para_que, r.comentario),
      'origem', r.origem,
      'usadoEm', r.usado_em
    );
  end loop;
  return v_out;
end;
$$;
alter function public.db_catalogo() set statement_timeout = '30s';
revoke execute on function public.db_catalogo() from public, anon;
grant execute on function public.db_catalogo() to authenticated;

-- ---------- detalhe de uma tabela: colunas, relações, quem usa ----------
create or replace function public.db_tabela(p_esquema text, p_tabela text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_oid oid := public.db_alvo(p_esquema, p_tabela);
  v_kind "char";
begin
  select relkind into v_kind from pg_class where oid = v_oid;
  return jsonb_build_object(
    'esquema', p_esquema,
    'tabela', p_tabela,
    'tipo', case v_kind when 'v' then 'visão' when 'm' then 'visão materializada' else 'tabela' end,
    'somenteLeitura', public.db_somente_leitura(p_esquema, p_tabela, v_kind),
    'porClinica', exists (select 1 from pg_attribute a where a.attrelid = v_oid and a.attname = 'tenant_id' and not a.attisdropped),
    'descricao', (select to_jsonb(d) - 'updated_by' from public.db_catalogo_tabelas d where d.esquema = p_esquema and d.tabela = p_tabela),
    'comentario', obj_description(v_oid, 'pg_class'),
    'colunas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nome', a.attname,
               'tipo', format_type(a.atttypid, a.atttypmod),
               'nulo', not a.attnotnull,
               'padrao', pg_get_expr(ad.adbin, ad.adrelid),
               'gerada', (a.attidentity <> '' or a.attgenerated <> ''),
               'pk', coalesce(a.attnum = any (pk.indkey), false),
               'oculta', format_type(a.atttypid, a.atttypmod) = 'bytea' or (p_esquema = 'legado' and p_tabela = 'config' and a.attname = 'token_sha256'),
               'descricao', coalesce(dc.descricao, col_description(v_oid, a.attnum)),
               'referencia', (select jsonb_build_object('esquema', fn.nspname, 'tabela', fc.relname, 'coluna', fa.attname)
                                from pg_constraint k
                                join pg_class fc on fc.oid = k.confrelid
                                join pg_namespace fn on fn.oid = fc.relnamespace
                                join pg_attribute fa on fa.attrelid = k.confrelid and fa.attnum = k.confkey[1]
                               where k.conrelid = v_oid and k.contype = 'f' and k.conkey[1] = a.attnum
                               limit 1))
             order by a.attnum)
        from pg_attribute a
        left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
        left join pg_index pk on pk.indrelid = v_oid and pk.indisprimary
        left join public.db_catalogo_colunas dc on dc.esquema = p_esquema and dc.tabela = p_tabela and dc.coluna = a.attname
       where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped
    ), '[]'::jsonb),
    'chave', coalesce((
      select jsonb_agg(a.attname order by array_position(i.indkey::int2[], a.attnum))
        from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
       where i.indrelid = v_oid and i.indisprimary
    ), '[]'::jsonb),
    'referenciadaPor', coalesce((
      select jsonb_agg(distinct jsonb_build_object('esquema', n.nspname, 'tabela', c.relname, 'coluna', a.attname))
        from pg_constraint k
        join pg_class c on c.oid = k.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
       where k.confrelid = v_oid and k.contype = 'f'
    ), '[]'::jsonb),
    'funcoes', coalesce((
      select jsonb_agg(distinct p.proname order by p.proname)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'legado')
         and p.prokind = 'f'
         and p.proname not like 'db\_%'
         and (p.prosrc ~* ('\m' || p_esquema || '\.' || p_tabela || '\M')
              or (p_esquema = 'public' and p.prosrc ~* ('(from|join|into|update|table)\s+' || p_tabela || '\M')))
    ), '[]'::jsonb),
    'visoes', coalesce((
      select jsonb_agg(distinct v.relname)
        from pg_depend d
        join pg_rewrite rw on rw.oid = d.objid
        join pg_class v on v.oid = rw.ev_class
       where d.refobjid = v_oid and d.classid = 'pg_rewrite'::regclass and v.oid <> v_oid
    ), '[]'::jsonb),
    'ultimasAlteracoes', coalesce((
      select jsonb_agg(jsonb_build_object('quando', x.feito_em, 'operacao', x.operacao, 'chave', x.chave, 'quem', u.email) order by x.feito_em desc)
        from (select * from public.db_alteracoes a2
               where a2.esquema = p_esquema and a2.tabela = p_tabela and (a2.tenant_id is null or a2.tenant_id = current_tenant_id())
               order by a2.feito_em desc limit 15) x
        left join users u on u.id = x.user_id
    ), '[]'::jsonb)
  );
end;
$$;
alter function public.db_tabela(text, text) set statement_timeout = '30s';
revoke execute on function public.db_tabela(text, text) from public, anon;
grant execute on function public.db_tabela(text, text) to authenticated;

-- linha → jsonb sem colunas ocultas (bytea / token)
create or replace function public.db_limpar_linha(p_esquema text, p_tabela text, p_oid oid, p_linha jsonb)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select p_linha - coalesce((
    select array_agg(a.attname::text)
      from pg_attribute a
     where a.attrelid = p_oid and a.attnum > 0 and not a.attisdropped
       and (format_type(a.atttypid, a.atttypmod) = 'bytea' or (p_esquema = 'legado' and p_tabela = 'config' and a.attname = 'token_sha256'))
  ), '{}'::text[])
$$;

-- ---------- linhas (página) ----------
create or replace function public.db_linhas(
  p_esquema text, p_tabela text,
  p_busca text default null, p_ordem text default null, p_desc boolean default false,
  p_limite int default 100, p_offset int default 0)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_oid oid := public.db_alvo(p_esquema, p_tabela);
  v_tenant boolean;
  v_where text := 'true';
  v_order text := '';
  v_total bigint;
  v_linhas jsonb;
begin
  v_tenant := exists (select 1 from pg_attribute a where a.attrelid = v_oid and a.attname = 'tenant_id' and not a.attisdropped);
  if v_tenant then
    v_where := format('t.tenant_id = %L::uuid', current_tenant_id());
  end if;
  if coalesce(trim(p_busca), '') <> '' then
    v_where := v_where || format(' and t::text ilike %L', '%' || trim(p_busca) || '%');
  end if;
  if p_ordem is not null and exists (select 1 from pg_attribute a where a.attrelid = v_oid and a.attname = p_ordem and a.attnum > 0 and not a.attisdropped) then
    v_order := format(' order by t.%I %s nulls last', p_ordem, case when p_desc then 'desc' else 'asc' end);
  end if;

  execute format('select count(*) from %I.%I t where %s', p_esquema, p_tabela, v_where) into v_total;
  execute format(
    'select coalesce(jsonb_agg(public.db_limpar_linha(%L, %L, %s::oid, to_jsonb(x))), ''[]''::jsonb)
       from (select t.* from %I.%I t where %s%s limit %s offset %s) x',
    p_esquema, p_tabela, v_oid, p_esquema, p_tabela, v_where, v_order,
    least(greatest(coalesce(p_limite, 100), 1), 500), greatest(coalesce(p_offset, 0), 0))
  into v_linhas;

  return jsonb_build_object('total', v_total, 'linhas', v_linhas);
end;
$$;
alter function public.db_linhas(text, text, text, text, boolean, int, int) set statement_timeout = '30s';
revoke execute on function public.db_linhas(text, text, text, text, boolean, int, int) from public, anon;
grant execute on function public.db_linhas(text, text, text, text, boolean, int, int) to authenticated;

-- ---------- inserir / editar ----------
-- p_chave nulo = inserir; senão edita a linha com essa chave primária.
-- p_valores: só as colunas que mudaram ({"coluna": valor}).
create or replace function public.db_salvar(p_esquema text, p_tabela text, p_chave jsonb, p_valores jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_oid oid := public.db_alvo(p_esquema, p_tabela);
  v_kind "char";
  v_tenant boolean;
  v_pk text[];
  v_cols text[];
  v_lista text;
  v_cond text;
  v_antes jsonb;
  v_depois jsonb;
  v_valores jsonb := coalesce(p_valores, '{}'::jsonb);
begin
  select relkind into v_kind from pg_class where oid = v_oid;
  if public.db_somente_leitura(p_esquema, p_tabela, v_kind) then
    raise exception 'Esta tabela é somente leitura nesta tela';
  end if;
  v_tenant := exists (select 1 from pg_attribute a where a.attrelid = v_oid and a.attname = 'tenant_id' and not a.attisdropped);
  select array_agg(a.attname::text order by array_position(i.indkey::int2[], a.attnum)) into v_pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
   where i.indrelid = v_oid and i.indisprimary;
  if v_pk is null then
    raise exception 'Tabela sem chave primária: edição desativada';
  end if;

  -- colunas editáveis enviadas (sem ocultas, geradas ou tenant_id)
  select array_agg(a.attname::text) into v_cols
    from pg_attribute a
   where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped
     and v_valores ? a.attname
     and format_type(a.atttypid, a.atttypmod) <> 'bytea'
     and a.attgenerated = ''
     and a.attname <> 'tenant_id';
  if v_tenant then
    v_valores := v_valores || jsonb_build_object('tenant_id', current_tenant_id());
  end if;

  if p_chave is null then
    -- inserir
    if v_tenant then v_cols := coalesce(v_cols, '{}') || array['tenant_id']; end if;
    if v_cols is null or cardinality(v_cols) = 0 then
      raise exception 'Preencha pelo menos uma coluna';
    end if;
    select string_agg(format('%I', c), ', ') into v_lista from unnest(v_cols) c;
    execute format('insert into %I.%I as t (%s) select %s from jsonb_populate_record(null::%I.%I, $1) returning to_jsonb(t)',
                   p_esquema, p_tabela, v_lista, v_lista, p_esquema, p_tabela)
      into v_depois using v_valores;
    insert into public.db_alteracoes (tenant_id, user_id, esquema, tabela, operacao, chave, depois)
    values (current_tenant_id(), auth.uid(), p_esquema, p_tabela, 'inserir',
            (select jsonb_object_agg(k, v_depois->k) from unnest(v_pk) k), public.db_limpar_linha(p_esquema, p_tabela, v_oid, v_depois));
    return public.db_limpar_linha(p_esquema, p_tabela, v_oid, v_depois);
  end if;

  -- editar
  if v_cols is null or cardinality(v_cols) = 0 then
    raise exception 'Nada para salvar';
  end if;
  select string_agg(format('t.%I is not distinct from k.%I', c, c), ' and ') into v_cond from unnest(v_pk) c;
  if v_tenant then
    v_cond := v_cond || format(' and t.tenant_id = %L::uuid', current_tenant_id());
  end if;
  execute format('select to_jsonb(t) from %I.%I t, jsonb_populate_record(null::%I.%I, $1) k where %s',
                 p_esquema, p_tabela, p_esquema, p_tabela, v_cond)
    into v_antes using p_chave;
  if v_antes is null then
    raise exception 'Linha não encontrada (pode ter sido alterada ou excluída)';
  end if;
  select string_agg(format('%I = n.%I', c, c), ', ') into v_lista from unnest(v_cols) c;
  execute format('update %I.%I t set %s from jsonb_populate_record(null::%I.%I, $2) n, jsonb_populate_record(null::%I.%I, $1) k where %s returning to_jsonb(t)',
                 p_esquema, p_tabela, v_lista, p_esquema, p_tabela, p_esquema, p_tabela, v_cond)
    into v_depois using p_chave, v_valores;
  insert into public.db_alteracoes (tenant_id, user_id, esquema, tabela, operacao, chave, antes, depois)
  values (current_tenant_id(), auth.uid(), p_esquema, p_tabela, 'editar', p_chave,
          public.db_limpar_linha(p_esquema, p_tabela, v_oid, v_antes), public.db_limpar_linha(p_esquema, p_tabela, v_oid, v_depois));
  return public.db_limpar_linha(p_esquema, p_tabela, v_oid, v_depois);
end;
$$;
revoke execute on function public.db_salvar(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.db_salvar(text, text, jsonb, jsonb) to authenticated;

-- ---------- descrições editáveis ----------
create or replace function public.db_descrever(p_esquema text, p_tabela text, p_coluna text, p_campos jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_oid oid := public.db_alvo(p_esquema, p_tabela);
begin
  if p_coluna is null then
    insert into public.db_catalogo_tabelas as d (esquema, tabela, area, titulo, para_que, origem, usado_em, updated_by, updated_at)
    values (p_esquema, p_tabela, nullif(p_campos->>'area', ''), nullif(p_campos->>'titulo', ''), nullif(p_campos->>'paraQue', ''),
            nullif(p_campos->>'origem', ''), nullif(p_campos->>'usadoEm', ''), auth.uid(), now())
    on conflict (esquema, tabela) do update set
      area = case when p_campos ? 'area' then excluded.area else d.area end,
      titulo = case when p_campos ? 'titulo' then excluded.titulo else d.titulo end,
      para_que = case when p_campos ? 'paraQue' then excluded.para_que else d.para_que end,
      origem = case when p_campos ? 'origem' then excluded.origem else d.origem end,
      usado_em = case when p_campos ? 'usadoEm' then excluded.usado_em else d.usado_em end,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  else
    if not exists (select 1 from pg_attribute a where a.attrelid = v_oid and a.attname = p_coluna and a.attnum > 0 and not a.attisdropped) then
      raise exception 'Coluna não encontrada';
    end if;
    insert into public.db_catalogo_colunas (esquema, tabela, coluna, descricao, updated_by, updated_at)
    values (p_esquema, p_tabela, p_coluna, nullif(p_campos->>'descricao', ''), auth.uid(), now())
    on conflict (esquema, tabela, coluna) do update set descricao = excluded.descricao, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
end;
$$;
revoke execute on function public.db_descrever(text, text, text, jsonb) from public, anon;
grant execute on function public.db_descrever(text, text, text, jsonb) to authenticated;
