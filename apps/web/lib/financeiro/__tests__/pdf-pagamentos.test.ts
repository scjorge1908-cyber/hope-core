import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { gerarPdfPagamentos } from '../pdf-pagamentos'

describe('PDF do controle de pagamento', () => {
  it('gera PDF válido com muitas linhas (quebra de página) e acentos', async () => {
    const linhas = Array.from({ length: 40 }, (_, i) => ({
      nome: `Psicóloga Ção ${i} de Oliveira Mendonça Muito Comprida Para Caber`,
      tipo: (i % 3 ? 'PF' : 'CNPJ') as 'PF' | 'CNPJ',
      chavePix: i % 5 ? '01761079590' : '',
      aPagar: 1000 + i,
      pago: i > 30,
      dataPagamento: i > 30 ? '2026-10-02' : null,
      forma: i > 30 ? 'QR Code Pix' : '',
      valorPago: i > 30 ? (i === 35 ? 999 : 1000 + i) : null,
      confirmadoExtrato: i === 32,
    }))
    const bytes = await gerarPdfPagamentos(linhas, { competencia: 'SETEMBRO/2026', geradoEm: '02/10/2026 18:20' })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(1)
    expect(doc.getTitle()).toContain('SETEMBRO/2026')
  })

  it('mês sem nada a pagar também gera PDF', async () => {
    const bytes = await gerarPdfPagamentos([], { competencia: 'JANEIRO/2026', geradoEm: 'x' })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })
})
