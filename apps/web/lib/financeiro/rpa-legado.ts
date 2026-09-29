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
// ================================================================

/** Célula como chega do banco: número, texto, booleano ou data marcada. */
export type CelulaLegado = string | number | boolean | null | { $date: string }

export type PsicologaLegado = {
  id: string
  nomeAbreviado: string | null
  nomeCompleto: string
  pixKey: string
  ultimaSincronizacao: string | null
  ultimoErro: string | null
  /** cada linha = [coluna A, coluna N, coluna S] */
  linhas: [CelulaLegado, CelulaLegado, CelulaLegado][]
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

  const isIsenta = Object.prototype.hasOwnProperty.call(isencaoMap, idPlanilha)
  const percentualIsenta = isIsenta ? Number(isencaoMap[idPlanilha]) : 0

  for (const [celA, celN, celS] of linhas) {
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
    const comissao40 = Number((totalProducao100 * 0.4).toFixed(2))
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
    } catch (e) {
      const msg = (e as Error).message
      relatorioFinal.push({ id: psi.id, nome: psi.nomeCompleto, pixKey: psi.pixKey, erro: true, msg })
      logs.push(`❌ ${psi.nomeCompleto}: Erro - ${msg}`)
    }
  }

  return { relatorioFinal, logs }
}
