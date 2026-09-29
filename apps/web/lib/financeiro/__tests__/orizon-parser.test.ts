import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { parseOrizonXlsx } from '../orizon-parser'

// .xlsx sintético no MESMO formato do relatório da Orizon (prefixo x:, alvo
// absoluto "/xl/...", textos compartilhados, datas como número de série)
function xlsxSintetico(): Uint8Array {
  const textos = [
    'CNPJ/CPF', 'Prestador', 'Numero Lote', 'Protocolo', 'Data de Envio', 'Operadora', 'Tipo de Guia',
    'Quantidade de Guias', 'Valor apresentado', 'Data de Liberação', 'Status', 'Origem',
    '47283631000129', 'CLINICA TESTE', '9000000001', 'BRADESCO SAÚDE', 'SADT', 'Exportado', 'Plataforma Web', '9000000002',
  ]
  const sst = `<?xml version="1.0" encoding="utf-8"?><x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${textos
    .map((t) => `<x:si><x:t>${t}</x:t></x:si>`)
    .join('')}</x:sst>`
  const s = (ref: string, i: number) => `<x:c r="${ref}" t="s"><x:v>${i}</x:v></x:c>`
  const n = (ref: string, v: number) => `<x:c r="${ref}"><x:v>${v}</x:v></x:c>`
  const cab = `<x:row r="1">${textos.slice(0, 12).map((_, i) => s(String.fromCharCode(65 + i) + '1', i)).join('')}</x:row>`
  const linha = (r: number, lote: number, envio: number, lib: number) =>
    `<x:row r="${r}">${s(`A${r}`, 12)}${s(`B${r}`, 13)}${s(`C${r}`, lote)}${n(`D${r}`, 230135794 + r)}${n(`E${r}`, envio)}${s(`F${r}`, 15)}${s(`G${r}`, 16)}${n(`H${r}`, 1)}${n(`I${r}`, 46.83)}${n(`J${r}`, lib)}${s(`K${r}`, 17)}${s(`L${r}`, 18)}</x:row>`
  const sheet = `﻿<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${cab}${linha(2, 14, 46241, 46241.4367307523)}${linha(3, 19, 46248, 46248.5)}</x:sheetData></x:worksheet>`
  const wb = `<?xml version="1.0"?><x:workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="Lotes Exportados e Liberados" sheetId="1" r:id="rId2" /></x:sheets></x:workbook>`
  const rels = `﻿<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/xl/sharedStrings.xml" Id="rId3" /><Relationship Target="/xl/worksheets/sheet1.xml" Id="rId2" /></Relationships>`
  return zipSync({
    'xl/workbook.xml': strToU8(wb),
    'xl/_rels/workbook.xml.rels': strToU8(rels),
    'xl/sharedStrings.xml': strToU8(sst),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  })
}

describe('parseOrizonXlsx', () => {
  it('lê lotes, datas (série do Excel) e valores no formato da Orizon', () => {
    const r = parseOrizonXlsx(xlsxSintetico())
    expect(r.linhas).toHaveLength(2)
    expect(r.linhas[0]).toEqual({
      lote: '9000000001', protocolo: '230135796', envio: '2026-08-07', liberacao: '2026-08-07T10:28:53',
      operadora: 'BRADESCO SAÚDE', tipoGuia: 'SADT', qtdGuias: 1, valor: 46.83, status: 'Exportado', cnpj: '47283631000129',
    })
    expect(r.linhas[1].envio).toBe('2026-08-14')
    expect(r.total).toBe(93.66)
    expect(r.avisos).toEqual([])
  })

  it('recusa arquivo que não é xlsx', () => {
    expect(() => parseOrizonXlsx(new Uint8Array([1, 2, 3]))).toThrow(/xlsx/)
  })
})

// Arquivo REAL (fora do repositório): HOPE_ORIZON_XLSX=/caminho/arquivo.xlsx npx vitest run
const real = process.env.HOPE_ORIZON_XLSX
describe.skipIf(!real)('arquivo real da Orizon', () => {
  it('confere com a leitura independente (openpyxl): 67 lotes, R$ 3.137,61', () => {
    const r = parseOrizonXlsx(new Uint8Array(readFileSync(real!)))
    expect(r.linhas).toHaveLength(67)
    expect(r.total).toBe(3137.61)
    expect(new Set(r.linhas.map((l) => l.envio))).toEqual(new Set(['2026-08-07', '2026-08-14', '2026-08-18', '2026-08-27']))
    expect(r.linhas[0]).toMatchObject({ lote: '1828225952', protocolo: '230135794', envio: '2026-08-07', liberacao: '2026-08-07T10:28:53', valor: 46.83 })
  })
})
