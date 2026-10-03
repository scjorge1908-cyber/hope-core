import 'server-only'
import type { createFinanceClient } from './server'
import type { RepassePagamentoRow } from './db-types'
import { processarRelatorio, MESES, type BaseRpaLegado, type LinhaRelatorio } from './rpa-legado'
import { motorCentralAtivo, motorParaRelatorio, type FechamentoMotor } from './motor'
import { competenciaDe, type LinhaOk } from './repasse-pagamentos'
export { ordenarFila, situacaoDe, type Situacao } from './repasse-pagamentos'

// ================================================================
// Dados do repasse do mês para a tela "Pagamentos de repasse" e para
// o PDF do controle — UMA função só, para a tela e o PDF nunca
// mostrarem números diferentes.
//   • valor a pagar = processarRelatorio() do RPA (fonte única)
//   • pago / não pago = tabela repasse_pagamentos
// ================================================================

type Cliente = Awaited<ReturnType<typeof createFinanceClient>>

export type RepasseDoMes = {
  competencia: string
  erro: string | null
  /** psicólogas sem cálculo (planilha com erro na última leitura) */
  comErro: Extract<LinhaRelatorio, { erro: true }>[]
  ok: LinhaOk[]
  pagamentos: Map<string, RepassePagamentoRow>
  /** a tabela repasse_pagamentos ainda não existe (migration 028) */
  tabelaFalta: boolean
}

export async function carregarRepasseDoMes(supabase: Cliente, mes: string, ano: string): Promise<RepasseDoMes> {
  const competencia = competenciaDe(mes, ano)

  let erro: string | null = null
  let resultado: ReturnType<typeof processarRelatorio> | null = null
  if (motorCentralAtivo()) {
    // FIN_MOTOR=central → motor financeiro central (mesmo formato do RPA)
    const { data: dadosMotor, error: erroMotor } = await supabase.rpc('fin_fechamento_mes', {
      p_ano: Number(ano),
      p_mes: MESES.indexOf(mes.toUpperCase() as (typeof MESES)[number]) + 1,
    })
    if (erroMotor) erro = erroMotor.message
    else resultado = motorParaRelatorio(dadosMotor as unknown as FechamentoMotor)
  } else {
  const { data: base, error: erroBase } = await supabase.rpc('legacy_rpa_base')
  if (erroBase) erro = erroBase.message
  else {
    try {
      resultado = processarRelatorio(base as unknown as BaseRpaLegado, mes, ano)
    } catch (e) {
      erro = (e as Error).message
    }
  }
  }
  const comErro = (resultado?.relatorioFinal.filter((d) => d.erro) ?? []) as Extract<LinhaRelatorio, { erro: true }>[]
  const ok = (resultado?.relatorioFinal.filter((d) => !d.erro) ?? []) as LinhaOk[]

  const { data: pagamentosRaw, error: erroPag } = await supabase
    .from('repasse_pagamentos')
    .select('*')
    .eq('competencia', competencia)
  const pagamentos = new Map((pagamentosRaw ?? []).map((x) => [x.spreadsheet_id, x]))

  return { competencia, erro, comErro, ok, pagamentos, tabelaFalta: !!erroPag }
}
