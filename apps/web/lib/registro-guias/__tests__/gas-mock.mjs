/* eslint-disable */
// Simula o ambiente Apps Script para rodar o Code.gs ORIGINAL + PonteRegistroGuias.gs em Node.
import { readFileSync } from 'node:fs'

const RAIZ = new URL('../../../../../', import.meta.url).pathname.replace(/\/$/, '')

function pad(n, w = 2) { return String(n).padStart(w, '0') }
function formatDate(d, _tz, fmt) {
  // fuso fixo -03:00
  const t = new Date(d.getTime() - 3 * 3600 * 1000)
  const map = {
    yyyy: t.getUTCFullYear(), MM: pad(t.getUTCMonth() + 1), dd: pad(t.getUTCDate()),
    HH: pad(t.getUTCHours()), mm: pad(t.getUTCMinutes()), ss: pad(t.getUTCSeconds()),
  }
  return fmt.replace(/'T'/g, 'T').replace(/yyyy|MM|dd|HH|mm|ss/g, (k) => map[k])
}

export class Aba {
  constructor(nome, linhas) { this.nome = nome; this.linhas = linhas.map((l) => l.slice()) }
  getName() { return this.nome }
  getLastRow() { return this.linhas.length }
  getLastColumn() { return Math.max(0, ...this.linhas.map((l) => l.length)) }
  _cel(r, c) { const l = this.linhas[r - 1]; return l && l[c - 1] !== undefined ? l[c - 1] : '' }
  _set(r, c, v) { while (this.linhas.length < r) this.linhas.push([]); const l = this.linhas[r - 1]; while (l.length < c) l.push(''); l[c - 1] = v }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())) }
  getRange(r, c, nr = 1, nc = 1) {
    const aba = this
    return {
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const l = []; for (let j = 0; j < nc; j++) l.push(aba._cel(r + i, c + j)); out.push(l) } return out },
      getDisplayValues() { return this.getValues().map((l) => l.map((v) => (v instanceof Date ? formatDate(v, '', 'dd/MM/yyyy') : String(v)))) },
      getValue() { return aba._cel(r, c) },
      setValue(v) { aba._set(r, c, v); return this },
      setValues(vs) { vs.forEach((l, i) => l.forEach((v, j) => aba._set(r + i, c + j, v))); return this },
      setNumberFormat() { return this },
      getRichTextValues() { return this.getValues().map((l) => l.map((v) => ({ getLinkUrl: () => (String(v).startsWith('http') ? String(v) : null) }))) },
      getMergedRanges() { return [] },
      getA1Notation() { return 'A1' },
    }
  }
  appendRow(l) { this.linhas.push(l.slice()) }
  freezeRows() {}
  getFrozenRows() { return 0 }
  clear() { this.linhas = [] }
}

export class Planilha {
  constructor(id, abas) { this.id = id; this.abas = abas }
  getSheetByName(n) { return this.abas[n] || null }
  insertSheet(n) { this.abas[n] = new Aba(n, []); return this.abas[n] }
  getSheets() { return Object.values(this.abas) }
  getId() { return this.id }
  getName() { return this.id }
}

export function carregarGAS({ ativa, externas, props }) {
  const code = readFileSync(`${RAIZ}/legado/registro-guias/Code.gs`, 'utf8')
  const ponte = readFileSync(`${RAIZ}/sync/apps-script/PonteRegistroGuias.gs`, 'utf8')
  const globais = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ativa,
      openById: (id) => { if (!externas[id]) throw new Error('Planilha não encontrada: ' + id); return externas[id] },
      getUi: () => ({ createMenu: () => ({ addItem() { return this }, addToUi() {} }) }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getScriptTimeZone: () => 'America/Sao_Paulo' },
    Utilities: {
      formatDate,
      newBlob: (h) => ({ getAs: () => ({ getBytes: () => Buffer.from('%PDF-fake ' + h.length) }) }),
      base64Encode: (b) => Buffer.from(b).toString('base64'),
    },
    MimeType: { HTML: 'text/html', PDF: 'application/pdf' },
    HtmlService: {},
    DriveApp: { getFileById: () => ({ getMimeType: () => 'image/jpeg' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (t) => ({ texto: t, setMimeType() { return this }, getContent() { return t } }),
    },
    UrlFetchApp: { fetch: () => { throw new Error('sem rede no teste') } },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({}) },
  }
  const nomes = Object.keys(globais)
  const fabrica = new Function(...nomes, `${code}\n${ponte}\nreturn { doPost, hopeMapaPsicologas };`)
  return fabrica(...nomes.map((n) => globais[n]))
}
