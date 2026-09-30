// ================================================================
// BI da clínica — porte das regras do "Sistema Gerencial e BI"
// (Apps Script: Código.gs / Sincronizacao.gs / Agenda.gs) para o HOPE CORE.
// Módulo puro: recebe o JSON de bi_base() (paciente = hash do nome) e
// devolve os números de cada tela. Regras mantidas como no original;
// as poucas diferenças estão marcadas com "DIFERENÇA".
// ================================================================

type N = number | string | null | undefined
const num = (v: N) => (v === null || v === undefined || v === '' ? 0 : Number(v))

// ---------- tipos da base ----------
export type PsicologaBase = {
  sid: string
  nome: string
  nomeCompleto: string | null
  ordem: number | null
  ativo: boolean
  desligada: boolean
  agendaEm: string | null
}
// [sid, linha, dia, horario, tipo, pac, plano, valor, sala, nascimento, cidade, bairro, inicio]
export type AgendaRow = [string, number, string | null, string | null, string, string | null, string | null, N, string | null, string | null, string | null, string | null, string | null]
// [sid, linha, pac, plano, valor, nascimento, cidade, bairro, inicio, cancelamento, dia]
export type CanceladoRow = [string, number, string, string | null, N, string | null, string | null, string | null, string | null, string | null, string | null]
// [sid, pac, tipo, timestamp, dataSessao, guia, statusS, valor]
export type AtendimentoRow = [string, string, string | null, string | null, string | null, string | null, string, N]
// [psicologaChave, mes, ano, guias[]]
export type BdGuiaRow = [string, N, N, string[]]

export type BaseBi = {
  hoje: string
  psicologas: PsicologaBase[]
  agenda: AgendaRow[]
  cancelados: CanceladoRow[]
  atendimentos: AtendimentoRow[]
  bdGuias: BdGuiaRow[]
  salas: { cabecalho: string[]; sincronizadoEm: string | null; linhas: string[][] }
  sync: { atendimentos: string | null; agenda: string | null; bdGuias: string | null }
}

export type Filtros = { psi?: string; plano?: string; cidade?: string; faixa?: string; periodo?: number }

