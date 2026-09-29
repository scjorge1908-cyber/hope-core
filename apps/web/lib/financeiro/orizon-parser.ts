// ================================================================
// Relatório "Lotes Exportados e Liberados" do portal Orizon (Bradesco
// Saúde) → lotes para a agenda de recebimentos.
// Na clínica, cada lote = 1 guia (o número do lote é o número da guia).
// ================================================================
import { lerPrimeiraAba, serialParaData, type CelulaXlsx } from './xlsx-simples'

export const CNPJ_CLINICA = '47283631000129'

export type LoteOrizon = {
  lote: string
  protocolo: string
  envio: string // YYYY-MM-DD
  liberacao: string | null // YYYY-MM-DDTHH:mm:ss (horário de Brasília, como no relatório)
  operadora: string
  tipoGuia: string
  qtdGuias: number | null
  valor: number
  status: string
  cnpj: string
}

export type ResultadoOrizon = { linhas: LoteOrizon[]; avisos: string[]; total: number }

const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()

const COLUNAS = {
  cnpj: 'cnpj/cpf',
  lote: 'numero lote',
  protocolo: 'protocolo',
  envio: 'data de envio',
  operadora: 'operadora',
  tipoGuia: 'tipo de guia',
  qtdGuias: 'quantidade de guias',
  valor: 'valor apresentado',
  liberacao: 'data de liberacao',
  status: 'status',
} as const

function texto(v: CelulaXlsx): string {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v)
  return String(v).trim()
}

function numero(v: CelulaXlsx): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v
  const s = String(v).trim().replace(/[R$\s]/g, '')
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s)
  return Number.isFinite(n) ? n : null
}

function dataHora(v: CelulaXlsx): { data: string; hora: string } | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return serialParaData(v)
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) {
    const p = (x: string | undefined) => String(x ?? '0').padStart(2, '0')
    return { data: `${m[3]}-${p(m[2])}-${p(m[1])}`, hora: `${p(m[4])}:${p(m[5])}:${p(m[6])}` }
  }
  const iso = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/)
  if (iso) return { data: iso[1], hora: (iso[2] ?? '00:00:00').padEnd(8, ':00').slice(0, 8) }
  return null
}

export function parseOrizonXlsx(bytes: Uint8Array): ResultadoOrizon {
  const { linhas } = lerPrimeiraAba(bytes)
  const iCab = linhas.findIndex((l) => l.some((c) => norm(c) === COLUNAS.lote))
  if (iCab < 0) throw new Error('Não encontrei a coluna "Numero Lote". Este é o relatório "Lotes Exportados e Liberados" da Orizon?')
  const cab = linhas[iCab].map(norm)
  const col = Object.fromEntries(Object.entries(COLUNAS).map(([k, nome]) => [k, cab.indexOf(nome)])) as Record<keyof typeof COLUNAS, number>
  for (const obrig of ['lote', 'envio', 'valor', 'operadora'] as const) {
    if (col[obrig] < 0) throw new Error(`Coluna obrigatória ausente: "${COLUNAS[obrig]}".`)
  }

  const avisos: string[] = []
  const saida: LoteOrizon[] = []
  const vistos = new Set<string>()
  for (let i = iCab + 1; i < linhas.length; i++) {
    const l = linhas[i] ?? []
    const lote = texto(l[col.lote])
    if (!lote) continue
    const envio = dataHora(l[col.envio])
    const valor = numero(l[col.valor])
    if (!envio) throw new Error(`Linha ${i + 1} (lote ${lote}): data de envio inválida.`)
    if (valor == null) throw new Error(`Linha ${i + 1} (lote ${lote}): valor inválido.`)
    if (vistos.has(lote)) {
      avisos.push(`Lote ${lote} aparece mais de uma vez no arquivo; considerei a última linha.`)
      const idx = saida.findIndex((x) => x.lote === lote)
      saida.splice(idx, 1)
    }
    vistos.add(lote)
    const lib = col.liberacao >= 0 ? dataHora(l[col.liberacao]) : null
    const cnpj = col.cnpj >= 0 ? texto(l[col.cnpj]).replace(/\D/g, '') : ''
    if (cnpj && cnpj !== CNPJ_CLINICA) avisos.push(`Lote ${lote}: CNPJ ${cnpj} diferente do da clínica.`)
    saida.push({
      lote,
      protocolo: col.protocolo >= 0 ? texto(l[col.protocolo]) : '',
      envio: envio.data,
      liberacao: lib ? `${lib.data}T${lib.hora}` : null,
      operadora: texto(l[col.operadora]),
      tipoGuia: col.tipoGuia >= 0 ? texto(l[col.tipoGuia]) : '',
      qtdGuias: col.qtdGuias >= 0 ? numero(l[col.qtdGuias]) : null,
      valor: Math.round(valor * 100) / 100,
      status: col.status >= 0 ? texto(l[col.status]) : '',
      cnpj,
    })
  }
  if (!saida.length) throw new Error('Nenhum lote encontrado no arquivo.')
  const total = Math.round(saida.reduce((t, x) => t + x.valor * 100, 0)) / 100
  return { linhas: saida, avisos, total }
}
