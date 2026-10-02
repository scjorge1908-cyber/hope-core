import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FinanceDatabase } from '@/lib/financeiro/db-types'
import { hojeSaoPaulo } from '@/lib/financeiro/agenda'
import { fatiarPorMes } from '../cora/cliente'
import { configBradesco, extratoBradesco } from './cliente'
import { lancamentosDoExtrato, saldoFinal, type EntradaBanco } from './extrato'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type ResultadoBradesco = {
  inicio: string
  fim: string
  recebidos: number
  lancamentos_novos?: number
  previstos_confirmados?: number
  saldoCentavos: number | null
  formatoData: string | null
}

function somarDias(iso: string, k: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + k)
  return d.toISOString().slice(0, 10)
}

/**
 * Lê o extrato do Bradesco e grava em bank_transactions (bank = 'bradesco'),
 * sem duplicar, e roda a mesma conciliação com a Agenda do Cora.
 * 1ª vez: desde 1º de janeiro; depois: os últimos 7 dias já lidos + o novo.
 * `apenasLer` = não grava nada (para conferir o formato na 1ª vez).
 */
export async function sincronizarBradesco(
  supabase: SupabaseClient<FinanceDatabase>,
  opcoes: { apenasLer?: boolean; inicio?: string } = {}
): Promise<ResultadoBradesco & { amostra?: EntradaBanco[] }> {
  const cfg = configBradesco()
  if (!cfg) throw new Error('Integração com o Bradesco não configurada (variáveis BRADESCO_* na Vercel).')
  const fim = hojeSaoPaulo()
  let inicio = opcoes.inicio
  if (!inicio) {
    const janeiro = `${fim.slice(0, 4)}-01-01`
    const { data: sync } = await supabase.from('bank_sync').select('last_period_start, last_period_end').eq('bank', 'bradesco').maybeSingle()
    inicio = !sync?.last_period_start || sync.last_period_start > janeiro ? janeiro : somarDias(sync.last_period_end ?? fim, -7)
  }
  if (inicio > fim) inicio = fim

  const entries: EntradaBanco[] = []
  let saldo: number | null = null
  let formato: string | null = null
  for (const [de, ate] of fatiarPorMes(inicio, fim)) {
    const r = await extratoBradesco(cfg, de, ate)
    formato = r.formato
    entries.push(...lancamentosDoExtrato(r.extrato, cfg.valorEmCentavos))
    const s = saldoFinal(r.extrato, cfg.valorEmCentavos)
    if (s !== null) saldo = s
  }

  const base: ResultadoBradesco = { inicio, fim, recebidos: entries.length, saldoCentavos: saldo, formatoData: formato }
  if (opcoes.apenasLer) return { ...base, amostra: entries.slice(-15) }

  const { data, error } = await supabase.rpc('bank_registrar_extrato', {
    p: { bank: 'bradesco', inicio, fim, entries } as unknown as Json,
  })
  if (error) throw new Error(error.message)
  return { ...base, ...((data ?? {}) as object) }
}
