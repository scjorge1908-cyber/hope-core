// ================================================================
// HOPE CORE — Leitor de XML TISS (Demonstrativo de Análise de Conta)
//
// Validado contra 5 demonstrativos reais da Unimed Grande Florianópolis
// (TISS 3.03.01, mai–set/2026). Regras aprendidas com esses arquivos:
//
// 1. Valores de cada sessão, guia e protocolo vêm em REAIS ("33.10").
//    Já o total geral do demonstrativo e o valor de cada glosa vêm
//    multiplicados por 100 ("4554.00" = R$ 45,54). A escala é
//    DETECTADA comparando com os valores em reais — se a operadora
//    corrigir o arquivo um dia, o leitor continua certo.
// 2. Uma guia pode ter várias sessões (até 6 nos arquivos reais), então
//    o número da guia sozinho NÃO identifica uma sessão. A chave é
//    operadora + guia do prestador + data de realização + procedimento
//    + ocorrência (1ª, 2ª... vez que essa combinação aparece no arquivo).
// 3. Um demonstrativo mistura atendimentos de meses diferentes. A
//    competência é sempre a data de realização da sessão.
// 4. Todo valor é somado em centavos inteiros (sem erro de arredondamento).
// ================================================================

import { createHash } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'

// ---------- Tipos -------------------------------------------------

export type Cents = number

export type ParsedGloss = {
  code: string
  valueCents: Cents
}

export type ParsedItem = {
  lotNumber: string | null
  protocolNumber: string | null
  protocolSituation: string | null
  providerGuideNumber: string
  operatorGuideNumber: string | null
  authPassword: string | null
  beneficiaryName: string | null
  cardNumber: string | null
  billingStartDate: string | null
  billingStartTime: string | null
  billingEndDate: string | null
  billingEndTime: string | null
  guideSituation: string | null
  /** posição da sessão dentro da guia (1, 2, 3...) */
  guideItemSequence: number
  realizationDate: string
  procedureTable: string | null
  procedureCode: string
  procedureDescription: string | null
  participationDegree: string | null
  quantity: number | null
  informedCents: Cents
  processedCents: Cents
  releasedCents: Cents
  /** informado − liberado */
  glossCents: Cents
  glosses: ParsedGloss[]
  /** 1ª, 2ª... ocorrência da mesma guia+data+procedimento no arquivo */
  occurrence: number
  itemKey: string
  contentHash: string
}

export type Totals = {
  informedCents: Cents
  processedCents: Cents
  releasedCents: Cents
  glossCents: Cents
}

export type ParsedStatement = {
  fileName: string
  fileSha256: string
  tissVersion: string | null
  transactionType: string
  operatorAnsCode: string
  operatorName: string | null
  operatorCnpj: string | null
  providerCode: string | null
  contractedCnpj: string | null
  contractedName: string | null
  statementNumber: string
  emissionDate: string
  /** totais declarados no cabeçalho do demonstrativo, já em reais×100 */
  declaredTotals: Totals | null
  /** totais somando sessão por sessão */
  itemTotals: Totals
  items: ParsedItem[]
  /** avisos que não impedem a importação, mas precisam aparecer na tela */
  divergences: string[]
}

export class TissParseError extends Error {}

// ---------- Utilidades --------------------------------------------

const ARRAY_TAGS = new Set([
  'demonstrativoAnaliseConta',
  'dadosProtocolo',
  'relacaoGuias',
  'detalhesGuia',
  'relacaoGlosa',
])

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  // Nunca converter para número: guia, carteirinha e senha têm zeros à esquerda.
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
})

type Node = Record<string, unknown>

