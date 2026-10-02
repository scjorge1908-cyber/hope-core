import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  calcularIndividual,
  extrairValorMonetario,
  indiceCarteirinha,
  rpaCarteirinhaUnimed,
  mapaIsencoes,
  processarRelatorio,
  MESES,
  type CelulaLegado,
  type PsicologaLegado,
} from '../rpa-legado'

// ------------------------------------------------------------------
// Carrega o Code.gs ORIGINAL do Sistema Mestre RPA (pasta legado/) e
// executa as funções dele com "SpreadsheetApp" e "Utilities" simulados.
// O teste compara o resultado original com o porte, célula por célula.
// ------------------------------------------------------------------
const CODE_GS = readFileSync(join(__dirname, '../../../../../legado/mestre-rpa/Code.gs'), 'utf8').replace(/\r\n/g, '\n')
const trecho = CODE_GS.slice(
  CODE_GS.indexOf('const RPA_PERCENTUAL_PADRAO'),
  CODE_GS.indexOf('// =======================================================\n// 4. GERADOR DE PDF')
)

const SP = 'America/Sao_Paulo'
function formatarSP(d: Date, padrao: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: SP, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value])
  )
  if (padrao === 'MM/yyyy') return `${p.month}/${p.year}`
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
}

type Planilhas = Record<string, unknown[][]>
function carregarOriginal(planilhas: Planilhas) {
  const SpreadsheetApp = {
    openById: (id: string) => ({
      getSheetByName: (n: string) =>
        n === 'Atendimentos' ? { getDataRange: () => ({ getValues: () => planilhas[id] }) } : null,
    }),
  }
  const Utilities = { formatDate: (d: Date, _tz: string, p: string) => formatarSP(d, p) }
  const fabrica = new Function('SpreadsheetApp', 'Utilities', `${trecho}\nreturn { extrairValorMonetario, calcularIndividual };`)
  return fabrica(SpreadsheetApp, Utilities) as {
    extrairValorMonetario: (v: unknown) => number
    calcularIndividual: (id: string, mes: string, ano: number, nome: string, iso: Record<string, number>) => unknown
  }
}

/** Mesma normalização do SyncSupabase.gs */
const normalizar = (v: unknown): CelulaLegado =>
  v instanceof Date ? { $date: formatarSP(v, 'iso') } : typeof v === 'number' || typeof v === 'boolean' ? v : v == null ? '' : String(v)

// gerador determinístico
let semente = 7
const aleatorio = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648
const escolher = <T,>(a: T[]) => a[Math.floor(aleatorio() * a.length)]

const VALORES: unknown[] = [33, 33, '33,00', 'R$ 33,00', 33.004, 45.54, 33.1, 32.74, 'R$ 45,54', 'R$45.54', '45,54', '45.5', '1.234', '1.234,56', '', null, 'abc', 'R$ 1.000,50', 0, '33,10 ', 100000, 'US$ 12.00', '12,3456']
const STATUS: unknown[] = ['OK', 'ok', ' Ok ', '', '', 'Falta', 'cancelado', null, 0, 'OK ', 'falta']

