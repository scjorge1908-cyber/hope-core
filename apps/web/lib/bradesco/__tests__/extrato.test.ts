import { describe, expect, it } from 'vitest'
import { centavos, contraparte, dataIso, formatarData, lancamentosDoExtrato, saldoFinal, type ExtratoBradesco } from '../extrato'

// formato do exemplo oficial da API (extratoPorPeriodo.lstLancamentoMensal)
const ex: ExtratoBradesco = {
  extratoPorPeriodo: [
    {
      codigoRetorno: '0',
      lstLancamentoMensal: [
        { dataLancamento: '30/09/2026', numeroDocumento: '0000000', valorLancamento: 0, sinalLancamento: '+', valorSaldoAposLancamento: 8000, sinalSaldo: '+', codigoLancamento: '00000', descritivoLancamentoAbreviado: 'Saldo Anterior', descritivoLancamentoCompleto: 'Saldo Anterior' },
        { dataLancamento: '01/10/2026', numeroDocumento: '0936269', valorLancamento: '1.234,56', sinalLancamento: '+', segundaLinhalLancamento: 'REM: BRADESCO SAUDE S A 01/10', codigoLancamento: '1674', descritivoLancamentoAbreviado: 'TRANSFE PIX', descritivoLancamentoCompleto: 'TRANSFERENCIA PIX', valorSaldoAposLancamento: '9.234,56', sinalSaldo: '+' },
        { dataLancamento: '01/10/2026', numeroDocumento: '0936270', valorLancamento: '80', sinalLancamento: '-', segundaLinhalLancamento: 'DES: FULANA DE TAL', codigoLancamento: '1675', descritivoLancamentoAbreviado: 'PIX ENVIADO', valorSaldoAposLancamento: '9.154,56', sinalSaldo: '+' },
        { dataLancamento: '01/10/2026', numeroDocumento: '0936270', valorLancamento: '80', sinalLancamento: '-', segundaLinhalLancamento: 'DES: FULANA DE TAL', codigoLancamento: '1675', descritivoLancamentoAbreviado: 'PIX ENVIADO', valorSaldoAposLancamento: '9.074,56', sinalSaldo: '+' },
      ],
    },
  ],
}

describe('extrato Bradesco → lançamentos do banco', () => {
  it('converte valores, datas e contraparte; ignora Saldo Anterior', () => {
    const l = lancamentosDoExtrato(ex)
    expect(l).toHaveLength(3)
    expect(l[0]).toMatchObject({ type: 'CREDIT', amount: 123456, createdAt: '2026-10-01T12:00:00', transaction: { counterParty: { name: 'BRADESCO SAUDE S A' } } })
    expect(l[1]).toMatchObject({ type: 'DEBIT', amount: 8000, transaction: { counterParty: { name: 'FULANA DE TAL' } } })
  })

  it('dois lançamentos idênticos no mesmo dia ganham ids diferentes e estáveis', () => {
    const a = lancamentosDoExtrato(ex)
    const b = lancamentosDoExtrato(ex)
    expect(a[1].id).not.toBe(a[2].id)
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id))
  })

  it('saldo após o último lançamento', () => {
    expect(saldoFinal(ex)).toBe(907456)
  })

  it('valores em centavos quando configurado', () => {
    expect(centavos('8000', true)).toBe(8000)
    expect(centavos(80)).toBe(8000)
    expect(centavos('1234.56')).toBe(123456)
    expect(centavos('')).toBe(0)
  })

  it('auxiliares', () => {
    expect(dataIso('30/09/2026')).toBe('2026-09-30')
    expect(dataIso('2026-09-30')).toBeNull()
    expect(contraparte('REM: EMPRESA PAGADOR 22/01')).toBe('EMPRESA PAGADOR')
    expect(contraparte('')).toBeNull()
    expect(formatarData('2026-10-02', 'dd/MM/yyyy')).toBe('02/10/2026')
    expect(formatarData('2026-10-02', 'ddMMyyyy')).toBe('02102026')
  })

  it('resposta vazia (CTAS0014) não quebra', () => {
    expect(lancamentosDoExtrato({})).toEqual([])
    expect(saldoFinal({})).toBeNull()
  })
})
