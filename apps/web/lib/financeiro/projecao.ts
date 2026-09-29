// ================================================================
// Projeção da clínica — curva de vendas (sessões) + caixa, com
// probabilidades (Monte Carlo). Módulo puro: recebe o JSON de
// projecao_base() e devolve faixas P10/P50/P90 por mês.
//
// Como o modelo cruza as variáveis:
//   1) Sessões/dia útil por plano (Unimed, Bradesco, outros) nas últimas
//      12 semanas, corrigidas pelo atraso de registro das psicólogas
//      (curva real de quantos % já estão lançados k dias depois).
//   2) Tendência log-linear com amortecimento (a tendência perde força
//      semana a semana) + choque de nível + passeio aleatório → a faixa
//      abre com o horizonte. Dias úteis e feriados nacionais contam.
//   3) Unimed: XML emitido no mês E = sessões Unimed de E−1 × valor por
//      sessão observado (XML ÷ sessões, meses com planilha completa);
//      pago no dia 25 de E+1 × (pago ÷ liberado) visto no banco.
//      XML já emitido entra pelo valor real.
//   4) Bradesco: lotes Orizon já existentes pelo mês previsto; sessões
//      novas × valor médio por guia, pagas 2 meses depois.
//   5) Particulares/outros convênios, despesas fixas e não operacionais:
//      distribuição dos últimos 6 meses do extrato (DRE).
//   6) Repasse = sessões do mês anterior × repasse por sessão observado;
//      impostos = receita do mês anterior × alíquota efetiva observada.
// ================================================================

export type Plano = 'unimed' | 'bradesco' | 'outros'
export const PLANOS: Plano[] = ['unimed', 'bradesco', 'outros']
export const ROTULO_PLANO: Record<Plano, string> = { unimed: 'Unimed', bradesco: 'Bradesco', outros: 'Outros / particulares' }

type N = number | string | null | undefined
const n = (v: N) => (v === null || v === undefined || v === '' ? 0 : Number(v))

export type BaseProjecao = {
  hoje: string
  ano: number
  semanas: { semana: string; plano: Plano; realizadas: number; faltas: number; justificadas: number; agendadas: number }[]
  mensal_plano: { mes: string; plano: Plano; realizadas: number; faltas: number; justificadas: number }[]
  atraso_registro: { amostra: number; acumulado: N[] }
  pacientes: { mes: string; ativos: number; novos: number; perdidos: number; sessoes: number; psicologas: number }[]
  unimed_xml: {
    numero: string
    emissao: string
    informado: N
    liberado: N
    glosa: N
    itens: number
    status: string | null
    previsto_para: string | null
    pago_em: string | null
    pago: N
    fonte: string | null
  }[]
  unimed_mensal: { month: string; sessions: number; informed: N; released: N; gloss: N; median_days_to_statement: number | null }[]
  unimed_sessao: { sessoes: number; media: N; dp: N } | null
  bradesco: { mes: string; guias: number; valor: N; dias_ate_pagar: number | null; recebido: N }[]
  bradesco_pagto?: { mes: string; ate_hoje: N; futuro: N; guias: number }[]
  previstos: { mes: string; kind: string; fonte: string; valor: N; qtd: number; atrasado: N }[]
  dre: { ano: number; mes: number; grupo: string; categoria: string; detalhe: string | null; valor: N; qtd: number }[]
  banco: { primeiro: string | null; ultimo: string | null; saldo_movimento_ano: N } | null
}

export type Faixa = { p10: number; p50: number; p90: number; media: number }

export type MesProjetado = {
  mes: string
  sessoes: Faixa
  sessoesPlano: Record<Plano, Faixa>
  receitaUnimed: Faixa
  receitaBradesco: Faixa
  receitaOutros: Faixa
  receitaTotal: Faixa
  repasse: Faixa
  impostos: Faixa
  despesas: Faixa
  naoOperacional: Faixa
  resultado: Faixa
  saldo: Faixa | null
  pResultadoPositivo: number
  pMetaSessoes: number
  pCresceSessoes: number
  /** quanto do recebimento do mês já é conhecido (XML emitido / lote Orizon existente) */
  receitaConhecida: number
}

export type MesHistorico = {
  mes: string
  parcial: boolean
  sessoes: number
  sessoesPlano: Record<Plano, number>
  faltas: number
  receitaCora: number
  receitaUnimed: number
  receitaOutros: number
  receitaBradesco: number
  receitaTotal: number
  repasse: number
  impostos: number
  despesas: number
  naoOperacional: number
  resultado: number
  temCaixa: boolean
}

export type Motor = {
  mes: string
  parcial: boolean
  sessoes: number
  pacientes: number
  novos: number
  perdidos: number
  taxaPerda: number | null
  sessoesPorPaciente: number | null
  psicologas: number
  sessoesPorPsicologa: number | null
  faltasPct: number | null
  valorUnimedSessao: number | null
  glosaPct: number | null
}

export type Sensibilidade = { rotulo: string; detalhe: string; baixo: number; alto: number }

export type Premissas = {
  simulacoes: number
  semanasAjuste: number
  tendenciaSemanal: Record<Plano, number>
  taxaDiaUtil: Record<Plano, number>
  completudeSemanaAtual: number
  valorXmlPorSessao: { media: number; amostras: number; fonte: string }
  pagoSobreLiberado: { media: number; amostras: number }
  valorGuiaBradesco: number
  repassePorSessao: { media: number; amostras: number }
  aliquotaImpostos: { media: number; amostras: number }
  despesasFixas: { media: number; dp: number; amostras: number }
  outrasReceitas: { media: number; dp: number; amostras: number }
  naoOperacional: { media: number; amostras: number }
  faltasSobreRealizadas: number
}

