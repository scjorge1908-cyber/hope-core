import { describe, expect, it } from 'vitest'
import { competenciaDe, janelaExtrato, pontosNome, sugerirPix, txidRepasse, type TransacaoExtrato } from '../repasse-pagamentos'

const tx = (id: string, data: string, valor: number, nome: string): TransacaoExtrato => ({
  id, occurred_on: data, amount: valor, counterparty_name: nome, counterparty_doc: null, transaction_type: 'PIX',
})

describe('pagamentos de repasse', () => {
  it('competência e janela do extrato (mês seguinte até o fim do 2º mês)', () => {
    expect(competenciaDe('AGOSTO', 2026)).toBe('2026-08-01')
    expect(janelaExtrato('2026-08-01')).toEqual({ de: '2026-09-01', ate: '2026-10-31' })
    expect(janelaExtrato('2026-12-01')).toEqual({ de: '2027-01-01', ate: '2027-02-28' })
  })

  it('nome: ignora LTDA, PSICOLOGA, DA, DE…', () => {
    expect(pontosNome('Juliana da Silva Matos', 'PSICOLOGA JULIANA DA SILVA MATOS LTDA')).toBe(3)
    expect(pontosNome('Beatriz Noskoski', 'Beatriz Santos Noskoski')).toBe(2)
    expect(pontosNome('Beatriz Noskoski', 'BEATRIZ FIGUEIREDO DE LIMA SANTIAGO')).toBe(1)
  })

  const extrato = [
    tx('1', '2026-09-01', 865.08, 'Beatriz Santos Noskoski'),
    tx('2', '2026-09-10', 7, 'BEATRIZ FIGUEIREDO DE LIMA SANTIAGO'),
    tx('3', '2026-09-16', 1392, 'BEATRIZ FIGUEIREDO DE LIMA SANTIAGO'),
    tx('4', '2026-09-02', 240.3, 'PSICOLOGA JULIANA DA SILVA MATOS LTDA'),
    tx('5', '2026-09-08', 29.7, 'PSICOLOGA JULIANA DA SILVA MATOS LTDA'),
  ]

  it('acha o Pix certo pelo valor + nome e não confunde homônima', () => {
    expect(sugerirPix('Beatriz Santos Noskoski', 865.08, extrato, new Set())?.transacao.id).toBe('1')
    expect(sugerirPix('Juliana da Silva Matos', 240.3, extrato, new Set())).toMatchObject({ valorConfere: true, transacao: { id: '4' } })
  })

  it('valor diferente com nome forte vira sugestão marcada como divergente', () => {
    expect(sugerirPix('Juliana da Silva Matos', 270, extrato, new Set(['4']))).toMatchObject({ valorConfere: false, transacao: { id: '5' } })
  })

  it('só 1 palavra em comum e valor diferente → nada', () => {
    expect(sugerirPix('Beatriz Noskoski', 500, extrato.slice(1, 3), new Set())).toBeNull()
  })

  it('não reaproveita Pix já vinculado', () => {
    expect(sugerirPix('Beatriz Santos Noskoski', 865.08, extrato, new Set(['1']))).toBeNull()
  })

  it('txid só com letras e números, até 25', () => {
    const t = txidRepasse('2026-09-01', '1LUytaan5CC1QqPQlzIFviJzekdEOd5kskNdSTzXtf2I')
    expect(t).toMatch(/^[A-Za-z0-9]{1,25}$/)
    expect(t.startsWith('REPHOPE202609')).toBe(true)
  })
})
