// ================================================================
// CÁLCULO DE REPASSE — PORTE FIEL DO "SISTEMA MESTRE - CÁLCULO RPA"
//
// Origem: Code.gs do projeto Apps Script "Calculo RPA"
// (planilha 18eqyiRTsnfl0PJ_b314XxFcPoHDbf3SvRoF_p_XttKA), versão
// recebida em 29/09/2026.
//
// REGRA DESTE ARQUIVO: a lógica e o cálculo são os MESMOS do Apps Script,
// linha a linha. O que mudou é só DE ONDE vêm os dados:
//   antes  → SpreadsheetApp.openById(id).getSheetByName('Atendimentos')
//   agora  → cópia da aba Atendimentos no Supabase (schema legado),
//            enviada pelo SyncSupabase.gs, via RPC legacy_rpa_base().
// Qualquer mudança de regra deve ser feita NOS DOIS lugares enquanto o
// Apps Script existir, senão os relatórios vão divergir.
//
// Observação mantida de propósito: TETO_INSS = 7786.02 é o valor de 2024,
// igual ao Apps Script. O teto de 2026 é 8475.55 (tabela inss_ceilings).
// Não foi trocado aqui para o relatório bater 100% com o atual; trocar
// nos dois sistemas ao mesmo tempo.
//
// ⚠️ NOVO (02/10/2026) — REPASSE DIFERENCIADO PARA SESSÃO DE R$ 33
//   Igual ao Code.gs de 02/10/2026 (com a correção da carteirinha):
//   sessão "OK" de R$ 33,00 (coluna N) cuja CARTEIRINHA (coluna L,
//   cabeçalho "Carterinha") começa com 0025 = Unimed → repasse FIXO de
//   R$ 18,00 (54,55%, PF). R$ 33 sem carteirinha 0025 continua 40% e
//   vira alerta. CNPJ, INSS e teto não mudam.
//   Carteirinha guardada como NÚMERO perdeu os zeros (0025… → 25…):
//   devolvemos os dois zeros antes de comparar, como no Code.gs.
//   A coluna da carteirinha é escolhida pelo cabeçalho DENTRO do banco
//   (legacy_rpa_base, migration 028): 1º cabeçalho com "CART", senão a
//   coluna L. Chega aqui como 4º item de cada linha.
// ================================================================

// ⚠️ NOVO — parâmetros do repasse diferenciado (iguais ao Code.gs)
export const RPA_PERCENTUAL_PADRAO = 0.4
export const RPA_VALOR_SESSAO_ESPECIAL = 33
export const RPA_REPASSE_SESSAO_ESPECIAL = 18 // R$ 18,00 fixo por sessão de R$ 33 Unimed (54,55%)
export const RPA_PLANO_SESSAO_ESPECIAL = 'UNIMED'
export const RPA_PREFIXO_CARTEIRINHA_UNIMED = '0025' // carteirinha Unimed começa com 0025

/** Célula como chega do banco: número, texto, booleano ou data marcada. */
export type CelulaLegado = string | number | boolean | null | { $date: string }

export type PsicologaLegado = {
  id: string
  nomeAbreviado: string | null
  nomeCompleto: string
  pixKey: string
  ultimaSincronizacao: string | null
  ultimoErro: string | null
  /**
   * cada linha = [coluna A, coluna N, coluna S, carteirinha (coluna L)].
   * O 4º item pode faltar em dados antigos (antes da migration 028).
   */
  linhas: [CelulaLegado, CelulaLegado, CelulaLegado, CelulaLegado?][]
}

export type BaseRpaLegado = {
  psicologas: PsicologaLegado[]
  /** cada linha = [psicologaId, cnpj, percentual] (valores crus da aba ExencaoCNPJ) */
  exencoes: [CelulaLegado, CelulaLegado, CelulaLegado][]
}

export type TipoRelatorio = 'COMPLETO' | 'RPA' | 'PAGAR'

export type ResultadoIndividual = {
  repasseBruto: number
  baseCalculoInss: number
  retencaoInss: number
  valorLiquido: number
  isIsenta: boolean
  percentualIsenta: number
  qtdPacientes: number
  qtdPendencias: number
  totalFaturamento: number
  // ⚠️ NOVO — detalhamento das sessões de R$ 33
  qtdSessoes33: number
  totalProducao33: number
  comissaoSessoes33: number
  comissaoPadrao: number
  qtdSessoes33SemUnimed: number
}

export type LinhaRelatorio =
  | ({ id: string; nome: string; pixKey: string; erro: false } & ResultadoIndividual)
  | { id: string; nome: string; pixKey: string; erro: true; msg: string }

export const MESES = [
  'JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
] as const

