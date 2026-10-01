import { describe, expect, it } from 'vitest'
import { agruparPorArea, chaveDaLinha, deTexto, familia, paraCsv, paraTexto, SEM_AREA, type TabelaCatalogo } from '../banco'

const t = (tabela: string, area: string | null, titulo: string | null = null): TabelaCatalogo => ({
  esquema: 'public', tabela, tipo: 'tabela', linhas: 0, porClinica: true, somenteLeitura: false, colunas: 1,
  area, titulo, paraQue: null, origem: null, usadoEm: null,
})

describe('banco de dados', () => {
  it('agrupa por área na ordem fixa, tabelas novas primeiro', () => {
    const g = agruparPorArea([t('b', 'Sistema e segurança'), t('a', 'Espelho das planilhas'), t('nova', null), t('x', 'Área nova')])
    expect(g.map((x) => x.area)).toEqual([SEM_AREA, 'Espelho das planilhas', 'Sistema e segurança', 'Área nova'])
  })

  it('reconhece a família do tipo', () => {
    expect(familia('numeric(12,2)')).toBe('numero')
    expect(familia('bigint')).toBe('numero')
    expect(familia('jsonb')).toBe('json')
    expect(familia('text[]')).toBe('json')
    expect(familia('timestamp with time zone')).toBe('data')
    expect(familia('boolean')).toBe('booleano')
    expect(familia('uuid')).toBe('texto')
  })

  it('converte texto digitado em valor', () => {
    expect(deTexto('1.234,56', 'numeric')).toBe(1234.56)
    expect(deTexto('33', 'integer')).toBe(33)
    expect(deTexto('  ', 'text')).toBeNull()
    expect(deTexto('sim', 'boolean')).toBe(true)
    expect(deTexto('[1,"a"]', 'jsonb')).toEqual([1, 'a'])
    expect(() => deTexto('abc', 'numeric')).toThrow()
    expect(() => deTexto('{x', 'jsonb')).toThrow()
    expect(deTexto(' Ana ', 'text')).toBe(' Ana ')
  })

  it('texto da célula e chave da linha', () => {
    expect(paraTexto(null)).toBe('')
    expect(paraTexto({ a: 1 })).toBe('{"a":1}')
    expect(chaveDaLinha({ id: 5, nome: 'x' }, ['id'])).toEqual({ id: 5 })
  })

  it('gera CSV com ; e aspas', () => {
    expect(paraCsv(['a', 'b'], [{ a: 'x;y', b: 'diz "oi"' }])).toBe('a;b\r\n"x;y";"diz ""oi"""')
  })
})
