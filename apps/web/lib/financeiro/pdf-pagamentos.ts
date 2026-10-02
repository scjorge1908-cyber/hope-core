import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { textoSeguro } from './pdf-nao-lancadas'

// ================================================================
// PDF "Controle de pagamento do repasse" — mesma tabela da tela
// (pagos × não pagos), A4 paisagem, Helvetica. Ordem = fila da tela:
// primeiro quem falta pagar, por último os pagos.
// ================================================================

export type LinhaPdfPagamento = {
  nome: string
  tipo: 'PF' | 'CNPJ'
  chavePix: string
  aPagar: number
  pago: boolean
  dataPagamento: string | null
  forma: string
  valorPago: number | null
  confirmadoExtrato: boolean
}

export type OpcoesPdfPagamento = {
  /** "SETEMBRO/2026" */
  competencia: string
  geradoEm: string
}

const PAG = { w: 841.89, h: 595.28 } // A4 paisagem
const M = 36
const COR = {
  texto: rgb(0.07, 0.09, 0.15),
  suave: rgb(0.42, 0.45, 0.5),
  linha: rgb(0.88, 0.89, 0.91),
  cab: rgb(0.96, 0.97, 0.98),
  marca: rgb(0.11, 0.25, 0.55),
  ruim: rgb(0.73, 0.11, 0.11),
  bom: rgb(0.02, 0.47, 0.34),
}

type Col = { titulo: string; larg: number; dir?: boolean }
const COLS: Col[] = [
  { titulo: 'Profissional', larg: 196 },
  { titulo: 'Tipo', larg: 36 },
  { titulo: 'Chave Pix', larg: 150 },
  { titulo: 'A pagar', larg: 74, dir: true },
  { titulo: 'Situação', larg: 92 },
  { titulo: 'Data', larg: 60 },
  { titulo: 'Forma', larg: 92 },
  { titulo: 'Valor pago', larg: 70, dir: true },
]

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** Corta o texto para caber na largura (com reticências). */
function caber(t: string, f: PDFFont, tam: number, larg: number): string {
  let s = textoSeguro(t)
  if (f.widthOfTextAtSize(s, tam) <= larg) return s
  while (s.length > 1 && f.widthOfTextAtSize(`${s}…`, tam) > larg) s = s.slice(0, -1)
  return `${s}…`
}

