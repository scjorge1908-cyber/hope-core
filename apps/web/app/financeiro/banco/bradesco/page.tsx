import { Titulo } from '../../titulo'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { dataBR } from '@/lib/financeiro/format'
import { configBradesco, diagnosticoBradesco, faltandoBradesco } from '@/lib/bradesco/cliente'
import { BotoesBradesco } from './botoes'
import s from '../../financeiro.module.css'

const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default async function BradescoPage() {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return null

  const cfg = configBradesco()
  const faltam = faltandoBradesco()
  const diag = cfg ? await diagnosticoBradesco(cfg) : null

  const [{ data: sync }, { data: lancs }] = await Promise.all([
    supabase.from('bank_sync').select('*').eq('bank', 'bradesco').maybeSingle(),
    supabase
      .from('bank_transactions')
      .select('id, occurred_on, kind, amount, counterparty_name, description, transaction_type')
      .eq('bank', 'bradesco')
      .order('occurred_on', { ascending: false })
      .limit(60),
  ])
  const ult = sync?.last_result as { lancamentos_novos?: number; recebidos?: number; previstos_confirmados?: number } | null

  return (
    <>
      <Titulo titulo="Banco (Bradesco)">
        Conta PJ da clínica no Bradesco pela API <strong>Saldo e extrato</strong> do Bradesco Developers (certificado A1 da
        clínica + client ID/secret guardados só na Vercel). Só leitura: nada é pago ou transferido por aqui. Os lançamentos
        entram na mesma base do Cora — DRE, Projeção e a conciliação automática com a Agenda (ex.: pagamentos da Bradesco
        Saúde) passam a enxergar os dois bancos.
      </Titulo>

      {!cfg && (
        <div className={s.alertWarn}>
          Integração ainda não configurada. Faltam na Vercel: {faltam.map((f) => <code key={f} style={{ marginRight: 6 }}>{f}</code>)}
        </div>
      )}

      {cfg && diag && (
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Conexão</h2>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <tbody>
                <tr>
                  <td>Client ID</td>
                  <td>{diag.clientId}</td>
                </tr>
                <tr>
                  <td>Agência / conta</td>
                  <td>
                    {diag.agencia} / {diag.conta}
                  </td>
                </tr>
                <tr>
                  <td>Certificado</td>
                  <td>
                    {diag.erroCert ? (
                      <span className={s.badgeBad}>{diag.erroCert}</span>
                    ) : (
                      <>
                        {diag.certCN} · válido até {diag.certValidoAte}{' '}
                        {diag.certVencido ? <span className={s.badgeBad}>VENCIDO</span> : <span className={s.badgeGood}>OK</span>}{' '}
                        {diag.chaveCombina === false && <span className={s.badgeBad}>chave privada não combina</span>}
                      </>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Última sincronização</td>
                  <td>
                    {sync?.last_synced_at
                      ? `${new Date(sync.last_synced_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} — período lido ${sync.last_period_start ? dataBR(sync.last_period_start) : '?'} a ${sync.last_period_end ? dataBR(sync.last_period_end) : '?'}${ult ? ` · ${ult.lancamentos_novos ?? 0} novo(s) de ${ult.recebidos ?? 0}` : ''}`
                      : 'nunca'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 16 }}>
            <BotoesBradesco />
          </div>
        </section>
      )}

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Últimos lançamentos gravados ({lancs?.length ?? 0})</h2>
        {!lancs?.length ? (
          <p className={s.muted} style={{ fontSize: 14, marginBottom: 12 }}>
            Nenhum lançamento do Bradesco ainda. Use “Testar leitura” para conferir e depois “Sincronizar extrato”.
          </p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th className={s.num}>Valor</th>
                  <th>Contraparte</th>
                  <th>Descrição</th>
                </tr>
              </thead>
              <tbody>
                {lancs.map((l) => (
                  <tr key={l.id}>
                    <td>{dataBR(l.occurred_on)}</td>
                    <td>{l.kind === 'entrada' ? 'Entrada' : 'Saída'}</td>
                    <td className={l.kind === 'entrada' ? s.numGood : s.numBad}>{brl(Number(l.amount))}</td>
                    <td>{l.counterparty_name ?? '—'}</td>
                    <td>{l.description ?? l.transaction_type ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
