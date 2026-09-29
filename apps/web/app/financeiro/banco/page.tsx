import { Titulo } from '../titulo'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { brl, dataBR, int } from '@/lib/financeiro/format'
import { hojeSaoPaulo } from '@/lib/financeiro/agenda'
import { configCora, diagnosticoCora, extratoCora, saldoCora, type DiagnosticoCora, type ExtratoCora } from '@/lib/cora/cliente'
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
  const { allowed } = await requireFinanceAccess()
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
      const [sa, ex] = await Promise.all([saldoCora(cfg), extratoCora(cfg, inicio, fim)])
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

  return (
    <>
      <Titulo titulo="Banco (Cora)">
        Conta da clínica no Cora pela <strong>Integração Direta</strong> (certificado + chave privada + client ID guardados só na
        Vercel). Por enquanto só leitura: saldo e extrato. Próximo passo: confirmar sozinho, na Agenda, os recebimentos de
        Bradesco e Unimed que caírem na conta.
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
            <button type="submit" className={s.button}>
              Ver extrato
            </button>
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
    </>
  )
}
