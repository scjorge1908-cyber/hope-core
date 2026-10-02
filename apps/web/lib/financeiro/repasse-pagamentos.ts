// ================================================================
// PAGAMENTOS DE REPASSE — regras puras (sem banco), testáveis.
//
//   • competência: o mês do RPA (ex.: SETEMBRO/2026 → 2026-09-01);
//     o repasse de um mês é pago no mês seguinte.
//   • valor a pagar: SEMPRE o valorLiquido do cálculo do RPA
//     (processarRelatorio) — nunca um valor digitado.
//   • extrato do Cora: procura o Pix de saída que pagou cada
//     psicóloga — mesmo valor (±R$ 0,01) e nome do recebedor parecido,
//     do 1º dia do mês seguinte à competência até o fim do 2º mês.
// ================================================================

import type { LinhaRelatorio } from './rpa-legado'
import { MESES } from './rpa-legado'

export type LinhaOk = Extract<LinhaRelatorio, { erro: false }>

export type TransacaoExtrato = {
  id: string
  occurred_on: string
  amount: number
  counterparty_name: string | null
  counterparty_doc: string | null
  transaction_type: string | null
}

export type Sugestao = {
  transacao: TransacaoExtrato
  /** quantas palavras do nome batem */
  pontos: number
  /** valor igual ao calculado (±R$ 0,01) */
  valorConfere: boolean
}

/** 'SETEMBRO', 2026 → '2026-09-01' */
export function competenciaDe(mes: string, ano: number | string): string {
  const i = MESES.indexOf(mes.toUpperCase() as (typeof MESES)[number])
  if (i < 0) throw new Error(`Mês inválido: ${mes}`)
  return `${ano}-${String(i + 1).padStart(2, '0')}-01`
}

/** Janela do extrato: do 1º dia do mês seguinte ao último dia do 2º mês seguinte. */
export function janelaExtrato(competencia: string): { de: string; ate: string } {
  const [a, m] = competencia.split('-').map(Number)
  const de = new Date(Date.UTC(a, m, 1)) // mês seguinte (m já é 1-based)
  const ate = new Date(Date.UTC(a, m + 2, 0)) // último dia do 2º mês seguinte
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { de: iso(de), ate: iso(ate) }
}

const IGNORAR = new Set([
  'DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'LTDA', 'ME', 'EPP', 'EIRELI', 'SA', 'S/A', 'PSI', 'PSICOLOGA', 'PSICOLOGO',
  'PSICOLOGIA', 'CLINICA', 'CONSULTORIO', 'SERVICOS', 'SAUDE', 'MEI',
])

export function palavrasNome(nome: string | null | undefined): string[] {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((p) => p.length >= 3 && !IGNORAR.has(p))
}

/** Quantas palavras significativas os dois nomes têm em comum. */
export function pontosNome(a: string | null | undefined, b: string | null | undefined): number {
  const pa = new Set(palavrasNome(a))
  return new Set(palavrasNome(b).filter((p) => pa.has(p))).size
}

/**
 * Melhor Pix do extrato para uma psicóloga: maior número de palavras do
 * nome em comum; em empate, valor igual primeiro e data mais antiga.
 * Exige pelo menos 2 palavras em comum (ex.: "BEATRIZ … NOSKOSKI"), ou 1
 * quando o valor bate exatamente — e nunca devolve um Pix já usado.
 */
export function sugerirPix(
  nomePsicologa: string,
  valor: number,
  transacoes: TransacaoExtrato[],
  usadas: Set<string>
): Sugestao | null {
  let melhor: Sugestao | null = null
  for (const t of transacoes) {
    if (usadas.has(t.id)) continue
    const pontos = pontosNome(nomePsicologa, t.counterparty_name)
    const valorConfere = Math.abs(Number(t.amount) - valor) <= 0.01
    if (pontos < 1 || (pontos < 2 && !valorConfere)) continue
    const s: Sugestao = { transacao: t, pontos, valorConfere }
    if (
      !melhor ||
      Number(s.valorConfere) > Number(melhor.valorConfere) ||
      (s.valorConfere === melhor.valorConfere && s.pontos > melhor.pontos) ||
      (s.valorConfere === melhor.valorConfere && s.pontos === melhor.pontos && t.occurred_on < melhor.transacao.occurred_on)
    ) {
      melhor = s
    }
  }
  return melhor
}

/** txid do Pix: REPHOPE + AAAAMM + 6 últimos caracteres do ID da planilha (só letras/números, até 25). */
export function txidRepasse(competencia: string, spreadsheetId: string): string {
  const id = spreadsheetId.replace(/[^A-Za-z0-9]/g, '').slice(-6)
  return `REPHOPE${competencia.slice(0, 4)}${competencia.slice(5, 7)}${id}`.slice(0, 25)
}
