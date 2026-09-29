// ================================================================
// DRE gerencial (regime de caixa, extrato do Cora) — montagem pura
// ================================================================

export type LinhaDreBanco = { mes: number; grupo: string; categoria: string; detalhe: string | null; valor: number; qtd: number }

export const CATEGORIAS_DRE: { grupo: 'receita' | 'deducao' | 'custo' | 'despesa' | 'nao_operacional' | 'fora'; categoria: string }[] = [
  { grupo: 'receita', categoria: 'Receita de convênios' },
  { grupo: 'receita', categoria: 'Receita de particulares' },
  { grupo: 'receita', categoria: 'Outras receitas' },
  { grupo: 'deducao', categoria: 'Impostos e taxas' },
  { grupo: 'custo', categoria: 'Repasse às psicólogas' },
  { grupo: 'despesa', categoria: 'Pessoal e pró-labore' },
  { grupo: 'despesa', categoria: 'Ocupação (aluguel, condomínio)' },
  { grupo: 'despesa', categoria: 'Utilidades (energia, água, gás, internet)' },
  { grupo: 'despesa', categoria: 'Serviços profissionais (contábil, jurídico)' },
  { grupo: 'despesa', categoria: 'Marketing e anúncios' },
  { grupo: 'despesa', categoria: 'Tecnologia e sistemas' },
  { grupo: 'despesa', categoria: 'Material, copa e consumo' },
  { grupo: 'despesa', categoria: 'Tarifas e juros bancários' },
  { grupo: 'despesa', categoria: 'Outras despesas' },
  { grupo: 'nao_operacional', categoria: 'Retiradas dos sócios' },
  { grupo: 'nao_operacional', categoria: 'Empréstimos e cartões (pagamentos)' },
  { grupo: 'nao_operacional', categoria: 'Aportes e empréstimos recebidos' },
  { grupo: 'fora', categoria: 'Transferência entre contas (fora do DRE)' },
]

export type LinhaDre = {
  chave: string
  rotulo: string
  tipo: 'titulo' | 'item' | 'subitem' | 'subtotal' | 'resultado'
  sinal?: '+' | '−' | '='
  porMes: number[] // índice 0..11
  total: number
}

const r2 = (v: number) => Math.round(v * 100) / 100
const vazio = () => Array.from({ length: 12 }, () => 0)
const soma = (...ls: number[][]) => vazio().map((_, i) => r2(ls.reduce((t, l) => t + (l[i] ?? 0), 0)))
const tot = (l: number[]) => r2(l.reduce((t, v) => t + v, 0))

/** Monta as linhas do DRE a partir do agregado mês × categoria (valores com sinal: entrada +, saída −). */
export function montarDre(dados: LinhaDreBanco[]): { linhas: LinhaDre[]; receitaBruta: number[] } {
  const porCat = new Map<string, number[]>()
  const porPlano = new Map<string, number[]>()
  for (const d of dados) {
    const i = Number(d.mes) - 1
    if (i < 0 || i > 11) continue
    const l = porCat.get(d.categoria) ?? vazio()
    l[i] = r2(l[i] + Number(d.valor))
    porCat.set(d.categoria, l)
    if (d.categoria === 'Receita de convênios') {
      const k = d.detalhe || 'Outros convênios'
      const p = porPlano.get(k) ?? vazio()
      p[i] = r2(p[i] + Number(d.valor))
      porPlano.set(k, p)
    }
  }
  const cat = (c: string) => porCat.get(c) ?? vazio()
  const cats = (g: string) => CATEGORIAS_DRE.filter((c) => c.grupo === g).map((c) => c.categoria)
  const linha = (chave: string, rotulo: string, tipo: LinhaDre['tipo'], porMes: number[], sinal?: LinhaDre['sinal']): LinhaDre => ({
    chave,
    rotulo,
    tipo,
    sinal,
    porMes,
    total: tot(porMes),
  })

  const receitaBruta = soma(...cats('receita').map(cat))
  const deducoes = soma(...cats('deducao').map(cat))
  const receitaLiquida = soma(receitaBruta, deducoes)
  const custos = soma(...cats('custo').map(cat))
  const margem = soma(receitaLiquida, custos)
  const despesas = soma(...cats('despesa').map(cat))
  const operacional = soma(margem, despesas)
  const naoOp = soma(...cats('nao_operacional').map(cat))
  const caixa = soma(operacional, naoOp)

  const planos = [...porPlano.entries()].sort((a, b) => tot(b[1]) - tot(a[1]))
  const linhas: LinhaDre[] = [
    linha('receita', 'Receita bruta', 'subtotal', receitaBruta, '+'),
    linha('conv', 'Convênios', 'item', cat('Receita de convênios')),
    ...planos.map(([p, v]) => linha(`conv-${p}`, p, 'subitem', v)),
    linha('part', 'Particulares', 'item', cat('Receita de particulares')),
    linha('outrasrec', 'Outras receitas', 'item', cat('Outras receitas')),
    linha('ded', 'Impostos e taxas', 'item', deducoes, '−'),
    linha('rliq', 'Receita líquida', 'subtotal', receitaLiquida, '='),
    linha('rep', 'Repasse às psicólogas', 'item', custos, '−'),
    linha('margem', 'Margem de contribuição', 'subtotal', margem, '='),
    linha('desp', 'Despesas operacionais', 'titulo', despesas, '−'),
    ...cats('despesa').map((c) => linha(`d-${c}`, c, 'subitem', cat(c))),
    linha('oper', 'Resultado operacional', 'resultado', operacional, '='),
    ...cats('nao_operacional').map((c) => linha(`n-${c}`, c, 'item', cat(c))),
    linha('caixa', 'Resultado de caixa do período', 'resultado', caixa, '='),
  ]
  return { linhas, receitaBruta }
}