export async function gerarPdfPagamentos(linhas: LinhaPdfPagamento[], o: OpcoesPdfPagamento): Promise<Uint8Array> {
  const TITULO = `Controle de pagamento do repasse - ${o.competencia}`
  const doc = await PDFDocument.create()
  doc.setTitle(textoSeguro(TITULO))
  doc.setAuthor('Clínica Hope — HOPE CORE')
  doc.setCreator('HOPE CORE')
  const f = await doc.embedFont(StandardFonts.Helvetica)
  const fb = await doc.embedFont(StandardFonts.HelveticaBold)

  let pag!: PDFPage
  let y = 0
  const paginas: PDFPage[] = []
  const txt = (t: string, x: number, yy: number, tam = 9, fonte = f, cor = COR.texto) =>
    pag.drawText(textoSeguro(t), { x, y: yy, size: tam, font: fonte, color: cor })

  const cabecalhoTabela = () => {
    pag.drawRectangle({ x: M, y: y - 16, width: PAG.w - 2 * M, height: 18, color: COR.cab })
    let x = M
    for (const c of COLS) {
      const t = c.titulo.toUpperCase()
      const w = fb.widthOfTextAtSize(textoSeguro(t), 7)
      txt(t, c.dir ? x + c.larg - 6 - w : x + 4, y - 10, 7, fb, COR.suave)
      x += c.larg
    }
    y -= 20
  }

  const novaPagina = (continuacao: boolean) => {
    pag = doc.addPage([PAG.w, PAG.h])
    paginas.push(pag)
    y = PAG.h - M
    pag.drawRectangle({ x: 0, y: PAG.h - 6, width: PAG.w, height: 6, color: COR.marca })
    txt('CLÍNICA HOPE', M, y - 4, 9, fb, COR.marca)
    const g = `Emitido em ${o.geradoEm}`
    txt(g, PAG.w - M - f.widthOfTextAtSize(textoSeguro(g), 8), y - 4, 8, f, COR.suave)
    y -= 24
    txt(continuacao ? `${TITULO} (continuação)` : TITULO, M, y, continuacao ? 11 : 14, fb)
    y -= continuacao ? 16 : 14
    if (!continuacao) {
      txt('Valor a pagar = relatório "Apenas Valor a Pagar (Líquido)" do RPA. Situação conforme o registro de pagamentos do HOPE CORE.', M, y, 8, f, COR.suave)
      y -= 16
    }
    cabecalhoTabela()
  }

  novaPagina(false)

  for (const l of linhas) {
    if (y - 18 < M + 70) novaPagina(true)
    const situacao = l.pago ? (l.confirmadoExtrato ? 'PAGO (extrato ok)' : 'PAGO') : 'NÃO PAGO'
    const diverge = l.pago && l.valorPago !== null && Math.abs(l.valorPago - l.aPagar) > 0.01
    const celulas: { t: string; fonte?: PDFFont; cor?: ReturnType<typeof rgb> }[] = [
      { t: l.nome, fonte: fb },
      { t: l.tipo },
      { t: l.chavePix || 'não informada', cor: l.chavePix ? COR.texto : COR.ruim },
      { t: brl(l.aPagar) },
      { t: situacao, fonte: fb, cor: l.pago ? COR.bom : COR.ruim },
      { t: l.dataPagamento ? dataBR(l.dataPagamento) : '—' },
      { t: l.pago ? l.forma : '—' },
      { t: l.pago && l.valorPago !== null ? `${brl(l.valorPago)}${diverge ? ' (!)' : ''}` : '—', cor: diverge ? COR.ruim : COR.texto },
    ]
    let x = M
    celulas.forEach((c, i) => {
      const col = COLS[i]
      const fonte = c.fonte ?? f
      const s = caber(c.t, fonte, 8.5, col.larg - 10)
      const w = fonte.widthOfTextAtSize(s, 8.5)
      pag.drawText(s, { x: col.dir ? x + col.larg - 6 - w : x + 4, y: y - 11, size: 8.5, font: fonte, color: c.cor ?? COR.texto })
      x += col.larg
    })
    pag.drawLine({ start: { x: M, y: y - 17 }, end: { x: PAG.w - M, y: y - 17 }, thickness: 0.5, color: COR.linha })
    y -= 18
  }

  if (!linhas.length) {
    txt('Nenhum repasse a pagar neste mês.', M + 4, y - 12, 9, f, COR.suave)
    y -= 20
  }

  // totais
  const total = linhas.reduce((t, l) => t + l.aPagar, 0)
  const pagos = linhas.filter((l) => l.pago)
  const pendentes = linhas.filter((l) => !l.pago)
  const totalPago = pagos.reduce((t, l) => t + (l.valorPago ?? 0), 0)
  const totalPendente = pendentes.reduce((t, l) => t + l.aPagar, 0)
  if (y - 60 < M) novaPagina(true)
  y -= 8
  pag.drawLine({ start: { x: M, y }, end: { x: PAG.w - M, y }, thickness: 1.2, color: COR.texto })
  y -= 16
  const totalLinha = (rotulo: string, valor: string, cor = COR.texto) => {
    txt(rotulo, M, y, 10, fb, cor)
    txt(valor, PAG.w - M - fb.widthOfTextAtSize(textoSeguro(valor), 10), y, 10, fb, cor)
    y -= 15
  }
  totalLinha('TOTAL A PAGAR:', brl(total))
  totalLinha(`PAGO (${pagos.length}):`, brl(totalPago), COR.bom)
  totalLinha(`FALTA PAGAR (${pendentes.length}):`, brl(totalPendente), totalPendente > 0 ? COR.ruim : COR.texto)
  if (pagos.some((l) => l.valorPago !== null && Math.abs(l.valorPago - l.aPagar) > 0.01)) {
    txt('(!) valor pago diferente do cálculo atual do RPA — a planilha mudou depois do pagamento.', M, y - 2, 8, f, COR.ruim)
  }

  paginas.forEach((p, i) => {
    const t = `Página ${i + 1} de ${paginas.length}`
    p.drawText(t, { x: PAG.w - M - f.widthOfTextAtSize(t, 8), y: M - 16, size: 8, font: f, color: COR.suave })
  })

  return doc.save()
}
