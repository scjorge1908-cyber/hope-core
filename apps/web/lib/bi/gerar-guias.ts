// ================================================================
// Gerar guias — guias previstas × já geradas, por semana (porte do
// Guiasprevistassemanais.gs). Regras:
//   • semanas de segunda a sábado; a última vai até o fim do mês (máx. 5)
//   • Particular e Sublocação ficam de fora
//   • Bradesco: 2 guias por atendimento na semana; Select: 1 guia no mês
//     (na primeira semana com atendimento); demais: 1 por atendimento
//   • só conta a partir da data de início do paciente
//   • gerado = guias válidas na BD_GUIAS (S1..S5, 2 por semana)
// ================================================================
import { indiceDia, normalizar } from './bi'

type N = number | string | null | undefined
export type GerarGuiasBase = {
  hoje: string
  psicologas: [string, string, string | null][] // sid, nome, nome completo
  agenda: [string, string, string | null, string | null, string | null][] // sid, paciente, plano, dia, inicio
  bd: [string, string, N, N, string[]][] // psicóloga, paciente, mês, ano, S1G1..S5G2
  bdSincronizado: string | null
}

export type Ciclo = { numero: number; inicio: string; fim: string }
const DIA = 86_400_000
const tD = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

export function ciclosSemanais(mes: number, ano: number): Ciclo[] {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  const fimMes = Date.UTC(ano, mes - 1, ultimo)
  const ciclos: Ciclo[] = []
  let cursor = Date.UTC(ano, mes - 1, 1)
  let numero = 1
  while (new Date(cursor).getUTCMonth() === mes - 1 && numero <= 5) {
    const dow = new Date(cursor).getUTCDay()
    const fimNatural = cursor + ((6 - dow + 7) % 7) * DIA
    let fim = fimNatural
    let ultimoCiclo = false
    if (new Date(fimNatural).getUTCMonth() !== mes - 1 || new Date(fimNatural).getUTCDate() >= ultimo) {
      fim = fimMes
      ultimoCiclo = true
    }
    ciclos.push({ numero, inicio: iso(cursor), fim: iso(fim) })
    if (ultimoCiclo) break
    cursor = fim + 2 * DIA
    numero++
  }
  if (ciclos.length && tD(ciclos[ciclos.length - 1].fim) < fimMes) ciclos[ciclos.length - 1].fim = iso(fimMes)
  return ciclos
}

export function numeroGuiaLimpo(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  if (/^[0-9]{7,}$/.test(s)) return s
  const m = s.match(/[0-9]{7,}/)
  return m ? m[0] : null
}

export type ClassePlano = 'EXCLUIDO' | 'BRADESCO' | 'SELECT' | 'PADRAO' | 'VAZIO'
export function classificarPlano(plano: string | null): ClassePlano {
  const n = normalizar(plano)
  if (!n) return 'VAZIO'
  if (n.includes('particular') || n.includes('sublocacao')) return 'EXCLUIDO'
  if (n.includes('bradesco')) return 'BRADESCO'
  if (n.includes('select')) return 'SELECT'
  return 'PADRAO'
}

export type DetalhePaciente = { paciente: string; plano: string; previsto: number; gerado: number; falta: number; limitePlanilha: boolean }
export type LinhaSemana = { sid: string; psicologa: string; previsto: number; gerado: number; falta: number; detalhe: DetalhePaciente[] }

