// ================================================================
// TESTE DIFERENCIAL — motor financeiro (SQL, migration_030) × RPA
//
// Gera planilhas aleatórias (valores em número e texto, datas em data
// e texto, status variados, PF/CNPJ, teto do INSS…), grava num Postgres
// LOCAL, roda fin__fechamento_mes() e compara com processarRelatorio()
// (porte fiel do Code.gs do RPA) mês a mês, profissional a profissional.
//
// Só roda quando existe um Postgres de teste:
//   MOTOR_PG="-h /var/tmp/pgmotor -p 5499 -U postgres" npx vitest run motor-sql
// (o teste cria o banco "motor_diff", aplica o stub do Supabase e a
// migration_030). Sem a variável, é pulado — não depende da produção.
//
// Regra nova (Unimed R$ 33 a partir de 10/2026) e INSS v2 têm testes
// próprios em supabase/tests/fin_motor_testes.sql. Aqui o foco é provar
// que, para os meses até 09/2026, o motor dá EXATAMENTE o mesmo resultado
// do RPA (sem sessões de R$ 33, que o RPA antigo tratava sem vigência).
// ================================================================
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { MESES, processarRelatorio, type BaseRpaLegado, type CelulaLegado, type PsicologaLegado } from '../rpa-legado'

const PG = process.env.MOTOR_PG
const RAIZ = join(__dirname, '../../../../..')