function linhaAleatoria(): unknown[] {
  const r: unknown[] = new Array(20).fill('')
  const k = aleatorio()
  if (k < 0.55) r[0] = new Date(Date.UTC(2026, Math.floor(aleatorio() * 12), 1 + Math.floor(aleatorio() * 28), Math.floor(aleatorio() * 24), Math.floor(aleatorio() * 60)))
  else if (k < 0.85) {
    const d = 1 + Math.floor(aleatorio() * 28)
    const m = 1 + Math.floor(aleatorio() * 12)
    r[0] = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/2026 ${escolher(['10:00:00', '08:15'])}`
  } else r[0] = escolher(['', null, 12345, '2026-08-01'])
  r[11] = escolher(['00250001234567890', '0025 0001 2345 678', 250001234567890, 2517000123456, '7700123456', 770012345678901, '', null, 'Não tem'])
  r[12] = escolher(['', 'Unimed', 'Não', 'Não encontrado', 'Bradesco', null, 0])
  r[13] = escolher(VALORES)
  r[18] = escolher(STATUS)
  return r
}

describe('porte do Sistema Mestre RPA = Code.gs original', () => {
  const ids = ['PSI_A_1234567890123456789012', 'PSI_B_1234567890123456789012', 'PSI_C_1234567890123456789012']
  const planilhas: Planilhas = {}
  // cabeçalhos reais: L "Carterinha" (maioria), "Carteirinha", e um sem cabeçalho (reserva L)
  const cab = (l: string) => {
    const h: unknown[] = new Array(20).fill('')
    h[10] = 'Plano (no Registro)'
    h[11] = l
    h[12] = 'Origen'
    h[13] = 'Valor'
    return h
  }
  const cabecalhos = [cab('Carterinha'), cab('Carteirinha'), cab('')]
  ids.forEach((id, i) => (planilhas[id] = [cabecalhos[i], ...Array.from({ length: 1500 }, linhaAleatoria)]))
  // produção alta para passar do teto do INSS
  for (let i = 0; i < 400; i++) {
    const r: unknown[] = new Array(20).fill('')
    r[0] = new Date(Date.UTC(2026, 7, 10, 15))
    r[13] = 'R$ 1.000,00'
    r[18] = 'OK'
    planilhas[ids[2]].push(r)
  }
  const original = carregarOriginal(planilhas)

  // ExencaoCNPJ: B isenta com percentual vazio (=45%); A sem CNPJ (não conta)
  const exencoes: [CelulaLegado, CelulaLegado, CelulaLegado][] = [
    [ids[1], '12.345.678/0001-99', ''],
    [ids[0], '', 30],
  ]
  const isencaoOriginal: Record<string, number> = { [ids[1]]: 45 }
  const isencaoPorte = mapaIsencoes(exencoes)

  it('isenções seguem a mesma regra (vazio = 45%, sem CNPJ não vale)', () => {
    expect(isencaoPorte).toEqual(isencaoOriginal)
  })

  /** Mesmo formato que legacy_rpa_base entrega: [A, N, S, carteirinha] */
  const paraPorte = (id: string) => {
    const k = indiceCarteirinha(planilhas[id][0])
    return planilhas[id]
      .slice(1)
      .map((r) => [normalizar(r[0]), normalizar(r[13]), normalizar(r[18]), normalizar(r[k])]) as PsicologaLegado['linhas']
  }

  it('coluna da carteirinha pelo cabeçalho (Carterinha / Carteirinha / reserva L)', () => {
    expect(cabecalhos.map(indiceCarteirinha)).toEqual([11, 11, 11])
    expect(indiceCarteirinha(['a', 'b', 'Nº Carteirinha'])).toBe(2)
  })

  it('carteirinha 0025 em texto ou número (zeros perdidos) é Unimed', () => {
    expect(rpaCarteirinhaUnimed('00250001234567890')).toBe(true)
    expect(rpaCarteirinhaUnimed('0025 0001 2345 678')).toBe(true)
    expect(rpaCarteirinhaUnimed(250001234567890)).toBe(true)
    expect(rpaCarteirinhaUnimed('250001234567890')).toBe(false)
    expect(rpaCarteirinhaUnimed(770012345678901)).toBe(false)
    expect(rpaCarteirinhaUnimed('')).toBe(false)
  })

  it('R$ 33 + carteirinha 0025 = R$ 18,00, mesmo com "Não" na coluna Origen', () => {
    const h = cabecalhos[0]
    const r = (v: unknown, l: unknown, m: string) => {
      const x: unknown[] = new Array(20).fill('')
      x[0] = new Date(Date.UTC(2026, 9, 2, 7))
      x[11] = l
      x[12] = m
      x[13] = v
      x[18] = 'OK'
      return x
    }
    const id = 'PSI_D_1234567890123456789012'
    planilhas[id] = [h, r(33, '00250001234567890', 'Não'), r(33, 250001234567890, ''), r(33, '7700123', 'Unimed'), r(45, '00250001234567890', 'Unimed')]
    const porte = calcularIndividual(id, paraPorte(id), 'OUTUBRO', 2026, {})
    expect(porte).toEqual(original.calcularIndividual(id, 'OUTUBRO', 2026, 'x', {}))
    expect(porte).toMatchObject({ qtdSessoes33: 2, comissaoSessoes33: 36, qtdSessoes33SemUnimed: 1, repasseBruto: 67.2, valorLiquido: 59.81 })
  })

  it.each(ids)('%s: os 12 meses dão exatamente o mesmo resultado', (id) => {
    const linhas = paraPorte(id)
    for (const mes of MESES) {
      expect(calcularIndividual(id, linhas, mes, 2026, isencaoPorte)).toEqual(original.calcularIndividual(id, mes, 2026, 'x', isencaoOriginal))
    }
  })

  it('teto do INSS aplicado igual ao original', () => {
    const linhas = paraPorte(ids[2])
    const r = calcularIndividual(ids[2], linhas, 'AGOSTO', 2026, isencaoPorte)
    expect(r.baseCalculoInss).toBe(7786.02)
    expect(r.retencaoInss).toBe(856.46)
  })

  it('extrairValorMonetario idêntico em todos os formatos', () => {
    for (const v of [...VALORES, '  R$ 7,5 ', '1,', ',50', 'R$', '12.3.4', 'x1.5y', '1.234.567', '45.00']) {
      expect(extrairValorMonetario(v)).toBe(original.extrairValorMonetario(v))
    }
  })

  it('psicóloga ainda não sincronizada aparece como erro, como no RPA', () => {
    const r = processarRelatorio(
      {
        psicologas: [{ id: ids[0], nomeAbreviado: 'A', nomeCompleto: 'Psi A', pixKey: '', ultimaSincronizacao: null, ultimoErro: null, linhas: [] }],
        exencoes: [],
      },
      'AGOSTO',
      2026
    )
    expect(r.relatorioFinal[0].erro).toBe(true)
    expect(r.logs[0]).toMatch(/^❌ Psi A: Erro/)
  })

  it('planilha que falhou na última leitura sai como erro, mesmo tendo cópia anterior', () => {
    const r = processarRelatorio(
      {
        psicologas: [
          {
            id: ids[0], nomeAbreviado: 'A', nomeCompleto: 'Psi A', pixKey: '',
            ultimaSincronizacao: '2026-09-29T10:00:00Z', ultimoErro: 'Aba "Atendimentos" não encontrada.',
            linhas: [[{ $date: '2026-08-10T10:00:00' }, 45.54, 'OK']],
          },
        ],
        exencoes: [],
      },
      'AGOSTO',
      2026
    )
    expect(r.relatorioFinal[0]).toMatchObject({ erro: true, msg: 'Aba "Atendimentos" não encontrada.' })
  })
})
