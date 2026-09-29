// Funções do Code.gs do ADM Registro de Guia que a página nova pode chamar
// (exatamente as usadas pelo Index.html original + o mapa nome→ID da aba ID).
export const FUNCOES_PONTE = [
  'getListaPsicologas',
  'getListaPacientes',
  'buscarDadosBackend',
  'buscarStatusDetalhadoGuias',
  'buscarTodasGlosas',
  'salvarDadosPaciente',
  'gerarRelatorioPDF',
  'buscarDetalhesGuiaComGlosa',
  'buscarDadosAgendaPaciente',
  'salvarStatusGuia',
  'buscarTelefonePaciente',
  'buscarGlosa',
  'verificarEAplicarGlosasPendentes',
  'hopeMapaPsicologas',
] as const

/** Funções que gravam na planilha → depois de confirmadas, espelhamos no banco. */
export const FUNCOES_ESCRITA = new Set<string>(['salvarDadosPaciente', 'salvarStatusGuia'])

/** Resolvida no próprio HOPE CORE (não vai ao Apps Script). */
export const FUNCAO_UNIMED = 'hopeUnimedStatus'

export const API_REGISTRO = '/financeiro/guias/api'

export function funcaoPermitida(fn: string): fn is (typeof FUNCOES_PONTE)[number] {
  return (FUNCOES_PONTE as readonly string[]).includes(fn)
}