// ---------- utilitários (iguais aos do Apps Script) ----------
/** normalizarTexto(): trim, espaços simples, minúsculas, sem acento. */
export function normalizar(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

const DIA_MS = 86_400_000
const tD = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
const isoDe = (t: number) => new Date(t).toISOString().slice(0, 10)
export const chaveMes = (iso: string) => iso.slice(0, 7)
export function somarMesesChave(chave: string, k: number) {
  const y = Number(chave.slice(0, 4))
  const m = Number(chave.slice(5, 7)) - 1 + k
  const d = new Date(Date.UTC(y, m, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export type Faixa = 'crianca' | 'adolescente' | 'adulto' | 'idoso'
export const ROTULO_FAIXA: Record<Faixa | 'nao', string> = {
  crianca: 'Crianças (0–11)',
  adolescente: 'Adolescentes (12–17)',
  adulto: 'Adultos (18–59)',
  idoso: 'Idosos (60+)',
  nao: 'Não informado',
}
export function faixaEtaria(nasc: string | null, hoje: string): Faixa | null {
  if (!nasc) return null
  let idade = Number(hoje.slice(0, 4)) - Number(nasc.slice(0, 4))
  const md = Number(hoje.slice(5, 7)) - Number(nasc.slice(5, 7))
  if (md < 0 || (md === 0 && Number(hoje.slice(8, 10)) < Number(nasc.slice(8, 10)))) idade--
  if (idade <= 11) return 'crianca'
  if (idade <= 17) return 'adolescente'
  if (idade <= 59) return 'adulto'
  return 'idoso'
}

/** _isGuiaValida(): não vazio, não "GUIA", e não "só dígitos com menos de 7". */
export function guiaValida(v: unknown) {
  const s = String(v ?? '').trim()
  if (!s) return false
  if (s.toUpperCase() === 'GUIA') return false
  if (/^[0-9]+$/.test(s) && s.length < 7) return false
  return true
}

type RegPaciente = { plano: string | null; cidade: string | null; nasc: string | null }
function passaFiltros(r: RegPaciente, f: Filtros, hoje: string) {
  if (f.plano && normalizar(r.plano) !== normalizar(f.plano)) return false
  if (f.cidade && normalizar(r.cidade) !== normalizar(f.cidade)) return false
  if (f.faixa && faixaEtaria(r.nasc, hoje) !== f.faixa) return false
  return true
}

/** Soma um mapa "AAAA-MM" → n no bloco de `n` meses que termina no mês de hoje (offset 0) ou no anterior (1). */
export function somarPeriodo(mapa: Record<string, number>, n: number, offset: number, hoje: string) {
  let soma = 0
  const base = chaveMes(hoje)
  for (let i = offset * n; i < offset * n + n; i++) soma += mapa[somarMesesChave(base, -i)] || 0
  return soma
}

const somar = (mapa: Record<string, number>, chave: string, v = 1) => {
  mapa[chave] = (mapa[chave] || 0) + v
}

// ---------- estrutura comum ----------
export function prepararBase(base: BaseBi) {
  const psicologas = [...base.psicologas]
    .filter((p) => p.ativo && !p.desligada)
    .sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999) || a.nome.localeCompare(b.nome))
  const sids = new Set(psicologas.map((p) => p.sid))
  const agenda = base.agenda.filter((r) => sids.has(r[0])).sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : 0))
  const cancelados = base.cancelados.filter((r) => sids.has(r[0]))
  const atendimentos = base.atendimentos.filter((r) => sids.has(r[0]))

  // tabelas de consulta SEM filtro (como no original)
  const historicoInicio: Record<string, string> = {}
  for (const c of base.cancelados) {
    const ini = c[8]
    if (!ini || !c[2]) continue
    if (!historicoInicio[c[2]] || ini < historicoInicio[c[2]]) historicoInicio[c[2]] = ini
  }
  const ultimoAtendimento: Record<string, string> = {}
  for (const a of base.atendimentos) {
    const ts = a[3]
    if (!ts) continue
    if (!ultimoAtendimento[a[1]] || ts > ultimoAtendimento[a[1]]) ultimoAtendimento[a[1]] = ts
  }
  const ativosNaAgenda = new Set(base.agenda.filter((r) => r[4] === 'PACIENTE' && r[5]).map((r) => r[5] as string))
  const guiasLancadas: Record<string, Set<string>> = {}
  for (const a of base.atendimentos) {
    if (!a[5] || !guiaValida(a[5])) continue
    ;(guiasLancadas[a[0]] ??= new Set()).add(String(a[5]).trim())
  }
  const sidPorNome: Record<string, string> = {}
  for (const p of base.psicologas) {
    if (p.nome) sidPorNome[normalizar(p.nome)] = p.sid
    if (p.nomeCompleto) sidPorNome[normalizar(p.nomeCompleto)] = p.sid
  }
  return { hoje: base.hoje, psicologas, agenda, cancelados, atendimentos, historicoInicio, ultimoAtendimento, ativosNaAgenda, guiasLancadas, sidPorNome, bdGuias: base.bdGuias }
}
export type BasePreparada = ReturnType<typeof prepararBase>

export type TipoNovo = 'NOVO' | 'RETORNO' | 'TRANSFERENCIA'
export const DIAS_GAP_RETORNO = 30
export function classificarNovoPaciente(pac: string, cand: string, b: Pick<BasePreparada, 'historicoInicio' | 'ultimoAtendimento'>): TipoNovo {
  const hist = b.historicoInicio[pac]
  if (!hist || hist >= cand) return 'NOVO'
  const ult = b.ultimoAtendimento[pac]
  if (!ult) return 'RETORNO'
  const gap = Math.round((tD(cand) - tD(ult)) / DIA_MS)
  return gap <= DIAS_GAP_RETORNO ? 'TRANSFERENCIA' : 'RETORNO'
}

const ehSessaoRealizada = (tipo: string | null) => normalizar(tipo) === 'sessao realizada'

