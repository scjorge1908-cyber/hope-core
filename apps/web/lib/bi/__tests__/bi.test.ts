import { describe, expect, it } from 'vitest'
import {
  classificarNovoPaciente,
  dashboard,
  faixaEtaria,
  faltas,
  guiaValida,
  indiceDia,
  normalizar,
  normalizarCidade,
  ocorrencias,
  perfil,
  planos,
  prepararBase,
  psicologas,
  resumoSalas,
  somarPeriodo,
  valorSessao,
  type BaseBi,
} from '../bi'
import { ciclosSemanais, classificarPlano, gerarGuias, numeroGuiaLimpo, type GerarGuiasBase } from '../gerar-guias'

const psi = (sid: string, nome: string, ordem: number) => ({ sid, nome, nomeCompleto: `${nome} Completo`, ordem, ativo: true, desligada: false, agendaEm: null })

function base(): BaseBi {
  return {
    hoje: '2026-09-29',
    psicologas: [psi('A'.repeat(25), 'Ana', 0), psi('B'.repeat(25), 'Bia', 1), { ...psi('C'.repeat(25), 'Cris', 2), desligada: true }],
    agenda: [
      // sid, linha, dia, horario, tipo, pac, plano, valor, sala, nasc, cidade, bairro, inicio
      ['A'.repeat(25), 2, 'Segunda-feira', '08:00', 'PACIENTE', 'p1', 'Unimed', 40, '311-1', '2015-03-10', 'Palhoça - SC', 'Pagani', '2026-09-07'],
      ['A'.repeat(25), 3, 'Quarta-feira', '09:00', 'PACIENTE', 'p2', 'Bradesco', 45, '311-1', '1990-01-01', 'Palhoça', 'Centro', '2026-08-01'],
      ['A'.repeat(25), 4, 'Quinta-feira', '10:00', 'LIVRE', null, null, null, null, null, null, null, null],
      ['B'.repeat(25), 2, 'Terça-feira', '14:00', 'PACIENTE', 'p3', 'Particular', 100, '507-4', '1950-05-05', 'São José', 'Kobrasol', '2026-09-15'],
      ['B'.repeat(25), 3, 'Terça-feira', '15:00', 'PACIENTE', 'p1', 'Unimed', 40, '507-4', '2015-03-10', 'Palhoça - SC', 'Pagani', '2026-09-01'],
    ],
    cancelados: [
      // sid, linha, pac, plano, valor, nasc, cidade, bairro, inicio, cancelamento, dia
      ['A'.repeat(25), 2, 'p9', 'Unimed', 40, '2000-01-01', 'Palhoça', 'Centro', '2026-08-01', '2026-09-10', 'Sexta-feira'],
      ['A'.repeat(25), 3, 'p2', 'Unimed', 40, '1990-01-01', 'Palhoça', 'Centro', '2026-03-01', '2026-07-20', 'Segunda-feira'],
      ['B'.repeat(25), 2, 'p8', 'Geap', 60, '1980-01-01', 'Palhoça', 'Centro', '2026-07-01', '2026-08-20', 'Terça-feira'],
    ],
    atendimentos: [
      // sid, pac, tipo, ts, sessao, guia, statusS, valor
      ['A'.repeat(25), 'p1', 'Sessão Realizada', '2026-09-08', '2026-09-08', '50140000001', 'OK', 40],
      ['A'.repeat(25), 'p2', 'Sessão realizada', '2026-07-25', '2026-07-24', '1234567890', 'OK', 45],
      ['A'.repeat(25), 'p2', 'Falta', '2026-09-02', '2026-09-02', null, '', 45],
      ['B'.repeat(25), 'p3', 'Sessão realizada', '2026-08-20', '2026-08-20', null, 'OK', 100],
    ],
    bdGuias: [
      ['ana', 9, 2026, ['50140000001', '50140000002', 'GUIA', '123']],
      ['bia', 9, 2026, ['50140000003']],
    ],
    salas: { cabecalho: [], sincronizadoEm: null, linhas: [] },
    sync: { atendimentos: null, agenda: null, bdGuias: null },
  }
}

