import { Titulo } from '../financeiro/titulo'
import { BotaoSincronizar } from '../financeiro/sincronizar/botao-sincronizar'
import { carregarBi, lerFiltros } from '@/lib/bi/carregar'
import { dashboard, opcoesFiltro, type Kpi } from '@/lib/bi/bi'
import { BarraFiltros, GraficoLinhas } from './componentes'
import { AvisoSync } from './aviso-sync'
import s from '../financeiro/financeiro.module.css'
import b from './bi.module.css'

export const metadata = { title: 'Dashboard — HOPE CORE' }
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotMes = (k: string) => `${MES[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`
const int = (v: number) => v.toLocaleString('pt-BR')

function Variacao({ k, invertido = false }: { k: Kpi; invertido?: boolean }) {
  if (!k.anterior && !k.atual) return <span>sem variação</span>
  if (!k.anterior) return <span className={invertido ? b.desce : b.sobe}>novo no período</span>
  const v = (k.atual - k.anterior) / k.anterior
  const bom = invertido ? v <= 0 : v >= 0
  return (
    <span className={bom ? b.sobe : b.desce}>
      {v >= 0 ? '↑' : '↓'} {Math.abs(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
    </span>
  )
}

function Card({ rotulo, valor, k, invertido, href, nota }: { rotulo: string; valor: number; k?: Kpi; invertido?: boolean; href?: string; nota?: string }) {
  const corpo = (
    <>
      <div className={b.kpiRotulo}>{rotulo}</div>
      <div className={b.kpiValor}>{int(valor)}</div>
      <div className={b.kpiNota}>
        {k ? (
          <>
            <Variacao k={k} invertido={invertido} /> vs. período anterior ({int(k.anterior)})
          </>
        ) : (
          nota
        )}
      </div>
    </>
  )
  const title = k?.nota ?? nota
  return href ? (
    <a href={href} className={b.kpi} title={title}>
      {corpo}
    </a>
  ) : (
    <div className={b.kpi} title={title}>
      {corpo}
    </div>
  )
}

export default async function BiDashboard({ searchParams }: PageProps<'/bi'>) {
  const sp = await searchParams
  const f = lerFiltros(sp)
  const { erro, base, bruto } = await carregarBi()
  if (!base || !bruto) return <div className={s.alertBad}>Não foi possível carregar o BI: {erro}</div>

  const d = dashboard(base, f)
  const op = opcoesFiltro(base)
  const rot = d.evolucao.meses.map(rotMes)
  const periodoTxt = d.periodo === 1 ? 'mês atual' : `últimos ${d.periodo} meses`

  return (
    <div className={b.pagina}>
      <Titulo titulo="Visão geral da clínica">
        <strong>Os mesmos indicadores do Sistema Gerencial e BI, agora no HOPE CORE.</strong> Fonte: planilhas das psicólogas (abas
        Agenda, Cancelados e Atendimentos) e o Registro de Guias, espelhadas no banco de hora em hora (ou pelo botão Sincronizar). Novos
        pacientes contam pela data de início; quem só trocou de psicóloga (último atendimento há até 30 dias) não conta como novo.
        Cancelamentos não contam quem ainda está ativo em alguma agenda. Passe o mouse em cada cartão para ver a regra.
      </Titulo>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <BotaoSincronizar compacto />
      </div>
      <AvisoSync sync={bruto.sync} />
      <BarraFiltros opcoes={op} valores={f} campos={['periodo', 'psi', 'plano', 'cidade', 'faixa']} />

      <div className={b.kpis}>
        <Card rotulo="Pacientes ativos" valor={d.pacientesAtivos} nota="Pacientes diferentes na Agenda hoje" href="/bi/perfil" />
        <Card rotulo={`Novos ativos (${periodoTxt})`} valor={d.novosAtivos.atual} k={d.novosAtivos} />
        <Card rotulo={`Novos já cancelados (${periodoTxt})`} valor={d.novosCancelados.atual} k={d.novosCancelados} invertido />
        <Card rotulo={`Cancelamentos (${periodoTxt})`} valor={d.cancelamentos.atual} k={d.cancelamentos} invertido />
        <Card rotulo={`Faltas (${periodoTxt})`} valor={d.faltas.atual} k={d.faltas} invertido href="/bi/faltas" />
        <Card rotulo={`Atendimentos realizados (${periodoTxt})`} valor={d.atendimentos.atual} k={d.atendimentos} />
        <Card rotulo={`Guias não lançadas (${periodoTxt})`} valor={d.guiasNaoLancadas.atual} k={d.guiasNaoLancadas} invertido href="/financeiro/nao-lancadas" />
      </div>

      <div className={b.duas}>
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Atendimentos e faltas por mês</h2>
          <GraficoLinhas
            titulo="Atendimentos realizados e faltas por mês"
            rotulos={rot}
            series={[
              { nome: 'Atendimentos', valores: d.evolucao.atendimentos, cor: 's1' },
              { nome: 'Faltas', valores: d.evolucao.faltas, cor: 's2' },
            ]}
          />
        </section>
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Entradas e saídas de pacientes</h2>
          <GraficoLinhas
            titulo="Novos ativos, novos cancelados e cancelamentos por mês"
            rotulos={rot}
            series={[
              { nome: 'Novos ativos', valores: d.evolucao.novosAtivos, cor: 's1' },
              { nome: 'Novos cancelados', valores: d.evolucao.novosCancelados, cor: 's2' },
              { nome: 'Cancelamentos', valores: d.evolucao.cancelamentos, cor: 's3' },
            ]}
          />
        </section>
      </div>

      <div className={b.duas}>
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Ranking — pacientes ativos</h2>
          <div className={s.tableWrap}>
            <table className={b.tabela}>
              <thead>
                <tr>
                  <th>#</th>
                  <th className={b.esq}>Psicóloga</th>
                  <th>Ativos</th>
                  <th>% do total</th>
                </tr>
              </thead>
              <tbody>
                {d.rankingAtivos.map((r, i) => (
                  <tr key={r.sid}>
                    <td>{i + 1}</td>
                    <td className={b.esq}>
                      <a href={`?psi=${r.sid}`}>{r.psicologa}</a>
                    </td>
                    <td>{int(r.ativos)}</td>
                    <td>{r.pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Cancelamentos por psicóloga ({periodoTxt})</h2>
          <div className={s.tableWrap}>
            <table className={b.tabela}>
              <thead>
                <tr>
                  <th>#</th>
                  <th className={b.esq}>Psicóloga</th>
                  <th>Cancelamentos</th>
                  <th>Taxa</th>
                </tr>
              </thead>
              <tbody>
                {d.rankingCancel.map((r, i) => {
                  const ativos = d.rankingAtivos.find((x) => x.sid === r.sid)?.ativos ?? 0
                  return (
                    <tr key={r.sid}>
                      <td>{i + 1}</td>
                      <td className={b.esq}>{r.psicologa}</td>
                      <td>{int(r.cancelamentos)}</td>
                      <td title="Cancelamentos ÷ (ativos + cancelamentos)">
                        {r.cancelamentos + ativos ? `${((r.cancelamentos / (r.cancelamentos + ativos)) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