// ---------- Dashboard ----------
export type Kpi = { atual: number; anterior: number; nota: string }
export function dashboard(b: BasePreparada, f: Filtros) {
  const n = [1, 3, 6, 12].includes(Number(f.periodo)) ? Number(f.periodo) : 1
  const hoje = b.hoje
  const psis = f.psi ? b.psicologas.filter((p) => p.sid === f.psi) : b.psicologas
  const sel = new Set(psis.map((p) => p.sid))
  const temFiltroAvancado = !!(f.plano || f.cidade || f.faixa)
  const notaNaoFiltra = temFiltroAvancado ? ' Não filtra por plano/cidade/faixa etária (dado não disponível nessa fonte).' : ''

  const agendaPac = b.agenda.filter(
    (r) => sel.has(r[0]) && r[4] === 'PACIENTE' && r[5] && passaFiltros({ plano: r[6], cidade: r[10], nasc: r[9] }, f, hoje),
  )
  const cancFiltrados = b.cancelados.filter((r) => sel.has(r[0]) && passaFiltros({ plano: r[3], cidade: r[6], nasc: r[5] }, f, hoje))

  const pacientesAtivos = new Set(agendaPac.map((r) => r[5] as string)).size

  // novos agendamentos ativos / cancelados
  const novosAtivos: Record<string, number> = {}
  const novosCanc: Record<string, number> = {}
  let transferencias = 0
  let retornosAtivos = 0
  let retornosCanc = 0
  for (const p of psis) {
    const vistos = new Set<string>()
    for (const r of agendaPac) {
      if (r[0] !== p.sid || !r[12] || vistos.has(r[5] as string)) continue
      vistos.add(r[5] as string)
      const t = classificarNovoPaciente(r[5] as string, r[12], b)
      if (t === 'TRANSFERENCIA') {
        transferencias++
        continue
      }
      if (t === 'RETORNO') retornosAtivos++
      somar(novosAtivos, chaveMes(r[12]))
    }
    const vistosC = new Set<string>()
    for (const r of cancFiltrados) {
      if (r[0] !== p.sid || !r[8] || vistosC.has(r[2])) continue
      vistosC.add(r[2])
      const t = classificarNovoPaciente(r[2], r[8], b)
      if (t === 'TRANSFERENCIA') {
        transferencias++
        continue
      }
      if (t === 'RETORNO') retornosCanc++
      somar(novosCanc, chaveMes(r[8]))
    }
  }

  // cancelamentos (linha a linha, sem quem ainda está ativo em alguma Agenda)
  const cancel: Record<string, number> = {}
  const cancelPorPsi: Record<string, Record<string, number>> = {}
  let ignoradosAtivos = 0
  for (const r of cancFiltrados) {
    if (!r[9]) continue
    if (b.ativosNaAgenda.has(r[2])) {
      ignoradosAtivos++
      continue
    }
    somar(cancel, chaveMes(r[9]))
    somar((cancelPorPsi[r[0]] ??= {}), chaveMes(r[9]))
  }

  // atendimentos realizados × faltas (aba Atendimentos, coluna G)
  const realizados: Record<string, number> = {}
  const faltas: Record<string, number> = {}
  let totalRealizados = 0
  let totalFaltas = 0
  for (const a of b.atendimentos) {
    if (!sel.has(a[0])) continue
    if (ehSessaoRealizada(a[2])) {
      totalRealizados++
      if (a[3]) somar(realizados, chaveMes(a[3]))
    } else {
      totalFaltas++
      if (a[4]) somar(faltas, chaveMes(a[4]))
    }
  }

  // guias não lançadas (BD_GUIAS × Atendimentos da psicóloga)
  const guiasNao: Record<string, number> = {}
  let totalGuiasNao = 0
  for (const g of b.bdGuias) {
    const sid = b.sidPorNome[g[0]]
    if (f.psi && sid !== f.psi) continue
    const mes = parseInt(String(g[1]), 10)
    const ano = parseInt(String(g[2]), 10)
    if (!mes || !ano) continue
    const validas = (g[3] || []).filter(guiaValida)
    if (!validas.length) continue
    const lancadas = (sid && b.guiasLancadas[sid]) || new Set<string>()
    for (const guia of validas) {
      if (lancadas.has(guia.trim())) continue
      totalGuiasNao++
      somar(guiasNao, `${ano}-${String(mes).padStart(2, '0')}`)
    }
  }

  const kpi = (mapa: Record<string, number>, nota: string): Kpi => ({
    atual: somarPeriodo(mapa, n, 0, hoje),
    anterior: somarPeriodo(mapa, n, 1, hoje),
    nota,
  })

  const rankingAtivos = psis
    .map((p) => {
      const ativos = new Set(agendaPac.filter((r) => r[0] === p.sid).map((r) => r[5] as string)).size
      return { sid: p.sid, psicologa: p.nome, ativos, pct: pacientesAtivos ? (ativos / pacientesAtivos) * 100 : 0 }
    })
    .sort((a, b2) => b2.ativos - a.ativos)
  const rankingCancel = psis
    .map((p) => ({ sid: p.sid, psicologa: p.nome, cancelamentos: somarPeriodo(cancelPorPsi[p.sid] || {}, n, 0, hoje) }))
    .sort((a, b2) => b2.cancelamentos - a.cancelamentos)

  const meses = [...new Set([...Object.keys(novosAtivos), ...Object.keys(novosCanc), ...Object.keys(cancel), ...Object.keys(realizados), ...Object.keys(faltas)])]
    .sort()
    .slice(-12)

  return {
    periodo: n,
    pacientesAtivos,
    novosAtivos: { ...kpi(novosAtivos, `Data de início na Agenda (novos + retornos; ${transferencias} transferências entre psicólogas não contam).`), retornos: retornosAtivos },
    novosCancelados: { ...kpi(novosCanc, 'Data de início de quem já está em Cancelados (pacientes que começaram e já saíram).'), retornos: retornosCanc },
    cancelamentos: { ...kpi(cancel, `Data de cancelamento (alta ou desistência). ${ignoradosAtivos} linha(s) ignoradas porque o paciente ainda está ativo em alguma agenda.`), total: cancFiltrados.length },
    atendimentos: { ...kpi(realizados, 'Aba Atendimentos, tipo "Sessão realizada", pela data do registro (coluna A).' + notaNaoFiltra), total: totalRealizados },
    faltas: { ...kpi(faltas, 'Aba Atendimentos, qualquer tipo diferente de "Sessão realizada", pela data da sessão.' + notaNaoFiltra), total: totalFaltas },
    guiasNaoLancadas: { ...kpi(guiasNao, 'Guias do Registro de Guias (BD_GUIAS) que ainda não aparecem na aba Atendimentos da psicóloga.' + notaNaoFiltra), total: totalGuiasNao },
    rankingAtivos,
    rankingCancel,
    evolucao: {
      meses,
      novosAtivos: meses.map((m) => novosAtivos[m] || 0),
      novosCancelados: meses.map((m) => novosCanc[m] || 0),
      cancelamentos: meses.map((m) => cancel[m] || 0),
      atendimentos: meses.map((m) => realizados[m] || 0),
      faltas: meses.map((m) => faltas[m] || 0),
    },
  }
}