function str(node: unknown, key: string): string | null {
  if (!node || typeof node !== 'object') return null
  const v = (node as Node)[key]
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function child(node: unknown, key: string): Node | null {
  if (!node || typeof node !== 'object') return null
  const v = (node as Node)[key]
  if (Array.isArray(v)) return (v[0] as Node) ?? null
  return v && typeof v === 'object' ? (v as Node) : null
}

function list(node: unknown, key: string): Node[] {
  if (!node || typeof node !== 'object') return []
  const v = (node as Node)[key]
  if (v === undefined || v === null) return []
  return (Array.isArray(v) ? v : [v]) as Node[]
}

/** "33.10" | "33,10" | "4554.00" -> centavos inteiros (sem float). */
export function toCents(raw: string | null): Cents {
  if (raw === null) return 0
  const s = raw.replace(/\s/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new TissParseError(`Valor monetário inválido: "${raw}"`)
  const neg = s.startsWith('-')
  const [int, dec = ''] = s.replace('-', '').split('.')
  const cents = Number(int) * 100 + Number((dec + '00').slice(0, 2))
  // arredonda a 3ª casa, se houver
  const extra = dec.length > 2 && Number(dec[2]) >= 5 ? 1 : 0
  return neg ? -(cents + extra) : cents + extra
}

function isoDate(raw: string | null): string | null {
  if (!raw || raw.startsWith('0001-01-01')) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  return raw
}

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Lê o encoding declarado no XML (a Unimed usa iso-8859-1). */
export function decodeXml(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 200))
  const m = head.match(/encoding\s*=\s*["']([^"']+)["']/i)
  const enc = (m?.[1] ?? 'utf-8').toLowerCase()
  const label = enc === 'iso-8859-1' || enc === 'latin1' || enc === 'windows-1252' ? 'windows-1252' : 'utf-8'
  return new TextDecoder(label).decode(bytes)
}

/**
 * Escolhe a escala (1 ou 100) de um valor "suspeito" comparando com o
 * valor esperado em centavos. Devolve null se nenhuma escala bate.
 */
function pickScale(rawCents: Cents, expectedCents: Cents): 1 | 100 | null {
  if (rawCents === expectedCents) return 1
  if (Math.round(rawCents / 100) === expectedCents) return 100
  return null
}

const brl = (c: Cents) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// ---------- Leitor principal --------------------------------------

