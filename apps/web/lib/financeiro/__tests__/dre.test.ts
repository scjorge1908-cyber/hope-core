import { describe, expect, it } from 'vitest'
import { montarDre } from '../dre'

describe('montarDre', () => {
  it('soma receitas, deduções, custos e despesas por mês', () => {
    const { linhas } = montarDre([
      { mes: 1, grupo: 'receita', categoria: 'Receita de convênios', detalhe: 'Unimed', valor: 1000, qtd: 1 },
      { mes: 1, grupo: 'receita', categoria: 'Receita de particulares', detalhe: null, valor: 200, qtd: 2 },
      { mes: 1, grupo: 'deducao', categoria: 'Impostos e taxas', detalhe: null, valor: -60, qtd: 1 },
      { mes: 1, grupo: 'custo', categoria: 'Repasse às psicólogas', detalhe: null, valor: -500, qtd: 3 },
      { mes: 1, grupo: 'despesa', categoria: 'Ocupação (aluguel, condomínio)', detalhe: null, valor: -300, qtd: 1 },
      { mes: 2, grupo: 'nao_operacional', categoria: 'Retiradas dos sócios', detalhe: null, valor: -100, qtd: 1 },
    ])
    const v = (k: string) => linhas.find((l) => l.chave === k)!
    expect(v('receita').porMes[0]).toBe(1200)
    expect(v('conv-Unimed').total).toBe(1000)
    expect(v('rliq').porMes[0]).toBe(1140)
    expect(v('margem').porMes[0]).toBe(640)
    expect(v('oper').porMes[0]).toBe(340)
    expect(v('caixa').total).toBe(240)
  })
})
