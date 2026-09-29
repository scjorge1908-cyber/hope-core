import { zipSync, strToU8 } from 'fflate'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { textoSeguro } from '../financeiro/pdf-nao-lancadas'
import type { ExtratoCora } from './cliente'

// ================================================================
// Download do extrato do Cora: Excel (.xlsx de verdade, valores como
// número) e PDF (A4). Valores do Cora vêm em centavos.
// ================================================================

export type LinhaExtrato = {
  data: string // YYYY-MM-DD
  hora: string // HH:MM
  tipo: 'Entrada' | 'Saída'
  operacao: string
  descricao: string
  contraparte: string
  documento: string
  valor: number // em reais, negativo nas saídas
}

export type MetaExtrato = {
  empresa: string
  documentoEmpresa: string
  inicio: string
  fim: string
  saldoInicial: number | null // reais
  saldoFinal: number | null // reais
  geradoEm: string
  ambiente: string
}

const OPERACAO: Record<string, string> = {
  PIX: 'Pix',
  TRANSFER: 'Transferência',
  PAYMENT: 'Pagamento',
  FEE: 'Tarifa',
  BANK_SLIP: 'Boleto',
  INVOICE: 'Boleto',
}

export function linhasDoExtrato(ex: ExtratoCora): LinhaExtrato[] {
  return (ex.entries ?? [])
    .map((e) => {
      const credito = String(e.type).toUpperCase() === 'CREDIT'
      const iso = String(e.createdAt ?? '')
      const tipoOp = String(e.transaction?.type ?? '')
      return {
        data: iso.slice(0, 10),
        hora: iso.slice(11, 16),
        tipo: credito ? ('Entrada' as const) : ('Saída' as const),
        operacao: OPERACAO[tipoOp.toUpperCase()] ?? tipoOp,
        descricao: String(e.transaction?.description ?? ''),
        contraparte: String(e.transaction?.counterParty?.name ?? ''),
        documento: formatarDoc(String(e.transaction?.counterParty?.identity ?? '')),
        valor: (credito ? 1 : -1) * Math.abs(Number(e.amount ?? 0)) / 100,
      }
    })
    .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora))
}

/** 14 dígitos → 00.000.000/0000-00; 11 → 000.000.000-00 */
export const formatarDoc = (d: string) => {
  const n = String(d ?? '').replace(/\D/g, '')
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return String(d ?? '')
}
const br = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// ---------------------------------------------------------------- Excel

const xmlEsc = (t: string) =>
  t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

function col(n: number) {
  let s = ''
  for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

type Celula = string | number | null | { v: number; estilo: number } | { t: string; estilo: number }

function linhaXml(r: number, celulas: Celula[]) {
  const cs = celulas
    .map((c, i) => {
      const ref = `${col(i)}${r}`
      if (c == null || c === '') return ''
      if (typeof c === 'number') return `<c r="${ref}" s="2"><v>${c}</v></c>`
      if (typeof c === 'string') return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c)}</t></is></c>`
      if ('v' in c) return `<c r="${ref}" s="${c.estilo}"><v>${c.v}</v></c>`
      return `<c r="${ref}" s="${c.estilo}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c.t)}</t></is></c>`
    })
    .join('')
  return `<row r="${r}">${cs}</row>`
}

/** Serial de data do Excel (dias desde 1899-12-30). */
function serial(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000
}