export function parseTissStatement(bytes: Uint8Array, fileName: string): ParsedStatement {
  const fileSha256 = sha256(bytes)
  const xml = decodeXml(bytes)

  let doc: Node
  try {
    doc = parser.parse(xml) as Node
  } catch (e) {
    throw new TissParseError(`Arquivo não é um XML válido: ${(e as Error).message}`)
  }

  const msg = child(doc, 'mensagemTISS')
  if (!msg) throw new TissParseError('Não é um arquivo TISS (falta mensagemTISS).')

  const cab = child(msg, 'cabecalho')
  const transactionType = str(child(cab, 'identificacaoTransacao'), 'tipoTransacao') ?? ''
  const tissVersion = str(cab, 'Padrao')
  const providerCode = str(child(child(cab, 'destino'), 'identificacaoPrestador'), 'codigoPrestadorNaOperadora')

  if (transactionType !== 'DEMONSTRATIVO_ANALISE_CONTA') {
    throw new TissParseError(
      `Tipo de arquivo "${transactionType || 'desconhecido'}" ainda não suportado. ` +
        'Por enquanto só o Demonstrativo de Análise de Conta é importado.'
    )
  }

  const demos = list(child(child(msg, 'operadoraParaPrestador'), 'demonstrativosRetorno'), 'demonstrativoAnaliseConta')
  if (demos.length === 0) throw new TissParseError('Demonstrativo de análise de conta não encontrado no arquivo.')
  if (demos.length > 1) {
    throw new TissParseError(`O arquivo tem ${demos.length} demonstrativos; esperado 1. Envie um por arquivo.`)
  }
  const demo = demos[0]

  const cd = child(demo, 'cabecalhoDemonstrativo')
  const operatorAnsCode = str(cd, 'registroANS')
  const statementNumber = str(cd, 'numeroDemonstrativo')
  const emissionDate = isoDate(str(cd, 'dataEmissao'))
  if (!operatorAnsCode) throw new TissParseError('Registro ANS da operadora ausente.')
  if (!statementNumber) throw new TissParseError('Número do demonstrativo ausente.')
  if (!emissionDate) throw new TissParseError('Data de emissão do demonstrativo ausente ou inválida.')

  const contratado = child(child(demo, 'dadosPrestador'), 'dadosContratado')
  const divergences: string[] = []
  const items: ParsedItem[] = []
  const occurrences = new Map<string, number>()

  const protocolos = list(child(demo, 'dadosConta'), 'dadosProtocolo')
  const protoTotals: Totals = { informedCents: 0, processedCents: 0, releasedCents: 0, glossCents: 0 }

  for (const p of protocolos) {
    const lotNumber = str(p, 'numeroLotePrestador')
    const protocolNumber = str(p, 'numeroProtocolo')
    const protocolSituation = str(p, 'situacaoProtocolo')
    protoTotals.informedCents += toCents(str(p, 'valorInformadoProtocolo'))
    protoTotals.processedCents += toCents(str(p, 'valorProcessadoProtocolo'))
    protoTotals.releasedCents += toCents(str(p, 'valorLiberadoProtocolo'))
    protoTotals.glossCents += toCents(str(p, 'valorGlosaProtocolo'))

    for (const g of list(p, 'relacaoGuias')) {
      const providerGuideNumber = str(g, 'numeroGuiaPrestador')
      if (!providerGuideNumber) {
        divergences.push(`Guia sem número do prestador no lote ${lotNumber ?? '?'} — ignorada.`)
        continue
      }
      const detalhes = list(g, 'detalhesGuia')
      let guideGloss = 0

      detalhes.forEach((d, idx) => {
        const proc = child(d, 'procedimento')
        const realizationDate = isoDate(str(d, 'dataRealizacao'))
        const procedureCode = str(proc, 'codigoProcedimento')
        if (!realizationDate || !procedureCode) {
          divergences.push(`Guia ${providerGuideNumber}: sessão ${idx + 1} sem data ou procedimento — ignorada.`)
          return
        }
        const informedCents = toCents(str(d, 'valorInformado'))
        const processedCents = toCents(str(d, 'valorProcessado'))
        const releasedCents = toCents(str(d, 'valorLiberado'))
        const glossCents = informedCents - releasedCents
        guideGloss += glossCents

        // Glosas: detecta a escala comparando com informado − liberado
        const rawGlosses = list(d, 'relacaoGlosa').map((x) => ({
          code: str(x, 'tipoGlosa') ?? 'SEM_CODIGO',
          raw: toCents(str(x, 'valorGlosa')),
        }))
        let glosses: ParsedGloss[] = []
        if (rawGlosses.length) {
          const rawSum = rawGlosses.reduce((s, x) => s + x.raw, 0)
          const scale = pickScale(rawSum, glossCents)
          if (scale === null) {
            divergences.push(
              `Guia ${providerGuideNumber} em ${realizationDate}: valor da glosa (${rawGlosses.map((x) => x.raw).join('+')}) ` +
                `não bate com informado − liberado (${brl(glossCents)}). Usado informado − liberado.`
            )
            glosses = rawGlosses.map((x, i) => ({ code: x.code, valueCents: i === 0 ? glossCents : 0 }))
          } else {
            glosses = rawGlosses.map((x) => ({ code: x.code, valueCents: Math.round(x.raw / scale) }))
          }
        } else if (glossCents !== 0) {
          divergences.push(
            `Guia ${providerGuideNumber} em ${realizationDate}: ${brl(glossCents)} a menos sem código de glosa.`
          )
        }

        const baseKey = [operatorAnsCode, providerGuideNumber, realizationDate, `${str(proc, 'codigoTabela') ?? ''}:${procedureCode}`].join('|')
        const occurrence = (occurrences.get(baseKey) ?? 0) + 1
        occurrences.set(baseKey, occurrence)
        const itemKey = `${baseKey}|${occurrence}`
        const contentHash = sha256(
          [informedCents, processedCents, releasedCents, glosses.map((x) => `${x.code}:${x.valueCents}`).sort().join(',')].join('|')
        )

        items.push({
          lotNumber,
          protocolNumber,
          protocolSituation,
          providerGuideNumber,
          operatorGuideNumber: str(g, 'numeroGuiaOperadora'),
          authPassword: str(g, 'senha'),
          beneficiaryName: str(g, 'nomeBeneficiario'),
          cardNumber: str(g, 'numeroCarteira'),
          billingStartDate: isoDate(str(g, 'dataInicioFat')),
          billingStartTime: str(g, 'horaInicioFat'),
          billingEndDate: isoDate(str(g, 'dataFimFat')),
          billingEndTime: str(g, 'horaFimFat'),
          guideSituation: str(g, 'situacaoGuia'),
          guideItemSequence: idx + 1,
          realizationDate,
          procedureTable: str(proc, 'codigoTabela'),
          procedureCode,
          procedureDescription: str(proc, 'descricaoProcedimento'),
          participationDegree: str(d, 'grauParticipacao'),
          quantity: str(d, 'qtdExecutada') === null ? null : Number(str(d, 'qtdExecutada')),
          informedCents,
          processedCents,
          releasedCents,
          glossCents,
          glosses,
          occurrence,
          itemKey,
          contentHash,
        })
      })

      const declaredGuideGloss = str(g, 'valorGlosaGuia')
      if (declaredGuideGloss !== null && toCents(declaredGuideGloss) !== guideGloss) {
        divergences.push(
          `Guia ${providerGuideNumber}: glosa declarada ${brl(toCents(declaredGuideGloss))} ≠ soma das sessões ${brl(guideGloss)}.`
        )
      }
    }
  }

  if (items.length === 0) throw new TissParseError('Nenhuma sessão encontrada no demonstrativo.')

  const itemTotals: Totals = items.reduce(
    (t, i) => ({
      informedCents: t.informedCents + i.informedCents,
      processedCents: t.processedCents + i.processedCents,
      releasedCents: t.releasedCents + i.releasedCents,
      glossCents: t.glossCents + i.glossCents,
    }),
    { informedCents: 0, processedCents: 0, releasedCents: 0, glossCents: 0 }
  )

  // Protocolos x sessões (ambos em reais — devem bater exatamente)
  for (const k of ['informedCents', 'releasedCents', 'glossCents'] as const) {
    if (protocolos.length && protoTotals[k] !== itemTotals[k]) {
      divergences.push(`Soma dos lotes (${brl(protoTotals[k])}) ≠ soma das sessões (${brl(itemTotals[k])}) em ${LABEL[k]}.`)
    }
  }

  // Total geral do cabeçalho: detecta escala pelo valor liberado
  let declaredTotals: Totals | null = null
  const rawDeclared = {
    informedCents: str(demo, 'valorInformadoGeral'),
    processedCents: str(demo, 'valorProcessadoGeral'),
    releasedCents: str(demo, 'valorLiberadoGeral'),
    glossCents: str(demo, 'valorGlosaGeral'),
  }
  if (rawDeclared.releasedCents !== null) {
    const scale = pickScale(toCents(rawDeclared.releasedCents), itemTotals.releasedCents) ??
      pickScale(toCents(rawDeclared.informedCents), itemTotals.informedCents) ?? 100
    declaredTotals = {
      informedCents: Math.round(toCents(rawDeclared.informedCents) / scale),
      processedCents: Math.round(toCents(rawDeclared.processedCents) / scale),
      releasedCents: Math.round(toCents(rawDeclared.releasedCents) / scale),
      glossCents: Math.round(toCents(rawDeclared.glossCents) / scale),
    }
    for (const k of ['informedCents', 'releasedCents', 'glossCents'] as const) {
      const diff = declaredTotals[k] - itemTotals[k]
      if (diff !== 0) {
        divergences.push(
          `Total geral de ${LABEL[k]} do demonstrativo (${brl(declaredTotals[k])}) difere da soma das sessões ` +
            `(${brl(itemTotals[k])}) em ${brl(diff)} — valor sem detalhamento por sessão.`
        )
      }
    }
  }

  return {
    fileName,
    fileSha256,
    tissVersion,
    transactionType,
    operatorAnsCode,
    operatorName: str(cd, 'nomeOperadora'),
    operatorCnpj: str(cd, 'numeroCNPJ'),
    providerCode,
    contractedCnpj: str(contratado, 'cnpjContratado'),
    contractedName: str(contratado, 'nomeContratado'),
    statementNumber,
    emissionDate,
    declaredTotals,
    itemTotals,
    items,
    divergences,
  }
}

const LABEL = {
  informedCents: 'valor informado',
  processedCents: 'valor processado',
  releasedCents: 'valor liberado',
  glossCents: 'glosa',
} as const
