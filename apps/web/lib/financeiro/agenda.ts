// ================================================================
// Agenda de recebimentos/pagamentos — monta a "planilha do mês"
// (dias nas colunas, planos e despesas nas linhas) a partir da view
// cashflow_calendar. Lógica pura (sem banco) para poder testar.
// ================================================================
import type { CashflowCalendarRow } from './db-types'

export type EstadoCelula = 'realizado' | 'previsto' | 'atrasado' | 'misto'

export type Celula = {
  valor: number
  itens: CashflowCalendarRow[]
  estado: EstadoCelula
  /** 'conciliado' = algum item confirmado pelo extrato do banco; 'sem_previsao' = entrou no banco sem nada previsto */
  banco?: 'conciliado' | 'sem_previsao'
}

/** Como o banco participa da célula (para marcar na Agenda). */
export function marcaBanco(itens: Pick<CashflowCalendarRow, 'origem' | 'realized_source'>[]): Celula['banco'] {
  if (itens.some((r) => r.origem === 'banco')) return 'sem_previsao'
  if (itens.some((r) => r.realized_source === 'banco')) return 'conciliado'
  return undefined
}

export type LinhaAgenda = {
  categoria: string
  ordem: number
  kind: 'entrada' | 'saida'
  porDia: Record<number, Celula>
  total: number
}

export type PlanoAgenda = { nome: string; ordem: number }

export type Agenda = {
  ano: number
  mes: number // 1..12
  dias: { dia: number; iso: string; semana: number; fimDeSemana: boolean; hoje: boolean }[]
  entradas: LinhaAgenda[]
  saidas: LinhaAgenda[]
  entradaDia: Record<number, number>
  saidaDia: Record<number, number>
  resumo: {
    aReceber: number // previsto no mês (ainda não recebido)
    recebido: number
    atrasado: number // previsto com data já passada e não confirmado
    aPagar: number
    pago: number
    saldoPrevisto: number // (a receber + recebido) − (a pagar + pago)
  }
}

export const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
export const DIAS_SEMANA_CURTO = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

const cent = (v: number) => Math.round(v * 100) / 100
const pad = (n: number) => String(n).padStart(2, '0')

/** Valor que conta na agenda: o recebido/pago quando confirmado, senão o previsto. */
export function valorItem(r: Pick<CashflowCalendarRow, 'status' | 'amount' | 'realized_amount'>): number {
  return Number(r.status === 'realizado' && r.realized_amount != null ? r.realized_amount : r.amount)
}

export function estadoItem(r: Pick<CashflowCalendarRow, 'status' | 'calendar_date'>, hojeIso: string): Exclude<EstadoCelula, 'misto'> {
  if (r.status === 'realizado') return 'realizado'
  return r.calendar_date < hojeIso ? 'atrasado' : 'previsto'
}

export function intervaloMes(ano: number, mes: number) {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return { inicio: `${ano}-${pad(mes)}-01`, fim: `${ano}-${pad(mes)}-${pad(ultimo)}`, ultimoDia: ultimo }
}

export function montarAgenda(
  rows: CashflowCalendarRow[],
  opcoes: { ano: number; mes: number; hojeIso: string; planos: PlanoAgenda[]; categoriasSaida: string[]; feriados?: string[] }
): Agenda {
  const { ano, mes, hojeIso, planos, categoriasSaida } = opcoes
  const feriados = new Set(opcoes.feriados ?? [])
  const { inicio, fim, ultimoDia } = intervaloMes(ano, mes)

  const dias = Array.from({ length: ultimoDia }, (_, i) => {
    const dia = i + 1
    const iso = `${ano}-${pad(mes)}-${pad(dia)}`
    const semana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()
    return { dia, iso, semana, fimDeSemana: semana === 0 || semana === 6 || feriados.has(iso), hoje: iso === hojeIso }
  })

  const linhas = new Map<string, LinhaAgenda>()
  const chave = (kind: string, cat: string) => `${kind}|${cat}`
  const garantir = (kind: 'entrada' | 'saida', categoria: string, ordem: number) => {
    const k = chave(kind, categoria)
    if (!linhas.has(k)) linhas.set(k, { categoria, ordem, kind, porDia: {}, total: 0 })
    return linhas.get(k)!
  }
  planos.forEach((p) => garantir('entrada', p.nome, p.ordem))
  categoriasSaida.forEach((c, i) => garantir('saida', c, 200 + i))

  const resumo = { aReceber: 0, recebido: 0, atrasado: 0, aPagar: 0, pago: 0, saldoPrevisto: 0 }
  for (const r of rows) {
    if (r.calendar_date < inicio || r.calendar_date > fim) continue
    const dia = Number(r.calendar_date.slice(8, 10))
    const linha = garantir(r.kind, r.category, Number(r.category_order ?? (r.kind === 'entrada' ? 100 : 200)))
    const v = valorItem(r)
    const est = estadoItem(r, hojeIso)
    const cel = (linha.porDia[dia] ??= { valor: 0, itens: [], estado: est })
    cel.valor = cent(cel.valor + v)
    cel.itens.push(r)
    cel.banco = marcaBanco(cel.itens)
    if (cel.estado !== est) cel.estado = 'misto'
    linha.total = cent(linha.total + v)

    if (r.kind === 'entrada') {
      if (est === 'realizado') resumo.recebido += v
      else resumo.aReceber += v
      if (est === 'atrasado') resumo.atrasado += v
    } else {
      if (est === 'realizado') resumo.pago += v
      else resumo.aPagar += v
    }
  }
  for (const k of Object.keys(resumo) as (keyof typeof resumo)[]) resumo[k] = cent(resumo[k])
  resumo.saldoPrevisto = cent(resumo.aReceber + resumo.recebido - resumo.aPagar - resumo.pago)

  const ordenar = (a: LinhaAgenda, b: LinhaAgenda) => a.ordem - b.ordem || a.categoria.localeCompare(b.categoria, 'pt-BR')
  const entradas = [...linhas.values()].filter((l) => l.kind === 'entrada').sort(ordenar)
  const saidas = [...linhas.values()].filter((l) => l.kind === 'saida').sort(ordenar)

  const somaDia = (ls: LinhaAgenda[]) => {
    const out: Record<number, number> = {}
    for (const l of ls) for (const [d, c] of Object.entries(l.porDia)) out[Number(d)] = cent((out[Number(d)] ?? 0) + c.valor)
    return out
  }

  return { ano, mes, dias, entradas, saidas, entradaDia: somaDia(entradas), saidaDia: somaDia(saidas), resumo }
}

/** "1.234,56" / "1234.56" / "R$ 46,83" → número (null se inválido). */
export function lerValorBR(texto: string): number | null {
  const s = String(texto ?? '').replace(/[R$\s]/g, '')
  if (!s) return null
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** Soma meses a uma data ISO mantendo o dia (ou o último dia do mês, se não existir). */
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1))
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
  return `${alvo.getUTCFullYear()}-${pad(alvo.getUTCMonth() + 1)}-${pad(Math.min(d, ultimo))}`
}

/** Data de hoje em São Paulo, 'YYYY-MM-DD'. */
export function hojeSaoPaulo(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}
