// ================================================================
// Leitor mínimo de .xlsx (primeira aba) — sem dependência pesada.
// Um .xlsx é um ZIP com XMLs: descompacta (fflate) e lê as células
// (fast-xml-parser). Devolve as linhas como arrays de valores crus:
// texto (string), número (number) ou vazio (null). Datas do Excel
// chegam como número de série; use serialParaData() para converter.
// ================================================================
import { unzipSync, strFromU8 } from 'fflate'
import { XMLParser } from 'fast-xml-parser'

export type CelulaXlsx = string | number | boolean | null

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
  isArray: (nome) => ['si', 'r', 'row', 'c', 'sheet', 'Relationship'].includes(nome),
})

function lerXml(arquivos: Record<string, Uint8Array>, caminho: string) {
  const chave = caminho.replace(/^\/+/, '')
  const bytes = arquivos[chave]
  if (!bytes) return null
  return parser.parse(strFromU8(bytes).replace(/^﻿/, ''))
}

function textoRico(no: unknown): string {
  if (no == null) return ''
  if (typeof no === 'string' || typeof no === 'number') return String(no)
  const o = no as Record<string, unknown>
  if (o.t !== undefined) {
    const t = o.t as unknown
    return typeof t === 'object' && t !== null ? String((t as Record<string, unknown>)['#text'] ?? '') : String(t)
  }
  if (Array.isArray(o.r)) return (o.r as unknown[]).map((r) => textoRico(r)).join('')
  if (o['#text'] !== undefined) return String(o['#text'])
  return ''
}

function colunaIndice(ref: string): number {
  const letras = ref.replace(/\d+/g, '').toUpperCase()
  let n = 0
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Lê a primeira aba do .xlsx e devolve { nomeAba, linhas }. */
export function lerPrimeiraAba(bytes: Uint8Array): { nomeAba: string; linhas: CelulaXlsx[][] } {
  let arquivos: Record<string, Uint8Array>
  try {
    arquivos = unzipSync(bytes)
  } catch {
    throw new Error('Arquivo não é um .xlsx válido.')
  }

  const wb = lerXml(arquivos, 'xl/workbook.xml')
  const primeira = wb?.workbook?.sheets?.sheet?.[0]
  if (!primeira) throw new Error('Planilha sem abas.')
  const rid = primeira['@id'] ?? primeira['@r:id']
  const rels = lerXml(arquivos, 'xl/_rels/workbook.xml.rels')
  const rel = (rels?.Relationships?.Relationship ?? []).find((r: Record<string, string>) => r['@Id'] === rid)
  let alvo: string = rel?.['@Target'] ?? 'worksheets/sheet1.xml'
  alvo = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, '')}`

  const sst = lerXml(arquivos, 'xl/sharedStrings.xml')
  const compartilhadas: string[] = (sst?.sst?.si ?? []).map((si: unknown) => textoRico(si))

  const aba = lerXml(arquivos, alvo)
  const rows = aba?.worksheet?.sheetData?.row ?? []
  const linhas: CelulaXlsx[][] = []
  for (const row of rows) {
    const numLinha = Number(row['@r'] ?? linhas.length + 1)
    const linha: CelulaXlsx[] = []
    for (const c of row.c ?? []) {
      const idx = c['@r'] ? colunaIndice(c['@r']) : linha.length
      const tipo = c['@t']
      const v = c.v
      let valor: CelulaXlsx = null
      if (tipo === 's') valor = compartilhadas[Number(v)] ?? ''
      else if (tipo === 'inlineStr') valor = textoRico(c.is)
      else if (tipo === 'str') valor = v == null ? '' : String(v)
      else if (tipo === 'b') valor = String(v) === '1'
      else if (v !== undefined && v !== '') valor = Number(v)
      linha[idx] = valor
    }
    for (let i = 0; i < linha.length; i++) if (linha[i] === undefined) linha[i] = null
    linhas[numLinha - 1] = linha
  }
  for (let i = 0; i < linhas.length; i++) if (!linhas[i]) linhas[i] = []
  return { nomeAba: String(primeira['@name'] ?? ''), linhas }
}

/** Número de série do Excel (sistema 1900) → { data: 'YYYY-MM-DD', hora: 'HH:mm:ss' } sem fuso. */
export function serialParaData(serial: number): { data: string; hora: string } {
  const ms = Math.round((serial - 25569) * 86400 * 1000) // 25569 = dias de 1899-12-30 a 1970-01-01
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    data: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    hora: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`,
  }
}