export function gerarGuias(base: GerarGuiasBase, mes: number, ano: number) {
  const ciclos = ciclosSemanais(mes, ano)
  const nomes = new Map(base.psicologas.map((p) => [p[0], p[1]]))
  const sidPorNome: Record<string, string> = {}
  for (const p of base.psicologas) {
    if (p[1]) sidPorNome[normalizar(p[1])] = p[0]
    if (p[2]) sidPorNome[normalizar(p[2])] = p[0]
  }

  // gerado (BD_GUIAS) por psicóloga|paciente e semana
  const gerado: Record<string, number[]> = {}
  for (const r of base.bd) {
    if (parseInt(String(r[2]), 10) !== mes || parseInt(String(r[3]), 10) !== ano) continue
    if (!r[0] || !r[1]) continue
    const psi = sidPorNome[normalizar(r[0])] ?? `nome:${normalizar(r[0])}`
    const k = `${psi}|${normalizar(r[1])}`
    const acc = (gerado[k] ??= [0, 0, 0, 0, 0])
    for (let s = 0; s < 5; s++) {
      if (numeroGuiaLimpo(r[4]?.[s * 2])) acc[s]++
      if (numeroGuiaLimpo(r[4]?.[s * 2 + 1])) acc[s]++
    }
  }

  // previstos por psicóloga → semana → paciente
  type Prev = { paciente: string; plano: string; previsto: number }
  const prev: Record<string, Record<number, Record<string, Prev>>> = {}
  const avisos: string[] = []
  const selectContado = new Set<string>()
  const entrada = (sid: string, semana: number, paciente: string, plano: string) => {
    const k = normalizar(paciente)
    return (((prev[sid] ??= {})[semana] ??= {})[k] ??= { paciente, plano, previsto: 0 })
  }
  for (const [sid, paciente, plano, dia, inicio] of base.agenda) {
    const classe = classificarPlano(plano)
    if (classe === 'EXCLUIDO' || classe === 'VAZIO' || !paciente) continue
    const idx = indiceDia(dia)
    if (idx === null) {
      avisos.push(`Dia da semana não reconhecido ("${dia ?? ''}") — ${nomes.get(sid) ?? sid}.`)
      continue
    }
    const ocorre = (c: Ciclo) => {
      const offset = (idx - new Date(tD(c.inicio)).getUTCDay() + 7) % 7
      const data = iso(tD(c.inicio) + offset * DIA)
      if (data > c.fim) return null
      if (inicio && data < inicio) return null
      return data
    }
    if (classe === 'SELECT') {
      const chave = `${sid}|${normalizar(paciente)}`
      if (selectContado.has(chave)) continue
      for (const c of ciclos) {
        if (!ocorre(c)) continue
        entrada(sid, c.numero, paciente, 'Select').previsto += 1
        selectContado.add(chave)
        break
      }
      continue
    }
    const inc = classe === 'BRADESCO' ? 2 : 1
    const rotulo = classe === 'BRADESCO' ? 'Bradesco' : String(plano ?? '').trim()
    for (const c of ciclos) if (ocorre(c)) entrada(sid, c.numero, paciente, rotulo).previsto += inc
  }

  const semanas = ciclos.map((c) => {
    const linhas: LinhaSemana[] = Object.entries(prev)
      .filter(([, porSemana]) => porSemana[c.numero])
      .map(([sid, porSemana]) => {
        const detalhe: DetalhePaciente[] = Object.entries(porSemana[c.numero]).map(([kPac, p]) => {
          const g = gerado[`${sid}|${kPac}`]?.[c.numero - 1] ?? 0
          return { paciente: p.paciente, plano: p.plano, previsto: p.previsto, gerado: g, falta: Math.max(0, p.previsto - g), limitePlanilha: p.previsto > 2 }
        })
        detalhe.sort((a, b) => b.falta - a.falta || a.paciente.localeCompare(b.paciente, 'pt-BR'))
        return {
          sid,
          psicologa: nomes.get(sid) ?? sid,
          previsto: detalhe.reduce((t, d) => t + d.previsto, 0),
          gerado: detalhe.reduce((t, d) => t + d.gerado, 0),
          falta: detalhe.reduce((t, d) => t + d.falta, 0),
          detalhe,
        }
      })
      .sort((a, b) => a.psicologa.localeCompare(b.psicologa, 'pt-BR'))
    return { ...c, linhas }
  })
  return { semanas, avisos: [...new Set(avisos)] }
}
