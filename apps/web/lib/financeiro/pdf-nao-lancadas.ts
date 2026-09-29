import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { PsicologaNaoLancada } from './conferencia'

// ================================================================
// PDF "Guias pendentes de lançamento" — um por psicóloga (ou todas,
// cada uma começando em página nova). A4 retrato, Helvetica.
// ================================================================

export type OpcoesPdf = {
  periodo: string
  geradoEm: string
  incluirSemGuia: boolean
  /** 'adm' (padrão da tela): guia no ADM sem sessão na planilha · 'planilha': sessão na planilha sem guia no ADM */
  modo?: 'adm' | 'planilha'
  /** cabeçalho do PDF: "Setembro de 2026" (sem isso usa `periodo`) */
  periodoExtenso?: string
}

const A4 = { w: 595.28, h: 841.89 }
const M = 40 // margem
const COR = {
  texto: rgb(0.07, 0.09, 0.15),
  suave: rgb(0.42, 0.45, 0.5),
  linha: rgb(0.9, 0.91, 0.92),
  cab: rgb(0.97, 0.98, 0.98),
  marca: rgb(0.11, 0.25, 0.55),
  alerta: rgb(0.71, 0.33, 0.04),
  ruim: rgb(0.73, 0.11, 0.11),
  bom: rgb(0.02, 0.47, 0.34),
}

// Helvetica padrão usa WinAnsi: mantém acentos do português; troca o resto
const TROCAS: Record<string, string> = { '→': '->', '↗': '', '≠': '<>', '−': '-', ' ': ' ' }
export function textoSeguro(t: string): string {
  return [...String(t ?? '')]
    .map((ch) => {
      if (TROCAS[ch] !== undefined) return TROCAS[ch]
      const c = ch.charCodeAt(0)
      if (c === 9 || c === 10) return ' '
      if (c < 32) return ''
      if (c <= 255) return ch
      return '–—‘’“”•…€'.includes(ch) ? ch : ''
    })
    .join('')
}

const dataBR = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function quebrar(t: string, f: PDFFont, tam: number, larg: number): string[] {
  const palavras = textoSeguro(t).split(/\s+/).filter(Boolean)
  const linhas: string[] = []
  let atual = ''
  for (const p of palavras) {
    const tenta = atual ? `${atual} ${p}` : p
    if (f.widthOfTextAtSize(tenta, tam) <= larg) atual = tenta
    else {
      if (atual) linhas.push(atual)
      // palavra maior que a coluna: corta
      let resto = p
      while (f.widthOfTextAtSize(resto, tam) > larg && resto.length > 1) {
        let n = resto.length
        while (n > 1 && f.widthOfTextAtSize(resto.slice(0, n), tam) > larg) n--
        linhas.push(resto.slice(0, n))
        resto = resto.slice(n)
      }
      atual = resto
    }
  }
  if (atual) linhas.push(atual)
  return linhas.length ? linhas : ['']
}

type Col = { titulo: string; larg: number; alinhar?: 'dir' }
const COLS_ADM: Col[] = [
  { titulo: 'Paciente', larg: 185 },
  { titulo: 'Guia', larg: 100 },
  { titulo: 'Plano', larg: 70 },
  { titulo: 'Mês / semana', larg: 160 },
]
const COLS_PLANILHA: Col[] = [
  { titulo: 'Paciente', larg: 140 },
  { titulo: 'Guia', larg: 82 },
  { titulo: 'Plano', larg: 52 },
  { titulo: 'Sessões (datas)', larg: 112 },
  { titulo: 'Qtd', larg: 26, alinhar: 'dir' },
  { titulo: 'Anexo', larg: 55 },
  { titulo: 'Coluna S', larg: 48 },
]

