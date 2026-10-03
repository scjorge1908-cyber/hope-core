// ================================================================
// MOTOR FINANCEIRO CENTRAL — cliente do HOPE CORE (migration_030)
//
// A REGRA mora no banco (fin_calcular_atendimento / fin__fechamento_mes).
// Aqui só: ler o resultado e entregar no MESMO formato do RPA
// (LinhaRelatorio), para Repasse, Pagamentos e PDF trocarem de fonte
// sem mudar layout.
//
// Chave na Vercel:
//   FIN_MOTOR=legado  (padrão) → telas continuam com o cálculo do RPA (TS)
//   FIN_MOTOR=central          → telas passam a usar o motor central
// A tela Conciliação mostra os dois lado a lado SEMPRE.
// ================================================================
import type { LinhaRelatorio } from './rpa-legado'

/** Telas de repasse usam o motor central? (só depois da validação de setembro) */
export function motorCentralAtivo(): boolean {
  return (process.env.FIN_MOTOR ?? '').trim().toLowerCase() === 'central'
}

/** Linha de fin__fechamento_mes() (uma por profissional). */
export type ProfissionalMotor = {
  spreadsheet_id: string
  profissional: string
  nome_abreviado: string | null
  ordem: number | null
  ativo: boolean
  desligada: boolean
  erro_sincronizacao: boolean
  ultimo_erro: string | null
  ultima_sincronizacao: string | null
  tipo: 'PF' | 'CNPJ'
  percentual_cnpj: number | null
  qtd_ok: number
  qtd_pendencias: number
  total_bruto: number
  qtd_unimed33: number
  bruto_unimed33: number
  repasse_unimed33: number
  comissao_padrao: number
  repasse_bruto: number
  base_inss: number | null
  inss: number | null
  liquido: number | null
  parcela_hope: number
  regra_inss: string | null
  qtd_33_sem_unimed: number
  alertas: Record<string, number>
  pix_key?: string
}

export type FechamentoMotor = {
  competencia: string
  fechado: boolean
  profissionais: ProfissionalMotor[]
}

export type FotoFechamento = {
  id: string
  competencia: string
  origem: string
  observacao: string | null
  qtd_ok: number
  total_bruto: number
  repasse_bruto: number
  inss: number
  liquido: number
  parcela_hope: number
  fechado_em: string
  profissionais: {
    spreadsheet_id: string
    profissional: string
    tipo: 'PF' | 'CNPJ'
    qtd_ok: number
    total_bruto: number
    repasse_bruto: number
    inss: number
    liquido: number
    parcela_hope: number
    regra_inss: string
  }[]
}

export type AlertaAtendimento = {
  spreadsheet_id: string
  profissional: string
  linha: number
  id_atendimento: string | null
  data_sessao: string | null
  status: string
  ok: boolean
  valor_registrado: unknown
  valor_bruto: number | null
  regra: string
  repasse_profissional: number
  parcela_hope: number
  plano: string
  alertas: string[]
}

export type DivergenciaUnimed = {
  profissional: string
  competencia: string
  id_atendimento: string
  linha: number
  data_sessao: string | null
  status: string
  valor_registrado: unknown
  valor_esperado: number
}

export type Pendencia = {
  tipo: 'ALTERADO_APOS_FECHAMENTO'
  competencia: string
  spreadsheet_id: string
  profissional: string | null
  situacao: 'NOVO_OU_ALTERADO' | 'REMOVIDO_OU_ALTERADO'
  qtd_atual: number
  qtd_fechada: number
  linha: number | null
  id_atendimento: string | null
  valor_atual: number | null
  valor_fechado: number | null
  regularizado: boolean
}

/** Descrição curta de cada alerta (para a tela). */
export const ALERTAS: Record<string, string> = {
  VALOR_PLANILHA_DIVERGENTE: 'Unimed 0025/25: coluna N diferente de R$ 33 — o fechamento usou R$ 33',
  INCONSISTENCIA_CADASTRAL_PLANO: 'Carteirinha 0025/25 com plano vazio, "NÃO" ou "NÃO ENCONTRADO"',
  SEM_VALOR: 'OK sem valor na coluna N (somado como 0)',
  VALOR_INVALIDO: 'Valor da coluna N sem número (somado como 0)',
  VALOR_ZERO: 'Valor R$ 0,00 digitado',
  VALOR_EM_TEXTO: 'Valor digitado como texto (ex.: "R$ 45,00") — lido corretamente',
  VALOR_33_SEM_REGRA_UNIMED: 'R$ 33 fora da regra Unimed 0025 — calculado na regra normal',
  DATA_SESSAO_INVALIDA: 'Data da Sessão vazia ou inválida (não muda a competência)',
  DATA_LANCAMENTO_TEXTO: 'Coluna A digitada como texto',
  ID_DUPLICADO: 'ID_ATENDIMENTO repetido em mais de uma linha',
}