export type Projecao = {
  hoje: string
  mesAtual: string
  historico: MesHistorico[]
  nowcast: { sessoes: Faixa; sessoesPlano: Record<Plano, Faixa>; observadas: number }
  meses: MesProjetado[]
  acumulado: { receita: Faixa; resultado: Faixa; pPositivo: number; sessoes: Faixa }
  saldoInicial: number | null
  pSaldoNegativo: number | null
  meta: number
  motores: Motor[]
  equilibrio: { novosMes: number; taxaPerda: number; pacientes: number; sessoesPorPaciente: number; sessoes: number } | null
  sensibilidade: Sensibilidade[]
  premissas: Premissas
}

export type OpcoesProjecao = {
  horizonte?: number
  simulacoes?: number
  semente?: number
  saldoInicial?: number | null
  meta?: number | null
}

// ---------------------------------------------------------------- datas

const DIA = 86_400_000
const tD = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
export const mesDe = (d: string) => `${d.slice(0, 7)}-01`
export function somarMeses(mes: string, k: number) {
  const y = Number(mes.slice(0, 4))
  const m = Number(mes.slice(5, 7)) - 1 + k
  return iso(Date.UTC(y, m, 1))
}
const segunda = (d: string) => {
  const t = tD(d)
  const dow = (new Date(t).getUTCDay() + 6) % 7
  return iso(t - dow * DIA)
}

function pascoa(ano: number) {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return Date.UTC(ano, mes - 1, dia)
}

const cacheFeriados = new Map<number, Set<string>>()
/** Feriados nacionais (fixos + Carnaval, Sexta-feira Santa e Corpus Christi). */
export function feriados(ano: number): Set<string> {
  const c = cacheFeriados.get(ano)
  if (c) return c
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map((d) => `${ano}-${d}`)
  const p = pascoa(ano)
  const moveis = [-48, -47, -2, 60].map((k) => iso(p + k * DIA))
  const s = new Set([...fixos, ...moveis])
  cacheFeriados.set(ano, s)
  return s
}
export function diaUtil(d: string) {
  const dow = new Date(tD(d)).getUTCDay()
  return dow >= 1 && dow <= 5 && !feriados(Number(d.slice(0, 4))).has(d)
}
function diasEntre(de: string, ate: string) {
  const out: string[] = []
  for (let t = tD(de); t <= tD(ate); t += DIA) out.push(iso(t))
  return out
}
const fimDoMes = (mes: string) => iso(tD(somarMeses(mes, 1)) - DIA)

// ---------------------------------------------------------------- estatística

/** Gerador determinístico (mulberry32) — mesma semente, mesmo resultado. */
export function rng(semente: number) {
  let a = semente >>> 0
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let guardado: number | null = null
  const normal = () => {
    if (guardado !== null) {
      const g = guardado
      guardado = null
      return g
    }
    let x = 0
    let y = 0
    while (x === 0) x = u()
    while (y === 0) y = u()
    const r = Math.sqrt(-2 * Math.log(x))
    guardado = r * Math.sin(2 * Math.PI * y)
    return r * Math.cos(2 * Math.PI * y)
  }
  const escolher = <T,>(arr: T[]) => arr[Math.floor(u() * arr.length)]
  return { u, normal, escolher }
}

export function quantil(ordenado: number[], q: number) {
  if (!ordenado.length) return 0
  const pos = (ordenado.length - 1) * q
  const i = Math.floor(pos)
  const f = pos - i
  return ordenado[i] + (ordenado[Math.min(i + 1, ordenado.length - 1)] - ordenado[i]) * f
}
export function faixa(valores: number[]): Faixa {
  const o = [...valores].sort((a, b) => a - b)
  const media = o.length ? o.reduce((t, v) => t + v, 0) / o.length : 0
  return { p10: quantil(o, 0.1), p50: quantil(o, 0.5), p90: quantil(o, 0.9), media }
}
const media = (v: number[]) => (v.length ? v.reduce((t, x) => t + x, 0) / v.length : 0)
const dp = (v: number[]) => {
  if (v.length < 2) return 0
  const m = media(v)
  return Math.sqrt(v.reduce((t, x) => t + (x - m) ** 2, 0) / (v.length - 1))
}

type Ajuste = { nivel: number; inclinacao: number; epInclinacao: number; epNivel: number; sigma: number; n: number }

/** Regressão linear ponderada de y em t; nível no último t. */
export function ajustarTendencia(pts: { t: number; y: number; w: number }[]): Ajuste {
  const k = pts.length
  if (k === 0) return { nivel: 0, inclinacao: 0, epInclinacao: 0, epNivel: 0, sigma: 0, n: 0 }
  const W = pts.reduce((s, p) => s + p.w, 0) || 1
  const w = pts.map((p) => (p.w * k) / W)
  const tb = pts.reduce((s, p, i) => s + w[i] * p.t, 0) / k
  const yb = pts.reduce((s, p, i) => s + w[i] * p.y, 0) / k
  const sxx = pts.reduce((s, p, i) => s + w[i] * (p.t - tb) ** 2, 0)
  const sxy = pts.reduce((s, p, i) => s + w[i] * (p.t - tb) * (p.y - yb), 0)
  const b = sxx > 0 ? sxy / sxx : 0
  const a = yb - b * tb
  const tL = Math.max(...pts.map((p) => p.t))
  const sse = pts.reduce((s, p, i) => s + w[i] * (p.y - (a + b * p.t)) ** 2, 0)
  const sigma = k > 2 ? Math.sqrt(sse / (k - 2)) : 0.25
  return {
    nivel: a + b * tL,
    inclinacao: b,
    epInclinacao: sxx > 0 ? sigma / Math.sqrt(sxx) : 0,
    epNivel: sigma * Math.sqrt(1 / k + (sxx > 0 ? (tL - tb) ** 2 / sxx : 0)),
    sigma,
    n: k,
  }
}

// ---------------------------------------------------------------- modelo

const OFFSET = 0.2 // evita log(0) em semanas sem sessão de um plano
const AMORTECIMENTO = 0.9 // a tendência semanal perde 10% de força por semana
const SEMANAS_AJUSTE = 12

