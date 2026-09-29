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