// ---------- listas dos filtros ----------
export function opcoesFiltro(b: BasePreparada) {
  const planos = new Set<string>()
  const cidades = new Set<string>()
  for (const r of b.agenda) {
    if (r[4] !== 'PACIENTE') continue
    if (r[6]?.trim()) planos.add(r[6].trim())
    if (r[10]?.trim()) cidades.add(r[10].trim())
  }
  const ord = (s: Set<string>) => [...s].sort((a, c) => a.localeCompare(c, 'pt-BR'))
  return { psicologas: b.psicologas.map((p) => ({ sid: p.sid, nome: p.nome })), planos: ord(planos), cidades: ord(cidades) }
}

// ---------- projeção do mês (Planos e Psicólogas) ----------
const TABELA_CURVA: [string, number][] = [
  ['unimed', 33],
  ['bradesco', 45],
  ['select', 80],
  ['geap', 60],
  ['celos', 60],
]
export const VALOR_SUBLOCACAO = 31.9
export function valorSessao(plano: string | null, valorColunaH: N, usarTabela: boolean) {
  const p = normalizar(plano)
  if (p.includes('sublocac') || p.includes('particular')) return VALOR_SUBLOCACAO
  if (usarTabela) for (const [k, v] of TABELA_CURVA) if (p.includes(k)) return v
  const v = Number(valorColunaH)
  return typeof valorColunaH === 'number' || (valorColunaH !== null && valorColunaH !== '' && !Number.isNaN(v)) ? v || 0 : 0
}
export const frequenciaSemanal = (plano: string | null) => (normalizar(plano).includes('bradesco') ? 2 : 1)