function psql(args: string[], entrada?: string) {
  return execFileSync('psql', [...PG!.split(' ').filter(Boolean), '-v', 'ON_ERROR_STOP=1', '-q', '-tA', ...args], {
    input: entrada,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

// gerador pseudoaleatório reprodutível
function rng(semente: number) {
  let s = semente >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const CABECALHO = [
  'Timestamp', 'Psicóloga', 'Paciente', 'Data da Sessão', 'Nº da Guia', 'e ', 'Tipo de Atendimento', 'URL Anexo Guia',
  'Observação', 'URL Anexo Atestado', 'Plano (no Registro)', 'Carterinha ', 'Origen ', 'Valor ', '', '', '', '',
  'faturado e obs:', '',
]

type Planilha = {
  id: string
  ativo: boolean
  desligada: boolean
  erro: string | null
  cnpj: CelulaLegado | undefined // percentual da ExencaoCNPJ (undefined = PF)
  linhas: CelulaLegado[][]
}

function gerar(semente: number): Planilha[] {
  const r = rng(semente)
  const escolher = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const dois = (n: number) => String(n).padStart(2, '0')
  const valores: CelulaLegado[] = [
    45, 45, 45, 45, 60, 80, 31.9, 47.45, 15, 0, 57.25, 'R$ 45,00', 'R$45.00', '45,5', '1.234', '', 'abc', 'R$ 31,90', '  ', '12,345',
  ]
  const status: CelulaLegado[] = ['OK', 'OK', 'OK', 'ok', ' Ok ', '', '', 'Falta', 'cancelado', ' ', 'troca de carterinha']
  const planos: CelulaLegado[] = ['UNIMED', 'BRADESCO', 'NÃO', '', 'SELECT', 'NÃO ENCONTRADO']
  const carts: CelulaLegado[] = ['0025.0250.001387.30-7', 25012345678901, '0865000012', 97500000186459, '', '0084800001']
  const cnpjs: (CelulaLegado | undefined)[] = [undefined, undefined, undefined, 40, '', 35.5, '40']
  const out: Planilha[] = []
  const n = 7
  for (let p = 0; p < n; p++) {
    const muitas = p === 0 // estoura o teto do INSS (comissão > 7.786,02)
    const linhas: CelulaLegado[][] = []
    const qtd = muitas ? 900 : 40 + Math.floor(r() * 220)
    for (let i = 0; i < qtd; i++) {
      const mes = muitas ? 3 : 1 + Math.floor(r() * 9)
      const dia = 1 + Math.floor(r() * 28)
      const tipoA = r()
      const a: CelulaLegado =
        tipoA < 0.9 ? { $date: `2026-${dois(mes)}-${dois(dia)}T04:00:00` }
          : tipoA < 0.95 ? `${dois(dia)}/${dois(mes)}/2026 10:00`
            : tipoA < 0.97 ? '31/02/2026'
              : ''
      const linha: CelulaLegado[] = new Array(20).fill('')
      linha[0] = a
      linha[2] = `Paciente ${Math.floor(r() * 50)}`
      linha[3] = r() < 0.9 ? { $date: `2026-${dois(mes)}-${dois(dia)}T00:00:00` } : ''
      linha[4] = String(Math.floor(r() * 1e6))
      linha[11] = escolher(carts)
      linha[12] = escolher(planos)
      linha[13] = muitas ? 80 : escolher(valores)
      linha[18] = muitas ? 'OK' : escolher(status)
      linhas.push(linha)
    }
    out.push({
      id: `planilha_teste_${semente}_${p}_xxxxxxxxxxxx`,
      ativo: p !== 5,
      desligada: p === 5,
      erro: p === 6 ? 'Falha simulada de leitura' : null,
      cnpj: p === 0 ? undefined : escolher(cnpjs),
      linhas,
    })
  }
  return out
}

function sqlLiteral(s: string) {
  return `'${s.replace(/'/g, "''")}'`
}

function carregarNoBanco(planilhas: Planilha[]) {
  const T = '11111111-1111-1111-1111-111111111111'
  const cmds: string[] = [
    `insert into public.tenants (id) values ('${T}') on conflict do nothing;`,
    'truncate legado.atendimentos_raw, legado.planilhas, legado.exencoes;',
  ]
  planilhas.forEach((p, ordem) => {
    cmds.push(
      `insert into legado.planilhas (spreadsheet_id, tenant_id, nome_abreviado, nome_completo, cabecalho, ordem, ativo, desligada, ultima_sincronizacao, ultimo_erro) values (${sqlLiteral(p.id)}, '${T}', ${sqlLiteral('PSI ' + ordem)}, ${sqlLiteral('Profissional ' + ordem)}, ${sqlLiteral(JSON.stringify(CABECALHO))}::jsonb, ${ordem}, ${p.ativo}, ${p.desligada}, now(), ${p.erro ? sqlLiteral(p.erro) : 'null'});`
    )
    if (p.linhas.length)
      cmds.push(
        'insert into legado.atendimentos_raw (spreadsheet_id, linha, celulas) values ' +
          p.linhas.map((l, i) => `(${sqlLiteral(p.id)}, ${i + 2}, ${sqlLiteral(JSON.stringify(l))}::jsonb)`).join(',\n') +
          ';'
      )
  })
  let linhaEx = 2
  for (const p of planilhas) {
    if (p.cnpj === undefined) continue
    cmds.push(
      `insert into legado.exencoes (linha, psicologa_id, cnpj, percentual) values (${linhaEx++}, ${sqlLiteral(JSON.stringify(p.id))}::jsonb, '"12.345.678/0001-90"'::jsonb, ${sqlLiteral(JSON.stringify(p.cnpj))}::jsonb);`
    )
  }
  psql(['-d', 'motor_diff'], cmds.join('\n'))
  return T
}

function baseLegado(planilhas: Planilha[]): BaseRpaLegado {
  return {
    psicologas: planilhas
      .filter((p) => p.ativo || p.desligada)
      .map(
        (p, i): PsicologaLegado => ({
          id: p.id,
          nomeAbreviado: 'PSI ' + i,
          nomeCompleto: 'Profissional ' + i,
          pixKey: '',
          ultimaSincronizacao: '2026-10-03T00:00:00Z',
          ultimoErro: p.erro,
          linhas: p.linhas.map((l) => [l[0], l[13], l[18], l[11]] as PsicologaLegado['linhas'][number]),
        })
      ),
    exencoes: planilhas
      .filter((p) => p.cnpj !== undefined)
      .map((p) => [p.id, '12.345.678/0001-90', p.cnpj as CelulaLegado] as [CelulaLegado, CelulaLegado, CelulaLegado]),
  }
}

type LinhaMotor = {
  spreadsheet_id: string
  erro_sincronizacao: boolean
  tipo: 'PF' | 'CNPJ'
  qtd_ok: number
  qtd_pendencias: number
  total_bruto: number
  repasse_bruto: number
  base_inss: number
  inss: number
  liquido: number
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

// Cria o banco motor_diff com o stub do Supabase + migration_030 e roda
// os testes SQL (uma vez por execução, antes de qualquer comparação).
let preparado = false
function preparar() {
  if (preparado) return
  psql(['-d', 'postgres', '-c', 'drop database if exists motor_diff', '-c', 'create database motor_diff'])
  psql(['-d', 'motor_diff', '-f', join(__dirname, 'sql/stub_supabase_local.sql')])
  psql(['-d', 'motor_diff', '-f', join(RAIZ, 'supabase/migrations/20261003100000_migration_030_motor_financeiro.sql')])
  psql(['-d', 'motor_diff', '-f', join(RAIZ, 'supabase/migrations/20261003110000_migration_031_motor_desempenho.sql')])
  psql(['-d', 'motor_diff', '-f', join(RAIZ, 'supabase/migrations/20261003120000_migration_032_motor_resumo_ano.sql')])
  execFileSync(
    'psql',
    [...PG!.split(' ').filter(Boolean), '-v', 'ON_ERROR_STOP=1', '-d', 'motor_diff', '-f', join(RAIZ, 'supabase/tests/fin_motor_testes.sql')],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
  preparado = true
}

describe.skipIf(!PG)('motor financeiro (SQL) = RPA para meses até 09/2026', { timeout: 180_000 }, () => {
  beforeAll(preparar, 120_000)

  for (const semente of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`semente ${semente}: todos os meses e profissionais batem centavo por centavo`, () => {
      const planilhas = gerar(semente)
      const tenant = carregarNoBanco(planilhas)
      const base = baseLegado(planilhas)
      let comparados = 0
      for (let mes = 1; mes <= 9; mes++) {
        const json = psql([
          '-d', 'motor_diff', '-c',
          `select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.fin__fechamento_mes('${tenant}', make_date(2026, ${mes}, 1)) m`,
        ])
        const motor = JSON.parse(json) as LinhaMotor[]
        const { relatorioFinal } = processarRelatorio(base, MESES[mes - 1], 2026)
        expect(motor.length).toBe(relatorioFinal.length)
        for (const leg of relatorioFinal) {
          const m = motor.find((x) => x.spreadsheet_id === leg.id)!
          expect(m, leg.id).toBeDefined()
          if (leg.erro) {
            expect(m.erro_sincronizacao).toBe(true)
            continue
          }
          const ctx = `semente ${semente}, mês ${mes}, ${leg.id} :: ${JSON.stringify({ m, leg: { ...leg, pixKey: undefined } })}`
          expect(m.erro_sincronizacao, ctx).toBe(false)
          expect(m.tipo, ctx).toBe(leg.isIsenta ? 'CNPJ' : 'PF')
          expect(m.qtd_ok, ctx).toBe(leg.qtdPacientes)
          expect(m.qtd_pendencias, ctx).toBe(leg.qtdPendencias)
          expect(Number(m.total_bruto), ctx).toBe(r2(leg.totalFaturamento))
          expect(Number(m.liquido), ctx).toBe(leg.valorLiquido)
          if (!leg.isIsenta) {
            expect(Number(m.repasse_bruto), ctx).toBe(leg.repasseBruto)
            expect(Number(m.base_inss), ctx).toBe(leg.baseCalculoInss)
            expect(Number(m.inss), ctx).toBe(leg.retencaoInss)
          }
          comparados++
        }
      }
      expect(comparados).toBeGreaterThan(30)
    })
  }

  it('fechamento do período (ano) = soma dos meses, mês a mês', () => {
    const planilhas = gerar(3)
    const tenant = carregarNoBanco(planilhas)
    const periodo = JSON.parse(
      psql(['-d', 'motor_diff', '-c', `select coalesce(jsonb_agg(to_jsonb(f)), '[]') from public.fin__fechamento_periodo('${tenant}', '2026-01-01', '2026-12-01') f`])
    ) as (LinhaMotor & { competencia: string })[]
    for (let mes = 1; mes <= 12; mes++) {
      const comp = `2026-${String(mes).padStart(2, '0')}-01`
      const doMes = JSON.parse(
        psql(['-d', 'motor_diff', '-c', `select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.fin__fechamento_mes('${tenant}', '${comp}') m`])
      ) as LinhaMotor[]
      const doPeriodo = periodo.filter((x) => x.competencia === comp).map((x) => {
        const resto: Record<string, unknown> = { ...x }
        delete resto.competencia
        return resto
      })
      expect(doPeriodo, comp).toEqual(doMes)
    }
  })

  it('o caso que estoura o teto existe nos dados gerados (cobre INSS v1)', () => {
    const planilhas = gerar(1)
    const tenant = carregarNoBanco(planilhas)
    const json = psql([
      '-d', 'motor_diff', '-c',
      `select coalesce(jsonb_agg(to_jsonb(m)), '[]') from generate_series(1, 9) g(mes), public.fin__fechamento_mes('${tenant}', make_date(2026, g.mes, 1)) m where m.base_inss = 7786.02`,
    ])
    expect((JSON.parse(json) as unknown[]).length).toBeGreaterThan(0)
  })
})

describe.skipIf(!PG)('motor financeiro — regra nova a partir de 10/2026 (fechamento do mês)', { timeout: 60_000 }, () => {
  beforeAll(preparar, 120_000)
  it('Unimed 0025 trava R$ 33 / R$ 18, INSS v2, CNPJ sem INSS, setembro intacto, lançamento atrasado vai para outubro', () => {
    const d = (iso: string) => ({ $date: `${iso}T04:00:00` })
    const linha = (a: CelulaLegado, sessao: string, plano: string, cart: CelulaLegado, valor: CelulaLegado, st = 'OK') => {
      const l: CelulaLegado[] = new Array(20).fill('')
      l[0] = a
      l[3] = { $date: `${sessao}T00:00:00` }
      l[11] = cart
      l[12] = plano
      l[13] = valor
      l[18] = st
      return l
    }
    const planilhas: Planilha[] = [
      {
        id: 'planilha_pf_outubro_xxxxxxxxxxxxxxxx', ativo: true, desligada: false, erro: null, cnpj: undefined,
        linhas: [
          linha(d('2026-10-01'), '2026-10-01', 'UNIMED', '0025.0250.001387.30-7', 45), // N errado → 33 + alerta
          linha(d('2026-10-02'), '2026-09-30', 'UNIMED ', 25012345678901, 33), // sessão 30/09 lançada 02/10 → outubro
          linha(d('2026-10-03'), '2026-10-03', 'UNIMED', '0865000012', 45), // Unimed sem 0025 → normal
          linha(d('2026-10-04'), '2026-10-04', 'NÃO', '0025999', 45), // 0025 sem plano → normal + alerta cadastral
          linha(d('2026-10-05'), '2026-10-05', 'UNIMED', '0025123', 45, ''), // pendente (não entra)
          linha(d('2026-09-29'), '2026-09-29', 'UNIMED', '0025123', 45), // setembro: regra antiga
        ],
      },
      {
        id: 'planilha_cnpj_outubro_xxxxxxxxxxxxxx', ativo: true, desligada: false, erro: null, cnpj: 40,
        linhas: [
          linha(d('2026-10-01'), '2026-10-01', 'UNIMED', '0025123', 'R$ 45,00'),
          linha(d('2026-10-01'), '2026-10-01', 'BRADESCO', '0084800001', 45),
        ],
      },
    ]
    const tenant = carregarNoBanco(planilhas)
    const ler = (mes: number) =>
      JSON.parse(
        psql(['-d', 'motor_diff', '-c', `select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.fin__fechamento_mes('${tenant}', make_date(2026, ${mes}, 1)) m`])
      ) as (LinhaMotor & Record<string, unknown>)[]

    const out = ler(10)
    const pf = out.find((x) => x.spreadsheet_id.startsWith('planilha_pf'))!
    expect(pf.qtd_ok).toBe(4)
    expect(pf.qtd_unimed33).toBe(2)
    expect(Number(pf.total_bruto)).toBe(33 + 33 + 45 + 45)
    expect(Number(pf.repasse_bruto)).toBe(18 + 18 + 18 + 18)
    expect(Number(pf.inss)).toBe(7.92)
    expect(Number(pf.liquido)).toBe(64.08)
    expect(Number(pf.parcela_hope)).toBe(156 - 72)
    expect(pf.regra_inss).toBe('INSS_PF v2')
    // 2 = a linha OK com N=45 e a pendente com N=45 (divergência aparece mesmo sem OK)
    expect(pf.alertas).toMatchObject({ VALOR_PLANILHA_DIVERGENTE: 2, INCONSISTENCIA_CADASTRAL_PLANO: 1 })

    const cnpj = out.find((x) => x.spreadsheet_id.startsWith('planilha_cnpj'))!
    expect(cnpj.tipo).toBe('CNPJ')
    expect(Number(cnpj.total_bruto)).toBe(33 + 45)
    expect(Number(cnpj.repasse_bruto)).toBe(18 + 18)
    expect(Number(cnpj.inss)).toBe(0)
    expect(Number(cnpj.liquido)).toBe(36)
    expect(Number(cnpj.parcela_hope)).toBe(42)

    const set = ler(9).find((x) => x.spreadsheet_id.startsWith('planilha_pf'))!
    expect(set.qtd_ok).toBe(1)
    expect(Number(set.total_bruto)).toBe(45)
    expect(Number(set.repasse_bruto)).toBe(18)
    expect(set.regra_inss).toBe('INSS_PF v1')
  })
})

// garante que o arquivo da migration existe (útil sem Postgres local)
describe('migration_030', () => {
  it('não contém a palavra bloqueada pelo conector do Supabase', () => {
    const sql = readFileSync(join(RAIZ, 'supabase/migrations/20261003100000_migration_030_motor_financeiro.sql'), 'utf8')
    expect(/delete/i.test(sql)).toBe(false)
    const sql31 = readFileSync(join(RAIZ, 'supabase/migrations/20261003110000_migration_031_motor_desempenho.sql'), 'utf8')
    expect(/delete/i.test(sql31)).toBe(false)
  })
})
