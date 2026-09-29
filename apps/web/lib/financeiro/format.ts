const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const INT = new Intl.NumberFormat('pt-BR')
const PCT = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export const brl = (v: number | string | null | undefined) => BRL.format(Number(v ?? 0))
export const int = (v: number | string | null | undefined) => INT.format(Number(v ?? 0))
export const pct = (part: number, total: number) => (total ? PCT.format(part / total) : '—')

/** 'YYYY-MM-DD' → 'dd/mm/aaaa' sem passar por Date (evita erro de fuso). */
export function dataBR(iso: string | null | undefined) {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** 'YYYY-MM-DD' → 'ago/2026' */
export function mesBR(iso: string) {
  const [y, m] = iso.slice(0, 10).split('-')
  return `${MESES[Number(m) - 1]}/${y}`
}
