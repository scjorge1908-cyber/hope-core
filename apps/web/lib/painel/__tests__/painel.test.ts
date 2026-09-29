import { describe, expect, it } from 'vitest'
import { alertas, indicadores, ritmoDoMes, type Painel } from '../painel'

const mes = (m: string, realizadas: number, extra: Partial<Painel['mensal'][number]> = {}) => ({
  mes: m, realizadas, faltas: 5, justificadas: 0, pacientes: 100, novos: 10, faturadas: realizadas, pendentes: 0, valor_ok: realizadas * 45, psicologas: 10, ...extra,
})

const base: Painel = {
  mensal: [mes('2026-06-01', 429), mes('2026-07-01', 490), mes('2026-08-01', 570), mes('2026-09-01', 369, { faturadas: 45, valor_ok: 1980 })],
  psicologas: [
    { spreadsheet_id: 'a', psi: 'PSI A', ativo: true, realizadas_mes: 50, realizadas_mes_anterior: 60, media_3m: 55, faltas_90: 5, agendadas_90: 180, pacientes_ativos: 20, pendentes_antigas: 0, valor_pendente_antigo: 0, dias_para_registrar: 0, valor_ok_mes_anterior: 2700 },
    { spreadsheet_id: 'b', psi: 'PSI B', ativo: true, realizadas_mes: 5, realizadas_mes_anterior: 10, media_3m: 40, faltas_90: 1, agendadas_90: 90, pacientes_ativos: 5, pendentes_antigas: 3, valor_pendente_antigo: 135, dias_para_registrar: 2, valor_ok_mes_anterior: 450 },
  ],
  planos: [],
  semana: [{ dow: 1, realizadas: 279, faltas: 45 }, { dow: 2, realizadas: 309, faltas: 28 }],
  retencao: { ativos_30: 145, ativos_31_60: 174, sem_sessao_ha_30: 51, novos_30: 22, total_historico: 341 },
  pendencias: { ate_30_dias: 318, mais_30_dias: 41, valor_mais_30_dias: 1590.4, mais_antiga: '2025-11-03' },
  valor_real: [],
  registro_guias: { guias_mes_anterior: 544, registradas: 543, linhas_bd: 1717 },
  unimed: [
    { month: '2026-07-01', sessions: 394, informed: 14735.6, released: 14143.58, gloss: 592.02, glossed_sessions: 13, median_days_to_statement: 35 },
    { month: '2026-08-01', sessions: 432, informed: 16488.12, released: 15693.28, gloss: 794.84, glossed_sessions: 18, median_days_to_statement: 32 },
    { month: '2026-09-01', sessions: 3, informed: 99.3, released: 99.3, gloss: 0, glossed_sessions: 0, median_days_to_statement: 23 },
  ],
  divergencias: [
    { tipo: 'ok_glosado', qtd: 50, glosado: 2222.72, liberado: 33.1 },
    { tipo: 'pago_sem_ok', qtd: 4, glosado: 0, liberado: 157.28 },
    { tipo: 'falta_faturada', qtd: 9, glosado: 0, liberado: 347.66 },
  ],
  caixa: { receber_30: 1123.92, atrasado: 11379.69, recebido_mes: 11661.86, pagar_30: 0, por_plano_30: [] },
  atualizacao: { planilhas: '2026-09-29T13:23:10Z', planilhas_com_erro: 0, bd_guias: '2026-09-29T14:53:37Z', ultimo_demonstrativo: '2026-09-25', ultima_orizon: null, hoje: '2026-09-29' },
}

describe('indicadores', () => {
  const k = indicadores(base)
  it('projeção do mês pelo ritmo e média de 3 meses fechados', () => {
    expect(ritmoDoMes('2026-09-29')).toMatchObject({ dia: 29, diasNoMes: 30 })
    expect(k.projecao).toBe(Math.round(369 / (29 / 30)))
    expect(k.media3).toBeCloseTo((429 + 490 + 570) / 3, 5)
    expect(k.anterior?.mes).toBe('2026-08-01')
  })
  it('falta 90 dias e glosa 3 meses (ignora mês atual e meses quase vazios)', () => {
    expect(k.taxaFalta90).toBeCloseTo(73 / 661, 6)
    expect(k.glosa3m).toBeCloseTo((592.02 + 794.84) / (14735.6 + 16488.12), 6)
    expect(k.cobertura).toBeCloseTo(543 / 544, 6)
  })
})

describe('alertas', () => {
  const a = alertas(base, new Date('2026-09-29T15:00:00Z'))
  it('ordem: críticos primeiro', () => {
    expect(a[0].severidade).toBe('critico')
    const sev = a.map((x) => x.severidade)
    expect(sev.lastIndexOf('critico')).toBeLessThan(sev.indexOf('atencao'))
  })
  it('traz os riscos reais', () => {
    const t = a.map((x) => x.titulo).join(' | ')
    expect(t).toMatch(/50 guias com OK foram glosadas/)
    expect(t).toMatch(/9 faltas foram faturadas/)
    expect(t).toMatch(/41 sessões realizadas há mais de 30 dias/)
    expect(t).toMatch(/Glosa da Unimed em 4,8%/)
    expect(t).toMatch(/Queda de atendimentos: PSI B/)
    expect(t).not.toMatch(/PSI A/)
    expect(t).not.toMatch(/Registro de Guias/) // 99,8% registrado
    expect(t).not.toMatch(/sem atualização/)
  })
})
