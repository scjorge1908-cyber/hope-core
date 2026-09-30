import { Titulo } from '../../financeiro/titulo'
import { carregarBi, lerFiltros } from '@/lib/bi/carregar'
import { opcoesFiltro, planos } from '@/lib/bi/bi'
import { BarraFiltros, Barras } from '../componentes'
import { AvisoSync } from '../aviso-sync'
import s from '../../financeiro/financeiro.module.css'
import b from '../bi.module.css'

export const metadata = { title: 'Planos — HOPE CORE' }
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const int = (v: number) => v.toLocaleString('pt-BR')

export default async function BiPlanos({ searchParams }: PageProps<'/bi/planos'>) {
  const f = lerFiltros(await searchParams)
  const { erro, base, bruto } = await carregarBi()
  if (!base || !bruto) return <div className={s.alertBad}>Não foi possível carregar: {erro}</div>
  const r = planos(base, f)
  const mesNome = `${MESES[Number(r.mes.slice(5, 7)) - 1]}/${r.mes.slice(0, 4)}`

  return (
    <div className={b.pagina}>
      <Titulo titulo="Planos">
        <strong>Pacientes por plano e projeção de faturamento de {mesNome}.</strong> Projeção = vezes que o dia da semana de cada paciente
        cai no mês (desde a data de início; Bradesco 2 atendimentos por semana) × valor da tabela da curva de venda (Unimed R$ 33, Bradesco
        R$ 45, Select R$ 80, Geap e Celos R$ 60; Sublocação/Particular R$ 31,90; demais planos pelo valor da coluna H da Agenda). Quem
        cancelou dentro do mês conta até a data do cancelamento. A produção real (sessões OK) está em Psicólogas e em RPA/Repasse.
      </Titulo>
      <AvisoSync sync={bruto.sync} />
      <BarraFiltros opcoes={opcoesFiltro(base)} valores={f} campos={['psi', 'cidade', 'faixa']} />

      <div className={b.kpis}>
        <div className={b.kpi}>
          <div className={b.kpiRotulo}>Pacientes ativos (todos os planos)</div>
          <div className={b.kpiValor}>{int(r.totalPacientes)}</div>
          <div className={b.kpiNota}>soma por plano (quem tem 2 planos conta 2 vezes)</div>
        </div>
        <div className={b.kpi}>
          <div className={b.kpiRotulo}>Faturamento projetado — {mesNome}</div>
          <div className={b.kpiValor}>{brl(r.totalFaturamento)}</div>
          <div className={b.kpiNota}>{int(r.totalAtendimentos)} atendimentos previstos na agenda</div>
        </div>
      </div>

      <div className={b.duas}>
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Pacientes por plano</h2>
          <Barras itens={r.pacientesPorPlano.map((p) => ({ rotulo: p.plano, valor: p.pacientes }))} />
        </section>
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Projeção de faturamento por plano — {mesNome}</h2>
          <div className={s.tableWrap}>
            <table className={b.tabela}>
              <thead>
                <tr>
                  <th>#</th>
                  <th className={b.esq}>Plano</th>
                  <th>Atend. no mês</th>
                  <th>Faturamento</th>
                </tr>
              </thead>
              <tbody>
                {r.projecaoPorPlano.map((p, i) => (
                  <tr key={p.plano}>
                    <td>{i + 1}</td>
                    <td className={b.esq}>{p.plano}</td>
                    <td>{int(p.atendimentos)}</td>
                    <td>{brl(p.faturamento)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td className={b.esq}>Total</td>
                  <td>{int(r.totalAtendimentos)}</td>
                  <td>{brl(r.totalFaturamento)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
