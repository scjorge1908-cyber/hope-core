import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import { gerarPdfExtrato, gerarXlsxExtrato, linhasDoExtrato } from '../exportar'

const ex = {
  start: { date: '2026-09-01', balance: 1000000 },
  end: { date: '2026-09-29', balance: 1150000 },
  entries: Array.from({ length: 70 }, (_, i) => ({
    id: `e${i}`,
    type: i % 3 ? 'CREDIT' : 'DEBIT',
    amount: 4683 + i,
    createdAt: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T10:${String(i % 60).padStart(2, '0')}:00`,
    transaction: { type: i % 2 ? 'PIX' : 'TRANSFER', description: `TED RECEBIDA & <teste> ${i}`, counterParty: { name: 'BRADESCO SAÚDE S/A', identity: '92693118000160' } },
  })),
}
const meta = { empresa: 'HOPE CLINICA', documentoEmpresa: '47283631000129', inicio: '2026-09-01', fim: '2026-09-29', saldoInicial: 10000, saldoFinal: 11500, geradoEm: '29/09/2026 17:00', ambiente: 'producao' }

describe('exportar extrato', () => {
  it('linhas com sinal e em reais', () => {
    const l = linhasDoExtrato(ex)
    expect(l).toHaveLength(70)
    expect(l.find((x) => x.tipo === 'Saída')!.valor).toBeLessThan(0)
    expect(l[0].data).toBe('2026-09-01')
  })
  it('xlsx válido com valores numéricos e texto escapado', () => {
    const b = gerarXlsxExtrato(linhasDoExtrato(ex), meta)
    const z = unzipSync(b)
    const sheet = strFromU8(z['xl/worksheets/sheet1.xml'])
    expect(sheet).toContain('&amp; &lt;teste&gt;')
    expect(sheet).toMatch(/<c r="H6" s="2"><v>-?\d+(\.\d+)?<\/v><\/c>/)
    if (process.env.XLSX_OUT) writeFileSync(process.env.XLSX_OUT, b)
  })
  it('pdf gera várias páginas', async () => {
    const b = await gerarPdfExtrato(linhasDoExtrato(ex), meta)
    expect(Buffer.from(b.slice(0, 5)).toString()).toBe('%PDF-')
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, b)
  })
})
