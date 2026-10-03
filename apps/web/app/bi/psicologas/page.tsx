import { Titulo } from '../../financeiro/titulo'
import { carregarBi, lerFiltros } from '@/lib/bi/carregar'
import { opcoesFiltro, psicologas } from '@/lib/bi/bi'
import { BarraFiltros } from '../componentes'
import { AvisoSync } from '../aviso-sync'
import { motorCentralAtivo, type FechamentoMotor } from '@/lib/financeiro/motor'
import { createFinanceClient } from '@/lib/financeiro/server'
import s from '../../financeiro/financeiro.module.css'
import b from '../bi.module.css'

export const metadata = { title: 'Psicólogas — HOPE CORE' }
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const int = (v: number) => v.toLocaleString('pt-BR')

export default async function BiPsicologas({ searchParams }: PageProps<'/bi/psicologas'>) {
  const f = lerFiltros(await searchParams)
  const { erro, base, bruto } = await carregarBi()
  if (!base || !bruto) return <div className={s.alertBad}>Não foi possível carregar: {erro}</div>
  const r = psicologas(base, f)
  // FIN_MOTOR=central → faturado, repasse e Parcela Bruta Hope vêm do motor
  // financeiro central (a partir de 10/2026 não existe 40/60 universal).
  const central = motorCentralAtivo()
  if (central) {
    const supabase = await createFinanceClient()
    const { data } = await supabase.rpc('fin_fechamento_mes', { p_ano: Number(r.mes.slice(0, 4)), p_mes: Number(r.mes.slice(5, 7)) })
    const porId = new Map(((data as unknown as FechamentoMotor | null)?.profissionais ?? []).map((m) => [m.spreadsheet_id, m]))
    if (porId.size) {
      for (const l of r.linhas) {
        const m = porId.get(l.sid)
        l.faturadoNoMes = m ? Number(m.total_bruto) : 0
        l.faturado40 = m ? Number(m.repasse_bruto) : 0
        l.faturado60 = m ? Number(m.parcela_hope) : 0
      }
      const somar = (k: 'faturadoNoMes' | 'faturado40' | 'faturado60') =>
        Math.round(r.linhas.reduce((t, l) => t + l[k], 0) * 100) / 100
      r.totais.faturadoNoMes = somar('faturadoNoMes')
      r.totais.faturado40 = somar('faturado40')
      r.totais.faturado60 = somar('faturado60')
    }
  }
  const mesNome = `${MESES[Number(r.mes.slice(5, 7)) - 1]}/${r.mes.slice(0, 4)}`

  return (
    <div className={b.pagina}>
      <Titulo titulo="Psicólogas">
        <strong>Pacientes, horas livres e faturamento de cada psicóloga em {mesNome}.</strong> Pacientes = pessoas diferentes na Agenda.
        Horas livres = horários 💚 na Agenda. Atendimentos e faturamento projetados = quantas vezes o dia da semana de cada paciente cai no
        mês (desde a data de início; Bradesco 2 por semana) × valor da coluna H da Agenda (Sublocação/Particular = R$ 31,90), incluindo quem
        cancelou dentro do mês até a data do cancelamento. Faturado no mês = sessões com status OK na coluna S da aba Atendimentos (mesma
        regra do RPA), dividido 40% psicóloga / 60% clínica (valor bruto, sem INSS).
      </Titulo>
      <AvisoSync sync={bruto.sync} />
      <BarraFiltros opcoes={opcoesFiltro(base)} valores={f} campos={['psi', 'plano', 'cidade', 'faixa']} />
      <section className={s.section}>
        <h2 className={s.sectionTitle}>Pacientes, horas livres e faturamento — {mesNome}</h2>
        <div className={s.tableWrap}>
          <table className={b.tabela}>
            <thead>
              <tr>
                <th>#</th>
                <th className={b.esq}>Psicóloga</th>
                <th>Pacientes</th>
                <th>Horas livres</th>
                <th>Atend. no mês</th>
                <th>Faturamento projetado</th>
                <th>Faturado no mês</th>
                <th>{central ? 'Repasse bruto profissional' : '40% psicóloga'}</th>
                <th>{central ? 'Parcela Bruta Hope' : '60% clínica'}</th>
              </tr>
            </thead>
            <tbody>
              {r.linhas.map((l, i) => (
                <tr key={l.sid}>
                  <td>{i + 1}</td>
                  <td className={b.esq}>{l.psicologa}</td>
                  <td>{int(l.pacientes)}</td>
                  <td>{int(l.horasLivres)}</td>
                  <td>{int(l.atendimentosNoMes)}</td>
                  <td>{brl(l.faturamentoProjetado)}</td>
                  <td>{brl(l.faturadoNoMes)}</td>
                  <td>{brl(l.faturado40)}</td>
                  <td>{brl(l.faturado60)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td className={b.esq}>Total</td>
                <td>{int(r.totais.pacientes)}</td>
                <td>{int(r.totais.horasLivres)}</td>
                <td>{int(r.totais.atendimentosNoMes)}</td>
                <td>{brl(r.totais.faturamentoProjetado)}</td>
                <td>{brl(r.totais.faturadoNoMes)}</td>
                <td>{brl(r.totais.faturado40)}</td>
                <td>{brl(r.totais.faturado60)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {!r.linhas.length && <p className={s.muted}>Nenhuma psicóloga com pacientes na Agenda para esses filtros.</p>}
      </section>
    </div>
  )
}
