import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { gerarPdfNaoLancadas, textoSeguro } from '../pdf-nao-lancadas'
import type { PsicologaNaoLancada } from '../conferencia'

describe('PDF guias não lançadas', () => {
  it('mantém acentos e remove caracteres fora do WinAnsi', () => {
    expect(textoSeguro('Sessão → João ↗ ç')).toBe('Sessão -> João  ç')
  })
  it('gera PDF com várias páginas sem erro', async () => {
    const g: PsicologaNaoLancada = {
      psicologa: 'PSI Teste Ávila',
      spreadsheet_id: 'x',
      guias: 60,
      sessoes: 60,
      pacientes: Array.from({ length: 60 }, (_, i) => ({
        paciente: `PACIENTE COM NOME BEM COMPRIDO NÚMERO ${i}`,
        sessoes: 1,
        guias: [{ guia: i % 7 ? `5014381${String(i).padStart(4, '0')}` : null, plano: 'Unimed', spreadsheet_id: 'x', datas: ['2026-08-05', '2026-08-12'], semAnexo: i % 3, statusS: ['OK'] }],
      })),
    }
    const bytes = await gerarPdfNaoLancadas([g, { ...g, psicologa: 'Outra', pacientes: [], guias: 0, sessoes: 0 }], {
      periodo: 'jul/2026 a set/2026',
      geradoEm: '29/09/2026 14:30',
      incluirSemGuia: true,
    })
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, bytes)
  })
  it('modo ADM (guias sem sessão na planilha)', async () => {
    const g: PsicologaNaoLancada = {
      psicologa: 'Psi Josane', spreadsheet_id: 'x', guias: 2, sessoes: 2,
      pacientes: [{ paciente: 'ANA PAULA DE OLIVEIRA FERNANDES', sessoes: 2, guias: [
        { guia: '50144743919', plano: 'Unimed', spreadsheet_id: 'x', datas: [], semAnexo: 0, statusS: [], refs: ['set/26 · 3ª semana'] },
        { guia: '50145394630', plano: 'Unimed', spreadsheet_id: 'x', datas: [], semAnexo: 0, statusS: [], refs: ['set/26 · 5ª semana'] },
      ] }],
    }
    const bytes = await gerarPdfNaoLancadas([g], { periodo: 'set/2026', geradoEm: '29/09/2026 15:00', incluirSemGuia: true, modo: 'adm' })
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')
    if (process.env.PDF_OUT2) writeFileSync(process.env.PDF_OUT2, bytes)
  })
})