// ----------------------------------------------------------------
// Datas: no Apps Script a coluna A chegava como objeto Date (quando a
// célula era data) ou como texto. O sincronizador marca as datas como
// {$date: "yyyy-MM-ddTHH:mm:ss"} já no fuso de São Paulo (GMT-3), então
// "MM/yyyy" em GMT-3 = os dígitos do próprio texto.
// ----------------------------------------------------------------
function ehData(v: CelulaLegado): v is { $date: string } {
  return typeof v === 'object' && v !== null && '$date' in v
}

/** Converte a célula para o valor que o Apps Script enxergaria (Date para datas). */
function comoValorAppsScript(v: CelulaLegado): unknown {
  if (ehData(v)) {
    const [d, t = '00:00:00'] = v.$date.split('T')
    // horário local de SP (GMT-3, sem horário de verão desde 2019)
    return new Date(`${d}T${t}-03:00`)
  }
  return v
}

// =======================================================
// FUNÇÃO QUE LÊ QUALQUER FORMATO DE VALOR MONETÁRIO
// (cópia fiel de extrairValorMonetario do Apps Script)
// =======================================================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extrairValorMonetario(valor: any): number {
  // Se já for número, retorna direto
  if (typeof valor === 'number' && !isNaN(valor)) {
    return valor
  }

  // Se for null, undefined ou vazio
  if (!valor) return 0

  // Converte para string
  let texto = String(valor).trim()

  // Se estiver vazio após trim
  if (texto === '') return 0

  // 1. Remove qualquer símbolo de moeda (R$, $, US$, €, etc)
  texto = texto
    .replace(/[Rr][Ss]\$\s*/g, '') // R$ 45,00
    .replace(/US\$\s*/g, '') // US$ 45.00
    .replace(/\$\s*/g, '') // $45.00
    .replace(/[€£¥]/g, '') // €, £, ¥
    .replace(/[A-Za-z]\s*/g, '') // Remove letras soltas

  // 2. Remove espaços extras
  texto = texto.trim()

  // 3. Se estiver vazio depois de limpar
  if (texto === '') return 0

  // 4. Trata formato com vírgula como separador decimal (BR)
  if (texto.includes(',')) {
    const partes = texto.split(',')
    const parteInteira = partes[0].replace(/\./g, '') // Remove pontos de milhar
    let parteDecimal = partes[1] || '00'

    // Se a parte decimal tiver mais de 2 dígitos, corta
    if (parteDecimal.length > 2) {
      parteDecimal = parteDecimal.substring(0, 2)
    }

    texto = parteInteira + '.' + parteDecimal
  } else if (texto.includes('.')) {
    //   "45.00" -> DECIMAL; "45.5" -> DECIMAL; "1.234" -> MILHAR; "1.234.567" -> MILHAR
    const partesPonto = texto.split('.')
    const ultimaParte = partesPonto[partesPonto.length - 1]
    if (partesPonto.length === 2 && (ultimaParte.length === 1 || ultimaParte.length === 2)) {
      // Ponto único com 1 ou 2 casas -> separador decimal, mantém como está
    } else {
      // Um ponto com 3+ casas, ou múltiplos pontos -> separador de milhar
      texto = partesPonto.join('')
    }
  }

  // 5. Tenta converter para número
  let numero = parseFloat(texto)

  // 6. Se ainda deu NaN, tenta extrair qualquer número
  if (isNaN(numero)) {
    const numerosEncontrados = texto.match(/\d+[,.]?\d*/g)
    if (numerosEncontrados && numerosEncontrados.length > 0) {
      let ultimoNumero = numerosEncontrados[numerosEncontrados.length - 1]
      // Se tiver vírgula, trata como decimal
      if (ultimoNumero.includes(',')) {
        ultimoNumero = ultimoNumero.replace(/,/g, '.')
      }
      numero = parseFloat(ultimoNumero)
    }
  }

  // 7. Se ainda for NaN, retorna 0
  return isNaN(numero) ? 0 : numero
}

// =======================================================
// listarExencoes() — mesma regra: percentual vazio = 45;
// só vale a linha que tem id E cnpj.
// =======================================================
export function mapaIsencoes(exencoes: BaseRpaLegado['exencoes']): Record<string, number> {
  const mapa: Record<string, number> = {}
  for (const row of exencoes) {
    const id = row[0]
    const cnpj = row[1]
    const percentualBruto = row[2]
    const percentual =
      percentualBruto === '' || percentualBruto === undefined || percentualBruto === null ? 45 : Number(percentualBruto)
    // o ID da aba ID é enviado sem espaços nas pontas; aplica o mesmo aqui
    if (id && cnpj) mapa[String(id).trim()] = percentual
  }
  return mapa
}

// =======================================================
// ⚠️ NOVO — AUXILIARES DA TRAVA UNIMED (iguais ao Code.gs)
// =======================================================

