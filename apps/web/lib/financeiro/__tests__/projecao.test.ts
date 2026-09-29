import { describe, expect, it } from 'vitest'
import { ajustarTendencia, diaUtil, faixa, feriados, leituras, pontoDeEquilibrio, projetar, rng, somarMeses, type BaseProjecao } from '../projecao'

// base sintética: ritmo estável de 20 sessões Unimed + 3 Bradesco + 1 outros por dia útil
function baseSintetica(): BaseProjecao {
  const hoje = '2026-09-29'
  const semanas: BaseProjecao['semanas'] = []
  for (let i = 0; i < 14; i++) {
    const t = Date.UTC(2026, 8, 28) - i * 7 * 86_400_000
    const sem = new Date(t).toISOString().slice(0, 10)
    const du = i === 0 ? 2 : 5
    semanas.push({ semana: sem, plano: 'unimed', realizadas: 20 * du, faltas: 2 * du, justificadas: 0, agendadas: 0 })
    semanas.push({ semana: sem, plano: 'bradesco', realizadas: 3 * du, faltas: 0, justificadas: 0, agendadas: 0 })
    semanas.push({ semana: sem, plano: 'outros', realizadas: 1 * du, faltas: 0, justificadas: 0, agendadas: 0 })
  }
  const meses = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']
  const mensal_plano: BaseProjecao['mensal_plano'] = meses.flatMap((mes) => [
    { mes, plano: 'unimed' as const, realizadas: 420, faltas: 40, justificadas: 0 },
    { mes, plano: 'bradesco' as const, realizadas: 63, faltas: 0, justificadas: 0 },
    { mes, plano: 'outros' as const, realizadas: 21, faltas: 0, justificadas: 0 },
  ])
  const dre: BaseProjecao['dre'] = [5, 6, 7, 8, 9].flatMap((m) => [
    { ano: 2026, mes: m, grupo: 'receita', categoria: 'Receita de convênios', detalhe: 'Unimed', valor: 14000, qtd: 1 },
    { ano: 2026, mes: m, grupo: 'receita', categoria: 'Receita de particulares', detalhe: null, valor: 3000, qtd: 5 },
    { ano: 2026, mes: m, grupo: 'custo', categoria: 'Repasse às psicólogas', detalhe: null, valor: -8000, qtd: 5 },
    { ano: 2026, mes: m, grupo: 'deducao', categoria: 'Impostos e taxas', detalhe: null, valor: -1500, qtd: 1 },
    { ano: 2026, mes: m, grupo: 'despesa', categoria: 'Outras despesas', detalhe: null, valor: -6000, qtd: 3 },
  ])
  return {
    hoje,
    ano: 2026,
    semanas,
    mensal_plano,
    atraso_registro: { amostra: 1000, acumulado: Array.from({ length: 41 }, () => 1) },
    pacientes: meses.map((mes) => ({ mes, ativos: 150, novos: 30, perdidos: 30, sessoes: 504, psicologas: 12 })),
    unimed_xml: [
      { numero: '1', emissao: '2026-06-25', informado: 14500, liberado: 14000, glosa: 500, itens: 400, status: 'realizado', previsto_para: '2026-07-27', pago_em: '2026-07-27', pago: 14000, fonte: 'banco' },
      { numero: '2', emissao: '2026-07-28', informado: 14500, liberado: 14000, glosa: 500, itens: 400, status: 'realizado', previsto_para: '2026-08-25', pago_em: '2026-08-25', pago: 13900, fonte: 'banco' },
      { numero: '3', emissao: '2026-08-26', informado: 14500, liberado: 14000, glosa: 500, itens: 400, status: 'realizado', previsto_para: '2026-09-25', pago_em: '2026-09-25', pago: 14000, fonte: 'banco' },
      { numero: '4', emissao: '2026-09-25', informado: 14500, liberado: 13000, glosa: 500, itens: 380, status: 'previsto', previsto_para: '2026-10-26', pago_em: null, pago: null, fonte: null },
    ],
    unimed_mensal: meses.map((month) => ({ month, sessions: 420, informed: 15000, released: 14500, gloss: 500, median_days_to_statement: 30 })),
    unimed_sessao: { sessoes: 1000, media: 34.5, dp: 5 },
    bradesco: [
      { mes: '2026-08-01', guias: 63, valor: 2950, dias_ate_pagar: 45, recebido: null },
      { mes: '2026-09-01', guias: 63, valor: 2950, dias_ate_pagar: 45, recebido: null },
    ],
    bradesco_pagto: [
      { mes: '2026-09-01', ate_hoje: 2950, futuro: 0, guias: 63 },
      { mes: '2026-11-01', ate_hoje: 0, futuro: 2950, guias: 63 },
    ],
    previstos: [],
    dre,
    banco: null,
  }
}

