import { Titulo } from '../../financeiro/titulo'
import { carregarBi, lerFiltros } from '@/lib/bi/carregar'
import { opcoesFiltro, perfil } from '@/lib/bi/bi'
import { BarraFiltros, Barras } from '../componentes'
import { AvisoSync } from '../aviso-sync'
import s from '../../financeiro/financeiro.module.css'
import b from '../bi.module.css'

export const metadata = { title: 'Perfil dos pacientes — HOPE CORE' }
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export default async function BiPerfil({ searchParams }: PageProps<'/bi/perfil'>) {
  const sp = await searchParams
  const f = lerFiltros(sp)
  const cidadeBairro = typeof sp.bairros === 'string' ? sp.bairros : ''
  const { erro, base, bruto } = await carregarBi()
  if (!base || !bruto) return <div className={s.alertBad}>Não foi possível carregar: {erro}</div>
  const r = perfil(base, f)
  const bairros = cidadeBairro ? (r.porBairroPorCidade[cidadeBairro] ?? []) : r.porBairro
  const cidades = r.porCidade.map((c) => c.rotulo)

  return (
    <div className={b.pagina}>
      <Titulo titulo="Perfil dos pacientes">
        <strong>Quem são os pacientes ativos hoje.</strong> Cada paciente conta uma vez (mesmo que esteja com duas psicólogas), pelos dados
        da Agenda: idade pela data de nascimento, cidade sem a sigla do estado (“Palhoça - SC” = “Palhoça”) e bairro como está escrito.
      </Titulo>
      <AvisoSync sync={bruto.sync} />
      <BarraFiltros opcoes={opcoesFiltro(base)} valores={f} campos={['psi', 'plano', 'cidade', 'faixa']} />
      <div className={b.kpis}>
        <div className={b.kpi}>
          <div className={b.kpiRotulo}>Total de pacientes ativos</div>
          <div className={b.kpiValor}>{r.total.toLocaleString('pt-BR')}</div>
          <div className={b.kpiNota}>pacientes diferentes</div>
        </div>
      </div>
      <div className={b.duas}>
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Por faixa etária</h2>
          <Barras itens={r.porFaixa.map((x) => ({ rotulo: x.rotulo, valor: x.quantidade }))} />
        </section>
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Por cidade</h2>
          <Barras itens={r.porCidade.map((x) => ({ rotulo: x.rotulo, valor: x.quantidade }))} />
        </section>
      </div>
      <section className={s.section}>
        <h2 className={s.sectionTitle}>Por bairro {cidadeBairro ? `— ${cidadeBairro}` : '(todas as cidades)'}</h2>
        <form className={b.filtros} style={{ marginTop: 0 }}>
          {Object.entries({ psi: f.psi, plano: f.plano, cidade: f.cidade, faixa: f.faixa }).map(([k, v]) =>
            v ? <input key={k} type="hidden" name={k} value={v} /> : null,
          )}
          <label>
            Ver bairros de
            <select name="bairros" defaultValue={cidadeBairro}>
              <option value="">Todas as cidades</option>
              {cidades.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={s.buttonSmall}>
            Ver
          </button>
        </form>
        <Barras itens={bairros.map((x) => ({ rotulo: x.rotulo, valor: x.quantidade }))} limite={15} />
      </section>
    </div>
  )
}