type Parametros = {
  fatorSessoes: number
  fatorValorUnimed: number
  fatorRepasse: number
  fatorDespesas: number
  fatorImpostos: number
}
const PADRAO: Parametros = { fatorSessoes: 1, fatorValorUnimed: 1, fatorRepasse: 1, fatorDespesas: 1, fatorImpostos: 1 }

function preparar(base: BaseProjecao) {
  const hoje = base.hoje
  const mesAtual = mesDe(hoje)
  const cdf = (base.atraso_registro?.acumulado ?? []).map((v) => n(v))
  const completude = (idade: number) => {
    if (!cdf.length) return 1
    if (idade < 0) return 1
    return Math.max(cdf[Math.min(idade, cdf.length - 1)] || 1, 0.05)
  }

  // --- semanas: taxa por dia útil corrigida pelo atraso de registro
  const semAtual = segunda(hoje)
  const semanasTodas = Array.from({ length: SEMANAS_AJUSTE + 1 }, (_, i) => iso(tD(semAtual) - (SEMANAS_AJUSTE - i) * 7 * DIA))
  const infoSemana = (sem: string) => {
    const dias = diasEntre(sem, iso(tD(sem) + 6 * DIA)).filter((d) => d <= hoje && diaUtil(d))
    const comp = dias.length ? media(dias.map((d) => completude(Math.round((tD(hoje) - tD(d)) / DIA)))) : 1
    return { du: dias.length, comp }
  }
  const atual = infoSemana(semAtual)
  const usarAtual = atual.du >= 2
  const semanas = usarAtual ? semanasTodas.slice(1) : semanasTodas.slice(0, -1)
  const ultimaSemana = semanas[semanas.length - 1]

  const porSemana = new Map<string, Record<Plano, { r: number; f: number }>>()
  for (const s of base.semanas ?? []) {
    const k = s.semana.slice(0, 10)
    const cur = porSemana.get(k) ?? { unimed: { r: 0, f: 0 }, bradesco: { r: 0, f: 0 }, outros: { r: 0, f: 0 } }
    const p = (PLANOS as string[]).includes(s.plano) ? s.plano : 'outros'
    cur[p].r += n(s.realizadas)
    cur[p].f += n(s.faltas)
    porSemana.set(k, cur)
  }

  const ajustes = {} as Record<Plano, Ajuste>
  const taxaAtual = {} as Record<Plano, number>
  let faltasTot = 0
  let realTot = 0
  for (const p of PLANOS) {
    const pts: { t: number; y: number; w: number }[] = []
    semanas.forEach((sem, i) => {
      const inf = infoSemana(sem)
      if (!inf.du) return
      const obs = porSemana.get(sem)?.[p] ?? { r: 0, f: 0 }
      const taxa = obs.r / inf.comp / inf.du
      pts.push({ t: i, y: Math.log(taxa + OFFSET), w: inf.du * inf.comp })
      if (i >= semanas.length - 8) {
        faltasTot += obs.f / inf.comp
        realTot += obs.r / inf.comp
      }
    })
    ajustes[p] = ajustarTendencia(pts)
    taxaAtual[p] = Math.max(Math.exp(ajustes[p].nivel) - OFFSET, 0)
  }

  // --- sessões por mês (histórico) com correção do atraso nos 2 últimos meses
  const mensal = new Map<string, Record<Plano, number> & { faltas: number }>()
  for (const r of base.mensal_plano ?? []) {
    const k = r.mes.slice(0, 10)
    const cur = mensal.get(k) ?? { unimed: 0, bradesco: 0, outros: 0, faltas: 0 }
    const p = (PLANOS as string[]).includes(r.plano) ? r.plano : 'outros'
    cur[p] += n(r.realizadas)
    cur.faltas += n(r.faltas)
    mensal.set(k, cur)
  }
  const fatorCorrecaoMes = (mes: string) => {
    const dias = diasEntre(mes, fimDoMes(mes)).filter((d) => d <= hoje && diaUtil(d))
    if (!dias.length) return 1
    return 1 / media(dias.map((d) => completude(Math.round((tD(hoje) - tD(d)) / DIA))))
  }

  // --- dias futuros (até o fim do horizonte) agrupados por semana
  return { hoje, mesAtual, completude, ajustes, taxaAtual, ultimaSemana, usarAtual, atual, mensal, fatorCorrecaoMes, faltasSobreRealizadas: realTot ? faltasTot / realTot : 0 }
}

function dreMensal(base: BaseProjecao) {
  const out = new Map<string, { receitaCora: number; receitaUnimed: number; receitaOutros: number; repasse: number; impostos: number; despesas: number; naoOperacional: number }>()
  for (const l of base.dre ?? []) {
    if (l.grupo === 'fora') continue
    const mes = `${l.ano}-${String(l.mes).padStart(2, '0')}-01`
    const c = out.get(mes) ?? { receitaCora: 0, receitaUnimed: 0, receitaOutros: 0, repasse: 0, impostos: 0, despesas: 0, naoOperacional: 0 }
    const v = n(l.valor)
    if (l.grupo === 'receita') {
      c.receitaCora += v
      if (l.categoria === 'Receita de convênios' && (l.detalhe ?? '').toLowerCase().startsWith('unimed')) c.receitaUnimed += v
      else c.receitaOutros += v
    } else if (l.grupo === 'deducao') c.impostos += -v
    else if (l.grupo === 'custo') c.repasse += -v
    else if (l.grupo === 'despesa') c.despesas += -v
    else if (l.grupo === 'nao_operacional') c.naoOperacional += -v
    out.set(mes, c)
  }
  return out
}