describe('calendário', () => {
  it('conhece feriados nacionais fixos e móveis', () => {
    const f = feriados(2026)
    expect(f.has('2026-10-12')).toBe(true)
    expect(f.has('2026-04-03')).toBe(true) // Sexta-feira Santa 2026
    expect(f.has('2026-02-16')).toBe(true) // Carnaval 2026
    expect(diaUtil('2026-10-12')).toBe(false)
    expect(diaUtil('2026-10-13')).toBe(true)
    expect(diaUtil('2026-10-17')).toBe(false) // sábado
  })
  it('soma meses atravessando o ano', () => {
    expect(somarMeses('2026-11-01', 3)).toBe('2027-02-01')
    expect(somarMeses('2026-01-01', -1)).toBe('2025-12-01')
  })
})

describe('estatística', () => {
  it('rng é determinístico e a normal tem média ~0 e desvio ~1', () => {
    const a = rng(7)
    const b = rng(7)
    expect(a.u()).toBe(b.u())
    const r = rng(1)
    const v = Array.from({ length: 20000 }, () => r.normal())
    const m = v.reduce((t, x) => t + x, 0) / v.length
    const s = Math.sqrt(v.reduce((t, x) => t + (x - m) ** 2, 0) / v.length)
    expect(Math.abs(m)).toBeLessThan(0.03)
    expect(Math.abs(s - 1)).toBeLessThan(0.03)
  })
  it('faixa devolve P10 ≤ P50 ≤ P90', () => {
    const f = faixa([5, 1, 3, 2, 4])
    expect(f.p50).toBe(3)
    expect(f.p10).toBeLessThanOrEqual(f.p50)
    expect(f.p90).toBeGreaterThanOrEqual(f.p50)
  })
  it('regressão acha a inclinação de uma reta', () => {
    const a = ajustarTendencia(Array.from({ length: 10 }, (_, t) => ({ t, y: 2 + 0.5 * t, w: 1 })))
    expect(a.inclinacao).toBeCloseTo(0.5, 6)
    expect(a.nivel).toBeCloseTo(6.5, 6)
    expect(a.sigma).toBeCloseTo(0, 6)
  })
})

describe('projetar', () => {
  const base = baseSintetica()
  const p = projetar(base, { simulacoes: 600, saldoInicial: 10000 })

  it('projeta 4 meses a partir do mês seguinte', () => {
    expect(p.meses.map((m) => m.mes)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01'])
  })

  it('ritmo estável → sessões de outubro perto de 24/dia útil × 21 dias úteis', () => {
    const out = p.meses[0].sessoes
    expect(out.p50).toBeGreaterThan(24 * 21 * 0.85)
    expect(out.p50).toBeLessThan(24 * 21 * 1.15)
    expect(out.p10).toBeLessThanOrEqual(out.p50)
    expect(out.p90).toBeGreaterThanOrEqual(out.p50)
  })

  it('usa o XML já emitido (setembro) para o recebimento Unimed de outubro', () => {
    const u = p.meses[0].receitaUnimed
    expect(u.p50).toBeGreaterThan(13000 * 0.98)
    expect(u.p50).toBeLessThanOrEqual(13000)
  })

  it('usa o lote Orizon existente pelo mês previsto e simula os lotes novos', () => {
    expect(p.meses[1].receitaBradesco.p50).toBeCloseTo(2950, 0)
    expect(p.meses[0].receitaBradesco.p50).toBe(0) // lote de agosto já pago antes de hoje
    expect(p.meses[2].receitaBradesco.p50).toBeGreaterThan(2000) // sessões de outubro × valor da guia
  })

  it('a faixa abre com o horizonte', () => {
    const larg = p.meses.map((m) => m.sessoes.p90 - m.sessoes.p10)
    expect(larg[3]).toBeGreaterThan(larg[0])
  })

  it('probabilidades ficam entre 0 e 1 e o saldo começa do saldo informado', () => {
    for (const m of p.meses) {
      expect(m.pResultadoPositivo).toBeGreaterThanOrEqual(0)
      expect(m.pResultadoPositivo).toBeLessThanOrEqual(1)
    }
    expect(p.pSaldoNegativo).not.toBeNull()
    expect(p.meses[0].saldo!.p50).toBeGreaterThan(0)
  })

  it('mesma semente → mesmo resultado', () => {
    const q = projetar(base, { simulacoes: 600, saldoInicial: 10000 })
    expect(q.acumulado.resultado.p50).toBe(p.acumulado.resultado.p50)
  })

  it('sensibilidade: mais despesa piora, mais valor Unimed melhora', () => {
    const desp = p.sensibilidade.find((s) => s.rotulo === 'Despesas fixas')!
    const val = p.sensibilidade.find((s) => s.rotulo === 'Valor Unimed por sessão')!
    expect(desp.baixo).toBeLessThan(0)
    expect(val.alto).toBeGreaterThan(0)
  })

  it('ponto de equilíbrio e leituras saem sem erro', () => {
    const pe = pontoDeEquilibrio(p)
    expect(pe).not.toBeNull()
    expect(pe!.sessoes).toBeGreaterThan(0)
    const l = leituras(p)
    expect(l.length).toBeGreaterThan(3)
    expect(l.join(' ')).not.toMatch(/NaN|undefined/)
  })
})
