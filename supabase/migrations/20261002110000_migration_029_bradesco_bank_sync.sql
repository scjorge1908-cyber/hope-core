-- =====================================================================
-- migration_029 — Segundo banco (Bradesco) no extrato da clínica
--
--   bank_sync tinha UMA linha por clínica (chave = tenant_id). Com o
--   Bradesco entrando ao lado do Cora, cada banco precisa da sua linha
--   (última leitura, período já lido), senão um sobrescreve o outro.
--   • chave passa a ser (tenant_id, bank)
--   • bank_registrar_extrato grava a sincronização na linha do banco
--     recebido em p.bank — o resto da função é igual (migration 019).
--   Os lançamentos já são separados por banco em bank_transactions
--   (único por tenant + bank + external_id). A conciliação com a Agenda
--   continua olhando TODOS os bancos.
-- =====================================================================

alter table public.bank_sync drop constraint if exists bank_sync_pkey;
alter table public.bank_sync add constraint bank_sync_pkey primary key (tenant_id, bank);

create or replace function public.bank_registrar_extrato(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_t uuid := current_tenant_id();
  v_bank text := coalesce(nullif(p->>'bank', ''), 'cora');
  e jsonb;
  v_novos int := 0;
  v_quando timestamptz;
  v_res jsonb;
begin
  if not has_finance_access() or v_t is null then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if jsonb_typeof(p->'entries') <> 'array' then
    raise exception 'entries deve ser uma lista';
  end if;

  for e in select * from jsonb_array_elements(p->'entries')
  loop
    continue when coalesce(e->>'id', '') = '' or e->>'amount' is null or coalesce(e->>'createdAt', '') = '';
    v_quando := case when (e->>'createdAt') ~ '(Z|[+-]\d{2}:?\d{2})$'
                     then (e->>'createdAt')::timestamptz
                     else (e->>'createdAt')::timestamp at time zone 'America/Sao_Paulo' end;
    insert into bank_transactions (tenant_id, bank, external_id, occurred_at, occurred_on, kind, amount,
                                   transaction_type, description, counterparty_name, counterparty_doc, raw)
    values (v_t, v_bank, e->>'id', v_quando, (v_quando at time zone 'America/Sao_Paulo')::date,
            case when upper(e->>'type') = 'CREDIT' then 'entrada' else 'saida' end,
            round(abs((e->>'amount')::numeric) / 100, 2),
            e#>>'{transaction,type}', e#>>'{transaction,description}',
            e#>>'{transaction,counterParty,name}', e#>>'{transaction,counterParty,identity}', e)
    on conflict (tenant_id, bank, external_id) do nothing;
    if found then v_novos := v_novos + 1; end if;
  end loop;

  v_res := bank_conciliar_tenant(v_t);
  insert into bank_sync as bs (tenant_id, bank, last_synced_at, last_period_start, last_period_end, last_result)
  values (v_t, v_bank, now(), nullif(p->>'inicio', '')::date, nullif(p->>'fim', '')::date,
          v_res || jsonb_build_object('lancamentos_novos', v_novos, 'recebidos', jsonb_array_length(p->'entries')))
  on conflict (tenant_id, bank) do update set
    last_synced_at = excluded.last_synced_at,
    last_period_start = least(bs.last_period_start, excluded.last_period_start),
    last_period_end = greatest(bs.last_period_end, excluded.last_period_end),
    last_result = excluded.last_result;

  return v_res || jsonb_build_object('lancamentos_novos', v_novos);
end;
$function$;

revoke execute on function public.bank_registrar_extrato(jsonb) from public, anon;
grant execute on function public.bank_registrar_extrato(jsonb) to authenticated;

update public.db_catalogo_tabelas
   set para_que = 'Uma linha por banco (Cora, Bradesco): quando o extrato foi lido pela última vez, o período já lido e o resultado da conciliação.'
 where esquema = 'public' and tabela = 'bank_sync';