/** Maiúsculas e sem acentos (_rpaNormalizarTexto_). */
export function rpaNormalizarTexto(t: unknown): string {
  return String(t === null || t === undefined ? '' : t)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
}

/**
 * Índice (base 0) da coluna da carteirinha pelo cabeçalho — a MESMA regra
 * do banco (legacy_rpa_base, migration 028) e do Code.gs corrigido:
 * 1º cabeçalho que contém "CART" ("Carterinha"/"Carteirinha"); senão L (11).
 */
export function indiceCarteirinha(cabecalho: unknown[]): number {
  const i = cabecalho.map(rpaNormalizarTexto).findIndex((h) => h.indexOf('CART') !== -1)
  return i === -1 ? 11 : i
}

/**
 * Verdadeiro se a carteirinha começa com 0025 (Unimed) — _rpaCarteirinhaUnimed_.
 * Texto: só os dígitos. Número: a planilha tirou os zeros da frente
 * (0025… virou 25…), então devolve os dois zeros antes de comparar.
 */
export function rpaCarteirinhaUnimed(valor: CelulaLegado | undefined): boolean {
  if (valor === null || valor === undefined || valor === '') return false
  if (typeof valor === 'object') return false // data: nunca é carteirinha
  const digitos = typeof valor === 'number' ? '00' + String(Math.trunc(Math.abs(valor))) : String(valor).replace(/\D/g, '')
  return digitos.indexOf(RPA_PREFIXO_CARTEIRINHA_UNIMED) === 0
}

// =======================================================
// calcularIndividual() — cópia fiel. `linhas` = [col A, col N, col S].
// =======================================================
export function calcularIndividual(
  idPlanilha: string,
  linhas: PsicologaLegado['linhas'],
  mesNome: string,
  anoAlvo: number | string,
  isencaoMap: Record<string, number>
): ResultadoIndividual {
  const mapaMeses: Record<string, number> = {
    JANEIRO: 0, FEVEREIRO: 1, MARCO: 2, ABRIL: 3, MAIO: 4, JUNHO: 5,
    JULHO: 6, AGOSTO: 7, SETEMBRO: 8, OUTUBRO: 9, NOVEMBRO: 10, DEZEMBRO: 11,
  }
  const mesIndex = mapaMeses[mesNome.toUpperCase()]

  let totalProducao100 = 0
  let contagemPacientes = 0
  let contagemPendencias = 0

  // ⚠️ NOVO — acumuladores das sessões de R$ 33 Unimed (repasse fixo R$ 18,00)
  let totalProducao33 = 0
  let contagemSessoes33 = 0
  let comissaoSessoes33 = 0
  let comissaoPadraoRetorno = 0
  let contagemSessoes33SemUnimed = 0

  const isIsenta = Object.prototype.hasOwnProperty.call(isencaoMap, idPlanilha)
  const percentualIsenta = isIsenta ? Number(isencaoMap[idPlanilha]) : 0

  for (const [celA, celN, celS, celCarteirinha] of linhas) {
    const dataRegistro = comoValorAppsScript(celA)
    const valorCheio = extrairValorMonetario(comoValorAppsScript(celN))
    const status = String(comoValorAppsScript(celS) || '').trim() // coluna S

    if (!dataRegistro) continue

    let registroValido = false
    if (ehData(celA)) {
      // Utilities.formatDate(dataRegistro, "GMT-3", "MM/yyyy")
      const mesStr = celA.$date.slice(5, 7)
      const anoStr = celA.$date.slice(0, 4)
      if (parseInt(mesStr) - 1 === mesIndex && anoStr === String(anoAlvo)) registroValido = true
    } else if (typeof dataRegistro === 'string') {
      try {
        const p = dataRegistro.split(' ')[0].split('/')
        if (p.length === 3 && parseInt(p[1]) - 1 === mesIndex && p[2] === String(anoAlvo)) registroValido = true
      } catch {
        // igual ao Apps Script: ignora
      }
    }

    if (registroValido) {
      // REGRA PRINCIPAL: Só considera se for "OK" (qualquer maiúscula/minúscula) ou vazio
      const statusNormalizado = status.toUpperCase()
      if (statusNormalizado === 'OK') {
        totalProducao100 += valorCheio
        contagemPacientes++

        // ⚠️ NOVO — sessão de R$ 33: só recebe R$ 18,00 fixo se a carteirinha for Unimed (0025)
        if (Math.abs(valorCheio - RPA_VALOR_SESSAO_ESPECIAL) < 0.009) {
          if (rpaCarteirinhaUnimed(celCarteirinha)) {
            totalProducao33 += valorCheio
            contagemSessoes33++
            comissaoSessoes33 += RPA_REPASSE_SESSAO_ESPECIAL
          } else {
            // R$ 33 de outro plano: continua nos 40% e vira alerta
            contagemSessoes33SemUnimed++
          }
        }
      } else if (status === '') {
        contagemPendencias++
      }
      // Qualquer outro texto (como "falta", "cancelado", etc.) é IGNORADO completamente
    }
  }

  let repasseBruto = 0
  let baseCalculoRPA = 0
  let retencaoInss = 0
  let valorLiquido = 0

  if (isIsenta) {
    // Para CNPJ: percentual individual definido por psicóloga, SEM INSS
    valorLiquido = Number((totalProducao100 * (percentualIsenta / 100)).toFixed(2))
    repasseBruto = totalProducao100
    baseCalculoRPA = 0
    retencaoInss = 0
  } else {
    // Para PF: 40% com desconto de INSS
    // ⚠️ NOVO — sessões de R$ 33 Unimed recebem R$ 18,00 fixo; as demais, 40%
    const totalProducaoPadrao = totalProducao100 - totalProducao33
    const comissaoPadrao = Number((totalProducaoPadrao * RPA_PERCENTUAL_PADRAO).toFixed(2))
    comissaoPadraoRetorno = comissaoPadrao
    const comissao40 = Number((comissaoPadrao + comissaoSessoes33).toFixed(2))
    baseCalculoRPA = comissao40
    repasseBruto = comissao40

    const TETO_INSS = 7786.02
    if (baseCalculoRPA > TETO_INSS) baseCalculoRPA = TETO_INSS

    retencaoInss = Number((baseCalculoRPA * 0.11).toFixed(2))
    const tetoImposto = Number((TETO_INSS * 0.11).toFixed(2))
    if (retencaoInss > tetoImposto) retencaoInss = tetoImposto

    valorLiquido = Number((baseCalculoRPA - retencaoInss).toFixed(2))
  }

  return {
    repasseBruto: repasseBruto,
    baseCalculoInss: baseCalculoRPA,
    retencaoInss: retencaoInss,
    valorLiquido: valorLiquido,
    isIsenta: isIsenta,
    percentualIsenta: percentualIsenta,
    qtdPacientes: contagemPacientes,
    qtdPendencias: contagemPendencias,
    totalFaturamento: totalProducao100,
    // ⚠️ NOVO — detalhamento das sessões de R$ 33
    qtdSessoes33: contagemSessoes33,
    totalProducao33: Number(totalProducao33.toFixed(2)),
    comissaoSessoes33: Number(comissaoSessoes33.toFixed(2)),
    comissaoPadrao: comissaoPadraoRetorno,
    qtdSessoes33SemUnimed: contagemSessoes33SemUnimed,
  }
}