describe('utilitários', () => {
  it('normaliza como o Apps Script', () => {
    expect(normalizar('  Sessão   Realizada ')).toBe('sessao realizada')
  })
  it('faixa etária pela data exata', () => {
    expect(faixaEtaria('2015-03-10', '2026-09-29')).toBe('crianca')
    expect(faixaEtaria('2008-09-30', '2026-09-29')).toBe('adolescente')
    expect(faixaEtaria('2008-09-29', '2026-09-29')).toBe('adulto')
    expect(faixaEtaria(null, '2026-09-29')).toBeNull()
  })
  it('guia válida', () => {
    expect(guiaValida('GUIA')).toBe(false)
    expect(guiaValida('123456')).toBe(false)
    expect(guiaValida('1234567')).toBe(true)
  })
  it('período: mês atual e anterior', () => {
    const m = { '2026-09': 5, '2026-08': 3, '2026-07': 2 }
    expect(somarPeriodo(m, 1, 0, '2026-09-29')).toBe(5)
    expect(somarPeriodo(m, 1, 1, '2026-09-29')).toBe(3)
    expect(somarPeriodo(m, 3, 0, '2026-09-29')).toBe(10)
  })
  it('dia da semana e ocorrências no mês', () => {
    expect(indiceDia('Segunda-feira')).toBe(1)
    expect(indiceDia('Sáb')).toBe(6)
    expect(indiceDia('xyz')).toBeNull()
    expect(ocorrencias(1, '2026-09-01', '2026-09-30')).toBe(4) // segundas de set/2026
  })
  it('valor da sessão: sublocação/particular fixo, tabela da curva, coluna H', () => {
    expect(valorSessao('Particular', 100, true)).toBe(31.9)
    expect(valorSessao('UNIMED', 40, true)).toBe(33)
    expect(valorSessao('UNIMED', 40, false)).toBe(40)
    expect(valorSessao('Outro', 55, true)).toBe(55)
  })
  it('cidade sem UF', () => {
    expect(normalizarCidade('Palhoça - SC')).toBe('Palhoça')
    expect(normalizarCidade('  ')).toBe('Não informado')
  })
})

describe('novos pacientes', () => {
  it('novo, retorno e transferência', () => {
    const b = { historicoInicio: { x: '2026-01-01', y: '2026-01-01' }, ultimoAtendimento: { x: '2026-08-25', y: '2026-05-01' } }
    expect(classificarNovoPaciente('z', '2026-09-01', b)).toBe('NOVO')
    expect(classificarNovoPaciente('x', '2026-09-01', b)).toBe('TRANSFERENCIA')
    expect(classificarNovoPaciente('y', '2026-09-01', b)).toBe('RETORNO')
  })
})

describe('dashboard', () => {
  const b = prepararBase(base())
  const d = dashboard(b, {})
  it('ignora psicóloga desligada e conta pacientes distintos', () => {
    expect(b.psicologas.map((p) => p.nome)).toEqual(['Ana', 'Bia'])
    expect(d.pacientesAtivos).toBe(3)
  })
  it('novos do mês, cancelamentos sem quem ainda está ativo', () => {
    expect(d.novosAtivos.atual).toBe(3) // p1 (Ana), p3, p1 (Bia) — dedup por psicóloga
    expect(d.cancelamentos.atual).toBe(1) // p9 em set; p2 ainda ativo é ignorado
    expect(d.cancelamentos.anterior).toBe(1) // p8 em ago
  })
  it('atendimentos, faltas e guias não lançadas', () => {
    expect(d.atendimentos.atual).toBe(1)
    expect(d.faltas.atual).toBe(1)
    expect(d.guiasNaoLancadas.atual).toBe(2) // Ana: ...002 (…001 já lançada; GUIA/123 inválidas); Bia: ...003
  })
  it('filtro de psicóloga', () => {
    const so = dashboard(b, { psi: 'B'.repeat(25) })
    expect(so.pacientesAtivos).toBe(2)
    expect(so.guiasNaoLancadas.atual).toBe(1)
  })
})