export function projetar(base: BaseProjecao, opcoes: OpcoesProjecao = {}): Projecao {
  const H = opcoes.horizonte ?? 4
  const S = opcoes.simulacoes ?? 2000
  const semente = opcoes.semente ?? 20260929
  const saldoInicial = opcoes.saldoInicial ?? null

  const pr = preparar(base)
  const { hoje, mesAtual } = pr
  const dre = dreMensal(base)

  // ---------- histórico ----------
  const sessoesMes = new Map<string, number>()
  for (const p of base.pacientes ?? []) sessoesMes.set(p.mes.slice(0, 10), n(p.sessoes))
  const bradPag = new Map<string, { ateHoje: number; futuro: number }>()
  for (const b of base.bradesco_pagto ?? []) bradPag.set(b.mes.slice(0, 10), { ateHoje: n(b.ate_hoje), futuro: n(b.futuro) })

  const mesesHist = [...new Set([...pr.mensal.keys(), ...dre.keys()])].filter((m) => m <= mesAtual).sort()
  const historico: MesHistorico[] = mesesHist.map((mes) => {
    const mp = pr.mensal.get(mes) ?? { unimed: 0, bradesco: 0, outros: 0, faltas: 0 }
    const d = dre.get(mes)
    const brad = bradPag.get(mes)?.ateHoje ?? 0
    const receitaCora = d?.receitaCora ?? 0
    const total = receitaCora + brad
    const custos = (d?.repasse ?? 0) + (d?.impostos ?? 0) + (d?.despesas ?? 0)
    return {
      mes,
      parcial: mes === mesAtual,
      sessoes: mp.unimed + mp.bradesco + mp.outros,
      sessoesPlano: { unimed: mp.unimed, bradesco: mp.bradesco, outros: mp.outros },
      faltas: mp.faltas,
      receitaCora,
      receitaUnimed: d?.receitaUnimed ?? 0,
      receitaOutros: d?.receitaOutros ?? 0,
      receitaBradesco: brad,
      receitaTotal: total,
      repasse: d?.repasse ?? 0,
      impostos: d?.impostos ?? 0,
      despesas: d?.despesas ?? 0,
      naoOperacional: d?.naoOperacional ?? 0,
      resultado: total - custos,
      temCaixa: !!d,
    }
  })
  const hist = new Map(historico.map((h) => [h.mes, h]))

  // meses "completos" de caixa para as distribuições (inclui o atual a partir do dia 25)
  const diaHoje = Number(hoje.slice(8, 10))
  const mesesCaixa = historico
    .filter((h) => h.temCaixa && (h.mes < mesAtual || diaHoje >= 25))
    .map((h) => h.mes)
    .slice(-6)

  // ---------- premissas empíricas ----------
  const cms = new Map((base.unimed_mensal ?? []).map((u) => [u.month.slice(0, 10), u]))
  const xmls = (base.unimed_xml ?? []).filter((x) => n(x.liberado) > 0)
  // valor do XML por sessão Unimed do mês anterior (só meses em que a planilha está completa)
  const razoesXml: number[] = []
  for (const x of xmls) {
    const ref = somarMeses(mesDe(x.emissao), -1)
    const planilha = pr.mensal.get(ref)?.unimed ?? 0
    const nXml = n(cms.get(ref)?.sessions)
    if (planilha >= 150 && nXml > 0 && planilha >= 0.8 * nXml) razoesXml.push(n(x.liberado) / planilha)
  }
  const fallbackXml = n(base.unimed_sessao?.media) || 36
  const amostrasXml = razoesXml.slice(-6)
  const fonteXml = amostrasXml.length >= 2 ? 'XML ÷ sessões Unimed do mês anterior' : 'valor liberado médio por sessão (XML)'
  if (amostrasXml.length < 2) amostrasXml.splice(0, amostrasXml.length, fallbackXml * 0.97)

  const pagos = xmls.filter((x) => x.status === 'realizado' && n(x.pago) > 0).map((x) => n(x.pago) / n(x.liberado))
  const amostrasPago = pagos.length ? pagos.slice(-8) : [0.99]

  const lotes = (base.bradesco ?? []).filter((b) => b.guias > 0)
  const valorGuia = lotes.length ? lotes.reduce((t, b) => t + n(b.valor), 0) / lotes.reduce((t, b) => t + b.guias, 0) : 46.8
  const dpGuia = lotes.length > 1 ? dp(lotes.map((b) => n(b.valor) / b.guias)) : valorGuia * 0.03
  const mesesComLote = new Set(lotes.map((b) => b.mes.slice(0, 10)))

  const razoesRepasse: number[] = []
  const razoesImposto: number[] = []
  for (const m of mesesCaixa) {
    const h = hist.get(m)!
    const ant = somarMeses(m, -1)
    const sAnt = sessoesMes.get(ant) ?? hist.get(ant)?.sessoes ?? 0
    if (sAnt >= 150 && h.repasse > 0) razoesRepasse.push(h.repasse / sAnt)
    const rAnt = hist.get(ant)?.receitaCora ?? 0
    if (rAnt > 0 && hist.get(ant)?.temCaixa) razoesImposto.push(h.impostos / rAnt)
  }
  const amostrasRepasse = razoesRepasse.slice(-4).length ? razoesRepasse.slice(-4) : [0]
  const amostrasImposto = razoesImposto.length ? razoesImposto : [0]
  const despesasHist = mesesCaixa.map((m) => hist.get(m)!.despesas)
  const outrasHist = mesesCaixa.map((m) => hist.get(m)!.receitaOutros)
  const naoOpHist = mesesCaixa.map((m) => hist.get(m)!.naoOperacional)

  // XML já emitido → pago no mês previsto
  const xmlConhecido = new Map<string, number>() // mês de emissão → liberado
  const unimedConhecidoPorMes = new Map<string, number>() // mês de pagamento → liberado ainda não pago
  for (const x of xmls) {
    xmlConhecido.set(mesDe(x.emissao), (xmlConhecido.get(mesDe(x.emissao)) ?? 0) + n(x.liberado))
    if (x.status !== 'realizado' && x.previsto_para) {
      const m = mesDe(x.previsto_para)
      unimedConhecidoPorMes.set(m, (unimedConhecidoPorMes.get(m) ?? 0) + n(x.liberado))
    }
  }

  // ---------- grade de dias futuros ----------
  const mesesProj = Array.from({ length: H }, (_, i) => somarMeses(mesAtual, i + 1))
  const fimHorizonte = fimDoMes(mesesProj[mesesProj.length - 1])
  const diasFuturos = diasEntre(iso(tD(hoje) + DIA), fimHorizonte).filter(diaUtil)
  const idxMes = (m: string) => {
    if (m === mesAtual) return 0 // 0 = mês atual
    const j = mesesProj.indexOf(m)
    return j < 0 ? -1 : j + 1
  }
  const semanaBase = tD(pr.ultimaSemana)
  const passos = diasFuturos.map((d) => ({ h: Math.max(Math.round((tD(segunda(d)) - semanaBase) / (7 * DIA)), 0), m: idxMes(mesDe(d)) }))
  const Hmax = passos.reduce((t, p) => Math.max(t, p.h), 0)

  const observadoAtual: Record<Plano, number> = { unimed: 0, bradesco: 0, outros: 0 }
  const corr = pr.fatorCorrecaoMes(mesAtual)
  const mpAtual = pr.mensal.get(mesAtual)
  for (const p of PLANOS) observadoAtual[p] = mpAtual?.[p] ?? 0

  // ---------- uma rodada de simulação ----------
  const metaPadrao = Math.max(...historico.filter((h) => !h.parcial).map((h) => h.sessoes), 0)
  const meta = opcoes.meta && opcoes.meta > 0 ? opcoes.meta : metaPadrao

  function rodar(par: Parametros, nSim: number) {
    const r = rng(semente)
    const nm = H + 1 // mês atual + horizonte
    const ses = PLANOS.map(() => Array.from({ length: nm }, () => new Float64Array(nSim)))
    const res = {
      receitaUnimed: Array.from({ length: H }, () => new Float64Array(nSim)),
      receitaBradesco: Array.from({ length: H }, () => new Float64Array(nSim)),
      receitaOutros: Array.from({ length: H }, () => new Float64Array(nSim)),
      repasse: Array.from({ length: H }, () => new Float64Array(nSim)),
      impostos: Array.from({ length: H }, () => new Float64Array(nSim)),
      despesas: Array.from({ length: H }, () => new Float64Array(nSim)),
      naoOperacional: Array.from({ length: H }, () => new Float64Array(nSim)),
      saldo: Array.from({ length: H }, () => new Float64Array(nSim)),
      saldoNegativo: new Uint8Array(nSim),
    }
    const taxasSemana = new Float64Array(Hmax + 1)

    for (let i = 0; i < nSim; i++) {
      // sessões por plano
      PLANOS.forEach((p, pi) => {
        const a = pr.ajustes[p]
        const sRw = 0.4 * a.sigma
        const sE = Math.sqrt(Math.max(a.sigma ** 2 - sRw ** 2, 0))
        const b = a.inclinacao + a.epInclinacao * r.normal()
        let l = a.nivel + a.epNivel * r.normal()
        for (let h = 0; h <= Hmax; h++) {
          if (h > 0) l += b * AMORTECIMENTO ** h + sRw * r.normal()
          taxasSemana[h] = Math.max(Math.exp(l + sE * r.normal()) - OFFSET, 0) * par.fatorSessoes
        }
        const arr = ses[pi]
        // o que já foi lançado + o que ainda falta lançar (estimado pelo atraso de registro, ±30%)
        arr[0][i] = observadoAtual[p] * (1 + (corr - 1) * Math.max(1 + 0.3 * r.normal(), 0))
        for (let m = 1; m < nm; m++) arr[m][i] = 0
        for (const ps of passos) arr[ps.m][i] += taxasSemana[ps.h]
      })

      const totalSes = (m: number) => ses[0][m][i] + ses[1][m][i] + ses[2][m][i]
      let saldo = saldoInicial ?? 0
      let negativo = 0
      let receitaCoraAnterior = hist.get(mesAtual)?.receitaCora ?? 0

      for (let k = 0; k < H; k++) {
        const M = mesesProj[k]
        const E = somarMeses(M, -1) // emissão do XML pago em M
        // Unimed
        let xml = 0
        if (unimedConhecidoPorMes.has(M)) xml = unimedConhecidoPorMes.get(M)!
        else if (xmlConhecido.has(E)) xml = 0 // XML desse mês já foi pago (ou está previsto para outro mês)
        else {
          const refM = somarMeses(E, -1)
          const refIdx = idxMes(refM)
          const sesU = refIdx >= 0 ? ses[0][refIdx][i] : (pr.mensal.get(refM)?.unimed ?? 0) * pr.fatorCorrecaoMes(refM)
          const razao = r.escolher(amostrasXml) * (1 + 0.06 * r.normal())
          xml = sesU * razao * par.fatorValorUnimed
        }
        const receitaUnimed = xml * r.escolher(amostrasPago)

        // Bradesco: lotes existentes pelo mês previsto + lotes novos (sessões de M−2)
        let receitaBradesco = bradPag.get(M)?.futuro ?? 0
        const refB = somarMeses(M, -2)
        if (!mesesComLote.has(refB) && refB >= mesAtual) {
          const ib = idxMes(refB)
          if (ib >= 0) receitaBradesco += ses[1][ib][i] * Math.max(valorGuia + dpGuia * r.normal(), 0)
        }

        // outras receitas (particulares e outros convênios)
        const receitaOutros = Math.max(media(outrasHist) + dp(outrasHist) * r.normal(), 0)

        // saídas
        const sesAnt = totalSes(k) // sessões de M−1 (índice k = mês anterior a mesesProj[k])
        const repasse = sesAnt * r.escolher(amostrasRepasse) * par.fatorRepasse
        const impostos = receitaCoraAnterior * Math.max(r.escolher(amostrasImposto), 0) * par.fatorImpostos
        const md = media(despesasHist)
        const despesas = Math.max(md + dp(despesasHist) * r.normal(), md * 0.3) * par.fatorDespesas
        const naoOp = naoOpHist.length ? r.escolher(naoOpHist) : 0

        res.receitaUnimed[k][i] = receitaUnimed
        res.receitaBradesco[k][i] = receitaBradesco
        res.receitaOutros[k][i] = receitaOutros
        res.repasse[k][i] = repasse
        res.impostos[k][i] = impostos
        res.despesas[k][i] = despesas
        res.naoOperacional[k][i] = naoOp
        saldo += receitaUnimed + receitaBradesco + receitaOutros - repasse - impostos - despesas - naoOp
        res.saldo[k][i] = saldo
        if (saldo < 0) negativo = 1
        receitaCoraAnterior = receitaUnimed + receitaOutros
      }
      res.saldoNegativo[i] = negativo
    }
    return { ses, res }
  }

  const { ses, res } = rodar(PADRAO, S)
  const arr = (f: Float64Array) => Array.from(f)
  const soma = (...fs: Float64Array[]) => Array.from(fs[0], (_, i) => fs.reduce((t, f) => t + f[i], 0))

  const totalSesMes = (m: number) => soma(ses[0][m], ses[1][m], ses[2][m])
  const nowTot = totalSesMes(0)

  const meses: MesProjetado[] = mesesProj.map((mes, k) => {
    const tot = totalSesMes(k + 1)
    const receita = soma(res.receitaUnimed[k], res.receitaBradesco[k], res.receitaOutros[k])
    const custos = soma(res.repasse[k], res.impostos[k], res.despesas[k])
    const resultado = receita.map((v, i) => v - custos[i])
    const ant = k === 0 ? nowTot : totalSesMes(k)
    return {
      mes,
      sessoes: faixa(tot),
      sessoesPlano: { unimed: faixa(arr(ses[0][k + 1])), bradesco: faixa(arr(ses[1][k + 1])), outros: faixa(arr(ses[2][k + 1])) },
      receitaUnimed: faixa(arr(res.receitaUnimed[k])),
      receitaBradesco: faixa(arr(res.receitaBradesco[k])),
      receitaOutros: faixa(arr(res.receitaOutros[k])),
      receitaTotal: faixa(receita),
      repasse: faixa(arr(res.repasse[k])),
      impostos: faixa(arr(res.impostos[k])),
      despesas: faixa(arr(res.despesas[k])),
      naoOperacional: faixa(arr(res.naoOperacional[k])),
      resultado: faixa(resultado),
      saldo: saldoInicial === null ? null : faixa(arr(res.saldo[k])),
      pResultadoPositivo: resultado.filter((v) => v > 0).length / S,
      pMetaSessoes: tot.filter((v) => v >= meta).length / S,
      pCresceSessoes: tot.filter((v, i) => v > ant[i]).length / S,
      receitaConhecida: (unimedConhecidoPorMes.get(mes) ?? 0) + (bradPag.get(mes)?.futuro ?? 0),
    }
  })

  const receitaAc = Array.from({ length: S }, (_, i) =>
    mesesProj.reduce((t, _m, k) => t + res.receitaUnimed[k][i] + res.receitaBradesco[k][i] + res.receitaOutros[k][i], 0),
  )
  const resultadoAc = Array.from({ length: S }, (_, i) =>
    mesesProj.reduce(
      (t, _m, k) =>
        t + res.receitaUnimed[k][i] + res.receitaBradesco[k][i] + res.receitaOutros[k][i] - res.repasse[k][i] - res.impostos[k][i] - res.despesas[k][i],
      0,
    ),
  )
  const sessoesAc = Array.from({ length: S }, (_, i) => mesesProj.reduce((t, _m, k) => t + ses[0][k + 1][i] + ses[1][k + 1][i] + ses[2][k + 1][i], 0))

  // ---------- sensibilidade (mesma semente → só a variável muda) ----------
  const nSens = Math.min(S, 800)
  const resultadoP50 = (par: Parametros) => {
    const { res: rr } = rodar(par, nSens)
    const v = Array.from({ length: nSens }, (_, i) =>
      mesesProj.reduce(
        (t, _m, k) =>
          t + rr.receitaUnimed[k][i] + rr.receitaBradesco[k][i] + rr.receitaOutros[k][i] - rr.repasse[k][i] - rr.impostos[k][i] - rr.despesas[k][i],
        0,
      ),
    )
    return faixa(v).p50
  }
  const base50 = resultadoP50(PADRAO)
  const sens = (rotulo: string, detalhe: string, campo: keyof Parametros, baixo: number, alto: number): Sensibilidade => ({
    rotulo,
    detalhe,
    baixo: resultadoP50({ ...PADRAO, [campo]: baixo }) - base50,
    alto: resultadoP50({ ...PADRAO, [campo]: alto }) - base50,
  })
  const recuperaFaltas = 1 + 0.5 * pr.faltasSobreRealizadas
  const sensibilidade: Sensibilidade[] = [
    sens('Volume de sessões', '−10% / +10% nas sessões por dia útil', 'fatorSessoes', 0.9, 1.1),
    sens('Valor Unimed por sessão', '−10% / +10% no XML (glosa, tabela, guias não lançadas)', 'fatorValorUnimed', 0.9, 1.1),
    sens('Repasse por sessão', '+10% / −10% no repasse às psicólogas', 'fatorRepasse', 1.1, 0.9),
    sens('Despesas fixas', '+10% / −10% nas despesas operacionais', 'fatorDespesas', 1.1, 0.9),
    sens('Impostos', '+10% / −10% na alíquota efetiva', 'fatorImpostos', 1.1, 0.9),
    {
      rotulo: 'Faltas pela metade',
      detalhe: `metade das faltas (${(pr.faltasSobreRealizadas * 100).toFixed(0)}% das realizadas) vira sessão`,
      baixo: 0,
      alto: resultadoP50({ ...PADRAO, fatorSessoes: recuperaFaltas }) - base50,
    },
  ].sort((a, b) => Math.abs(b.alto - b.baixo) - Math.abs(a.alto - a.baixo))

  // ---------- motores (variáveis cruzadas) ----------
  const pac = new Map((base.pacientes ?? []).map((p) => [p.mes.slice(0, 10), p]))
  const motores: Motor[] = [...pac.keys()]
    .sort()
    .slice(-8)
    .map((mes) => {
      const p = pac.get(mes)!
      const ant = pac.get(somarMeses(mes, -1))
      const mp = pr.mensal.get(mes)
      const u = cms.get(mes)
      const real = mp ? mp.unimed + mp.bradesco + mp.outros : n(p.sessoes)
      return {
        mes,
        parcial: mes === mesAtual,
        sessoes: n(p.sessoes),
        pacientes: n(p.ativos),
        novos: n(p.novos),
        perdidos: n(p.perdidos),
        taxaPerda: ant && n(ant.ativos) ? n(p.perdidos) / n(ant.ativos) : null,
        sessoesPorPaciente: n(p.ativos) ? n(p.sessoes) / n(p.ativos) : null,
        psicologas: n(p.psicologas),
        sessoesPorPsicologa: n(p.psicologas) ? n(p.sessoes) / n(p.psicologas) : null,
        faltasPct: mp && real + mp.faltas ? mp.faltas / (real + mp.faltas) : null,
        valorUnimedSessao: u && n(u.sessions) >= 20 ? n(u.released) / n(u.sessions) : null,
        glosaPct: u && n(u.informed) > 0 && n(u.sessions) >= 20 ? n(u.gloss) / n(u.informed) : null,
      }
    })

  const completos = motores.filter((m) => !m.parcial && m.taxaPerda !== null).slice(-3)
  let equilibrio: Projecao['equilibrio'] = null
  if (completos.length >= 2) {
    const novosMes = media(completos.map((m) => m.novos))
    const taxaPerda = media(completos.map((m) => m.taxaPerda ?? 0))
    const spp = media(completos.map((m) => m.sessoesPorPaciente ?? 0))
    if (taxaPerda > 0.01) {
      const pacientes = novosMes / taxaPerda
      equilibrio = { novosMes, taxaPerda, pacientes, sessoesPorPaciente: spp, sessoes: pacientes * spp }
    }
  }

  const premissas: Premissas = {
    simulacoes: S,
    semanasAjuste: SEMANAS_AJUSTE,
    tendenciaSemanal: {
      unimed: Math.exp(pr.ajustes.unimed.inclinacao) - 1,
      bradesco: Math.exp(pr.ajustes.bradesco.inclinacao) - 1,
      outros: Math.exp(pr.ajustes.outros.inclinacao) - 1,
    },
    taxaDiaUtil: pr.taxaAtual,
    completudeSemanaAtual: pr.atual.comp,
    valorXmlPorSessao: { media: media(amostrasXml), amostras: razoesXml.slice(-6).length, fonte: fonteXml },
    pagoSobreLiberado: { media: media(amostrasPago), amostras: pagos.length },
    valorGuiaBradesco: valorGuia,
    repassePorSessao: { media: media(amostrasRepasse), amostras: razoesRepasse.slice(-4).length },
    aliquotaImpostos: { media: media(amostrasImposto), amostras: razoesImposto.length },
    despesasFixas: { media: media(despesasHist), dp: dp(despesasHist), amostras: despesasHist.length },
    outrasReceitas: { media: media(outrasHist), dp: dp(outrasHist), amostras: outrasHist.length },
    naoOperacional: { media: media(naoOpHist), amostras: naoOpHist.length },
    faltasSobreRealizadas: pr.faltasSobreRealizadas,
  }

  return {
    hoje,
    mesAtual,
    historico,
    nowcast: {
      sessoes: faixa(nowTot),
      sessoesPlano: { unimed: faixa(arr(ses[0][0])), bradesco: faixa(arr(ses[1][0])), outros: faixa(arr(ses[2][0])) },
      observadas: mpAtual ? mpAtual.unimed + mpAtual.bradesco + mpAtual.outros : 0,
    },
    meses,
    acumulado: {
      receita: faixa(receitaAc),
      resultado: faixa(resultadoAc),
      pPositivo: resultadoAc.filter((v) => v > 0).length / S,
      sessoes: faixa(sessoesAc),
    },
    saldoInicial,
    pSaldoNegativo: saldoInicial === null ? null : Array.from(res.saldoNegativo).filter(Boolean).length / S,
    meta,
    motores,
    equilibrio,
    sensibilidade,
    premissas,
  }
}

