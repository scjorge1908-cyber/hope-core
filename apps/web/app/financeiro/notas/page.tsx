import { Titulo } from '../titulo'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { brl, dataBR } from '@/lib/financeiro/format'
import { NotaForm } from './nota-form'
import { cancelarNota, marcarPaga } from './actions'
import s from '../financeiro.module.css'

const STATUS = {
  issued: { label: 'A receber', cls: s.badgeWarn },
  paid: { label: 'Paga', cls: s.badgeGood },
  cancelled: { label: 'Cancelada', cls: s.badgeBad },
} as const

export default async function NotasPage() {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return null

  const [stRes, invRes] = await Promise.all([
    supabase
      .from('claim_statement_overview')
      .select('id, plan_name, statement_number, emission_date, items_released, financial_status')
      .order('emission_date', { ascending: false }),
    supabase.from('operator_invoices').select('*').order('issue_date', { ascending: false }),
  ])

  const statements = stRes.data ?? []
  const invoices = invRes.data ?? []
  const stById = new Map(statements.map((x) => [x.id, x]))
  const semNota = statements
    .filter((x) => x.financial_status === 'sem_nota')
    .map((x) => ({
      id: x.id,
      released: Number(x.items_released),
      label: `${x.statement_number} · ${dataBR(x.emission_date)} · liberado ${brl(x.items_released)} · ${x.plan_name}`,
    }))
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

  return (
    <>
      <Titulo titulo="Notas fiscais para as operadoras">
        Para cada demonstrativo, a clínica emite a nota do valor liberado e a operadora paga a nota. Registre aqui a nota e,
        quando o dinheiro entrar, marque como paga. O valor já vem preenchido com o liberado do demonstrativo.
      </Titulo>

      {(stRes.error || invRes.error) && (
        <div className={s.alertBad}>Erro ao carregar: {(stRes.error ?? invRes.error)?.message}</div>
      )}

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Registrar nota</h2>
        <div style={{ paddingBottom: 12 }}>
          <NotaForm statements={semNota} />
        </div>
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Notas registradas</h2>
        {invoices.length === 0 ? (
          <p className={s.muted} style={{ fontSize: 14, marginBottom: 10 }}>
            Nenhuma nota registrada ainda.
          </p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Nota</th>
                  <th>Demonstrativo</th>
                  <th>Emissão</th>
                  <th className={s.num}>Valor</th>
                  <th>Previsto</th>
                  <th>Situação</th>
                  <th>Pagamento</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((n) => {
                  const st = STATUS[n.status]
                  return (
                    <tr key={n.id}>
                      <td>{n.invoice_number}</td>
                      <td>{n.statement_id ? stById.get(n.statement_id)?.statement_number ?? '—' : '—'}</td>
                      <td>{dataBR(n.issue_date)}</td>
                      <td className={s.num}>{brl(n.amount)}</td>
                      <td>{dataBR(n.expected_payment_date)}</td>
                      <td>
                        <span className={st.cls}>{st.label}</span>
                      </td>
                      <td>
                        {n.status === 'paid' && `${dataBR(n.paid_on)} · ${brl(n.paid_amount)}`}
                        {n.status === 'issued' && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <form action={marcarPaga} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input type="hidden" name="id" value={n.id} />
                              <input type="date" name="paid_on" defaultValue={hoje} required aria-label="Data do pagamento" />
                              <input
                                name="paid_amount"
                                defaultValue={Number(n.amount).toFixed(2).replace('.', ',')}
                                size={10}
                                required
                                aria-label="Valor pago"
                              />
                              <button className={s.buttonSmall}>Marcar paga</button>
                            </form>
                            <form action={cancelarNota}>
                              <input type="hidden" name="id" value={n.id} />
                              <button className={s.buttonSmall} style={{ background: 'var(--fin-bad)' }}>
                                Cancelar
                              </button>
                            </form>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
