// ================================================================
// Conferência de guias — 3 pontas: psicóloga (aba Atendimentos),
// admin (ADM Registro de Guia / BD_GUIAS) e plano (XML Unimed /
// lote Orizon). Regras de leitura puras (testáveis).
// ================================================================

export type LinhaConferencia = {
  origem: 'sessao' | 'so_admin'
  spreadsheet_id: string | null
  psicologa: string | null
  paciente: string | null
  data_sessao: string | null
  guia: string | null
  tipo_atendimento: string | null
  anexo: 'sim' | 'nao' | null
  anexo_texto: string | null
  status_s: string | null
  status_classe: 'faturada' | 'pendente' | 'falta' | 'glosa' | 'outro' | null
  admin_registrou: boolean
  plano: string | null
  plano_fonte: 'admin' | 'unimed_xml' | 'orizon' | 'formato_guia' | 'desconhecido'
  operadora_status:
    | 'pago'
    | 'glosado'
    | 'parcial'
    | 'guia_sem_esta_sessao'
    | 'aguardando'
    | 'lote_enviado'
    | 'lote_pago'
    | 'sem_retorno_integrado'
    | 'guia_no_xml'
  operadora_valor: number | null
  operadora_glosa: number | null
  operadora_codigos: string | null
  operadora_ref: string | null
  valor_planilha: number | null
}

export type CodigoProblema =
  | 'sem_anexo'
  | 'sem_guia'
  | 'fora_do_adm'
  | 'sem_status'
  | 'ok_glosado'
  | 'pago_sem_ok'
  | 'falta_faturada'
  | 'so_admin'

export const PROBLEMAS: Record<CodigoProblema, { rotulo: string; grave: boolean; explica: string }> = {
  ok_glosado: { rotulo: 'OK, mas glosada', grave: true, explica: 'A psicóloga recebe repasse e a clínica não recebeu.' },
  falta_faturada: { rotulo: 'Falta faturada', grave: true, explica: 'Sessão marcada como falta foi cobrada da operadora.' },
  pago_sem_ok: { rotulo: 'Paga sem OK', grave: false, explica: 'A clínica recebeu; falta dar OK para gerar o repasse.' },
  sem_anexo: { rotulo: 'Sem anexo da guia', grave: false, explica: 'A psicóloga não anexou a guia (coluna H).' },
  sem_guia: { rotulo: 'Sem nº de guia', grave: false, explica: 'Sessão registrada sem número de guia (coluna E).' },
  fora_do_adm: { rotulo: 'Não lançada no ADM', grave: false, explica: 'A guia não está no ADM Registro de Guia.' },
  sem_status: { rotulo: 'Sem status', grave: false, explica: 'Coluna S vazia: nem OK, nem glosa, nem falta.' },
  so_admin: { rotulo: 'Só no ADM', grave: false, explica: 'O admin lançou a guia, mas não há sessão com ela nas planilhas.' },
}

const PAGO = new Set(['pago', 'parcial', 'lote_pago'])

/** Problemas de uma linha, do mais grave ao mais leve. */
export function problemas(l: LinhaConferencia): CodigoProblema[] {
  if (l.origem === 'so_admin') return ['so_admin']
  const out: CodigoProblema[] = []
  const realizada = l.status_classe !== 'falta'
  if (l.status_classe === 'faturada' && (l.operadora_status === 'glosado' || l.operadora_status === 'parcial') && Number(l.operadora_glosa ?? 0) > 0)
    out.push('ok_glosado')
  if (l.status_classe === 'falta' && PAGO.has(l.operadora_status)) out.push('falta_faturada')
  if (l.status_classe !== 'faturada' && l.status_classe !== 'falta' && PAGO.has(l.operadora_status)) out.push('pago_sem_ok')
  if (!l.guia) out.push('sem_guia')
  else if (!l.admin_registrou && realizada) out.push('fora_do_adm')
  if (realizada && l.anexo === 'nao') out.push('sem_anexo')
  if (l.status_classe === 'pendente') out.push('sem_status')
  return out
}

export const ROTULO_OPERADORA: Record<LinhaConferencia['operadora_status'], string> = {
  pago: 'Pago',
  parcial: 'Pago parcial',
  glosado: 'Glosado',
  guia_sem_esta_sessao: 'Guia no XML, sessão não',
  aguardando: 'Aguardando retorno',
  lote_enviado: 'Lote enviado',
  lote_pago: 'Lote pago',
  sem_retorno_integrado: 'Sem retorno integrado',
  guia_no_xml: 'Guia no XML',
}

export function normalizarPlano(p: string | null): string {
  if (!p) return '—'
  const t = p.trim().toLowerCase()
  if (t.startsWith('unimed')) return 'Unimed'
  if (t.startsWith('bradesco')) return 'Bradesco'
  return t.replace(/(^|\s)\S/g, (c) => c.toUpperCase())
}

export type ResumoPsicologa = {
  psicologa: string
  sessoes: number
  faltas: number
  semAnexo: number
  foraDoAdm: number
  semGuia: number
  semStatus: number
  okGlosado: number
  pagoSemOk: number
  faltaFaturada: number
  pagas: number
  aguardando: number
  soAdmin: number
}

export function resumir(linhas: LinhaConferencia[]): ResumoPsicologa[] {
  const m = new Map<string, ResumoPsicologa>()
  for (const l of linhas) {
    const nome = l.psicologa || '(sem psicóloga)'
    const r =
      m.get(nome) ??
      { psicologa: nome, sessoes: 0, faltas: 0, semAnexo: 0, foraDoAdm: 0, semGuia: 0, semStatus: 0, okGlosado: 0, pagoSemOk: 0, faltaFaturada: 0, pagas: 0, aguardando: 0, soAdmin: 0 }
    const ps = problemas(l)
    if (l.origem === 'so_admin') r.soAdmin++
    else {
      if (l.status_classe === 'falta') r.faltas++
      else r.sessoes++
      if (PAGO.has(l.operadora_status)) r.pagas++
      if (['aguardando', 'lote_enviado', 'guia_sem_esta_sessao'].includes(l.operadora_status) && l.status_classe !== 'falta') r.aguardando++
    }
    for (const p of ps) {
      if (p === 'sem_anexo') r.semAnexo++
      if (p === 'fora_do_adm') r.foraDoAdm++
      if (p === 'sem_guia') r.semGuia++
      if (p === 'sem_status') r.semStatus++
      if (p === 'ok_glosado') r.okGlosado++
      if (p === 'pago_sem_ok') r.pagoSemOk++
      if (p === 'falta_faturada') r.faltaFaturada++
    }
    m.set(nome, r)
  }
  return [...m.values()].sort((a, b) => b.sessoes - a.sessoes || a.psicologa.localeCompare(b.psicologa, 'pt-BR'))
}

/** Compara nomes de psicóloga de sistemas diferentes ("PSI Gabriella" = "Psi GABRIELLA "). */
export const chaveNome = (s: string | null) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
