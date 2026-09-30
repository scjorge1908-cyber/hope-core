import { requireFinanceAccess } from '@/lib/financeiro/server'
import { prepararBase, type BaseBi, type Filtros } from './bi'

type Sp = Record<string, string | string[] | undefined>
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/** Lê os filtros da URL (?psi=&periodo=&plano=&cidade=&faixa=). */
export function lerFiltros(sp: Sp): Filtros {
  const faixa = um(sp.faixa)
  return {
    psi: um(sp.psi) || undefined,
    plano: um(sp.plano) || undefined,
    cidade: um(sp.cidade) || undefined,
    faixa: ['crianca', 'adolescente', 'adulto', 'idoso'].includes(faixa) ? faixa : undefined,
    periodo: Number(um(sp.periodo)) || 1,
  }
}

/** Busca a base do BI (bi_base) e prepara as tabelas de consulta. */
export async function carregarBi() {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return { erro: 'Sem acesso.', base: null, bruto: null }
  const { data, error } = await supabase.rpc('bi_base')
  if (error || !data) return { erro: error?.message ?? 'Sem dados', base: null, bruto: null }
  const bruto = data as unknown as BaseBi
  return { erro: null, base: prepararBase(bruto), bruto }
}