export async function gerarPdfNaoLancadas(grupos: PsicologaNaoLancada[], o: OpcoesPdf): Promise<Uint8Array> {
  const adm = o.modo !== 'planilha'
  const COLS = adm ? COLS_ADM : COLS_PLANILHA
  const TITULO = adm ? 'Relatório de guias não lançadas' : 'Guias pendentes de lançamento'
  const doc = await PDFDocument.create()
  doc.setTitle(textoSeguro(`${TITULO} — ${o.periodo}`))
  doc.setAuthor('Clínica Hope — HOPE CORE')
  doc.setCreator('HOPE CORE')
  const f = await doc.embedFont(StandardFonts.Helvetica)
  const fb = await doc.embedFont(StandardFonts.HelveticaBold)

  let pag!: PDFPage
  let y = 0
  let psiAtual = ''

  const txt = (t: string, x: number, yy: number, tam = 9, fonte = f, cor = COR.texto) =>
    pag.drawText(textoSeguro(t), { x, y: yy, size: tam, font: fonte, color: cor })

  const cabecalhoTabela = () => {
    pag.drawRectangle({ x: M, y: y - 16, width: A4.w - 2 * M, height: 18, color: COR.cab })
    let x = M + 4
    for (const c of COLS) {
      const w = fb.widthOfTextAtSize(textoSeguro(c.titulo.toUpperCase()), 7)
      txt(c.titulo.toUpperCase(), c.alinhar === 'dir' ? x + c.larg - 8 - w : x, y - 10, 7, fb, COR.suave)
      x += c.larg
    }
    y -= 20
  }

  const novaPagina = (continuacao: boolean) => {
    pag = doc.addPage([A4.w, A4.h])
    y = A4.h - M
    // faixa da marca
    pag.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: COR.marca })
    txt('CLÍNICA HOPE', M, y - 4, 9, fb, COR.marca)
    const t = TITULO
    txt(t, A4.w - M - f.widthOfTextAtSize(textoSeguro(t), 9), y - 4, 9, f, COR.suave)
    y -= 22
    if (continuacao) {
      txt(`${psiAtual} (continuação)`, M, y, 11, fb)
      y -= 14
      cabecalhoTabela()
    }
  }

  const garantir = (altura: number) => {
    if (y - altura < M + 24) {
      novaPagina(true)
    }
  }

  if (!grupos.length) {
    novaPagina(false)
    txt('Nenhuma guia pendente de lançamento no período.', M, y - 20, 12, fb)
    txt(`Período: ${o.periodo}`, M, y - 38, 10, f, COR.suave)
  }

  for (const g of grupos) {
    psiAtual = g.psicologa
    novaPagina(false)

    // modo ADM: cabeçalho enxuto — título, psicóloga, mês, total e a lista de guias
    if (adm) {
      txt('RELATÓRIO DE GUIAS NÃO LANÇADAS', M, y - 6, 16, fb)
      y -= 30
      txt('Psicóloga:', M, y, 11, fb, COR.suave)
      txt(g.psicologa, M + 62, y, 11, fb)
      y -= 17
      txt('Mês:', M, y, 11, fb, COR.suave)
      txt(o.periodoExtenso || o.periodo, M + 62, y, 11, fb)
      y -= 22
      const rot = 'TOTAL DE GUIAS NÃO LANÇADAS'
      pag.drawRectangle({ x: M, y: y - 34, width: A4.w - 2 * M, height: 40, color: rgb(1, 0.98, 0.92), borderColor: rgb(0.96, 0.84, 0.6), borderWidth: 1 })
      txt(rot, M + 12, y - 19, 10, fb, COR.alerta)
      const val = String(g.guias)
      txt(val, A4.w - M - 12 - fb.widthOfTextAtSize(val, 20), y - 23, 20, fb, COR.alerta)
      y -= 50
      if (!g.pacientes.length) {
        txt('Nenhuma guia não lançada neste período. Obrigado!', M, y - 6, 12, fb, COR.bom)
        continue
      }
      cabecalhoTabela()
      for (const p of g.pacientes) {
        p.guias.forEach((x, i) => {
          const celulas = [p.paciente, x.guia ?? '', x.plano, (x.refs ?? []).join(', ') || '—']
          const quebradas = celulas.map((c, k) => quebrar(c, k === 0 ? fb : f, 9, COLS[k].larg - 8))
          const alt = Math.max(...quebradas.map((q) => q.length)) * 11 + 9
          garantir(alt)
          if (i === 0) pag.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.8, color: rgb(0.82, 0.84, 0.86) })
          let xx = M + 4
          quebradas.forEach((linhas, k) => {
            linhas.forEach((l, j) => txt(l, xx, y - 12 - j * 11, 9, k === 0 ? fb : f, k === 3 ? COR.suave : COR.texto))
            xx += COLS[k].larg
          })
          y -= alt
          pag.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.4, color: COR.linha })
        })
      }
      garantir(30)
      y -= 16
      txt(`Gerado em ${o.geradoEm} · Dúvidas: equipe administrativa da Clínica Hope.`, M, y, 8, f, COR.suave)
      continue
    }

    txt(g.psicologa, M, y - 6, 18, fb)
    y -= 28
    txt(`Período: ${o.periodo}   ·   Gerado em ${o.geradoEm}`, M, y, 9, f, COR.suave)
    y -= 22

    // resumo
    const comNumero = g.pacientes.reduce((t, p) => t + p.guias.filter((x) => x.guia).length, 0)
    const semNumero = g.pacientes.reduce((t, p) => t + p.guias.filter((x) => !x.guia).length, 0)
    const unimed = g.pacientes.reduce((t, p) => t + p.guias.filter((x) => x.plano === 'Unimed').length, 0)
    const caixas: [string, string, typeof COR.texto][] = adm
      ? [
          ['Guias sem sessão', String(g.guias), COR.alerta],
          ['Pacientes', String(g.pacientes.length), COR.texto],
          ['Unimed', String(unimed), COR.texto],
          ['Outros planos', String(g.guias - unimed), COR.texto],
        ]
      : [
      ['Guias pendentes', String(comNumero), COR.alerta],
      ['Sem nº de guia', o.incluirSemGuia ? String(semNumero) : '—', semNumero ? COR.ruim : COR.texto],
      ['Pacientes', String(g.pacientes.length), COR.texto],
      ['Sessões', String(g.sessoes), COR.texto],
        ]
    const cw = (A4.w - 2 * M - 3 * 8) / 4
    caixas.forEach(([rot, val, cor], i) => {
      const x = M + i * (cw + 8)
      pag.drawRectangle({ x, y: y - 42, width: cw, height: 46, borderColor: COR.linha, borderWidth: 1, color: rgb(1, 1, 1) })
      txt(rot.toUpperCase(), x + 8, y - 10, 7, fb, COR.suave)
      txt(val, x + 8, y - 32, 16, fb, cor)
    })
    y -= 58

    if (!g.pacientes.length) {
      txt(adm ? 'Todas as guias do registro da clínica estão na sua planilha. Obrigado!' : 'Nenhuma guia pendente de lançamento no período. Obrigado!', M, y - 6, 12, fb, COR.bom)
      continue
    }

    // orientação para a psicóloga
    const orienta = adm
      ? 'As guias abaixo foram registradas pela clínica (ADM Registro de Guia), mas nenhuma sessão com esse número de guia foi encontrada na sua planilha (aba Atendimentos). ' +
        'Por favor, registre as sessões correspondentes na sua planilha com o número da guia na coluna E e anexe a guia na coluna H. Se a guia não for sua ou o número estiver diferente, avise a equipe administrativa.'
      : 'As sessões abaixo estão registradas na sua planilha (aba Atendimentos), mas a guia correspondente ainda não consta no registro de guias da clínica. ' +
      'Por favor, confira se o número da guia está correto na coluna E, se a guia foi anexada (coluna H) e, se houver guia física ou autorização, envie-a para a equipe administrativa.'
    for (const l of quebrar(orienta, f, 9, A4.w - 2 * M)) {
      txt(l, M, y, 9, f, COR.texto)
      y -= 12
    }
    y -= 8

    cabecalhoTabela()

    for (const p of g.pacientes) {
      p.guias.forEach((x, i) => {
        const celulas = adm
          ? [p.paciente, x.guia ?? '', x.plano, (x.refs ?? []).join(', ') || '—']
          : [
          p.paciente,
          x.guia ?? 'SEM Nº',
          x.plano,
          x.datas.length ? x.datas.map((d) => dataBR(d).slice(0, 5)).join(', ') : '—',
          String(Math.max(x.datas.length, 1)),
          x.semAnexo ? 'sem anexo' : 'anexou',
          x.statusS.length ? x.statusS.join(', ') : '(vazio)',
            ]
        const quebradas = celulas.map((c, k) => quebrar(c, k === 0 ? fb : f, 8, COLS[k].larg - 8))
        const alt = Math.max(...quebradas.map((q) => q.length)) * 10 + 8
        garantir(alt)
        if (i === 0) pag.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.8, color: rgb(0.82, 0.84, 0.86) })
        let xx = M + 4
        quebradas.forEach((linhas, k) => {
          const c = COLS[k]
          const fonte = k === 0 ? fb : f
          const cor = adm ? (k === 3 ? COR.suave : COR.texto) : k === 1 && !x.guia ? COR.ruim : k === 5 ? (x.semAnexo ? COR.alerta : COR.bom) : k === 3 ? COR.suave : COR.texto
          linhas.forEach((l, j) => {
            const w = fonte.widthOfTextAtSize(l, 8)
            txt(l, c.alinhar === 'dir' ? xx + c.larg - 8 - w : xx, y - 11 - j * 10, 8, fonte, cor)
          })
          xx += c.larg
        })
        y -= alt
        pag.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.4, color: COR.linha })
      })
    }

    garantir(40)
    y -= 18
    txt('Dúvidas: equipe administrativa da Clínica Hope.', M, y, 8, f, COR.suave)
  }

  // rodapé com numeração
  const paginas = doc.getPages()
  paginas.forEach((pg, i) => {
    const t = `Página ${i + 1} de ${paginas.length}`
    pg.drawText(t, { x: A4.w - M - f.widthOfTextAtSize(t, 8), y: 22, size: 8, font: f, color: COR.suave })
    pg.drawText('HOPE CORE · documento interno', { x: M, y: 22, size: 8, font: f, color: COR.suave })
  })

  return doc.save()
}
