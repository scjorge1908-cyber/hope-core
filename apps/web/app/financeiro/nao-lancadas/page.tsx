import { Titulo } from '../titulo'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { dataBR, int } from '@/lib/financeiro/format'
import { agruparNaoLancadas, type LinhaConferencia } from '@/lib/financeiro/conferencia'
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

  const meses: string[] = []
  for (let m = de; m <= ate; m = somarMes(m, 1)) meses.push(m)

  const respostas = await Promise.all(
    meses.map((m) => supabase.rpc('conferencia_guias', { p_ano: Number(m.slice(0, 4)), p_mes: Number(m.slice(5, 7)) }))
  )
  const erro = respostas.find((r) => r.error)?.error
  const linhas = respostas.flatMap((r) => (r.data ?? []) as LinhaConferencia[])

  const todas = agruparNaoLancadas(linhas, incluirSemGuia)
  const nomesPsi = [...new Set(linhas.filter((l) => l.origem === 'sessao' && l.psicologa).map((l) => String(l.psicologa)))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
  )
  const grupos = psiFiltro ? todas.filter((g) => g.psicologa === psiFiltro) : todas

  const totGuias = grupos.reduce((t, g) => t + g.pacientes.reduce((u, p) => u + p.guias.filter((x) => x.guia).length, 0), 0)
  const totSemNumero = grupos.reduce((t, g) => t + g.pacientes.reduce((u, p) => u + p.guias.filter((x) => !x.guia).length, 0), 0)
  const totSessoes = grupos.reduce((t, g) => t + g.sessoes, 0)
  const totPacientes = grupos.reduce((t, g) => t + g.pacientes.length, 0)
  const periodo = de === ate ? rotuloMes(de) : `${rotuloMes(de)} a ${rotuloMes(ate)}`
  const pdfQuery = (psi: string) => {
    const q = new URLSearchParams({ de, ate, semguia: incluirSemGuia ? '1' : '0' })
    if (psi) q.set('psi', psi)
    return q.toString()
  }

  return (
    <>
      <div className={n.naoImprimir}>
        <Titulo titulo="Guias não lançadas">
          Sessões <strong>realizadas</strong> nas planilhas das psicólogas (aba Atendimentos) cuja guia ainda <strong>não está no ADM
          Registro de Guia</strong>. Faltas não entram. Use ↗ para abrir o Registro já na psicóloga, no mês e na guia.
        </Titulo>

        <form className={n.filtros}>
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
          <label className={s.field}>
            Sem nº de guia
            <select name="semguia" defaultValue={incluirSemGuia ? '1' : '0'}>
              <option value="1">Incluir</option>
              <option value="0">Não incluir</option>
            </select>
          </label>
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
        <h1 className={s.pageTitle}>Guias não lançadas no ADM — {periodo}</h1>
        <p className={s.muted}>{psiFiltro || 'Todas as psicólogas'}</p>
      </div>

      {erro && <div className={s.alertBad}>Erro ao carregar: {erro.message}</div>}

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

      {!grupos.length && !erro && <div className={s.alertGood}>Nenhuma guia pendente de lançamento em {periodo}. Tudo lançado no ADM.</div>}

      {grupos.map((g) => (
        <section key={g.psicologa} className={`${s.section} ${n.bloco}`}>
          <div className={n.topoBloco}>
            <h2 className={s.sectionTitle}>{g.psicologa}</h2>
            <span className={n.contagem}>
              {int(g.guias)} guia{g.guias === 1 ? '' : 's'} · {int(g.pacientes.length)} paciente{g.pacientes.length === 1 ? '' : 's'} · {int(g.sessoes)} sess
              {g.sessoes === 1 ? 'ão' : 'ões'}
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
          </div>
        </section>
      ))}
    </>
  )
}