export function gerarXlsxExtrato(linhas: LinhaExtrato[], meta: MetaExtrato): Uint8Array {
  const rows: string[] = []
  let r = 1
  rows.push(linhaXml(r++, [{ t: `Extrato Cora — ${meta.empresa || 'Clínica Hope'}`, estilo: 1 }]))
  rows.push(linhaXml(r++, [`Período: ${br(meta.inicio)} a ${br(meta.fim)}`, '', '', `Gerado em ${meta.geradoEm}`]))
  if (meta.saldoInicial != null) rows.push(linhaXml(r++, ['Saldo inicial', '', '', '', '', '', '', { v: meta.saldoInicial, estilo: 2 }]))
  r++
  const cab = r
  rows.push(
    linhaXml(r++, ['Data', 'Hora', 'Tipo', 'Operação', 'Descrição', 'Contraparte', 'CPF/CNPJ', 'Valor (R$)'].map((t) => ({ t, estilo: 1 })))
  )
  const primeira = r
  for (const l of linhas) {
    rows.push(
      linhaXml(r++, [
        l.data ? { v: serial(l.data), estilo: 3 } : '',
        l.hora,
        l.tipo,
        l.operacao,
        l.descricao,
        l.contraparte,
        l.documento,
        { v: Math.round(l.valor * 100) / 100, estilo: 2 },
      ])
    )
  }
  const ultima = r - 1
  r++
  const entradas = linhas.filter((l) => l.valor > 0).reduce((t, l) => t + l.valor, 0)
  const saidas = linhas.filter((l) => l.valor < 0).reduce((t, l) => t + l.valor, 0)
  rows.push(linhaXml(r++, ['', '', '', '', '', '', { t: 'Total de entradas', estilo: 1 }, { v: Math.round(entradas * 100) / 100, estilo: 2 }]))
  rows.push(linhaXml(r++, ['', '', '', '', '', '', { t: 'Total de saídas', estilo: 1 }, { v: Math.round(saidas * 100) / 100, estilo: 2 }]))
  if (meta.saldoFinal != null) rows.push(linhaXml(r++, ['', '', '', '', '', '', { t: 'Saldo final', estilo: 1 }, { v: meta.saldoFinal, estilo: 2 }]))

  const larguras = [11, 7, 9, 14, 48, 36, 18, 14]
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${cab}" topLeftCell="A${cab + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    (ultima >= primeira ? `<autoFilter ref="A${cab}:H${ultima}"/>` : '') +
    `</worksheet>`

  const estilos =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]-#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

  const arquivos: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="Extrato" sheetId="1" r:id="rId1"/></sheets>` +
        (ultima >= primeira ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Extrato!$A$${cab}:$H$${ultima}</definedName></definedNames>` : '') +
        `</workbook>`
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    ),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    'xl/styles.xml': strToU8(estilos),
  }
  return zipSync(arquivos, { level: 6 })
}

// ---------------------------------------------------------------- PDF

const A4 = { w: 595.28, h: 841.89 }
const M = 36
const COR = {
  texto: rgb(0.07, 0.09, 0.15),
  suave: rgb(0.42, 0.45, 0.5),
  linha: rgb(0.9, 0.91, 0.92),
  cab: rgb(0.97, 0.98, 0.98),
  marca: rgb(0.11, 0.25, 0.55),
  bom: rgb(0.02, 0.47, 0.34),
  ruim: rgb(0.73, 0.11, 0.11),
}

function cortar(t: string, f: PDFFont, tam: number, larg: number) {
  let s = textoSeguro(t)
  if (f.widthOfTextAtSize(s, tam) <= larg) return s
  while (s.length > 1 && f.widthOfTextAtSize(`${s}…`, tam) > larg) s = s.slice(0, -1)
  return `${s}…`
}

