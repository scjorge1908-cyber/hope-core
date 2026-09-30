import { Titulo } from '../../financeiro/titulo'
import { carregarBi } from '@/lib/bi/carregar'
import { celulaLivre, ocupacaoSalas, PERIODOS, resumoSalas, turnoDe } from '@/lib/bi/bi'
import s from '../../financeiro/financeiro.module.css'
import b from '../bi.module.css'

export const metadata = { title: 'Agendamento de salas — HOPE CORE' }
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const pct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export default async function BiSalas({ searchParams }: PageProps<'/bi/salas'>) {
  const sp = await searchParams
  const fDia = um(sp.dia)
  const fTurno = um(sp.turno)
  const fPsi = um(sp.psi).trim()
  const { erro, bruto } = await carregarBi()
  if (!bruto) return <div className={s.alertBad}>Não foi possível carregar: {erro}</div>

  const { cabecalho, linhas, sincronizadoEm } = bruto.salas
  const urlApps = process.env.HOPE_BI_URL ? `${process.env.HOPE_BI_URL}?page=salas` : null
  if (!linhas.length) {
    return (
      <div className={b.pagina}>
        <Titulo titulo="Agendamento de salas" />
        <div className={b.aviso}>
          <strong>A grade de salas ainda não chegou ao HOPE CORE.</strong> No projeto Apps Script <b>Calculo RPA</b>: em Propriedades do
          script, crie <code>SALAS_SPREADSHEET_ID</code> com o ID da planilha de Salas, atualize o <code>SyncSupabase.gs</code> e rode{' '}
          <code>testarAgendaSalasSupabase</code>. Depois disso a grade é atualizada junto com a sincronização das planilhas.
        </div>
        {urlApps && <iframe src={urlApps} title="Gestão de Salas — Apps Script" className={b.iframe} />}
      </div>
    )
  }

  const salas = cabecalho.slice(2)
  const dias = [...new Set(linhas.map((l) => String(l[0] ?? '').trim()).filter(Boolean))]
  const visiveis = linhas.filter((l) => {
    if (fDia && String(l[0]).trim() !== fDia) return false
    if (fTurno && turnoDe(l[1]) !== fTurno) return false
    if (fPsi && !l.slice(2).some((c) => String(c ?? '').toUpperCase().includes(fPsi.toUpperCase()))) return false
    return true
  })
  const nomes = [...new Set(linhas.flatMap((l) => l.slice(2)).flatMap((c) => String(c ?? '').split('/')).map((x) => x.trim()).filter((x) => x && !celulaLivre(x)))].sort((a, c) =>
    a.localeCompare(c, 'pt-BR'),
  )
  const resumo = resumoSalas(cabecalho, linhas)
  const oc = ocupacaoSalas(cabecalho, linhas)

  return (
    <div className={b.pagina}>
      <Titulo titulo="Agendamento de salas">
        <strong>Grade de ocupação das salas (aba Painel da planilha de Salas).</strong> Cada célula mostra a psicóloga que usa a sala no
        horário; “/” = duas psicólogas no mesmo horário (conflito). O resumo da semana considera um período livre só se a sala estiver livre
        em todos os horários do período. Para sincronizar as agendas das psicólogas com a grade ou gerar os PDFs, use a gestão de salas do
        Apps Script (abaixo).
      </Titulo>
      <p style={{ fontSize: 12, color: 'var(--fin-muted)', margin: '0 0 14px' }}>Grade atualizada em {quando(sincronizadoEm)}.</p>

      <div className={b.kpis}>
        <div className={b.kpi}>
          <div className={b.kpiRotulo}>Ocupação da grade</div>
          <div className={b.kpiValor}>{pct(oc.taxa)}</div>
          <div className={b.kpiNota}>
            {oc.ocupados.toLocaleString('pt-BR')} de {oc.total.toLocaleString('pt-BR')} horários de sala
          </div>
        </div>
        {(['manha', 'tarde', 'noite'] as const).map((t) => (
          <div key={t} className={b.kpi}>
            <div className={b.kpiRotulo}>{t === 'manha' ? 'Manhã' : t === 'tarde' ? 'Tarde' : 'Noite'}</div>
            <div className={b.kpiValor}>{pct(oc.porTurno[t].total ? oc.porTurno[t].ocupados / oc.porTurno[t].total : 0)}</div>
            <div className={b.kpiNota}>{(oc.porTurno[t].total - oc.porTurno[t].ocupados).toLocaleString('pt-BR')} horários livres</div>
          </div>
        ))}
        <div className={b.kpi}>
          <div className={b.kpiRotulo}>Conflitos</div>
          <div className={b.kpiValor}>{oc.conflitos}</div>
          <div className={b.kpiNota}>horários com duas psicólogas na mesma sala</div>
        </div>
      </div>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Resumo de disponibilidade da semana</h2>
        <div className={s.tableWrap}>
          <table className={b.grade5}>
            <thead>
              <tr>
                <th>Período</th>
                {resumo.dias.map((d) => (
                  <th key={d}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERIODOS.map((p) => (
                <tr key={p.nome}>
                  <td className={b.hora}>
                    {p.nome}
                    <br />
                    <small>{p.faixa}</small>
                  </td>
                  {resumo.dias.map((d) => {
                    const c = resumo.matriz[d][p.nome]
                    return (
                      <td key={d} className={b[c.status]}>
                        {c.status === 'fechado' ? 'Fechado' : c.status === 'indisponivel' ? 'Indisponível' : (
                          <span className={b.chips}>
                            {c.livres.map((x) => (
                              <span key={x} className={b.chip}>
                                {x.replace(/^sala\s*/i, '')}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Grade de horários</h2>
        <form className={b.filtros}>
          <label>
            Dia
            <select name="dia" defaultValue={fDia}>
              <option value="">Todos os dias</option>
              {dias.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Turno
            <select name="turno" defaultValue={fTurno}>
              <option value="">Todos os turnos</option>
              <option value="manha">Manhã (07h - 12h)</option>
              <option value="tarde">Tarde (13h - 17h)</option>
              <option value="noite">Noite (18h - 21h)</option>
            </select>
          </label>
          <label>
            Psicóloga
            <select name="psi" defaultValue={fPsi}>
              <option value="">Todas</option>
              {nomes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={s.buttonSmall}>
            Filtrar
          </button>
          <a href="?" className={b.limpar}>
            Limpar
          </a>
        </form>
        <div className={s.tableWrap}>
          <table className={b.grade5}>
            <thead>
              <tr>
                <th>Dia</th>
                <th>Horário</th>
                {salas.map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l, i) => (
                <tr key={i}>
                  <td className={b.hora}>{l[0]}</td>
                  <td className={b.hora}>{l[1]}</td>
                  {salas.map((_, k) => {
                    const v = String(l[k + 2] ?? '').trim()
                    const livre = celulaLivre(v)
                    return (
                      <td key={k} className={livre ? b.livre : v.includes('/') ? b.conflito : b.ocupado}>
                        {livre ? 'LIVRE' : v}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {urlApps && (
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Gestão de salas (Apps Script) — sincronizar agendas, PDF e relatório</h2>
          <iframe src={urlApps} title="Gestão de Salas — Apps Script" className={b.iframe} />
        </section>
      )}
    </div>
  )
}
