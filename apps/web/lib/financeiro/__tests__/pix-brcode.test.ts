import { describe, expect, it } from 'vitest'
import { cnpjValido, cpfValido, crc16, gerarPixCopiaECola, normalizarChavePix } from '../pix-brcode'

describe('Pix estático (BR Code)', () => {
  it('reproduz o exemplo do manual do Banco Central (CRC 1D3D)', () => {
    expect(
      gerarPixCopiaECola({ chave: '123e4567-e12b-12d1-a456-426655440000', nome: 'Fulano de Tal', cidade: 'BRASILIA' })
    ).toBe(
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D'
    )
  })

  it('valor com 2 casas, nome sem acento e cortado em 25, CRC confere', () => {
    const p = gerarPixCopiaECola({
      chave: 'fulana@exemplo.com',
      nome: 'Beatriz Santos Noskoski de Araújo Lima',
      cidade: 'Palhoça',
      valor: 865.08,
      txid: 'REPHOPE202608abc',
    })
    expect(p).toContain('5406865.08')
    expect(p).toContain('5925Beatriz Santos Noskoski d')
    expect(p).toContain('6007Palhoca')
    expect(p).toContain('0516REPHOPE202608abc')
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)))
  })

  it('recusa valor zero', () => {
    expect(() => gerarPixCopiaECola({ chave: 'a@b.com', nome: 'X', cidade: 'Y', valor: 0 })).toThrow()
  })

  it('valida CPF e CNPJ', () => {
    expect(cpfValido('52998224725')).toBe(true)
    expect(cpfValido('52998224724')).toBe(false)
    expect(cnpjValido('47283631000129')).toBe(true)
    expect(cnpjValido('47283631000128')).toBe(false)
  })

  it.each([
    ['529.982.247-25', 'cpf', '52998224725'],
    ['47.283.631/0001-29', 'cnpj', '47283631000129'],
    ['(48) 99838-5204', 'telefone', '+5548998385204'],
    ['48998385204', 'telefone', '+5548998385204'],
    ['+55 48 99838-5204', 'telefone', '+5548998385204'],
    [' Fulana@Gmail.com ', 'email', 'fulana@gmail.com'],
    ['123E4567-E12B-12D1-A456-426655440000', 'aleatoria', '123e4567-e12b-12d1-a456-426655440000'],
  ])('reconhece %s como %s', (bruta, tipo, chave) => {
    expect(normalizarChavePix(bruta)).toMatchObject({ ok: true, tipo, chave })
  })

  it('CPF/CNPJ guardado como número (zeros da frente perdidos) volta com os zeros', () => {
    expect(normalizarChavePix('1761079590')).toMatchObject({ ok: true, tipo: 'cpf', chave: '01761079590' })
    expect(normalizarChavePix(1761079590)).toMatchObject({ ok: true, tipo: 'cpf', chave: '01761079590' })
    expect(normalizarChavePix('01761079590')).toMatchObject({ ok: true, tipo: 'cpf', chave: '01761079590' })
    expect(normalizarChavePix('7283631000129')).toMatchObject({ ok: false }) // padStart(14) não é CNPJ válido
    expect(normalizarChavePix('(48) 3242-1234')).toMatchObject({ ok: true, tipo: 'telefone', chave: '+554832421234' })
  })

  it('avisa quando a chave não é reconhecida', () => {
    expect(normalizarChavePix('')).toMatchObject({ ok: false })
    expect(normalizarChavePix('12345')).toMatchObject({ ok: false })
    expect(normalizarChavePix('11122233344')).toMatchObject({ ok: false })
  })
})