// ---------------------------------------------------------------- leitura do analista

const MESES_EXTENSO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const nomeMes = (mes: string) => MESES_EXTENSO[Number(mes.slice(5, 7)) - 1]
const reais = (v: number) => `R$ ${Math.round(v).toLocaleString('pt-BR')}`
const pc = (v: number, casas = 0) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: casas })}%`

export type Equilibrio = { sessoes: number; margemSessao: number; receitaSessao: number } | null

/** Sessões por mês para o resultado operacional empatar (em regime, sem o atraso de recebimento). */
export function pontoDeEquilibrio(p: Projecao): Equilibrio {
  const pm = p.premissas
  const t = pm.taxaDiaUtil
  const conv = t.unimed + t.bradesco
  if (conv <= 0) return null
  const vU = pm.valorXmlPorSessao.media * pm.pagoSobreLiberado.media
  const receitaSessao = (t.unimed * vU + t.bradesco * pm.valorGuiaBradesco) / conv
  const margemSessao = receitaSessao * (1 - pm.aliquotaImpostos.media) - pm.repassePorSessao.media
  if (margemSessao <= 0) return null
  const aCobrir = pm.despesasFixas.media - pm.outrasReceitas.media * (1 - pm.aliquotaImpostos.media)
  const sessoesConv = Math.max(aCobrir, 0) / margemSessao
  return { sessoes: (sessoesConv * (conv + t.outros)) / conv, margemSessao, receitaSessao }
}

/** Frases curtas com o que os números dizem (ordem: o que pede ação primeiro). */
export function leituras(p: Projecao): string[] {
  const out: string[] = []
  const ultimoCompleto = [...p.historico].reverse().find((h) => !h.parcial && h.sessoes > 0)
  const nc = p.nowcast.sessoes

  // 1) mês mais apertado
  const apertado = [...p.meses].sort((a, b) => a.pResultadoPositivo - b.pResultadoPositivo)[0]
  if (apertado && apertado.pResultadoPositivo < 0.5) {
    const conhecida = apertado.receitaTotal.p50 > 0 ? apertado.receitaConhecida / apertado.receitaTotal.p50 : 0
    out.push(
      `${cap(nomeMes(apertado.mes))} é o mês mais apertado: resultado mediano de ${reais(apertado.resultado.p50)} e só ${pc(apertado.pResultadoPositivo)} de chance de fechar positivo.` +
        (conhecida > 0.4 ? ` ${pc(Math.min(conhecida, 1))} da receita desse mês já é conhecida (XML emitido e lotes Orizon), então a margem para surpresa é pequena.` : ''),
    )
  }

  // 2) fechamento do mês atual
  if (ultimoCompleto && nc.p50 > 0) {
    const varMes = nc.p50 / ultimoCompleto.sessoes - 1
    out.push(
      `${cap(nomeMes(p.mesAtual))} deve fechar com ~${Math.round(nc.p50)} sessões (80% de chance entre ${Math.round(nc.p10)} e ${Math.round(nc.p90)}), ` +
        `${varMes >= 0 ? '+' : ''}${pc(varMes)} contra ${nomeMes(ultimoCompleto.mes)} (${ultimoCompleto.sessoes}). Já há ${p.nowcast.observadas} lançadas; o resto é o atraso normal de registro das psicólogas.`,
    )
  }

  // 3) tendência
  const tu = p.premissas.tendenciaSemanal.unimed
  const taxaTotal = PLANOS.reduce((t, k) => t + p.premissas.taxaDiaUtil[k], 0)
  out.push(
    `Ritmo atual: ${taxaTotal.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} sessões por dia útil. Tendência das últimas ${p.premissas.semanasAjuste} semanas na Unimed: ${tu >= 0 ? '+' : ''}${pc(tu, 1)} por semana` +
      ` (a projeção amortece essa tendência — ela perde força a cada semana).`,
  )

  // 4) ponto de equilíbrio
  const pe = pontoDeEquilibrio(p)
  if (pe) {
    out.push(
      `Ponto de equilíbrio ≈ ${Math.round(pe.sessoes)} sessões/mês: cada sessão de convênio deixa ~${reais(pe.margemSessao)} depois de impostos e repasse, ` +
        `e as despesas fixas (${reais(p.premissas.despesasFixas.media)}/mês, descontadas as receitas de particulares) precisam ser cobertas.`,
    )
  }

  // 5) caixa × crescimento
  out.push(
    'Crescer consome caixa no curto prazo: a sessão feita hoje só vira dinheiro da Unimed ~2 meses depois (XML no dia 25 do mês seguinte, pagamento no dia 25 do outro), ' +
      'mas o repasse da psicóloga sai no mês seguinte. Por isso mais sessões mexem pouco nos próximos 4 meses e muito no resultado depois.',
  )

  // 6) equilíbrio da base de pacientes
  const eq = p.equilibrio
  const ultimo = [...p.motores].reverse().find((m) => !m.parcial)
  if (eq && ultimo) {
    const menos1pp = eq.novosMes / Math.max(eq.taxaPerda - 0.01, 0.005) - eq.pacientes
    out.push(
      `Base de pacientes: entram ~${Math.round(eq.novosMes)} novos/mês e ${pc(eq.taxaPerda)} dos ativos não voltam no mês seguinte. Mantido isso, a base se estabiliza em ~${Math.round(eq.pacientes)} pacientes ` +
        `(~${Math.round(eq.sessoes)} sessões/mês); em ${nomeMes(ultimo.mes)} eram ${ultimo.pacientes}. Cada 1 ponto a menos de perda soma ~${Math.round(menos1pp)} pacientes ao teto.`,
    )
  }

  // 7) faltas e glosa
  const f = p.premissas.faltasSobreRealizadas
  if (f > 0.05) out.push(`Faltas = ${pc(f)} das sessões realizadas nas últimas 8 semanas. Recuperar metade delas vale +${Math.round((f / 2) * taxaTotal * 21)} sessões/mês.`)
  const comGlosa = p.motores.filter((m) => m.glosaPct !== null)
  if (comGlosa.length >= 2) {
    const g1 = comGlosa[comGlosa.length - 1]
    const g0 = comGlosa[0]
    if ((g1.glosaPct ?? 0) > (g0.glosaPct ?? 0) + 0.01)
      out.push(`Glosa da Unimed subindo: ${pc(g0.glosaPct ?? 0, 1)} em ${nomeMes(g0.mes)} → ${pc(g1.glosaPct ?? 0, 1)} em ${nomeMes(g1.mes)} do valor informado.`)
  }

  if (p.pSaldoNegativo !== null && p.pSaldoNegativo > 0.2)
    out.push(`Com o saldo de hoje no Cora, há ${pc(p.pSaldoNegativo)} de chance de o saldo ficar negativo em algum fim de mês até ${nomeMes(p.meses[p.meses.length - 1].mes)} (se nada mudar).`)
  return out
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
