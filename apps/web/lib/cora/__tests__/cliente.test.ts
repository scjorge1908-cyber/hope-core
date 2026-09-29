import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { lerPem } from '../cliente'

const PEM = '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----'
describe('lerPem', () => {
  it('aceita PEM direto, com \\n escrito e em base64', () => {
    expect(lerPem(PEM)).toBe(PEM)
    expect(lerPem(PEM.replace(/\n/g, '\\n'))).toBe(PEM)
    expect(lerPem(Buffer.from(PEM).toString('base64'))).toBe(PEM)
    expect(lerPem('lixo')).toBe('')
    expect(lerPem(undefined)).toBe('')
  })
})

import { fatiarPorMes } from '../cliente'
describe('fatiarPorMes', () => {
  it('divide em meses de calendário', () => {
    expect(fatiarPorMes('2026-01-15', '2026-03-10')).toEqual([
      ['2026-01-15', '2026-01-31'],
      ['2026-02-01', '2026-02-28'],
      ['2026-03-01', '2026-03-10'],
    ])
    expect(fatiarPorMes('2026-09-01', '2026-09-29')).toEqual([['2026-09-01', '2026-09-29']])
    expect(fatiarPorMes('2026-01-01', '2026-12-31')).toHaveLength(12)
  })
})