const MAPA_DIA: Record<string, number> = {
  domingo: 0, dom: 0,
  segunda: 1, seg: 1,
  terca: 2, ter: 2,
  quarta: 3, qua: 3,
  quinta: 4, qui: 4,
  sexta: 5, sex: 5,
  sabado: 6, sab: 6,
}
/** Dia da semana (0 = domingo). DIFERENÇA: abreviações (Seg, Ter…) também valem; texto desconhecido = null (o original contava como domingo). */
export function indiceDia(dia: string | null): number | null {
  const d = normalizar(dia).replace(/[\s-]*feira\s*$/, '').replace(/\.$/, '')
  return d in MAPA_DIA ? MAPA_DIA[d] : null
}
export function ocorrencias(diaSemana: number, de: string, ate: string) {
  if (de > ate) return 0
  let n = 0
  for (let t = tD(de); t <= tD(ate); t += DIA_MS) if (new Date(t).getUTCDay() === diaSemana) n++
  return n
}
export const inicioFimMes = (hoje: string) => {
  const inicio = `${hoje.slice(0, 7)}-01`
  const fim = isoDe(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0))
  return { inicio, fim }
}

type LinhaProj = { sid: string; plano: string | null; valorH: N; dia: string | null; inicio: string | null; ate?: string }
function projetarLinha(l: LinhaProj, mes: { inicio: string; fim: string }, usarTabela: boolean) {
  const idx = indiceDia(l.dia)
  if (idx === null) return { atend: 0, fat: 0 }
  const de = l.inicio && l.inicio > mes.inicio ? l.inicio : mes.inicio
  const ate = l.ate && l.ate < mes.fim ? l.ate : mes.fim
  const atend = ocorrencias(idx, de, ate) * frequenciaSemanal(l.plano)
  return { atend, fat: atend * valorSessao(l.plano, l.valorH, usarTabela) }
}

function linhasProjecao(b: BasePreparada, f: Filtros, usarPlanoFiltro: boolean): LinhaProj[] {
  const hoje = b.hoje
  const mes = inicioFimMes(hoje)
  const filtro: Filtros = { ...f, plano: usarPlanoFiltro ? f.plano : undefined }
  const sel = (sid: string) => !f.psi || sid === f.psi
  const out: LinhaProj[] = []
  for (const r of b.agenda) {
    if (r[4] !== 'PACIENTE' || !sel(r[0]) || !passaFiltros({ plano: r[6], cidade: r[10], nasc: r[9] }, filtro, hoje)) continue
    out.push({ sid: r[0], plano: r[6], valorH: r[7], dia: r[2], inicio: r[12] })
  }
  for (const c of b.cancelados) {
    if (!sel(c[0]) || !c[9] || c[9] < mes.inicio || c[9] > mes.fim) continue
    if (b.ativosNaAgenda.has(c[2])) continue
    if (!passaFiltros({ plano: c[3], cidade: c[6], nasc: c[5] }, filtro, hoje)) continue
    out.push({ sid: c[0], plano: c[3], valorH: c[4], dia: c[10], inicio: c[8], ate: c[9] })
  }
  return out
}

const r2 = (v: number) => Math.round(v * 100) / 100

export function planos(b: BasePreparada, f: Filtros) {
  const hoje = b.hoje
  const mes = inicioFimMes(hoje)
  const exib: Record<string, string> = {}
  const pacPorPlano: Record<string, Set<string>> = {}
  for (const r of b.agenda) {
    if (r[4] !== 'PACIENTE' || !r[5] || (f.psi && r[0] !== f.psi)) continue
    if (!passaFiltros({ plano: r[6], cidade: r[10], nasc: r[9] }, { ...f, plano: undefined }, hoje)) continue
    const nome = r[6]?.trim() || '(Sem plano informado)'
    const k = normalizar(nome)
    exib[k] ??= nome
    ;(pacPorPlano[k] ??= new Set()).add(r[5])
  }
  const proj: Record<string, { atend: number; fat: number }> = {}
  for (const l of linhasProjecao(b, f, false)) {
    const nome = l.plano?.trim() || '(Sem plano informado)'
    const k = normalizar(nome)
    exib[k] ??= nome
    const p = projetarLinha(l, mes, true)
    const acc = (proj[k] ??= { atend: 0, fat: 0 })
    acc.atend += p.atend
    acc.fat += p.fat
  }
  const pacientesPorPlano = Object.entries(pacPorPlano)
    .map(([k, s]) => ({ plano: exib[k], pacientes: s.size }))
    .sort((a, c) => c.pacientes - a.pacientes)
  const projecaoPorPlano = Object.entries(proj)
    .map(([k, v]) => ({ plano: exib[k], atendimentos: v.atend, faturamento: r2(v.fat) }))
    .sort((a, c) => c.faturamento - a.faturamento)
  return {
    mes: mes.inicio,
    pacientesPorPlano,
    totalPacientes: pacientesPorPlano.reduce((t, x) => t + x.pacientes, 0),
    projecaoPorPlano,
    totalFaturamento: r2(projecaoPorPlano.reduce((t, x) => t + x.faturamento, 0)),
    totalAtendimentos: projecaoPorPlano.reduce((t, x) => t + x.atendimentos, 0),
  }
}

