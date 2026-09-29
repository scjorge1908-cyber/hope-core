import { describe, expect, it } from 'vitest'
import { agruparAdmSemSessao, agruparNaoLancadas, chaveNome, rotuloSemana, normalizarPlano, problemas, resumir, type LinhaConferencia } from '../conferencia'

const base: LinhaConferencia = {
  origem: 'sessao', spreadsheet_id: 's1', psicologa: 'PSI A', paciente: 'X', data_sessao: '2026-08-10', guia: '50140000001',
  tipo_atendimento: 'Sessão Realizada', anexo: 'sim', anexo_texto: 'Guia 1', status_s: 'OK', status_classe: 'faturada',
  admin_registrou: true, plano: 'Unimed', plano_fonte: 'admin', operadora_status: 'pago', operadora_valor: 33.1,
  operadora_glosa: 0, operadora_codigos: null, operadora_ref: '282244', valor_planilha: 45,
}
const l = (o: Partial<LinhaConferencia>): LinhaConferencia => ({ ...base, ...o })

describe('problemas', () => {
  it('sessão completa não tem problema', () => {
    expect(problemas(base)).toEqual([])
  })
  it('OK mas glosada', () => {
    expect(problemas(l({ operadora_status: 'glosado', operadora_valor: 0, operadora_glosa: 33.1 }))).toEqual(['ok_glosado'])
  })
  it('falta faturada não cobra anexo nem ADM', () => {
    expect(problemas(l({ status_classe: 'falta', status_s: 'FALTA', anexo: 'nao', admin_registrou: false }))).toEqual(['falta_faturada'])
  })
  it('paga sem OK + sem status + sem anexo + fora do ADM', () => {
    expect(problemas(l({ status_classe: 'pendente', status_s: '', anexo: 'nao', admin_registrou: false }))).toEqual([
      'pago_sem_ok', 'fora_do_adm', 'sem_anexo', 'sem_status',
    ])
  })
  it('sem guia', () => {
    expect(problemas(l({ guia: '', admin_registrou: false, operadora_status: 'sem_retorno_integrado' }))).toEqual(['sem_guia'])
  })
  it('só no ADM', () => {
    expect(problemas(l({ origem: 'so_admin' }))).toEqual(['so_admin'])
  })
})

describe('resumir', () => {
  it('conta por psicóloga', () => {
    const r = resumir([
      base,
      l({ anexo: 'nao' }),
      l({ status_classe: 'falta', operadora_status: 'aguardando' }),
      l({ operadora_status: 'aguardando' }),
      l({ origem: 'so_admin', psicologa: 'PSI B' }),
    ])
    expect(r[0]).toMatchObject({ psicologa: 'PSI A', sessoes: 3, faltas: 1, semAnexo: 1, pagas: 2, aguardando: 1 })
    expect(r[1]).toMatchObject({ psicologa: 'PSI B', soAdmin: 1, sessoes: 0 })
  })
})

describe('auxiliares', () => {
  it('normaliza plano e nome', () => {
    expect(normalizarPlano('unimed')).toBe('Unimed')
    expect(normalizarPlano('select')).toBe('Select')
    expect(chaveNome('  Psi  Gabriélla ')).toBe(chaveNome('PSI GABRIELLA'))
  })
})

describe('agruparNaoLancadas', () => {
  const fora = { admin_registrou: false, operadora_status: 'aguardando' as const }
  it('agrupa psicóloga → paciente → guia com as datas, ignora falta e lançadas', () => {
    const r = agruparNaoLancadas([
      base, // lançada
      l({ ...fora, guia: '501', paciente: 'Ana', data_sessao: '2026-08-12' }),
      l({ ...fora, guia: '501', paciente: 'Ana', data_sessao: '2026-08-05', anexo: 'nao' }),
      l({ ...fora, guia: '502', paciente: 'Bia', data_sessao: '2026-08-07' }),
      l({ ...fora, guia: '503', paciente: 'Bia', status_classe: 'falta', status_s: 'FALTA' }), // falta: fora
      l({ ...fora, psicologa: 'PSI B', guia: '', paciente: 'Caio', data_sessao: '2026-08-09' }), // sem guia
    ])
    expect(r.map((p) => [p.psicologa, p.guias, p.sessoes])).toEqual([
      ['PSI A', 2, 3],
      ['PSI B', 1, 1],
    ])
    expect(r[0].pacientes[0]).toMatchObject({ paciente: 'Ana', sessoes: 2 })
    expect(r[0].pacientes[0].guias[0]).toMatchObject({ guia: '501', datas: ['2026-08-05', '2026-08-12'], semAnexo: 1 })
    expect(r[1].pacientes[0].guias[0].guia).toBeNull()
  })
  it('sem incluir as sem nº de guia', () => {
    const r = agruparNaoLancadas([l({ ...fora, guia: '', paciente: 'Caio' })], false)
    expect(r).toEqual([])
  })
})

describe('agruparAdmSemSessao', () => {
  const b = { psicologa: 'Psi Josane', psicologa_adm: 'Psi Josane', spreadsheet_id: 'sj', desligada: false, plano: 'UNIMED', linha_bd: 2 }
  it('agrupa por paciente com mês/semana e ordena as guias', () => {
    const r = agruparAdmSemSessao([
      { ...b, paciente: 'ANA', guia: '50145394630', mes: 9, ano: 2026, semana: 'S5' },
      { ...b, paciente: 'ANA', guia: '50144743919', mes: 9, ano: 2026, semana: 'S3' },
      { ...b, paciente: 'ANGELINE', guia: '50144447353', mes: 9, ano: 2026, semana: 'S2' },
      { ...b, paciente: 'BIA', guia: '2761419', mes: 9, ano: 2026, semana: 'extra', plano: 'Select' },
    ])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ psicologa: 'Psi Josane', guias: 4, spreadsheet_id: 'sj' })
    expect(r[0].pacientes.map((p) => p.paciente)).toEqual(['ANA', 'ANGELINE', 'BIA'])
    expect(r[0].pacientes[0].guias.map((g) => [g.guia, g.refs])).toEqual([
      ['50144743919', ['set/26 · 3ª semana']],
      ['50145394630', ['set/26 · 5ª semana']],
    ])
    expect(r[0].pacientes[2].guias[0]).toMatchObject({ plano: 'Select', refs: ['set/26 · extra'], mesRef: { mes: 9, ano: 2026 } })
    expect('ordem' in r[0].pacientes[0].guias[0]).toBe(false)
  })
  it('rótulo da semana', () => {
    expect(rotuloSemana(1, 2027, 'S1')).toBe('jan/27 · 1ª semana')
  })
})