/**
 * Converte o resultado do motor para o MESMO formato do processarRelatorio()
 * do RPA — as telas atuais funcionam sem mudança.
 * Profissional CNPJ: repasseBruto = faturamento bruto (como no RPA).
 */
export function motorParaRelatorio(dados: FechamentoMotor): { relatorioFinal: LinhaRelatorio[]; logs: string[] } {
  const relatorioFinal: LinhaRelatorio[] = []
  const logs: string[] = []
  for (const p of dados.profissionais) {
    const nome = p.profissional
    const pixKey = p.pix_key ?? ''
    if (p.erro_sincronizacao) {
      const msg = p.ultimo_erro || 'Planilha ainda não sincronizada.'
      relatorioFinal.push({ id: p.spreadsheet_id, nome, pixKey, erro: true, msg })
      logs.push(`❌ ${nome}: Erro - ${msg}`)
      continue
    }
    const cnpj = p.tipo === 'CNPJ'
    relatorioFinal.push({
      id: p.spreadsheet_id,
      nome,
      pixKey,
      erro: false,
      repasseBruto: cnpj ? Number(p.total_bruto) : Number(p.repasse_bruto),
      baseCalculoInss: cnpj ? 0 : Number(p.base_inss ?? 0),
      retencaoInss: cnpj ? 0 : Number(p.inss ?? 0),
      valorLiquido: Number(p.liquido ?? 0),
      isIsenta: cnpj,
      percentualIsenta: cnpj ? Number(p.percentual_cnpj ?? 0) : 0,
      qtdPacientes: p.qtd_ok,
      qtdPendencias: p.qtd_pendencias,
      totalFaturamento: Number(p.total_bruto),
      qtdSessoes33: p.qtd_unimed33,
      totalProducao33: Number(p.bruto_unimed33),
      comissaoSessoes33: Number(p.repasse_unimed33),
      comissaoPadrao: cnpj ? 0 : Number(p.comissao_padrao),
      qtdSessoes33SemUnimed: p.qtd_33_sem_unimed,
    })
    logs.push(`✅ ${nome}: Sucesso`)
    if (p.qtd_33_sem_unimed > 0) {
      logs.push(`⚠️ ${nome}: ${p.qtd_33_sem_unimed} sessão(ões) de R$ 33 fora da regra Unimed 0025 — calculadas na regra normal. Conferir.`)
    }
    const divergentes = p.alertas?.VALOR_PLANILHA_DIVERGENTE ?? 0
    if (divergentes > 0) {
      logs.push(`⚠️ ${nome}: ${divergentes} lançamento(s) Unimed 0025 com valor ≠ R$ 33 na planilha — fechamento usou R$ 33.`)
    }
  }
  return { relatorioFinal, logs }
}

/** Situação da conciliação de um profissional. */
export type StatusConciliacao =
  | 'CONCILIADO'
  | 'PENDENTE'
  | 'DIVERGENTE'
  | 'SEM VALOR'
  | 'ERRO DE SINCRONIZAÇÃO'
  | 'SÓ NO MOTOR'

export function statusConciliacao(x: {
  erro: boolean
  liquidoMotor: number | null
  liquidoRpa: number | null
  liquidoFoto: number | null
  pago: number | null
}): { status: StatusConciliacao; motivo: string } {
  const dif = (a: number, b: number) => Math.abs(a - b) > 0.004
  if (x.erro) return { status: 'ERRO DE SINCRONIZAÇÃO', motivo: 'Planilha com erro na última leitura' }
  const ref = x.liquidoFoto ?? x.liquidoMotor ?? 0
  if (x.liquidoFoto !== null && x.liquidoMotor !== null && dif(x.liquidoFoto, x.liquidoMotor))
    return { status: 'DIVERGENTE', motivo: 'Planilha mudou depois do fechamento (foto ≠ cálculo de hoje)' }
  if (x.liquidoRpa === null) {
    if (x.pago !== null && !dif(x.pago, ref)) return { status: 'CONCILIADO', motivo: 'Fora da lista atual do RPA (desligada), pago conforme motor' }
    return { status: 'SÓ NO MOTOR', motivo: 'Fora da lista atual do RPA (desligada) — continua no histórico' }
  }
  if (x.liquidoMotor !== null && dif(x.liquidoMotor, x.liquidoRpa))
    return { status: 'DIVERGENTE', motivo: 'Motor central ≠ RPA atual' }
  if (x.pago !== null) {
    if (dif(x.pago, ref)) return { status: 'DIVERGENTE', motivo: 'Valor pago ≠ líquido calculado' }
    return { status: 'CONCILIADO', motivo: 'Pago = líquido' }
  }
  if (ref <= 0) return { status: 'SEM VALOR', motivo: 'Nada a pagar no mês' }
  return { status: 'PENDENTE', motivo: 'Ainda não pago' }
}