/** Produção real do mês (status "OK" na coluna S, pela data do registro — mesma regra do RPA). */
export function producaoRealPorPsi(b: BasePreparada) {
  const mes = chaveMes(b.hoje)
  const out: Record<string, { valor: number; sessoes: number }> = {}
  for (const a of b.atendimentos) {
    if (a[6] !== 'OK' || !a[3] || chaveMes(a[3]) !== mes) continue
    const acc = (out[a[0]] ??= { valor: 0, sessoes: 0 })
    acc.valor += num(a[7])
    acc.sessoes++
  }
  return out
}

export function psicologas(b: BasePreparada, f: Filtros) {
  const hoje = b.hoje
  const mes = inicioFimMes(hoje)
  const producao = producaoRealPorPsi(b)
  const horasLivres: Record<string, number> = {}
  for (const r of b.agenda) if (r[4] === 'LIVRE') somar(horasLivres, r[0])
  const pac: Record<string, Set<string>> = {}
  for (const r of b.agenda) {
    if (r[4] !== 'PACIENTE' || !r[5] || (f.psi && r[0] !== f.psi)) continue
    if (!passaFiltros({ plano: r[6], cidade: r[10], nasc: r[9] }, f, hoje)) continue
    ;(pac[r[0]] ??= new Set()).add(r[5])
  }
  const proj: Record<string, { atend: number; fat: number }> = {}
  for (const l of linhasProjecao(b, f, true)) {
    const p = projetarLinha(l, mes, false)
    const acc = (proj[l.sid] ??= { atend: 0, fat: 0 })
    acc.atend += p.atend
    acc.fat += p.fat
  }
  const linhas = b.psicologas
    .filter((p) => (!f.psi || p.sid === f.psi) && (pac[p.sid] || proj[p.sid]))
    .map((p) => {
      const fat = producao[p.sid]?.valor ?? 0
      return {
        sid: p.sid,
        psicologa: p.nomeCompleto || p.nome,
        pacientes: pac[p.sid]?.size ?? 0,
        horasLivres: horasLivres[p.sid] ?? 0,
        atendimentosNoMes: proj[p.sid]?.atend ?? 0,
        faturamentoProjetado: r2(proj[p.sid]?.fat ?? 0),
        faturadoNoMes: r2(fat),
        faturado40: r2(fat * 0.4),
        faturado60: r2(fat * 0.6),
      }
    })
    .sort((a, c) => c.pacientes - a.pacientes)
  const tot = (k: keyof (typeof linhas)[number]) => r2(linhas.reduce((t, l) => t + Number(l[k] || 0), 0))
  return {
    mes: mes.inicio,
    linhas,
    totais: {
      pacientes: tot('pacientes'),
      horasLivres: tot('horasLivres'),
      atendimentosNoMes: tot('atendimentosNoMes'),
      faturamentoProjetado: tot('faturamentoProjetado'),
      faturadoNoMes: tot('faturadoNoMes'),
      faturado40: tot('faturado40'),
      faturado60: tot('faturado60'),
    },
  }
}

