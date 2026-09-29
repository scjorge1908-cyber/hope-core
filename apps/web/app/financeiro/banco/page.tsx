import { Titulo } from '../titulo'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { brl, dataBR, int } from '@/lib/financeiro/format'
import { hojeSaoPaulo } from '@/lib/financeiro/agenda'
import { configCora, diagnosticoCora, extratoCora, saldoCora, type DiagnosticoCora, type ExtratoCora } from '@/lib/cora/cliente'
import { AutoConciliar } from './auto-conciliar'
import { buscarAgora, desvincular, ignorar, vincular } from './actions'
import type { BankSugestaoRow } from '@/lib/financeiro/db-types'
import s from '../financeiro.module.css'

export const metadata = { title: 'Banco (Cora) — HOPE CORE' }
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const reais = (centavos: number | string | undefined) => brl(Number(centavos ?? 0) / 100)

function somarDias(iso: string, k: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + k)
  return d.toISOString().slice(0, 10)
}

export default async function BancoPage({ searchParams }: PageProps<'/financeiro/banco'>) {
  const { allowed, supabase } = await requireFinanceAccess()
  if (!allowed) return null

  const sp = await searchParams
  const hoje = hojeSaoPaulo()
  const ISO = /^\d{4}-\d{2}-\d{2}$/
  const fim = ISO.test(String(sp.fim)) ? String(sp.fim) : hoje
  const inicio = ISO.test(String(sp.inicio)) ? String(sp.inicio) : somarDias(fim, -30)

  const cfg = configCora()
  const diag: DiagnosticoCora | null = cfg ? await diagnosticoCora(cfg) : null
  let saldo: number | null = null
  let extrato: ExtratoCora | null = null
  let erro: string | null = null
  if (cfg) {
    try {
      const [sa, ex] = await Promise.all([saldoCora(cfg), extratoCora(cfg, inicio, fim, hoje)])
      saldo = Number(sa.balance)
      extrato = ex
    } catch (e) {
      erro = (e as Error).message
    }
  }
  const entradas = (extrato?.entries ?? []).filter((e) => e.type === 'CREDIT')
  const saidas = (extrato?.entries ?? []).filter((e) => e.type !== 'CREDIT')
  const totEnt = extrato?.aggregations?.creditTotal ?? entradas.reduce((t, e) => t + Number(e.amount), 0)
  const totSai = extrato?.aggregations?.debitTotal ?? saidas.reduce((t, e) => t + Number(e.amount), 0)

  // ---------- conciliação com a Agenda ----------
  const desde = somarDias(hoje, -120)
  const [{ data: sync }, { data: creditos }, { data: vinculos }] = await Promise.all([
    supabase.from('bank_sync').select('*').maybeSingle(),
    supabase
      .from('bank_transactions')
      .select('*')
      .eq('kind', 'entrada')
      .gte('occurred_on', desde)
      .order('occurred_on', { ascending: false })
      .limit(400),
    supabase.from('bank_matches').select('*').order('created_at', { ascending: false }).limit(400),
  ])
  const porTx = new Map<string, NonNullable<typeof vinculos>>()
  for (const m of vinculos ?? []) porTx.set(m.bank_transaction_id, [...(porTx.get(m.bank_transaction_id) ?? []), m])
  const aConferir = (creditos ?? []).filter((c) => !c.ignored && !porTx.has(c.id))
  const conciliados = (creditos ?? []).filter((c) => porTx.has(c.id)).slice(0, 40)
  const ignorados = (creditos ?? []).filter((c) => c.ignored && !porTx.has(c.id)).slice(0, 20)
  const sugestoes = new Map<string, BankSugestaoRow[]>()
  await Promise.all(
    aConferir.slice(0, 15).map(async (c) => {
      const { data } = await supabase.rpc('bank_sugestoes', { p_tx: c.id })
      sugestoes.set(c.id, (data ?? []) as BankSugestaoRow[])
    })
  )
  // descrição dos previstos confirmados (Agenda)
  const alvos = [...new Set((vinculos ?? []).map((m) => m.target_id))]
  const { data: agenda } = alvos.length
    ? await supabase.from('cashflow_calendar').select('id, category, description, external_ref, expected_date').in('id', alvos.slice(0, 400))
    : { data: [] }
  const descAlvo = new Map((agenda ?? []).map((a) => [a.id, `${a.category}${a.external_ref ? ` · ${a.external_ref}` : ''} (prev. ${dataBR(a.expected_date)})`]))
  const ok = typeof sp.ok === 'string' ? sp.ok : ''
  const erroAcao = typeof sp.erro === 'string' ? sp.erro : ''

  return (
    <>
      <Titulo titulo="Banco (Cora)">
        Conta da clínica no Cora pela <strong>Integração Direta</strong> (certificado + chave privada + client ID guardados só na
        Vercel). Só leitura: saldo e extrato — nada é pago ou transferido por aqui.
        <br />
        <br />
        <strong>Conciliação:</strong> ao abrir a Agenda ou esta página (no máximo a cada 30 min), o sistema lê o extrato dos
        últimos 60 dias e confirma sozinho, na Agenda, os recebimentos que baterem: (1) mesmo valor de um previsto; (2) soma
        de todos os previstos do mesmo plano no mesmo dia; (3) quando o pagador indica o plano (ex.: “BRADESCO”), os previstos
        mais antigos do plano até fechar o valor exato. O que não bater fica em “Entradas a conferir”, com sugestões.
      </Titulo>

      {!cfg && (
        <div className={s.alertWarn}>
          Integração ainda não configurada. Faltam as variáveis <code>CORA_CLIENT_ID</code>, <code>CORA_CERT</code> e{' '}
          <code>CORA_KEY</code> na Vercel (e <code>CORA_AMBIENTE</code> = stage ou producao).
        </div>
      )}
      {cfg && (
        <p className={s.muted} style={{ fontSize: 13, marginBottom: 16 }}>
          Ambiente: <strong>{cfg.ambiente === 'producao' ? 'Produção' : 'Teste (Stage)'}</strong>
        </p>
      )}
      {erro && <div className={s.alertBad}>Erro ao falar com o Cora: {erro}</div>}

      {cfg && diag && (erro || sp.diag === '1') && (
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Diagnóstico das credenciais</h2>
          <p className={s.sectionNote}>Mostra só pedaços dos valores, para conferir com o Cora sem expor nada.</p>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <tbody>
                <tr>
                  <td>Ambiente (CORA_AMBIENTE)</td>
                  <td>{diag.ambiente === 'producao' ? 'Produção' : 'Teste (Stage)'}</td>
                </tr>
                <tr>
                  <td>Client ID (CORA_CLIENT_ID)</td>
                  <td>{diag.clientId}</td>
                </tr>
                <tr>
                  <td>Certificado — nome (CN)</td>
                  <td>{diag.certCN ?? '—'}</td>
                </tr>
                <tr>
                  <td>CN do certificado = Client ID?</td>
                  <td>
                    {diag.cnIgualClientId == null ? '—' : diag.cnIgualClientId ? <span className={s.badgeGood}>sim</span> : <span className={s.badgeBad}>não — são de credenciais diferentes</span>}
                  </td>
                </tr>
                <tr>
                  <td>Chave privada combina com o certificado?</td>
                  <td>
                    {diag.chaveCombina == null ? '—' : diag.chaveCombina ? <span className={s.badgeGood}>sim</span> : <span className={s.badgeBad}>não</span>}
                  </td>
                </tr>
                <tr>
                  <td>Certificado válido até</td>
                  <td>
                    {diag.certValidoAte ?? '—'} {diag.certVencido ? <span className={s.badgeBad}>vencido</span> : null}
                  </td>
                </tr>
                <tr>
                  <td>Emissor do certificado</td>
                  <td style={{ whiteSpace: 'normal' }}>{diag.certEmissor ?? '—'}</td>
                </tr>
                {diag.erroCert && (
                  <tr>
                    <td>Problema</td>
                    <td className={s.numBad} style={{ textAlign: 'left' }}>
                      {diag.erroCert}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {cfg && !erro && (
        <>
          <form className={s.form} style={{ maxWidth: 520, marginBottom: 24 }}>
            <div className={s.formRow}>
              <label className={s.field}>
                De
                <input type="date" name="inicio" defaultValue={inicio} />
              </label>
              <label className={s.field}>
                Até
                <input type="date" name="fim" defaultValue={fim} />
              </label>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button type="submit" className={s.button}>
                Ver extrato
              </button>
              <a className={s.buttonSmall} style={{ minHeight: 40, padding: '9px 14px' }} href={`/financeiro/banco/extrato?${new URLSearchParams({ inicio, fim, formato: 'xlsx' })}`} download>
                ⬇ Baixar Excel
              </a>
              <a className={s.buttonSmall} style={{ minHeight: 40, padding: '9px 14px' }} href={`/financeiro/banco/extrato?${new URLSearchParams({ inicio, fim, formato: 'pdf' })}`} download>
                ⬇ Baixar PDF
              </a>
            </div>
          </form>

          <div className={s.cards}>
            <div className={s.cardInfo}>
              <div className={s.cardLabel}>Saldo agora</div>
              <div className={s.cardValue}>{saldo == null ? '—' : reais(saldo)}</div>
              <div className={s.cardHint}>{extrato?.header?.businessName ?? ''}</div>
            </div>
            <div className={s.cardGood}>
              <div className={s.cardLabel}>Entradas no período</div>
              <div className={s.cardValue}>{reais(totEnt)}</div>
              <div className={s.cardHint}>{int(entradas.length)} lançamentos</div>
            </div>
            <div className={s.cardBad}>
              <div className={s.cardLabel}>Saídas no período</div>
              <div className={s.cardValue}>{reais(totSai)}</div>
              <div className={s.cardHint}>{int(saidas.length)} lançamentos</div>
            </div>
            <div className={s.card}>
              <div className={s.cardLabel}>Saldo no fim do período</div>
              <div className={s.cardValue}>{extrato?.end ? reais(extrato.end.balance) : '—'}</div>
              <div className={s.cardHint}>início: {extrato?.start ? reais(extrato.start.balance) : '—'}</div>
            </div>
          </div>

          <section className={s.section}>
            <h2 className={s.sectionTitle}>Extrato</h2>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Descrição</th>
                    <th>Contraparte</th>
                    <th className={s.num}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {(extrato?.entries ?? []).map((e) => (
                    <tr key={e.id}>
                      <td>{dataBR(e.createdAt)}</td>
                      <td>{e.transaction?.type ?? '—'}</td>
                      <td style={{ whiteSpace: 'normal' }}>{e.transaction?.description ?? '—'}</td>
                      <td style={{ whiteSpace: 'normal' }}>{e.transaction?.counterParty?.name ?? '—'}</td>
                      <td className={e.type === 'CREDIT' ? s.numGood : s.numBad}>
                        {e.type === 'CREDIT' ? '+' : '−'} {reais(e.amount)}
                      </td>
                    </tr>
                  ))}
                  {!extrato?.entries?.length && (
                    <tr>
                      <td colSpan={5} className={s.muted}>
                        Nenhum lançamento no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {cfg && (
        <section id="conciliacao" className={s.section}>
          <AutoConciliar />
          <h2 className={s.sectionTitle}>Conciliação com a Agenda</h2>
          <p className={s.sectionNote}>
            Última leitura do extrato:{' '}
            {sync?.last_synced_at
              ? new Date(sync.last_synced_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
              : 'nunca'}
            . Entradas dos últimos 120 dias.
          </p>
          {ok && <div className={s.alertGood}>{ok}</div>}
          {erroAcao && <div className={s.alertBad}>{erroAcao}</div>}
          <form action={buscarAgora} style={{ marginBottom: 20 }}>
            <input type="hidden" name="inicio" value={inicio} />
            <input type="hidden" name="fim" value={fim} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <button type="submit" className={s.button}>
                Buscar pagamentos e conciliar agora
              </button>
              <button type="submit" name="desde" value="ano" className={s.buttonSmall} style={{ minHeight: 40, padding: '9px 14px' }} title="Relê o extrato desde 1º de janeiro para confirmar pagamentos antigos">
                Conciliar desde janeiro
              </button>
            </div>
          </form>

          <h3 className={s.sectionTitle} style={{ fontSize: 15 }}>
            Entradas a conferir ({int(aConferir.length)})
          </h3>
          {!aConferir.length ? (
            <p className={s.muted} style={{ fontSize: 14, marginBottom: 16 }}>
              Nenhuma entrada pendente de conferência.
            </p>
          ) : (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Pagador / descrição</th>
                    <th className={s.num}>Valor</th>
                    <th>Pode ser (previsto na Agenda)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {aConferir.slice(0, 60).map((c) => (
                    <tr key={c.id}>
                      <td>{dataBR(c.occurred_on)}</td>
                      <td style={{ whiteSpace: 'normal', maxWidth: 260 }}>
                        <strong>{c.counterparty_name ?? '—'}</strong>
                        <br />
                        <span className={s.muted}>{c.description ?? c.transaction_type ?? ''}</span>
                      </td>
                      <td className={s.numGood}>{brl(c.amount)}</td>
                      <td style={{ whiteSpace: 'normal', minWidth: 280 }}>
                        {(sugestoes.get(c.id) ?? []).slice(0, 4).map((g) => (
                          <form key={`${g.origem}-${g.target_id}`} action={vincular} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                            <input type="hidden" name="tx" value={c.id} />
                            <input type="hidden" name="origem" value={g.origem} />
                            <input type="hidden" name="target" value={g.target_id} />
                            <input type="hidden" name="inicio" value={inicio} />
                            <input type="hidden" name="fim" value={fim} />
                            <button type="submit" className={s.buttonSmall}>
                              É este
                            </button>
                            <span style={{ fontSize: 13 }}>
                              {g.plano ?? '—'} · {brl(g.amount)} · prev. {dataBR(g.expected_date)}
                              {Math.abs(Number(g.diferenca)) > 0.01 && <span className={s.muted}> (dif. {brl(Number(g.diferenca))})</span>}
                            </span>
                          </form>
                        ))}
                        {!sugestoes.has(c.id) && <span className={s.muted}>—</span>}
                        {sugestoes.has(c.id) && !(sugestoes.get(c.id) ?? []).length && <span className={s.muted}>Nenhum previsto parecido.</span>}
                      </td>
                      <td>
                        <form action={ignorar}>
                          <input type="hidden" name="tx" value={c.id} />
                          <input type="hidden" name="ignorar" value="1" />
                          <input type="hidden" name="inicio" value={inicio} />
                          <input type="hidden" name="fim" value={fim} />
                          <button type="submit" className={s.buttonSmall} title="Particular, transferência própria etc.">
                            Não é de plano
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className={s.sectionTitle} style={{ fontSize: 15, marginTop: 20 }}>
            Confirmadas pelo banco ({int(conciliados.length)})
          </h3>
          {!conciliados.length ? (
            <p className={s.muted} style={{ fontSize: 14, marginBottom: 16 }}>
              Nenhuma ainda.
            </p>
          ) : (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Pagador</th>
                    <th className={s.num}>Valor</th>
                    <th>Confirmou na Agenda</th>
                    <th>Como</th>
                  </tr>
                </thead>
                <tbody>
                  {conciliados.map((c) => {
                    const ms = porTx.get(c.id) ?? []
                    return (
                      <tr key={c.id}>
                        <td>{dataBR(c.occurred_on)}</td>
                        <td style={{ whiteSpace: 'normal', maxWidth: 240 }}>{c.counterparty_name ?? c.description ?? '—'}</td>
                        <td className={s.numGood}>{brl(c.amount)}</td>
                        <td style={{ whiteSpace: 'normal', minWidth: 260 }}>
                          {ms.slice(0, 6).map((m) => (
                            <form key={m.id} action={desvincular} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                              <input type="hidden" name="origem" value={m.origem} />
                              <input type="hidden" name="target" value={m.target_id} />
                              <input type="hidden" name="inicio" value={inicio} />
                              <input type="hidden" name="fim" value={fim} />
                              <span style={{ fontSize: 13 }}>
                                {descAlvo.get(m.target_id) ?? 'previsto'} · {brl(m.amount)}
                              </span>
                              <button type="submit" className={s.buttonSmall} title="Volta para previsto">
                                Desfazer
                              </button>
                            </form>
                          ))}
                          {ms.length > 6 && <span className={s.muted}>+ {ms.length - 6} previsto(s)</span>}
                        </td>
                        <td>
                          <span className={ms[0]?.matched_by === 'manual' ? s.badgeWarn : s.badgeGood}>
                            {ms[0]?.matched_by === 'manual' ? 'manual' : ms[0]?.regra ?? 'auto'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!!ignorados.length && (
            <details>
              <summary>Marcadas como “não é de plano” ({ignorados.length})</summary>
              <ul className={s.list}>
                {ignorados.map((c) => (
                  <li key={c.id}>
                    <form action={ignorar} style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      <input type="hidden" name="tx" value={c.id} />
                      <input type="hidden" name="ignorar" value="0" />
                      <input type="hidden" name="inicio" value={inicio} />
                      <input type="hidden" name="fim" value={fim} />
                      {dataBR(c.occurred_on)} · {c.counterparty_name ?? c.description ?? '—'} · {brl(c.amount)}
                      <button type="submit" className={s.buttonSmall}>
                        Voltar para conferir
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </>
  )
}
