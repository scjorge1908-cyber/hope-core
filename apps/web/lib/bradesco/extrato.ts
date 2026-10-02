// ================================================================
// Bradesco — "Saldo e extrato" (API PJ): conversão da resposta do
// GET /v1/fornecimento-extratos-contas/extratos para o formato que o
// banco do HOPE CORE já usa para o Cora (bank_registrar_extrato).
// Funções puras (sem rede), testadas em __tests__/extrato.test.ts.
//
// Formato da resposta (documentação do portal, versão 1.0.4):
//   extratoPorPeriodo[].lstLancamentoMensal[]:
//     dataLancamento "30/09/2024", numeroDocumento, valorLancamento,
//     sinalLancamento "+"/"-", segundaLinhalLancamento ("REM: NOME 22/01"),
//     codigoLancamento, descritivoLancamentoAbreviado/Completo,
//     valorSaldoAposLancamento, sinalSaldo
//   (linhas "Saldo Anterior" não são lançamentos — ficam de fora)
// O Bradesco não manda um id por lançamento: o id é montado com data,
// documento, código, sinal e valor, mais um contador para lançamentos
// idênticos no mesmo dia — por isso o extrato é sempre lido em dias
// inteiros.
// ================================================================

export type LancamentoBradesco = {
  dataLancamento?: string
  numeroDocumento?: string
  valorLancamento?: string | number
  sinalLancamento?: string
  segundaLinhalLancamento?: string
  codigoLancamento?: string
  descritivoLancamentoAbreviado?: string
  descritivoLancamentoCompleto?: string
  valorSaldoAposLancamento?: string | number
  sinalSaldo?: string
  tipoLancamento?: string
}

export type ExtratoBradesco = {
  extratoPorPeriodo?: { codigoRetorno?: string; mensagem?: string; nomeCliente?: string; lstLancamentoMensal?: LancamentoBradesco[] }[]
  extratoUltimosLancamentos?: unknown[]
  extratoLancamentosFuturos?: unknown[]
}

/** Mesmo formato que o Cora manda para bank_registrar_extrato (valor em centavos). */
export type EntradaBanco = {
  id: string
  type: 'CREDIT' | 'DEBIT'
  amount: number
  createdAt: string
  transaction: { id: string | null; type: string | null; description: string | null; counterParty: { name: string | null; identity: string | null } }
}

/**
 * Valor do Bradesco → centavos.
 *  • texto com vírgula ("1.234,56") = reais no formato brasileiro
 *  • número ou texto sem vírgula ("80", "1234.56", 80) = reais
 *  • `emCentavos` = a API manda centavos (chave BRADESCO_VALOR_CENTAVOS=1)
 */
export function centavos(v: string | number | undefined | null, emCentavos = false): number {
  if (v === undefined || v === null || v === '') return 0
  let n: number
  if (typeof v === 'number') n = v
  else {
    const t = String(v).trim().replace(/\s/g, '')
    n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t)
  }
  if (!Number.isFinite(n)) return 0
  return emCentavos ? Math.round(Math.abs(n)) : Math.round(Math.abs(n) * 100)
}

/** "30/09/2024" → "2024-09-30" (ou null). */
export function dataIso(br: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br ?? '').trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** "REM: EMPRESA PAGADORA 22/01" → "EMPRESA PAGADORA"; "DES: FULANA" → "FULANA". */
export function contraparte(segunda: string | undefined): string | null {
  const t = String(segunda ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  const sem = t.replace(/^(REM|DES|REMET|DEST|FAV|PAG)\s*[:.-]\s*/i, '').replace(/\s+\d{2}\/\d{2}(\/\d{2,4})?$/, '').trim()
  return sem || null
}

const ehSaldo = (l: LancamentoBradesco) =>
  /SALDO\s+ANTERIOR|SALDO\s+DO\s+DIA|^SALDO$/i.test(String(l.descritivoLancamentoAbreviado ?? l.descritivoLancamentoCompleto ?? '').trim())

/** Converte o extrato por período em lançamentos para o banco (sem saldos). */
export function lancamentosDoExtrato(ex: ExtratoBradesco, emCentavos = false): EntradaBanco[] {
  const linhas = (ex.extratoPorPeriodo ?? []).flatMap((b) => b.lstLancamentoMensal ?? [])
  const vistos = new Map<string, number>()
  const out: EntradaBanco[] = []
  for (const l of linhas) {
    const dia = dataIso(l.dataLancamento)
    if (!dia || ehSaldo(l)) continue
    const valor = centavos(l.valorLancamento, emCentavos)
    if (valor === 0) continue
    const sinal = String(l.sinalLancamento ?? '').trim() === '-' ? '-' : '+'
    const base = [dia, String(l.numeroDocumento ?? '').trim(), String(l.codigoLancamento ?? '').trim(), `${sinal}${valor}`].join('|')
    const n = (vistos.get(base) ?? 0) + 1
    vistos.set(base, n)
    const descricao = String(l.descritivoLancamentoCompleto || l.descritivoLancamentoAbreviado || '').trim()
    out.push({
      id: `brd|${base}|${n}`,
      type: sinal === '-' ? 'DEBIT' : 'CREDIT',
      amount: valor,
      createdAt: `${dia}T12:00:00`,
      transaction: {
        id: String(l.numeroDocumento ?? '').trim() || null,
        type: String(l.descritivoLancamentoAbreviado ?? '').trim() || null,
        description: [descricao, String(l.segundaLinhalLancamento ?? '').trim()].filter(Boolean).join(' · ') || null,
        counterParty: { name: contraparte(l.segundaLinhalLancamento), identity: null },
      },
    })
  }
  return out
}

/** Saldo depois do último lançamento do período (centavos, com sinal). */
export function saldoFinal(ex: ExtratoBradesco, emCentavos = false): number | null {
  const linhas = (ex.extratoPorPeriodo ?? []).flatMap((b) => b.lstLancamentoMensal ?? [])
  const ultima = [...linhas].reverse().find((l) => l.valorSaldoAposLancamento !== undefined && l.valorSaldoAposLancamento !== '')
  if (!ultima) return null
  const v = centavos(ultima.valorSaldoAposLancamento, emCentavos)
  return String(ultima.sinalSaldo ?? '+').trim() === '-' ? -v : v
}

/** Formatos de data aceitos pelo parâmetro dataInicio/dataFim (o 1º que a API aceitar fica valendo). */
export const FORMATOS_DATA = ['dd/MM/yyyy', 'ddMMyyyy', 'yyyy-MM-dd'] as const
export type FormatoData = (typeof FORMATOS_DATA)[number]

export function formatarData(iso: string, f: FormatoData): string {
  const [a, m, d] = iso.split('-')
  return f === 'dd/MM/yyyy' ? `${d}/${m}/${a}` : f === 'ddMMyyyy' ? `${d}${m}${a}` : iso
}