// ---------- Perfil dos pacientes ----------
export function normalizarCidade(c: string | null) {
  if (!c || !c.trim()) return 'Não informado'
  const s = c.trim().replace(/\s*-\s*[A-Za-zÀ-ÿ]{2}\s*$/, '').trim()
  return s || 'Não informado'
}
export function perfil(b: BasePreparada, f: Filtros) {
  const hoje = b.hoje
  const ordem = new Map(b.psicologas.map((p, i) => [p.sid, i]))
  const linhas = b.agenda
    .filter((r) => r[4] === 'PACIENTE' && r[5] && (!f.psi || r[0] === f.psi) && passaFiltros({ plano: r[6], cidade: r[10], nasc: r[9] }, f, hoje))
    .sort((a, c) => (ordem.get(a[0]) ?? 999) - (ordem.get(c[0]) ?? 999) || a[1] - c[1])
  const vistos = new Set<string>()
  const faixa: Record<string, number> = {}
  const cidade: Record<string, { rotulo: string; n: number }> = {}
  const bairro: Record<string, number> = {}
  const bairroPorCidade: Record<string, Record<string, number>> = {}
  for (const r of linhas) {
    if (vistos.has(r[5] as string)) continue
    vistos.add(r[5] as string)
    somar(faixa, ROTULO_FAIXA[faixaEtaria(r[9], hoje) ?? 'nao'])
    const c = normalizarCidade(r[10])
    const kc = normalizar(c)
    ;(cidade[kc] ??= { rotulo: c, n: 0 }).n++
    const bb = r[11]?.trim() || 'Não informado'
    somar(bairro, bb)
    somar((bairroPorCidade[cidade[kc].rotulo] ??= {}), bb)
  }
  const lista = (m: Record<string, number>) =>
    Object.entries(m)
      .map(([rotulo, quantidade]) => ({ rotulo, quantidade }))
      .sort((a, c) => c.quantidade - a.quantidade)
  return {
    total: vistos.size,
    porFaixa: lista(faixa),
    porCidade: Object.values(cidade)
      .map((x) => ({ rotulo: x.rotulo, quantidade: x.n }))
      .sort((a, c) => c.quantidade - a.quantidade),
    porBairro: lista(bairro),
    porBairroPorCidade: Object.fromEntries(Object.entries(bairroPorCidade).map(([k, v]) => [k, lista(v)])),
  }
}

// ---------- Faltas ----------
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
/** Faltas × sessões realizadas (aba Atendimentos, coluna G), por mês, psicóloga e dia da semana. */
export function faltas(b: BasePreparada, f: Filtros, meses = 6) {
  const base = chaveMes(b.hoje)
  const janela = Array.from({ length: meses }, (_, i) => somarMesesChave(base, -(meses - 1 - i)))
  const inicio = `${janela[0]}-01`
  const porMes = Object.fromEntries(janela.map((m) => [m, { faltas: 0, realizadas: 0 }]))
  const porPsi: Record<string, { faltas: number; realizadas: number }> = {}
  const porDia = DIAS_SEMANA.map(() => ({ faltas: 0, realizadas: 0 }))
  for (const a of b.atendimentos) {
    if (f.psi && a[0] !== f.psi) continue
    const data = a[4] ?? a[3]
    if (!data || data < inicio || data > b.hoje) continue
    const k = ehSessaoRealizada(a[2]) ? 'realizadas' : 'faltas'
    const m = chaveMes(data)
    if (porMes[m]) porMes[m][k]++
    ;(porPsi[a[0]] ??= { faltas: 0, realizadas: 0 })[k]++
    porDia[new Date(tD(data)).getUTCDay()][k]++
  }
  const taxa = (x: { faltas: number; realizadas: number }) => (x.faltas + x.realizadas ? x.faltas / (x.faltas + x.realizadas) : 0)
  const nomes = new Map(b.psicologas.map((p) => [p.sid, p.nome]))
  return {
    janela,
    porMes: janela.map((m) => ({ mes: m, ...porMes[m], taxa: taxa(porMes[m]) })),
    porPsicologa: Object.entries(porPsi)
      .map(([sid, x]) => ({ sid, psicologa: nomes.get(sid) ?? sid, ...x, taxa: taxa(x) }))
      .sort((a, c) => c.faltas - a.faltas),
    porDia: porDia.map((x, i) => ({ dia: DIAS_SEMANA[i], ...x, taxa: taxa(x) })).filter((x) => x.faltas + x.realizadas > 0),
  }
}