// =======================================================
// processarRelatorioWeb() — mesma sequência; em vez de gerar PDF no
// Drive, devolve as linhas para a tela (que imprime/gera PDF).
// =======================================================
export function processarRelatorio(base: BaseRpaLegado, mesNome: string, anoAlvo: number | string) {
  if (base.psicologas.length === 0) throw new Error('Nenhuma psicóloga válida encontrada.')
  const isencaoMap = mapaIsencoes(base.exencoes)

  const relatorioFinal: LinhaRelatorio[] = []
  const logs: string[] = []

  for (const psi of base.psicologas) {
    // Igual ao RPA original: se a planilha não pôde ser lida (agora, na
    // última sincronização), a psicóloga sai como erro e fica fora dos
    // totais — nunca calcula em cima de uma cópia antiga sem avisar.
    if (!psi.ultimaSincronizacao || psi.ultimoErro) {
      const msg = psi.ultimoErro || 'Planilha ainda não sincronizada.'
      relatorioFinal.push({ id: psi.id, nome: psi.nomeCompleto, pixKey: psi.pixKey, erro: true, msg })
      logs.push(`❌ ${psi.nomeCompleto}: Erro - ${msg}`)
      continue
    }
    try {
      const resultado = calcularIndividual(psi.id, psi.linhas, mesNome, anoAlvo, isencaoMap)
      relatorioFinal.push({ id: psi.id, nome: psi.nomeCompleto, pixKey: psi.pixKey, ...resultado, erro: false })
      logs.push(`✅ ${psi.nomeCompleto}: Sucesso`)
      // ⚠️ NOVO — alerta de sessão de R$ 33 que não é Unimed
      if (resultado.qtdSessoes33SemUnimed > 0) {
        logs.push(`⚠️ ${psi.nomeCompleto}: ${resultado.qtdSessoes33SemUnimed} sessão(ões) de R$ 33 SEM plano Unimed — calculadas a 40%. Conferir.`)
      }
    } catch (e) {
      const msg = (e as Error).message
      relatorioFinal.push({ id: psi.id, nome: psi.nomeCompleto, pixKey: psi.pixKey, erro: true, msg })
      logs.push(`❌ ${psi.nomeCompleto}: Erro - ${msg}`)
    }
  }

  return { relatorioFinal, logs }
}
