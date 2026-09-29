import { describe, expect, it } from 'vitest'
import { lerValorBR, montarAgenda, somarMeses } from '../agenda'
import type { CashflowCalendarRow } from '../db-types'

const base: CashflowCalendarRow = {
  id: 'x', tenant_id: 't', origem: 'item', kind: 'entrada', insurance_plan_id: 'p', category: 'Bradesco', category_order: 3,
  source: 'orizon', external_ref: '1', reference_date: '2026-08-07', amount: 46.83, expected_date: '2026-09-21',
  calendar_date: '2026-09-21', status: 'previsto', realized_date: null, realized_amount: null, description: null,
}
const r = (o: Partial<CashflowCalendarRow>): CashflowCalendarRow => ({ ...base, ...o })

describe('montarAgenda', () => {
  const planos = [
    { nome: 'Select', ordem: 1 },
    { nome: 'Bradesco', ordem: 3 },
    { nome: 'Unimed', ordem: 6 },
  ]
  const rows = [
    r({ id: 'a', calendar_date: '2026-09-21' }),
    r({ id: 'b', calendar_date: '2026-09-21', amount: 46.83 }),
    r({ id: 'c', calendar_date: '2026-09-28', status: 'realizado', realized_amount: 40, realized_date: '2026-09-28' }),
    r({ id: 'd', category: 'Unimed', category_order: 6, origem: 'nota_fiscal', source: 'nf', amount: 11661.86, calendar_date: '2026-09-30' }),
    r({ id: 'e', kind: 'saida', category: 'INSS', category_order: 200, source: 'manual', amount: 1000, calendar_date: '2026-09-20' }),
    r({ id: 'f', calendar_date: '2026-10-02' }), // outro mês: fora
  ]
  const a = montarAgenda(rows, { ano: 2026, mes: 9, hojeIso: '2026-09-29', planos, categoriasSaida: ['INSS', 'Sala 507'], feriados: ['2026-09-07'] })

  it('linhas na ordem da planilha, incluindo planos sem valor', () => {
    expect(a.entradas.map((l) => l.categoria)).toEqual(['Select', 'Bradesco', 'Unimed'])
    expect(a.saidas.map((l) => l.categoria)).toEqual(['INSS', 'Sala 507'])
    expect(a.dias).toHaveLength(30)
    expect(a.dias[6]).toMatchObject({ dia: 7, fimDeSemana: true }) // feriado
    expect(a.dias[28]).toMatchObject({ dia: 29, hoje: true })
  })

  it('soma por dia e marca atrasado / recebido', () => {
    const brad = a.entradas.find((l) => l.categoria === 'Bradesco')!
    expect(brad.porDia[21]).toMatchObject({ valor: 93.66, estado: 'atrasado' })
    expect(brad.porDia[28]).toMatchObject({ valor: 40, estado: 'realizado' })
    expect(brad.total).toBe(133.66)
    expect(a.entradaDia[30]).toBe(11661.86)
    expect(a.saidaDia[20]).toBe(1000)
  })

  it('resumo do mês', () => {
    expect(a.resumo).toEqual({ aReceber: 11755.52, recebido: 40, atrasado: 93.66, aPagar: 1000, pago: 0, saldoPrevisto: 10795.52 })
  })
})

describe('auxiliares', () => {
  it('lerValorBR', () => {
    expect(lerValorBR('1.234,56')).toBe(1234.56)
    expect(lerValorBR('R$ 46,83')).toBe(46.83)
    expect(lerValorBR('10000')).toBe(10000)
    expect(lerValorBR('abc')).toBeNull()
  })
  it('somarMeses mantém o dia ou usa o último do mês', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28')
    expect(somarMeses('2026-09-10', 4)).toBe('2027-01-10')
  })
})
