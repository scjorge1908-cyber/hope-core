import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTissStatement, toCents, TissParseError } from '../tiss-parser'

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)))

describe('toCents', () => {
  it('converte sem erro de arredondamento', () => {
    expect(toCents('33.10')).toBe(3310)
    expect(toCents('45,54')).toBe(4554)
    expect(toCents('4554.00')).toBe(455400)
    expect(toCents('0.00')).toBe(0)
    expect(toCents(null)).toBe(0)
  })
  it('recusa lixo', () => {
    expect(() => toCents('R$ 10')).toThrow(TissParseError)
  })
})

describe('demonstrativo sintético (dados inventados)', () => {
  const s = parseTissStatement(fixture('demonstrativo-sintetico.xml'), 'sintetico.xml')

  it('lê o cabeçalho', () => {
    expect(s.operatorAnsCode).toBe('000001')
    expect(s.statementNumber).toBe('900001')
    expect(s.emissionDate).toBe('2026-09-25')
    expect(s.tissVersion).toBe('3.03.01')
  })

  it('preserva zeros à esquerda da guia e da carteirinha', () => {
    expect(s.items[0].providerGuideNumber).toBe('00100')
    expect(s.items[0].cardNumber).toBe('00250000000000001')
  })

  it('separa as sessões de uma mesma guia', () => {
    expect(s.items).toHaveLength(4)
    expect(s.items.filter((i) => i.providerGuideNumber === '00100').map((i) => i.realizationDate)).toEqual([
      '2026-08-04',
      '2026-08-11',
    ])
  })

  it('glosa: converte a escala ×100 para reais', () => {
    const glosada = s.items.find((i) => i.glossCents > 0)!
    expect(glosada.glossCents).toBe(3310)
    expect(glosada.glosses).toEqual([{ code: '1702', valueCents: 3310 }])
  })

  it('sessão repetida na mesma guia+data recebe ocorrência 1 e 2 (chaves distintas)', () => {
    const dup = s.items.filter((i) => i.providerGuideNumber === '00200')
    expect(dup.map((i) => i.occurrence)).toEqual([1, 2])
    expect(new Set(dup.map((i) => i.itemKey)).size).toBe(2)
  })

  it('todas as chaves são únicas', () => {
    expect(new Set(s.items.map((i) => i.itemKey)).size).toBe(s.items.length)
  })

  it('total geral: detecta escala ×100 e aponta diferença sem detalhe', () => {
    expect(s.itemTotals).toEqual({ informedCents: 15728, processedCents: 15728, releasedCents: 12418, glossCents: 3310 })
    expect(s.declaredTotals?.releasedCents).toBe(12418)
    expect(s.declaredTotals?.glossCents).toBe(9930)
    expect(s.divergences.some((d) => d.includes('glosa') && d.includes('66,20'))).toBe(true)
  })

  it('mesmo arquivo gera o mesmo hash e as mesmas chaves (idempotente)', () => {
    const again = parseTissStatement(fixture('demonstrativo-sintetico.xml'), 'outro-nome.xml')
    expect(again.fileSha256).toBe(s.fileSha256)
    expect(again.items.map((i) => i.itemKey)).toEqual(s.items.map((i) => i.itemKey))
  })

  it('recusa arquivo que não é TISS', () => {
    expect(() => parseTissStatement(new TextEncoder().encode('<a/>'), 'x.xml')).toThrow(TissParseError)
  })
})

// ------------------------------------------------------------------
// Arquivos REAIS: nunca versionados (contêm dados de pacientes).
// Para rodar: HOPE_TISS_FIXTURES_DIR=/caminho/dos/xmls npx vitest run
// Totais conferidos manualmente contra os 5 demonstrativos mai–set/2026.
// ------------------------------------------------------------------
const realDir = process.env.HOPE_TISS_FIXTURES_DIR
const EXPECTED: Record<string, { n: number; inf: number; lib: number; glosa: number; declGlosa: number }> = {
  '271630': { n: 581, inf: 2127310, lib: 2102474, glosa: 24836, declGlosa: 24836 },
  '275402': { n: 392, inf: 1431604, lib: 1395630, glosa: 35974, declGlosa: 35974 },
  '278704': { n: 320, inf: 1188956, lib: 1166186, glosa: 22770, declGlosa: 22770 },
  '282244': { n: 428, inf: 1614568, lib: 1541704, glosa: 72864, declGlosa: 79484 },
  '284996': { n: 345, inf: 1308882, lib: 1243060, glosa: 65822, declGlosa: 65822 },
}

describe.skipIf(!realDir || !existsSync(realDir))('demonstrativos reais Unimed', () => {
  const files = realDir && existsSync(realDir) ? readdirSync(realDir).filter((f) => f.endsWith('.xml')) : []
  const parsed = files.map((f) => parseTissStatement(new Uint8Array(readFileSync(join(realDir!, f))), f))

  it.each(Object.entries(EXPECTED))('demonstrativo %s bate com os totais conferidos', (num, e) => {
    const s = parsed.find((p) => p.statementNumber === num)
    expect(s, `arquivo do demonstrativo ${num} não encontrado`).toBeDefined()
    expect(s!.items).toHaveLength(e.n)
    expect(s!.itemTotals.informedCents).toBe(e.inf)
    expect(s!.itemTotals.releasedCents).toBe(e.lib)
    expect(s!.itemTotals.glossCents).toBe(e.glosa)
    expect(s!.declaredTotals!.glossCents).toBe(e.declGlosa)
    expect(s!.declaredTotals!.releasedCents).toBe(e.lib)
  })

  it('nenhuma sessão se repete entre os 5 arquivos', () => {
    const keys = parsed.flatMap((p) => p.items.map((i) => i.itemKey))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('glosas por código: 1822=39, 1702=11, 1814=1, e somam o total', () => {
    const all = parsed.flatMap((p) => p.items.flatMap((i) => i.glosses))
    const count = (c: string) => all.filter((g) => g.code === c).length
    expect([count('1822'), count('1702'), count('1814')]).toEqual([39, 11, 1])
    const soma = all.reduce((s, g) => s + g.valueCents, 0)
    const esperado = parsed.reduce((s, p) => s + p.itemTotals.glossCents, 0)
    expect(soma).toBe(esperado)
  })

  it('só o 282244 tem divergência (R$ 66,20 sem detalhe)', () => {
    const com = parsed.filter((p) => p.divergences.length > 0).map((p) => p.statementNumber)
    expect(com).toEqual(['282244'])
  })
})