export async function gerarPdfExtrato(linhas: LinhaExtrato[], meta: MetaExtrato): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(textoSeguro(`Extrato Cora ${br(meta.inicio)} a ${br(meta.fim)}`))
  doc.setAuthor('Clínica Hope — HOPE CORE')
  const f = await doc.embedFont(StandardFonts.Helvetica)
  const fb = await doc.embedFont(StandardFonts.HelveticaBold)
  const COLS = [
    { t: 'Data', w: 58 },
    { t: 'Operação', w: 70 },
    { t: 'Descrição / contraparte', w: 300 },
    { t: 'Valor', w: 95, dir: true },
  ]
  let pag!: PDFPage
  let y = 0
  const txt = (t: string, x: number, yy: number, tam = 8.5, fonte = f, cor = COR.texto) =>
    pag.drawText(textoSeguro(t), { x, y: yy, size: tam, font: fonte, color: cor })
  const dir = (t: string, xFim: number, yy: number, tam = 8.5, fonte = f, cor = COR.texto) =>
    txt(t, xFim - fonte.widthOfTextAtSize(textoSeguro(t), tam), yy, tam, fonte, cor)

  const cabecalho = () => {
    pag.drawRectangle({ x: M, y: y - 15, width: A4.w - 2 * M, height: 17, color: COR.cab })
    let x = M + 4
    for (const c of COLS) {
      if (c.dir) dir(c.t.toUpperCase(), x + c.w - 6, y - 10, 7, fb, COR.suave)
      else txt(c.t.toUpperCase(), x, y - 10, 7, fb, COR.suave)
      x += c.w
    }
    y -= 19
  }
  const nova = (primeira: boolean) => {
    pag = doc.addPage([A4.w, A4.h])
    y = A4.h - M
    pag.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: COR.marca })
    txt('CLÍNICA HOPE', M, y - 4, 9, fb, COR.marca)
    dir('Extrato bancário — Cora', A4.w - M, y - 4, 9, f, COR.suave)
    y -= 22
    if (primeira) {
      txt('EXTRATO BANCÁRIO', M, y - 6, 16, fb)
      y -= 26
      txt(`${meta.empresa || 'Hope Clínica Multidisciplinar'}${meta.documentoEmpresa ? ` · CNPJ ${formatarDoc(meta.documentoEmpresa)}` : ''}`, M, y, 10, fb)
      y -= 15
      txt(`Período: ${br(meta.inicio)} a ${br(meta.fim)}   ·   Gerado em ${meta.geradoEm}${meta.ambiente === 'stage' ? '   ·   AMBIENTE DE TESTE' : ''}`, M, y, 9, f, COR.suave)
      y -= 18
      const ent = linhas.filter((l) => l.valor > 0).reduce((t, l) => t + l.valor, 0)
      const sai = linhas.filter((l) => l.valor < 0).reduce((t, l) => t + l.valor, 0)
      const caixas: [string, string, typeof COR.texto][] = [
        ['Saldo inicial', meta.saldoInicial == null ? '—' : brl(meta.saldoInicial), COR.texto],
        ['Entradas', brl(ent), COR.bom],
        ['Saídas', brl(sai), COR.ruim],
        ['Saldo final', meta.saldoFinal == null ? '—' : brl(meta.saldoFinal), COR.texto],
      ]
      const cw = (A4.w - 2 * M - 3 * 8) / 4
      caixas.forEach(([r, v, cor], i) => {
        const x = M + i * (cw + 8)
        pag.drawRectangle({ x, y: y - 40, width: cw, height: 44, borderColor: COR.linha, borderWidth: 1 })
        txt(r.toUpperCase(), x + 8, y - 10, 7, fb, COR.suave)
        txt(v, x + 8, y - 30, 12, fb, cor)
      })
      y -= 56
    }
    cabecalho()
  }

  nova(true)
  if (!linhas.length) txt('Nenhum lançamento no período.', M, y - 10, 10, f, COR.suave)
  for (const l of linhas) {
    const alt = l.contraparte && l.descricao ? 24 : 15
    if (y - alt < M + 20) nova(false)
    let x = M + 4
    txt(`${br(l.data)}`, x, y - 10)
    x += COLS[0].w
    txt(cortar(l.operacao, f, 8.5, COLS[1].w - 6), x, y - 10, 8.5, f, COR.suave)
    x += COLS[1].w
    const principal = l.contraparte || l.descricao || '—'
    txt(cortar(principal, fb, 8.5, COLS[2].w - 8), x, y - 10, 8.5, fb)
    if (l.contraparte && l.descricao) txt(cortar(l.descricao, f, 7.5, COLS[2].w - 8), x, y - 20, 7.5, f, COR.suave)
    x += COLS[2].w
    dir(`${l.valor > 0 ? '+' : '−'} ${brl(Math.abs(l.valor))}`.replace('−', '-'), x + COLS[3].w - 6, y - 10, 8.5, fb, l.valor > 0 ? COR.bom : COR.ruim)
    y -= alt
    pag.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.4, color: COR.linha })
  }

  const paginas = doc.getPages()
  paginas.forEach((pg, i) => {
    const t = `Página ${i + 1} de ${paginas.length}`
    pg.drawText(t, { x: A4.w - M - f.widthOfTextAtSize(t, 8), y: 20, size: 8, font: f, color: COR.suave })
    pg.drawText('HOPE CORE · extrato obtido da API do Cora', { x: M, y: 20, size: 8, font: f, color: COR.suave })
  })
  return doc.save()
}
