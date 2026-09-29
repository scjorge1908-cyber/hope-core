// ================================================================
// Painel de gestão — tipos do retorno de public.painel_gestao() e as
// regras de leitura (indicadores, alertas). Lógica pura, testável.
// ================================================================

export type MesProducao = {
  mes: string // YYYY-MM-01
  realizadas: number
  faltas: number
  justificadas: number
  pacientes: number
  novos: number
  faturadas: number
  pendentes: number
  valor_ok: number
  psicologas: number
}

export type PsicologaPainel = {
  spreadsheet_id: string
  psi: string
  ativo: boolean
  realizadas_mes: number
  realizadas_mes_anterior: number
  media_3m: number
  faltas_90: number
  agendadas_90: number
  pacientes_ativos: number
  pendentes_antigas: number
  valor_pendente_antigo: number
  dias_para_registrar: number | null
  valor_ok_mes_anterior: number
}

export type PlanoMes = { mes: string; plano: string; realizadas: number; confirmadas: number; valor_ok: number }

export type Painel = {
  mensal: MesProducao[]
  psicologas: PsicologaPainel[]
  planos: PlanoMes[]
  semana: { dow: number; realizadas: number; faltas: number }[]
  retencao: { ativos_30: number; ativos_31_60: number; sem_sessao_ha_30: number; novos_30: number; total_historico: number }
  pendencias: { ate_30_dias: number; mais_30_dias: number; valor_mais_30_dias: number; mais_antiga: string | null }
  valor_real: { plano: string; sessoes: number; media_planilha: number; media_pago: number; media_informado: number }[]
  registro_guias: { guias_mes_anterior: number; registradas: number; linhas_bd: number }
  unimed: { month: string; sessions: number; informed: number; released: number; gloss: number; glossed_sessions: number; median_days_to_statement: number | null }[]
  divergencias: { tipo: 'ok_glosado' | 'pago_sem_ok' | 'falta_faturada'; qtd: number; glosado: number; liberado: number }[]
  caixa: { receber_30: number; atrasado: number; recebido_mes: number; pagar_30: number; por_plano_30: { plano: string; valor: number }[] }
  atualizacao: {
    planilhas: string | null
    planilhas_com_erro: number
    bd_guias: string | null
    ultimo_demonstrativo: string | null
    ultima_orizon: string | null
    hoje: string
  }
}

export type Severidade = 'critico' | 'atencao' | 'info'
export type Alerta = { severidade: Severidade; titulo: string; detalhe: string; link?: string; acao?: string }

const brl = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

export const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const rotuloMes = (iso: string) => `${MESES_CURTOS[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`

/** Dias do mês e dias já passados (inclusive hoje), para projetar o fechamento. */
export function ritmoDoMes(hojeIso: string) {
  const ano = Number(hojeIso.slice(0, 4))
  const mes = Number(hojeIso.slice(5, 7))
  const dia = Number(hojeIso.slice(8, 10))
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return { dia, diasNoMes, fracao: dia / diasNoMes }
}

export function indicadores(p: Painel) {
  const hoje = p.atualizacao.hoje
  const mesAtualIso = `${hoje.slice(0, 7)}-01`
  const atual = p.mensal.find((m) => m.mes === mesAtualIso)
  const fechados = p.mensal.filter((m) => m.mes < mesAtualIso)
  const anterior = fechados.at(-1)
  const ult3 = fechados.slice(-3)
  const media3 = ult3.length ? ult3.reduce((t, m) => t + m.realizadas, 0) / ult3.length : 0
  const { fracao } = ritmoDoMes(hoje)
  const projecao = atual && fracao > 0 ? Math.round(atual.realizadas / fracao) : 0

  const agendadas90 = p.semana.reduce((t, d) => t + d.realizadas + d.faltas, 0)
  const faltas90 = p.semana.reduce((t, d) => t + d.faltas, 0)

  const unimedFechados = p.unimed.filter((u) => u.month < mesAtualIso && u.informed > 100)
  const unimed3 = unimedFechados.slice(-3)
  const informado3 = unimed3.reduce((t, u) => t + Number(u.informed), 0)
  const glosa3 = unimed3.reduce((t, u) => t + Number(u.gloss), 0)
  const unimedUltimo = unimedFechados.at(-1)

  const div = Object.fromEntries(p.divergencias.map((d) => [d.tipo, d])) as Partial<Record<Painel['divergencias'][number]['tipo'], Painel['divergencias'][number]>>
  const cobertura = p.registro_guias.guias_mes_anterior ? p.registro_guias.registradas / p.registro_guias.guias_mes_anterior : null

  return {
    mesAtualIso,
    atual,
    anterior,
    media3,
    projecao,
    variacaoAnterior: anterior && media3 ? anterior.realizadas / media3 - 1 : null,
    taxaFalta90: agendadas90 ? faltas90 / agendadas90 : 0,
    faltas90,
    glosa3m: informado3 ? glosa3 / informado3 : 0,
    glosaValor3m: glosa3,
    unimedUltimo,
    risco: {
      okGlosado: div.ok_glosado,
      pagoSemOk: div.pago_sem_ok,
      faltaFaturada: div.falta_faturada,
    },
    cobertura,
    ticketPlanilha: anterior && anterior.faturadas ? anterior.valor_ok / anterior.faturadas : 0,
  }
}

function horasDesde(iso: string | null, agora: Date) {
  if (!iso) return Infinity
  return (agora.getTime() - new Date(iso).getTime()) / 3_600_000
}

