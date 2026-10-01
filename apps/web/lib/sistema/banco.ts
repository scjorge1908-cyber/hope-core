/**
 * Tela "Banco de dados" — tipos do que as funções db_* devolvem e as
 * conversões texto ⇄ valor usadas na grade estilo Excel.
 * (imports relativos: este arquivo também roda no vitest)
 */

export type TabelaCatalogo = {
  esquema: string
  tabela: string
  tipo: 'tabela' | 'visão' | 'visão materializada'
  linhas: number | null
  porClinica: boolean
  somenteLeitura: boolean
  colunas: number
  area: string | null
  titulo: string | null
  paraQue: string | null
  origem: string | null
  usadoEm: string | null
}

export type Referencia = { esquema: string; tabela: string; coluna: string }

export type Coluna = {
  nome: string
  tipo: string
  nulo: boolean
  padrao: string | null
  gerada: boolean
  pk: boolean
  oculta: boolean
  descricao: string | null
  referencia: Referencia | null
}

export type DetalheTabela = {
  esquema: string
  tabela: string
  tipo: string
  somenteLeitura: boolean
  porClinica: boolean
  descricao: {
    area: string | null
    titulo: string | null
    para_que: string | null
    origem: string | null
    usado_em: string | null
    updated_at: string | null
  } | null
  comentario: string | null
  colunas: Coluna[]
  chave: string[]
  referenciadaPor: Referencia[]
  funcoes: string[]
  visoes: string[]
  ultimasAlteracoes: { quando: string; operacao: 'inserir' | 'editar' | 'excluir'; chave: Record<string, unknown> | null; quem: string | null }[]
}

export type Linha = Record<string, unknown>
export type PaginaLinhas = { total: number; linhas: Linha[] }

export const SEM_AREA = 'Sem descrição (tabelas novas)'

/** Ordem das áreas na tela; áreas novas (digitadas na tela) vão para o fim, em ordem alfabética. */
export const ORDEM_AREAS = [
  'Espelho das planilhas',
  'Faturamento de convênios',
  'Financeiro e banco',
  'Repasse às psicólogas',
  'Clínica (sistema novo)',
  'Sistema e segurança',
]

export function agruparPorArea(tabelas: TabelaCatalogo[]): { area: string; tabelas: TabelaCatalogo[] }[] {
  const mapa = new Map<string, TabelaCatalogo[]>()
  for (const t of tabelas) {
    const a = t.area?.trim() || SEM_AREA
    const lista = mapa.get(a) ?? []
    lista.push(t)
    mapa.set(a, lista)
  }
  const peso = (a: string) => {
    if (a === SEM_AREA) return -1 // tabela nova sem descrição aparece primeiro, para ser descrita
    const i = ORDEM_AREAS.indexOf(a)
    return i === -1 ? ORDEM_AREAS.length : i
  }
  return [...mapa.entries()]
    .sort(([a], [b]) => peso(a) - peso(b) || a.localeCompare(b, 'pt-BR'))
    .map(([area, ts]) => ({
      area,
      tabelas: ts.sort((x, y) => (x.titulo ?? x.tabela).localeCompare(y.titulo ?? y.tabela, 'pt-BR')),
    }))
}

/** Tipo da coluna em grupos que mudam como o valor é editado. */
export function familia(tipo: string): 'numero' | 'booleano' | 'json' | 'data' | 'texto' {
  const t = tipo.toLowerCase()
  if (t.endsWith('[]') || t === 'json' || t === 'jsonb') return 'json'
  if (t === 'boolean') return 'booleano'
  if (/^(smallint|integer|bigint|numeric|real|double precision|money)/.test(t)) return 'numero'
  if (/^(date|timestamp|time)/.test(t)) return 'data'
  return 'texto'
}

/** Valor do banco → texto mostrado/editado na célula. */
export function paraTexto(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * Texto digitado → valor para o banco. Vazio vira null (o banco recusa se a
 * coluna for obrigatória). Lança Error com mensagem amigável se inválido.
 */
export function deTexto(texto: string, tipo: string): unknown {
  const bruto = texto
  const t = bruto.trim()
  if (t === '') return null
  switch (familia(tipo)) {
    case 'numero': {
      // aceita 1.234,56 (Brasil) e 1234.56
      const normal = /,\d*$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t
      const n = Number(normal)
      if (!Number.isFinite(n)) throw new Error(`"${t}" não é um número`)
      return n
    }
    case 'booleano': {
      const b = t.toLowerCase()
      if (['true', 'sim', 's', '1', 'verdadeiro', '✓'].includes(b)) return true
      if (['false', 'não', 'nao', 'n', '0', 'falso', '✗'].includes(b)) return false
      throw new Error(`"${t}" não é sim/não`)
    }
    case 'json':
      try {
        return JSON.parse(t)
      } catch {
        throw new Error('JSON inválido (confira aspas, colchetes e vírgulas)')
      }
    default:
      return bruto
  }
}

/** Valores da chave primária de uma linha (identifica a linha para editar/excluir). */
export function chaveDaLinha(linha: Linha, chave: string[]): Record<string, unknown> {
  return Object.fromEntries(chave.map((c) => [c, linha[c] ?? null]))
}

/** Texto curto para a célula (a completa fica no title). */
export function resumo(v: unknown, max = 80): string {
  const s = paraTexto(v)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** CSV (separador ;, padrão do Excel em pt-BR) das linhas e colunas informadas. */
export function paraCsv(colunas: string[], linhas: Linha[]): string {
  const cel = (v: unknown) => {
    const s = paraTexto(v)
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [colunas.join(';'), ...linhas.map((l) => colunas.map((c) => cel(l[c])).join(';'))].join('\r\n')
}