describe('telas', () => {
  const b = prepararBase(base())
  it('planos: pacientes e projeção', () => {
    const p = planos(b, {})
    expect(p.pacientesPorPlano.find((x) => x.plano === 'Unimed')?.pacientes).toBe(1)
    const bradesco = p.projecaoPorPlano.find((x) => x.plano === 'Bradesco')!
    expect(bradesco.atendimentos).toBe(10) // 5 quartas em set/2026 × 2
    expect(bradesco.faturamento).toBe(450)
  })
  it('psicólogas: horas livres e faturado no mês', () => {
    const r = psicologas(b, {})
    const ana = r.linhas.find((l) => l.psicologa === 'Ana Completo')!
    expect(ana.horasLivres).toBe(1)
    expect(ana.faturadoNoMes).toBe(40)
    expect(ana.faturado40).toBe(16)
  })
  it('perfil: paciente conta uma vez', () => {
    const r = perfil(b, {})
    expect(r.total).toBe(3)
    expect(r.porCidade.find((c) => c.rotulo === 'Palhoça')?.quantidade).toBe(2)
  })
  it('faltas por mês', () => {
    const r = faltas(b, {}, 3)
    expect(r.porMes.map((m) => m.mes)).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(r.porMes[2].faltas).toBe(1)
  })
  it('resumo de salas', () => {
    const r = resumoSalas(['Dia', 'Hora', 'Sala 1', 'Sala 2', 'Sala 3'], [
      ['Segunda', '08:00', 'DISPONIVEL', 'Ana', 'x'],
      ['Segunda', '09:00', 'DISPONIVEL', 'DISPONIVEL', 'x'],
      ['Segunda', '14:00', 'Ana', 'Bia', 'x'],
    ])
    expect(r.salas).toEqual(['Sala 1', 'Sala 2'])
    expect(r.matriz.Segunda['Manhã']).toEqual({ status: 'parcial', livres: ['Sala 1'] })
    expect(r.matriz.Segunda.Tarde.status).toBe('indisponivel')
    expect(r.matriz.Domingo.Noite.status).toBe('fechado')
  })
})

describe('gerar guias', () => {
  it('semanas de segunda a sábado', () => {
    const c = ciclosSemanais(9, 2026)
    expect(c[0]).toEqual({ numero: 1, inicio: '2026-09-01', fim: '2026-09-05' })
    expect(c[c.length - 1].fim).toBe('2026-09-30')
  })
  it('número de guia limpo e classe do plano', () => {
    expect(numeroGuiaLimpo('Guia 13/08/2026 09:09 50143457157')).toBe('50143457157')
    expect(numeroGuiaLimpo('123')).toBeNull()
    expect(classificarPlano('Sublocação')).toBe('EXCLUIDO')
    expect(classificarPlano('SELECT')).toBe('SELECT')
  })
  it('previstas × geradas', () => {
    const g: GerarGuiasBase = {
      hoje: '2026-09-29',
      psicologas: [['A'.repeat(25), 'Ana', null]],
      agenda: [
        ['A'.repeat(25), 'Paciente Um', 'Bradesco', 'Quarta-feira', '2026-09-01'],
        ['A'.repeat(25), 'Paciente Dois', 'Select', 'Terça-feira', null],
        ['A'.repeat(25), 'Paciente Três', 'Particular', 'Terça-feira', null],
      ],
      bd: [['Ana', 'Paciente Um', 9, 2026, ['50140000001', '50140000002', '', '', '', '', '', '', '', '']]],
      bdSincronizado: null,
    }
    const r = gerarGuias(g, 9, 2026)
    const s1 = r.semanas[0].linhas[0]
    expect(s1.previsto).toBe(3) // Bradesco 2 + Select 1
    expect(s1.gerado).toBe(2)
    expect(s1.falta).toBe(1)
    expect(r.semanas[1].linhas[0].previsto).toBe(2) // só Bradesco
  })
})
