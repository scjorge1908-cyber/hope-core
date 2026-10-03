import { afterEach, describe, expect, it } from 'vitest'
import { motorCentralAtivo, motorParaRelatorio, statusConciliacao, type ProfissionalMotor } from '../motor'

const base: ProfissionalMotor = {
  spreadsheet_id: 'id1', profissional: 'Josane Flaviana', nome_abreviado: 'Psi Josane', ordem: 1, ativo: true, desligada: false,
  erro_sincronizacao: false, ultimo_erro: null, ultima_sincronizacao: '2026-10-03T00:00:00Z', tipo: 'PF', percentual_cnpj: null,
  qtd_ok: 169, qtd_pendencias: 0, total_bruto: 7815, qtd_unimed33: 0, bruto_unimed33: 0, repasse_unimed33: 0, comissao_padrao: 3126,
  repasse_bruto: 3126, base_inss: 3126, inss: 343.86, liquido: 2782.14, parcela_hope: 4689, regra_inss: 'INSS_PF v1',
  qtd_33_sem_unimed: 0, alertas: { VALOR_EM_TEXTO: 5 }, pix_key: 'x',
}

describe('motorParaRelatorio — mesmo formato do RPA', () => {
  it('PF: valores do motor nos campos do RPA', () => {
    const { relatorioFinal } = motorParaRelatorio({ competencia: '2026-09-01', fechado: true, profissionais: [base] })
    expect(relatorioFinal[0]).toMatchObject({
      id: 'id1', nome: 'Josane Flaviana', pixKey: 'x', erro: false, repasseBruto: 3126, baseCalculoInss: 3126,
      retencaoInss: 343.86, valorLiquido: 2782.14, isIsenta: false, qtdPacientes: 169, totalFaturamento: 7815,
    })
  })
  it('CNPJ: repasseBruto = faturamento bruto (como o RPA) e sem INSS', () => {
    const cnpj = { ...base, tipo: 'CNPJ' as const, percentual_cnpj: 40, total_bruto: 2700, repasse_bruto: 1080, liquido: 1080, inss: 0 }
    const { relatorioFinal } = motorParaRelatorio({ competencia: '2026-09-01', fechado: true, profissionais: [cnpj] })
    expect(relatorioFinal[0]).toMatchObject({ isIsenta: true, percentualIsenta: 40, repasseBruto: 2700, valorLiquido: 1080, retencaoInss: 0 })
  })
  it('erro de leitura da planilha vira linha de erro (fora dos totais)', () => {
    const { relatorioFinal, logs } = motorParaRelatorio({
      competencia: '2026-09-01', fechado: false, profissionais: [{ ...base, erro_sincronizacao: true, ultimo_erro: 'Sem acesso' }],
    })
    expect(relatorioFinal[0]).toMatchObject({ erro: true, msg: 'Sem acesso' })
    expect(logs[0]).toContain('Erro')
  })
  it('avisa divergência Unimed no log', () => {
    const { logs } = motorParaRelatorio({
      competencia: '2026-10-01', fechado: false, profissionais: [{ ...base, alertas: { VALOR_PLANILHA_DIVERGENTE: 2 } }],
    })
    expect(logs.join('\n')).toContain('2 lançamento(s) Unimed 0025')
  })
})

describe('statusConciliacao', () => {
  const ok = { erro: false, liquidoMotor: 100, liquidoRpa: 100, liquidoFoto: null, pago: null }
  it('pendente quando não pago', () => expect(statusConciliacao(ok).status).toBe('PENDENTE'))
  it('conciliado quando pago = líquido', () => expect(statusConciliacao({ ...ok, pago: 100 }).status).toBe('CONCILIADO'))
  it('divergente quando pago ≠ líquido', () => expect(statusConciliacao({ ...ok, pago: 90 }).status).toBe('DIVERGENTE'))
  it('divergente quando motor ≠ RPA', () => expect(statusConciliacao({ ...ok, liquidoRpa: 99.99 }).status).toBe('DIVERGENTE'))
  it('divergente quando a foto do mês fechado ≠ hoje', () =>
    expect(statusConciliacao({ ...ok, liquidoFoto: 120 }).motivo).toContain('depois do fechamento'))
  it('desligada fora do RPA atual continua no histórico', () =>
    expect(statusConciliacao({ ...ok, liquidoRpa: null }).status).toBe('SÓ NO MOTOR'))
  it('erro de sincronização', () => expect(statusConciliacao({ ...ok, erro: true }).status).toBe('ERRO DE SINCRONIZAÇÃO'))
  it('sem valor', () => expect(statusConciliacao({ ...ok, liquidoMotor: 0, liquidoRpa: 0 }).status).toBe('SEM VALOR'))
})

describe('FIN_MOTOR', () => {
  const antes = process.env.FIN_MOTOR
  afterEach(() => {
    if (antes === undefined) delete process.env.FIN_MOTOR
    else process.env.FIN_MOTOR = antes
  })
  it('padrão = RPA atual (modo sombra)', () => {
    delete process.env.FIN_MOTOR
    expect(motorCentralAtivo()).toBe(false)
  })
  it('central só com o valor exato', () => {
    process.env.FIN_MOTOR = 'central'
    expect(motorCentralAtivo()).toBe(true)
    process.env.FIN_MOTOR = 'legado'
    expect(motorCentralAtivo()).toBe(false)
  })
})
