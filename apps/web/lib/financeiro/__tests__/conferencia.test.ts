import { describe, expect, it } from 'vitest'
import { chaveNome, normalizarPlano, problemas, resumir, type LinhaConferencia } from '../conferencia'

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