/** Lista do que precisa de atenção, do mais grave para o menos grave. */
export function alertas(p: Painel, agora = new Date()): Alerta[] {
  const k = indicadores(p)
  const out: Alerta[] = []

  if (k.risco.okGlosado?.qtd) {
    out.push({
      severidade: 'critico',
      titulo: `${k.risco.okGlosado.qtd} guias com OK foram glosadas pela Unimed`,
      detalhe: `${brl(k.risco.okGlosado.glosado)} entram no repasse das psicólogas sem a clínica ter recebido. Decidir: recurso de glosa ou tirar o OK.`,
      link: '/financeiro/divergencias',
      acao: 'Ver divergências',
    })
  }
  if (p.caixa.atrasado > 0) {
    out.push({
      severidade: 'critico',
      titulo: `${brl(p.caixa.atrasado)} a receber com data vencida e sem confirmação`,
      detalhe: 'Confira no extrato se caiu e confirme na Agenda; o que não caiu precisa ser cobrado da operadora.',
      link: '/financeiro/agenda',
      acao: 'Abrir agenda',
    })
  }
  if (k.risco.faltaFaturada?.qtd) {
    out.push({
      severidade: 'critico',
      titulo: `${k.risco.faltaFaturada.qtd} faltas foram faturadas para a Unimed`,
      detalhe: `${brl(k.risco.faltaFaturada.liberado)} recebidos por sessões marcadas como falta — risco em auditoria da operadora.`,
      link: '/financeiro/divergencias',
      acao: 'Ver divergências',
    })
  }
  if (p.pendencias.mais_30_dias > 0) {
    out.push({
      severidade: 'atencao',
      titulo: `${p.pendencias.mais_30_dias} sessões realizadas há mais de 30 dias sem status`,
      detalhe: `${brl(p.pendencias.valor_mais_30_dias)} (valor de tabela) sem OK, glosa ou falta na coluna S — faturamento e repasse parados.`,
      link: '/financeiro/guias',
      acao: 'Registro de Guias',
    })
  }
  if (k.risco.pagoSemOk?.qtd) {
    out.push({
      severidade: 'atencao',
      titulo: `${k.risco.pagoSemOk.qtd} guias pagas pela Unimed sem OK na planilha`,
      detalhe: `${brl(k.risco.pagoSemOk.liberado)} recebidos; as psicólogas ainda não recebem repasse por essas sessões.`,
      link: '/financeiro/divergencias',
      acao: 'Ver divergências',
    })
  }
  if (k.unimedUltimo && k.unimedUltimo.informed > 0 && k.unimedUltimo.gloss / k.unimedUltimo.informed > 0.03) {
    out.push({
      severidade: 'atencao',
      titulo: `Glosa da Unimed em ${pct(k.unimedUltimo.gloss / k.unimedUltimo.informed)} (${rotuloMes(k.unimedUltimo.month)})`,
      detalhe: `${brl(k.unimedUltimo.gloss)} glosados em ${k.unimedUltimo.glossed_sessions} sessões. Acima de 3% vale revisar guias e assinaturas antes do envio.`,
      link: '/financeiro',
      acao: 'Painel Unimed',
    })
  }
  const r = p.retencao
  if (r.ativos_31_60 > 0 && r.sem_sessao_ha_30 / r.ativos_31_60 > 0.2) {
    out.push({
      severidade: 'atencao',
      titulo: `${r.sem_sessao_ha_30} pacientes sem sessão nos últimos 30 dias`,
      detalhe: `Eram atendidos entre 30 e 60 dias atrás (${pct(r.sem_sessao_ha_30 / r.ativos_31_60)} da base daquele período). Parte são altas; o resto é risco de abandono — vale contato da recepção.`,
    })
  }
  const quedas = p.psicologas.filter((x) => x.ativo && x.media_3m >= 20 && x.realizadas_mes_anterior < x.media_3m * 0.75)
  if (quedas.length) {
    out.push({
      severidade: 'atencao',
      titulo: `Queda de atendimentos: ${quedas.map((x) => x.psi).join(', ')}`,
      detalhe: 'Mês passado ficou mais de 25% abaixo da média dos 3 meses. Pode ser férias, agenda vazia ou sessões não registradas.',
    })
  }
  if (k.cobertura != null && k.cobertura < 0.95) {
    out.push({
      severidade: 'atencao',
      titulo: `Só ${pct(k.cobertura)} das guias do mês passado estão no Registro de Guias`,
      detalhe: `${p.registro_guias.guias_mes_anterior - p.registro_guias.registradas} guias das planilhas ainda não foram lançadas no ADM Registro de Guia.`,
      link: '/financeiro/guias',
      acao: 'Registro de Guias',
    })
  }
  if (p.atualizacao.planilhas_com_erro > 0) {
    out.push({ severidade: 'atencao', titulo: `${p.atualizacao.planilhas_com_erro} planilha(s) com erro na sincronização`, detalhe: 'Os números dessas psicólogas podem estar desatualizados.', link: '/financeiro/repasse', acao: 'Ver situação' })
  }
  if (horasDesde(p.atualizacao.planilhas, agora) > 3) {
    out.push({ severidade: 'info', titulo: 'Planilhas das psicólogas sem atualização há mais de 3 horas', detalhe: 'Confira o gatilho do Apps Script do Cálculo RPA.' })
  }
  if (p.atualizacao.ultimo_demonstrativo) {
    const dias = (new Date(p.atualizacao.hoje).getTime() - new Date(p.atualizacao.ultimo_demonstrativo).getTime()) / 86_400_000
    if (dias > 35) {
      out.push({ severidade: 'info', titulo: `Último demonstrativo da Unimed é de ${Math.round(dias)} dias atrás`, detalhe: 'Importe o XML do ciclo mais recente.', link: '/financeiro/importar', acao: 'Importar XML' })
    }
  }
  return out
}