// ---------- Salas ----------
export type StatusPeriodo = 'livre' | 'parcial' | 'indisponivel' | 'fechado'
export const PERIODOS = [
  { nome: 'Manhã', faixa: '07h - 12h', de: 7, ate: 11 },
  { nome: 'Tarde', faixa: '13h - 17h', de: 13, ate: 16 },
  { nome: 'Noite', faixa: '18h - 21h', de: 18, ate: 20 },
]
export const celulaLivre = (v: string) => ['', 'DISPONIVEL', 'LIVRE'].includes(String(v ?? '').trim().toUpperCase())
export function horaDe(v: string): number | null {
  const m = String(v ?? '').match(/\d{1,2}/)
  if (!m) return null
  const h = Number(m[0])
  return h >= 0 && h <= 23 ? h : null
}
export function turnoDe(v: string): 'manha' | 'tarde' | 'noite' | null {
  const h = horaDe(v)
  if (h === null) return null
  if (h >= 7 && h <= 12) return 'manha'
  if (h >= 13 && h <= 17) return 'tarde'
  if (h >= 18 && h <= 21) return 'noite'
  return null
}
const EXCLUIR_RESUMO = new Set(['507 consultorio 3', 'sala 507-3', '507-3'].map((x) => normalizar(x).replace(/\s+/g, '')))

/** Resumo semanal de disponibilidade (obterResumoSemanalPainel). */
export function resumoSalas(cabecalho: string[], linhas: string[][]) {
  const salas = cabecalho
    .map((nome, i) => ({ nome, i }))
    .filter((s) => s.i >= 2 && s.i !== 4 && s.nome && !EXCLUIR_RESUMO.has(normalizar(s.nome).replace(/\s+/g, '')))
  const dias: string[] = []
  for (const l of linhas) {
    const d = String(l[0] ?? '').trim()
    if (d && !dias.includes(d)) dias.push(d)
  }
  const matriz: Record<string, Record<string, { status: StatusPeriodo; livres: string[] }>> = {}
  for (const dia of dias) {
    matriz[dia] = {}
    for (const p of PERIODOS) {
      const rows = linhas.filter((l) => String(l[0] ?? '').trim() === dia && (() => { const h = horaDe(l[1]); return h !== null && h >= p.de && h <= p.ate })())
      const livres = rows.length ? salas.filter((s) => rows.every((l) => celulaLivre(l[s.i]))).map((s) => s.nome) : []
      const status: StatusPeriodo = livres.length === 0 ? 'indisponivel' : livres.length === salas.length ? 'livre' : 'parcial'
      matriz[dia][p.nome] = { status, livres }
    }
  }
  if (!dias.some((d) => normalizar(d).startsWith('domingo'))) {
    dias.push('Domingo')
    matriz.Domingo = Object.fromEntries(PERIODOS.map((p) => [p.nome, { status: 'fechado' as StatusPeriodo, livres: [] }]))
  }
  return { salas: salas.map((s) => s.nome), dias, matriz }
}

/** Ocupação da grade (analisarSalasPeloPainel): total de horários × ocupados, por sala e turno. */
export function ocupacaoSalas(cabecalho: string[], linhas: string[][]) {
  const salas = cabecalho.map((nome, i) => ({ nome, i })).filter((s) => s.i >= 2 && s.nome)
  const porSala = salas.map((s) => ({ sala: s.nome, total: 0, ocupados: 0 }))
  const porTurno: Record<string, { total: number; ocupados: number }> = { manha: { total: 0, ocupados: 0 }, tarde: { total: 0, ocupados: 0 }, noite: { total: 0, ocupados: 0 } }
  let conflitos = 0
  for (const l of linhas) {
    const h = horaDe(l[1])
    const bloco = h !== null && h >= 18 ? 'noite' : h !== null && h >= 13 ? 'tarde' : 'manha'
    salas.forEach((s, k) => {
      const v = String(l[s.i] ?? '').trim()
      const ocup = !['', 'DISPONIVEL', 'LIVRE'].includes(v)
      porSala[k].total++
      porTurno[bloco].total++
      if (ocup) {
        porSala[k].ocupados++
        porTurno[bloco].ocupados++
        if (v.includes('/')) conflitos++
      }
    })
  }
  const total = porSala.reduce((t, s) => t + s.total, 0)
  const ocupados = porSala.reduce((t, s) => t + s.ocupados, 0)
  return { total, ocupados, taxa: total ? ocupados / total : 0, conflitos, porSala, porTurno }
}
