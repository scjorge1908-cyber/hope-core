import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXTENSAO_SCRIPT, SHIM_SCRIPT, montarPagina } from '../pagina'
import { FUNCOES_PONTE } from '../funcoes'
import original from '../index-original.json'
// módulo JS de teste (simula o Apps Script)
import { Aba, Planilha, carregarGAS } from './gas-mock.mjs'

const RAIZ = join(__dirname, '../../../../..')
const INDEX_LEGADO = readFileSync(join(RAIZ, 'legado/registro-guias/Index.html'), 'utf8')
const CODE_LEGADO = readFileSync(join(RAIZ, 'legado/registro-guias/Code.gs'), 'utf8')

describe('página Registro de Guias = Index.html original', () => {
  it('o JSON servido é idêntico ao Index.html da pasta legado', () => {
    expect(original.html).toBe(INDEX_LEGADO)
  })

  it('montarPagina só acrescenta (tirando os acréscimos volta ao original)', () => {
    const pagina = montarPagina(original.html)
    const semAcrescimos = pagina.replace('\n' + SHIM_SCRIPT + '\n', '').replace(EXTENSAO_SCRIPT + '\n', '')
    expect(semAcrescimos).toBe(original.html)
    expect(pagina.indexOf(SHIM_SCRIPT)).toBeLessThan(pagina.indexOf('var CACHE_STATUS'))
    expect(pagina.indexOf(EXTENSAO_SCRIPT)).toBeGreaterThan(pagina.indexOf('function renderizarTabela'))
  })

  it('toda função chamada pelo Index.html via google.script.run está liberada na ponte', () => {
    // chamadas ao servidor = métodos chamados no Index.html que são funções do Code.gs
    const doCode = new Set(Array.from(CODE_LEGADO.matchAll(/^function (\w+)\(/gm), (m) => m[1]))
    const chamadas = new Set<string>()
    for (const m of original.html.matchAll(/\.(\w+)\(/g)) if (doCode.has(m[1])) chamadas.add(m[1])
    expect(chamadas.size).toBeGreaterThan(8)
    for (const fn of chamadas) expect(FUNCOES_PONTE as readonly string[]).toContain(fn)
    // e todas existem no Code.gs original (menos a nossa hopeMapaPsicologas, que está na ponte)
    for (const fn of FUNCOES_PONTE.filter((f) => f !== 'hopeMapaPsicologas')) {
      expect(CODE_LEGADO).toMatch(new RegExp(`function ${fn}\\(`))
    }
  })
})

describe('PonteRegistroGuias.gs (doPost) com o Code.gs original', () => {
  const TOKEN = 't'.repeat(40)
  const ID = 'PLANILHA_TESTE_abcdefghij1234567890'
  function ambiente() {
    const atend = new Aba('Atendimentos', [
      ['Timestamp', 'Psicóloga', 'Paciente', 'Data', 'Guia'],
      ['', 'PSI T', 'Ana', '', '501', '', '', '', '', '', '', '', '', 33.1, '', '', '', '', ''],
      ['', 'PSI T', 'Ana', '', '502', '', '', '', '', '', '', '', '', 33.1],
    ])
    const bd = new Aba('BD_GUIAS', [['Data', 'Mês', 'Ano', 'Psicóloga', 'Paciente', 'Plano']])
    const ativa = new Planilha('C', {
      ID: new Aba('ID', [['Nome', 'ID'], ['PSI T', `https://docs.google.com/spreadsheets/d/${ID}/edit`]]),
      BD_GUIAS: bd,
    })
    const externa = new Planilha(ID, { Atendimentos: atend, AGENDA: new Aba('AGENDA', [['x']]) })
    const gas = carregarGAS({ ativa, externas: { [ID]: externa }, props: { HOPE_PONTE_TOKEN: TOKEN } })
    const chamar = (fn: string, args: unknown[], token = TOKEN) =>
      JSON.parse(gas.doPost({ postData: { contents: JSON.stringify({ token, fn, args }) } }).getContent())
    return { atend, bd, chamar }
  }

  it('recusa token errado e função fora da lista', () => {
    const { chamar } = ambiente()
    expect(chamar('getListaPsicologas', [], 'errado')).toMatchObject({ ok: false, erro: 'Token inválido' })
    expect(chamar('limparDuplicadosBD', [])).toMatchObject({ ok: false })
    expect(chamar('getListaPsicologas', [])).toEqual({ ok: true, resultado: ['PSI T'], extra: {} })
  })

  it('salvarStatusGuia grava a coluna S e devolve o ID da planilha para o espelho', () => {
    const { atend, chamar } = ambiente()
    const r = chamar('salvarStatusGuia', ['PSI T', '502', 'OK'])
    expect(r.ok).toBe(true)
    expect(r.resultado).toMatchObject({ sucesso: true, valorSalvo: 'OK', linhas: [3] })
    expect(r.extra).toEqual({ idPlanilha: ID })
    expect(atend.linhas[2][18]).toBe('OK')
  })

  it('salvarDadosPaciente grava a BD_GUIAS e devolve a linha exata para o espelho', () => {
    const { bd, chamar } = ambiente()
    const r = chamar('salvarDadosPaciente', [
      { psicologa: 'PSI T', mes: '9', ano: '2026', paciente: { nome: 'Ana', plano: 'UNIMED', semana1: '501 / 502', semana2: '', semana3: '', semana4: '', semana5: '', extras: [] } },
    ])
    expect(r.resultado).toMatchObject({ sucesso: true, operacao: 'INSERIR', linha: 2 })
    expect(bd.linhas[1].slice(1, 8)).toEqual(['9', '2026', 'PSI T', 'Ana', 'UNIMED', '501', '502'])
    expect(r.extra.linhaValores.slice(0, 8)).toEqual(bd.linhas[1].slice(0, 8))
  })

  it('hopeMapaPsicologas devolve nome e ID limpo da aba ID', () => {
    const { chamar } = ambiente()
    expect(chamar('hopeMapaPsicologas', []).resultado).toEqual([{ nome: 'PSI T', id: ID }])
  })
})
