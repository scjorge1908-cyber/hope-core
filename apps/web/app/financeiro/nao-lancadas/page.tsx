import { Titulo } from '../titulo'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { dataBR, int } from '@/lib/financeiro/format'
import {
  agruparAdmSemSessao,
  agruparNaoLancadas,
  type LinhaAdmSemSessao,
  type LinhaConferencia,
  type PsicologaNaoLancada,
} from '@/lib/financeiro/conferencia'
import { hojeSaoPaulo } from '@/lib/financeiro/agenda'
import { BotaoImprimir } from '../repasse/botao-imprimir'
import { BotaoSincronizar } from '../sincronizar/botao-sincronizar'
import s from '../financeiro.module.css'
import n from './nao-lancadas.module.css'

export const metadata = { title: 'Guias não lançadas — HOPE CORE' }
export const maxDuration = 60

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MES_RE = /^(\d{4})-(\d{2})$/

function lerMes(v: unknown, padrao: string) {
  const m = MES_RE.exec(String(v ?? ''))
  if (!m) return padrao
  const mm = Math.min(Math.max(Number(m[2]), 1), 12)
  return `${m[1]}-${String(mm).padStart(2, '0')}`
}

function somarMes(ym: string, k: number) {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + k, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const rotuloMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`
const ultimoDia = (ym: string) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0))
  return d.toISOString().slice(0, 10)
}
const quando = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export default async function NaoLancadasPage({ searchParams }: PageProps<'/financeiro/nao-lancadas'>) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return null

  const sp = await searchParams
  const atual = hojeSaoPaulo().slice(0, 7)
  let de = lerMes(sp.de, somarMes(atual, -2))
  let ate = lerMes(sp.ate, atual)
  if (de > ate) [de, ate] = [ate, de]
  // no máximo 12 meses por consulta
  if (somarMes(de, 11) < ate) de = somarMes(ate, -11)
  const psiFiltro = typeof sp.psi === 'string' ? sp.psi : ''
  const incluirSemGuia = sp.semguia !== '0'
  // adm (padrão): guia no ADM Registro de Guia sem sessão na aba Atendimentos
  // planilha: sessão na aba Atendimentos cuja guia não está no ADM
  const modo: 'adm' | 'planilha' = sp.modo === 'planilha' ? 'planilha' : 'adm'

  const [{ data: syncStatus }, { data: nomesPlanilhas }] = await Promise.all([
    supabase.rpc('legacy_sync_status'),
    supabase.rpc('legacy_planilhas_nomes'),
  ])
  const lidaEm = new Map((syncStatus ?? []).map((x) => [x.spreadsheet_id, x.ultima_sincronizacao]))

  let todas: PsicologaNaoLancada[] = []
  let erro: { message: string } | null = null
  let nomesPsi: string[] = []

  if (modo === 'adm') {
    const { data, error } = await supabase.rpc('guias_adm_sem_sessao', { p_de: `${de}-01`, p_ate: ultimoDia(ate) })
    erro = error
    const linhas = (data ?? []) as LinhaAdmSemSessao[]
    todas = agruparAdmSemSessao(linhas)
    nomesPsi = [
      ...new Set([
        ...linhas.map((l) => l.psicologa),
        ...(nomesPlanilhas ?? []).filter((p) => !p.desligada && p.nome_abreviado).map((p) => String(p.nome_abreviado)),
      ]),
    ]
  } else {
    const meses: string[] = []
    for (let m = de; m <= ate; m = somarMes(m, 1)) meses.push(m)
    const respostas = await Promise.all(
      meses.map((m) => supabase.rpc('conferencia_guias', { p_ano: Number(m.slice(0, 4)), p_mes: Number(m.slice(5, 7)) }))
    )
    erro = respostas.find((r) => r.error)?.error ?? null
    const linhas = respostas.flatMap((r) => (r.data ?? []) as LinhaConferencia[])
    todas = agruparNaoLancadas(linhas, incluirSemGuia)
    nomesPsi = [...new Set(linhas.filter((l) => l.origem === 'sessao' && l.psicologa).map((l) => String(l.psicologa)))]
  }
  nomesPsi.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))

  const grupos = psiFiltro ? todas.filter((g) => g.psicologa === psiFiltro) : todas

  const totGuias = grupos.reduce((t, g) => t + g.pacientes.reduce((u, p) => u + p.guias.filter((x) => x.guia).length, 0), 0)
  const totSemNumero = grupos.reduce((t, g) => t + g.pacientes.reduce((u, p) => u + p.guias.filter((x) => !x.guia).length, 0), 0)
  const totSessoes = grupos.reduce((t, g) => t + g.sessoes, 0)
  const totPacientes = grupos.reduce((t, g) => t + g.pacientes.length, 0)
  const totUnimed = grupos.reduce((t, g) => t + g.pacientes.reduce((u, p) => u + p.guias.filter((x) => x.plano === 'Unimed').length, 0), 0)
  const periodo = de === ate ? rotuloMes(de) : `${rotuloMes(de)} a ${rotuloMes(ate)}`
  const pdfQuery = (psi: string) => {
    const q = new URLSearchParams({ de, ate, modo, semguia: incluirSemGuia ? '1' : '0' })
    if (psi) q.set('psi', psi)
    return q.toString()
  }

  return (
    <>
      <div className={n.naoImprimir}>
        <Titulo titulo="Guias não lançadas">
          <strong>Guia no ADM, sem sessão na planilha</strong> (padrão): guias que o admin lançou no ADM Registro de Guia, mas que
          não aparecem na aba Atendimentos de nenhuma psicóloga — a psicóloga ainda não registrou a sessão. É o relatório para
          enviar a ela. A comparação ignora espaços e pontos; anotações que não são número de guia ficam de fora. As planilhas
          são lidas de hora em hora (use “Sincronizar planilhas” antes de enviar).
          <br />
          <br />
          <strong>Sessão na planilha, sem guia no ADM</strong>: o caminho inverso — sessões realizadas que o admin ainda não
          lançou. Faltas não entram. Use ↗ para abrir o Registro já na psicóloga, no mês e na guia.
        </Titulo>

        <nav className={n.modos} aria-label="Tipo de relatório">
          <a
            href={`/financeiro/nao-lancadas?${new URLSearchParams({ de, ate, ...(psiFiltro ? { psi: psiFiltro } : {}) })}`}
            className={modo === 'adm' ? n.modoAtivo : n.modo}
            aria-current={modo === 'adm' ? 'page' : undefined}
          >
            No ADM, sem sessão na planilha
          </a>
          <a
            href={`/financeiro/nao-lancadas?${new URLSearchParams({ de, ate, modo: 'planilha', ...(psiFiltro ? { psi: psiFiltro } : {}) })}`}
            className={modo === 'planilha' ? n.modoAtivo : n.modo}
            aria-current={modo === 'planilha' ? 'page' : undefined}
          >
            Na planilha, sem guia no ADM
          </a>
        </nav>

        <form className={n.filtros}>
          <input type="hidden" name="modo" value={modo} />
          <label className={s.field}>
            Psicóloga
            <select name="psi" defaultValue={psiFiltro}>
              <option value="">Todas</option>
              {nomesPsi.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            De
            <input type="month" name="de" defaultValue={de} />
          </label>
          <label className={s.field}>
            Até
            <input type="month" name="ate" defaultValue={ate} />
          </label>
          {modo === 'planilha' && (
            <label className={s.field}>
              Sem nº de guia
              <select name="semguia" defaultValue={incluirSemGuia ? '1' : '0'}>
                <option value="1">Incluir</option>
                <option value="0">Não incluir</option>
              </select>
            </label>
          )}
          <button type="submit" className={s.button}>
            Gerar relatório
          </button>
        </form>

        <div className={n.acoes}>
          <a className={s.button} href={`/financeiro/nao-lancadas/pdf?${pdfQuery(psiFiltro)}`} download>
            ⬇ Baixar PDF {psiFiltro ? `— ${psiFiltro}` : '(todas, uma por página)'}
          </a>
          <BotaoImprimir />
          <BotaoSincronizar compacto />
        </div>
      </div>

      <div className={n.soImpressao}>
        <h1 className={s.pageTitle}>
          {modo === 'adm' ? 'Guias no ADM sem sessão na planilha' : 'Guias não lançadas no ADM'} — {periodo}
        </h1>
        <p className={s.muted}>{psiFiltro || 'Todas as psicólogas'}</p>
      </div>

      {erro && <div className={s.alertBad}>Erro ao carregar: {erro.message}</div>}

      {modo === 'adm' ? (
        <div className={s.cards}>
          <div className={totGuias ? s.cardWarn : s.cardGood}>
            <div className={s.cardLabel}>Guias sem sessão na planilha</div>
            <div className={s.cardValue}>{int(totGuias)}</div>
            <div className={s.cardHint}>{periodo}</div>
          </div>
          <div className={s.cardInfo}>
            <div className={s.cardLabel}>Pacientes</div>
            <div className={s.cardValue}>{int(totPacientes)}</div>
            <div className={s.cardHint}>com guia no ADM e sem sessão</div>
          </div>
          <div className={s.card}>
            <div className={s.cardLabel}>Unimed / outros</div>
            <div className={s.cardValue}>
              {int(totUnimed)} / {int(totGuias - totUnimed)}
            </div>
            <div className={s.cardHint}>plano informado pelo admin</div>
          </div>
          <div className={s.card}>
            <div className={s.cardLabel}>Psicólogas com pendência</div>
            <div className={s.cardValue}>{int(grupos.length)}</div>
            <div className={s.cardHint}>{psiFiltro ? 'filtro aplicado' : `de ${int(nomesPsi.length)}`}</div>
          </div>
        </div>
      ) : (
        <div className={s.cards}>
          <div className={totGuias ? s.cardWarn : s.cardGood}>
            <div className={s.cardLabel}>Guias não lançadas</div>
            <div className={s.cardValue}>{int(totGuias)}</div>
            <div className={s.cardHint}>{periodo}</div>
          </div>
          <div className={s.cardInfo}>
            <div className={s.cardLabel}>Sessões nessas guias</div>
            <div className={s.cardValue}>{int(totSessoes)}</div>
            <div className={s.cardHint}>
              {int(totPacientes)} paciente{totPacientes === 1 ? '' : 's'}
            </div>
          </div>
          <div className={totSemNumero ? s.cardBad : s.card}>
            <div className={s.cardLabel}>Sem nº de guia</div>
            <div className={s.cardValue}>{incluirSemGuia ? int(totSemNumero) : '—'}</div>
            <div className={s.cardHint}>coluna E vazia na planilha</div>
          </div>
          <div className={s.card}>
            <div className={s.cardLabel}>Psicólogas com pendência</div>
            <div className={s.cardValue}>{int(grupos.length)}</div>
            <div className={s.cardHint}>{psiFiltro ? 'filtro aplicado' : `de ${int(nomesPsi.length)} com sessões no período`}</div>
          </div>
        </div>
      )}

      {!grupos.length && !erro && (
        <div className={s.alertGood}>
          {modo === 'adm'
            ? `Nenhuma guia do ADM sem sessão na planilha em ${periodo}.`
            : `Nenhuma guia pendente de lançamento em ${periodo}. Tudo lançado no ADM.`}
        </div>
      )}

      {grupos.map((g) => (
        <section key={g.psicologa} className={`${s.section} ${n.bloco}`}>
          <div className={n.topoBloco}>
            <h2 className={s.sectionTitle}>{g.psicologa}</h2>
            <span className={n.contagem}>
              {int(g.guias)} guia{g.guias === 1 ? '' : 's'} · {int(g.pacientes.length)} paciente{g.pacientes.length === 1 ? '' : 's'}
              {modo === 'planilha' && (
                <>
                  {' '}
                  · {int(g.sessoes)} sess{g.sessoes === 1 ? 'ão' : 'ões'}
                </>
              )}
              {modo === 'adm' &&
                (g.spreadsheet_id ? (
                  <> · planilha lida em {quando(lidaEm.get(g.spreadsheet_id))}</>
                ) : (
                  <> · planilha não sincronizada (fora da aba ID do Calculo RPA)</>
                ))}
            </span>
            <a className={`${s.buttonSmall} ${n.naoImprimir} ${n.pdf}`} href={`/financeiro/nao-lancadas/pdf?${pdfQuery(g.psicologa)}`} download>
              ⬇ PDF
            </a>
            {g.spreadsheet_id && (
              <a className={`${s.link} ${n.naoImprimir}`} href={`https://docs.google.com/spreadsheets/d/${g.spreadsheet_id}/edit`} target="_blank" rel="noopener">
                Planilha ↗
              </a>
            )}
          </div>
          <div className={s.tableWrap}>
            {modo === 'adm' ? (
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Paciente</th>
                    <th>Guia</th>
                    <th>Plano</th>
                    <th>Lançada pelo admin em</th>
                  </tr>
                </thead>
                <tbody>
                  {g.pacientes.flatMap((p) =>
                    p.guias.map((x, i) => {
                      const deep =
                        x.guia && x.spreadsheet_id && x.mesRef
                          ? `/financeiro/guias?${new URLSearchParams({ planilha: x.spreadsheet_id, mes: String(x.mesRef.mes), ano: String(x.mesRef.ano), guia: x.guia })}`
                          : null
                      return (
                        <tr key={`${p.paciente}-${x.guia}-${i}`} className={i === 0 ? n.primeira : undefined}>
                          <td className={n.paciente}>{i === 0 ? p.paciente : ''}</td>
                          <td>
                            <span className={n.guia}>{x.guia}</span>
                            {deep && (
                              <a className={`${n.abrir} ${n.naoImprimir}`} href={deep} target="_blank" rel="noopener" title="Abrir no Registro de Guias">
                                ↗
                              </a>
                            )}
                          </td>
                          <td>{x.plano}</td>
                          <td className={n.datas}>{(x.refs ?? []).join(', ') || '—'}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            ) : (
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Paciente</th>
                    <th>Guia</th>
                    <th>Plano</th>
                    <th>Sessões (datas)</th>
                    <th className={s.num}>Qtd</th>
                    <th>Anexo</th>
                    <th>Coluna S</th>
                  </tr>
                </thead>
                <tbody>
                  {g.pacientes.flatMap((p) =>
                    p.guias.map((x, i) => {
                      const ref = x.datas[0] ?? ''
                      const deep =
                        x.guia && x.spreadsheet_id && ref
                          ? `/financeiro/guias?${new URLSearchParams({ planilha: x.spreadsheet_id, mes: String(Number(ref.slice(5, 7))), ano: ref.slice(0, 4), guia: x.guia })}`
                          : null
                      return (
                        <tr key={`${p.paciente}-${x.guia ?? 'sem'}-${i}`} className={i === 0 ? n.primeira : undefined}>
                          <td className={n.paciente}>{i === 0 ? p.paciente : ''}</td>
                          <td>
                            {x.guia ? (
                              <>
                                <span className={n.guia}>{x.guia}</span>
                                {deep && (
                                  <a className={`${n.abrir} ${n.naoImprimir}`} href={deep} target="_blank" rel="noopener" title="Abrir no Registro de Guias">
                                    ↗
                                  </a>
                                )}
                              </>
                            ) : (
                              <span className={s.badgeBad}>sem nº</span>
                            )}
                          </td>
                          <td>{x.plano}</td>
                          <td className={n.datas}>{x.datas.length ? x.datas.map((d) => dataBR(d).slice(0, 5)).join(', ') : '—'}</td>
                          <td className={s.num}>{int(Math.max(x.datas.length, 1))}</td>
                          <td>{x.semAnexo ? <span className={s.badgeWarn}>sem anexo</span> : <span className={s.badgeGood}>anexou</span>}</td>
                          <td>{x.statusS.length ? x.statusS.join(', ') : <span className={s.muted}>(vazio)</span>}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>
      ))}
    </>
  )
}
