import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FinanceDatabase } from '@/lib/financeiro/db-types'
import { hojeSaoPaulo } from '@/lib/financeiro/agenda'
import { configCora, extratoCora } from './cliente'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type ResultadoConciliacao = {
  lancamentos_novos?: number
  previstos_confirmados?: number
  creditos_valor_igual?: number
  creditos_soma?: number
  creditos_em_ordem?: number
}

function somarDias(iso: string, k: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + k)
  return d.toISOString().slice(0, 10)
}

/**
 * Busca o extrato do Cora dos últimos `dias`, grava no banco (sem duplicar)
 * e roda a conciliação automática com a Agenda (bank_registrar_extrato).
 */
export async function sincronizarBanco(supabase: SupabaseClient<FinanceDatabase>, dias?: number): Promise<ResultadoConciliacao> {
  const cfg = configCora()
  if (!cfg) throw new Error('Integração com o Cora não configurada.')
  const fim = hojeSaoPaulo()
  // sem `dias`: na 1ª vez lê desde 1º de janeiro; depois só o que é novo (com 15 dias de folga)
  let inicio: string
  if (dias != null) inicio = somarDias(fim, -dias)
  else {
    const janeiro = `${fim.slice(0, 4)}-01-01`
    const { data: sync } = await supabase.from('bank_sync').select('last_period_start, last_period_end').maybeSingle()
    if (!sync?.last_period_start || sync.last_period_start > janeiro) inicio = janeiro
    else inicio = somarDias(sync.last_period_end && sync.last_period_end < fim ? sync.last_period_end : fim, -15)
  }
  const ex = await extratoCora(cfg, inicio, fim, fim)
  // só o necessário para o banco (id, tipo, valor, data, descrição, contraparte)
  const entries = (ex.entries ?? []).map((e) => ({
    id: e.id,
    type: e.type,
    amount: e.amount,
    createdAt: e.createdAt,
    transaction: {
      id: e.transaction?.id ?? null,
      type: e.transaction?.type ?? null,
      description: e.transaction?.description ?? null,
      counterParty: { name: e.transaction?.counterParty?.name ?? null, identity: e.transaction?.counterParty?.identity ?? null },
    },
  }))
  const { data, error } = await supabase.rpc('bank_registrar_extrato', {
    p: { bank: 'cora', inicio, fim, entries } as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return (data ?? {}) as ResultadoConciliacao
}

/** A última busca foi há mais de `minutos`? */
export async function precisaSincronizar(supabase: SupabaseClient<FinanceDatabase>, minutos = 30): Promise<boolean> {
  if (!configCora()) return false
  const { data } = await supabase.from('bank_sync').select('last_synced_at, last_period_start').maybeSingle()
  // ainda não leu o ano todo (desde 1º de janeiro) → lê já, sem esperar os 30 min
  const janeiro = `${hojeSaoPaulo().slice(0, 4)}-01-01`
  if (!data?.last_period_start || data.last_period_start > janeiro) return true
  const ult = data?.last_synced_at ? new Date(data.last_synced_at).getTime() : 0
  return Date.now() - ult > minutos * 60_000
}
