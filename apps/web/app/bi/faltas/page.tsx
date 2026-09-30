import { Titulo } from '../../financeiro/titulo'
import { carregarBi, lerFiltros } from '@/lib/bi/carregar'
import { faltas, opcoesFiltro } from '@/lib/bi/bi'
import { BarraFiltros, Barras, GraficoLinhas } from '../componentes'
import { AvisoSync } from '../aviso-sync'
import s from '../../financeiro/financeiro.module.css'
import b from '../bi.module.css'

export const metadata = { title: 'Faltas — HOPE CORE' }
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotMes = (k: string) => `${MES[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`
const pct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

export default async function BiFaltas({ searchParams }: PageProps<'/bi/faltas'>) {
  const f = lerFiltros(await searchParams)
  const { erro, base, bruto } = await carregarBi()
  if (!base || !bruto) return <div className={s.alertBad}>Não foi possível carregar: {erro}</div>
  const r = faltas(base, f, 6)
  const ultimo = r.porMes[r.porMes.length - 1]
  const penultimo = r.porMes[r.porMes.length - 2]

  return (
    <div className={b.pagina}>
      <Titulo titulo="Faltas">
        <strong>Faltas lançadas pelas psicólogas na aba Atendimentos.</strong> Falta = qualquer tipo de atendimento (coluna G) diferente de
        “Sessão realizada”, contado pela data da sessão. Taxa = faltas ÷ (faltas + sessões realizadas). O mês atual ainda está em
        andamento e as psicólogas lançam com alguns dias de atraso.
      </Titulo>
      <AvisoSync sync={bruto.sync} precisaAgenda={false} />
      <BarraFiltros opcoes={opcoesFiltro(base)} valores={f} campos={['psi']} />
      <div className={b.kpis}>
        <div className={b.kpi}>
          <div className={b.kpiRotulo}>Faltas em {rotMes(ultimo.mes)} (parcial)</div>
          <div className={b.kpiValor}>{ultimo.faltas.toLocaleString('pt-BR')}</div>
          <div className={b.kpiNota}>taxa {pct(ultimo.taxa)} das sessões marcadas</div>
        </div>
        {penultimo && (
          <div className={b.kpi}>
            <div className={b.kpiRotulo}>Faltas em {rotMes(penultimo.mes)}</div>
            <div className={b.kpiValor}>{penultimo.faltas.toLocaleString('pt-BR')}</div>
            <div className={b.kpiNota}>taxa {pct(penultimo.taxa)} das sessões marcadas</div>
          </div>
        )}
      </div>
      <section className={s.section}>
        <h2 className={s.sectionTitle}>Faltas e sessões realizadas — últimos 6 meses</h2>
        <GraficoLinhas
          titulo="Faltas e sessões realizadas por mês"
          rotulos={r.porMes.map((m) => rotMes(m.mes))}
          series={[
            { nome: 'Realizadas', valores: r.porMes.map((m) => m.realizadas), cor: 's1' },
            { nome: 'Faltas', valores: r.porMes.map((m) => m.faltas), cor: 's2' },
          ]}
        />
      </section>
      <div className={b.duas}>
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Taxa de faltas por psicóloga (6 meses)</h2>
          <Barras
            formato="pct"
            itens={r.porPsicologa
              .filter((x) => x.faltas + x.realizadas >= 10)
              .sort((a, c) => c.taxa - a.taxa)
              .map((x) => ({ rotulo: x.psicologa, valor: x.taxa, dica: `${x.psicologa}: ${x.faltas} faltas em ${x.faltas + x.realizadas} sessões marcadas` }))}
          />
        </section>
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Taxa de faltas por dia da semana</h2>
          <Barras
            formato="pct"
            itens={r.porDia.map((x) => ({ rotulo: x.dia, valor: x.taxa, dica: `${x.dia}: ${x.faltas} faltas em ${x.faltas + x.realizadas} sessões marcadas` }))}
          />
        </section>
      </div>
    </div>
  )
}
