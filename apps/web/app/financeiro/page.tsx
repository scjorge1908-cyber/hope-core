import Link from 'next/link'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { brl, dataBR, int, mesBR, pct } from '@/lib/financeiro/format'
import type { ClaimStatementOverviewRow } from '@/lib/financeiro/db-types'
import s from './financeiro.module.css'

const STATUS: Record<ClaimStatementOverviewRow['financial_status'], { label: string; cls: string }> = {
  sem_nota: { label: 'Sem nota', cls: s.badgeBad },
  nota_emitida: { label: 'Nota emitida', cls: s.badgeWarn },
  paga: { label: 'Paga', cls: s.badgeGood },
}

const APPEAL: Record<string, string> = {
  not_evaluated: 'Não avaliada',
  appealing: 'Em recurso',
  recovered: 'Recuperada',
  partial: 'Parcial',
  lost: 'Perdida',
}

export default async function PainelFinanceiro({ searchParams }: PageProps<'/financeiro'>) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return null

  const { data: plans } = await supabase
    .from('insurance_plans')
    .select('id, name, operator_ans_code, active, tenant_id')
    .not('operator_ans_code', 'is', null)
    .order('name')

  if (!plans?.length) {
    return (
      <>
        <h1 className={s.pageTitle}>Painel financeiro</h1>
        <p className={s.lead}>Nenhum demonstrativo importado ainda.</p>
        <Link className={s.button} href="/financeiro/importar">
          Importar o primeiro XML
        </Link>
      </>
    )
  }

  const { plano } = await searchParams
  // Sem plano escolhido: abre no primeiro plano que já tem demonstrativo importado
  // (planos novos, como Bradesco via Orizon, ainda não têm XML TISS).
  const { data: comDemonstrativo } = await supabase.from('claim_statement_overview').select('insurance_plan_id').limit(1000)
  const planosComXml = new Set((comDemonstrativo ?? []).map((x) => x.insurance_plan_id))
  const plan = plans.find((p) => p.id === plano) ?? plans.find((p) => planosComXml.has(p.id)) ?? plans[0]

  const [statementsRes, monthlyRes, codesRes, glossRes, dupRes] = await Promise.all([
    supabase.from('claim_statement_overview').select('*').eq('insurance_plan_id', plan.id).order('emission_date', { ascending: false }),
    supabase.from('claim_monthly_summary').select('*').eq('insurance_plan_id', plan.id).order('month', { ascending: false }),
    supabase.from('claim_gloss_by_code').select('*').eq('insurance_plan_id', plan.id).order('gloss', { ascending: false }),
    supabase.rpc('claim_gloss_details', { p_plan_id: plan.id }),
    supabase.rpc('claim_duplicate_billing', { p_plan_id: plan.id }),
  ])

  const firstError = [statementsRes, monthlyRes, codesRes, glossRes, dupRes].find((r) => r.error)?.error
  const statements = statementsRes.data ?? []
  const monthly = monthlyRes.data ?? []
  const codes = codesRes.data ?? []
  const glosses = glossRes.data ?? []
  const duplicates = dupRes.data ?? []

  // ---------- totais ----------
  const informed = monthly.reduce((t, m) => t + Number(m.informed), 0)
  const released = monthly.reduce((t, m) => t + Number(m.released), 0)
  const gloss = monthly.reduce((t, m) => t + Number(m.gloss), 0)
  const sessions = monthly.reduce((t, m) => t + Number(m.sessions), 0)
  const semNota = statements.filter((x) => x.financial_status === 'sem_nota')
  const liberadoSemNota = semNota.reduce((t, x) => t + Number(x.items_released), 0)
  const invoicedOpen = statements
    .filter((x) => x.financial_status === 'nota_emitida')
    .reduce((t, x) => t + Number(x.invoiced) - Number(x.paid), 0)
  const paid = statements.reduce((t, x) => t + Number(x.paid), 0)

  // ---------- glosa por paciente ----------
  const byPatient = new Map<string, { name: string; last4: string; n: number; value: number; codes: Set<string> }>()
  for (const g of glosses) {
    const key = `${g.beneficiary_name}|${g.card_last4}`
    const cur = byPatient.get(key) ?? { name: g.beneficiary_name ?? '—', last4: g.card_last4 ?? '', n: 0, value: 0, codes: new Set() }
    cur.n += 1
    cur.value += Number(g.gloss_value)
    g.gloss_codes?.split(',').forEach((c) => cur.codes.add(c))
    byPatient.set(key, cur)
  }
  const patients = [...byPatient.values()].sort((a, b) => b.value - a.value)
  const topPatient = patients[0]

  return (
    <>
      <h1 className={s.pageTitle}>Painel financeiro</h1>
      <p className={s.lead}>
        Tudo aqui vem dos demonstrativos importados. Os meses são os <strong>meses do atendimento</strong>, não os do
        demonstrativo. Uma sessão que reaparece em outro demonstrativo é contada uma vez só, com a situação mais recente.
      </p>

      {plans.length > 1 && (
        <div className={s.planPicker}>
          {plans.map((p) => (
            <Link key={p.id} href={`/financeiro?plano=${p.id}`} className={p.id === plan.id ? s.planActive : undefined}>
              {p.name}
            </Link>
          ))}
        </div>
      )}

      {firstError && <div className={s.alertBad}>Erro ao carregar dados: {firstError.message}</div>}

      <div className={s.cards}>
        <div className={s.card}>
          <div className={s.cardLabel}>Liberado pela operadora</div>
          <div className={s.cardValue}>{brl(released)}</div>
          <div className={s.cardHint}>
            {int(sessions)} sessões · informado {brl(informed)}
          </div>
        </div>
        <div className={s.card}>
          <div className={s.cardLabel}>Glosado (atual)</div>
          <div className={s.cardValue}>{brl(gloss)}</div>
          <div className={s.cardHint}>{pct(gloss, informed)} do informado</div>
        </div>
        <div className={s.card}>
          <div className={s.cardLabel}>Liberado sem nota fiscal</div>
          <div className={s.cardValue}>{brl(liberadoSemNota)}</div>
          <div className={s.cardHint}>
            {semNota.length} demonstrativo{semNota.length === 1 ? '' : 's'} sem nota registrada
          </div>
        </div>
        <div className={s.card}>
          <div className={s.cardLabel}>Nota emitida, a receber</div>
          <div className={s.cardValue}>{brl(invoicedOpen)}</div>
          <div className={s.cardHint}>Recebido até agora: {brl(paid)}</div>
        </div>
      </div>

      {topPatient && topPatient.value >= gloss * 0.2 && (
        <div className={s.alertWarn}>
          <strong>{topPatient.name}</strong> (carteirinha final {topPatient.last4}) concentra {pct(topPatient.value, gloss)} de
          todo o valor glosado: {topPatient.n} sessões, {brl(topPatient.value)}. Vale checar autorização/elegibilidade desse
          paciente com a operadora.
        </div>
      )}

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Demonstrativos</h2>
        <p className={s.sectionNote}>
          Cada demonstrativo libera um valor → a clínica emite a nota → a operadora paga. Registre as notas em{' '}
          <Link href="/financeiro/notas" style={{ color: 'var(--fin-accent)' }}>
            Notas fiscais
          </Link>
          .
        </p>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Nº</th>
                <th>Emissão</th>
                <th className={s.num}>Sessões</th>
                <th className={s.num}>Informado</th>
                <th className={s.num}>Liberado</th>
                <th className={s.num}>Glosado</th>
                <th>Nota</th>
                <th>Situação</th>
                <th>Avisos</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((x) => {
                const div = Array.isArray(x.divergences) ? (x.divergences as string[]) : []
                const st = STATUS[x.financial_status]
                return (
                  <tr key={x.id}>
                    <td>{x.statement_number}</td>
                    <td>{dataBR(x.emission_date)}</td>
                    <td className={s.num}>{int(x.item_count)}</td>
                    <td className={s.num}>{brl(x.items_informed)}</td>
                    <td className={s.num}>{brl(x.items_released)}</td>
                    <td className={s.num}>{brl(x.items_gloss)}</td>
                    <td>{x.invoice_numbers ?? '—'}</td>
                    <td>
                      <span className={st.cls}>{st.label}</span>
                    </td>
                    <td>
                      {div.length ? (
                        <details>
                          <summary>{div.length} aviso{div.length > 1 ? 's' : ''}</summary>
                          <ul className={s.list} style={{ whiteSpace: 'normal', maxWidth: 420 }}>
                            {div.map((d, i) => (
                              <li key={i}>{d}</li>
                            ))}
                          </ul>
                        </details>
                      ) : (
                        <span className={s.muted}>—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Por mês de atendimento</h2>
        <p className={s.sectionNote}>
          Prazo = dias entre a sessão e a emissão do demonstrativo que a analisou. Meses recentes aparecem incompletos até
          chegarem os próximos demonstrativos.
        </p>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Mês</th>
                <th className={s.num}>Sessões</th>
                <th className={s.num}>Informado</th>
                <th className={s.num}>Liberado</th>
                <th className={s.num}>Glosado</th>
                <th className={s.num}>% glosa</th>
                <th className={s.num}>Prazo mediano</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month}>
                  <td>{mesBR(m.month)}</td>
                  <td className={s.num}>{int(m.sessions)}</td>
                  <td className={s.num}>{brl(m.informed)}</td>
                  <td className={s.num}>{brl(m.released)}</td>
                  <td className={s.num}>{brl(m.gloss)}</td>
                  <td className={s.num}>{pct(Number(m.gloss), Number(m.informed))}</td>
                  <td className={s.num}>{m.median_days_to_statement == null ? '—' : `${Math.round(Number(m.median_days_to_statement))} dias`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Glosas por código</h2>
        <p className={s.sectionNote}>Códigos da tabela de glosas TISS, exatamente como vieram da operadora.</p>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Código</th>
                <th className={s.num}>Sessões</th>
                <th className={s.num}>Pacientes</th>
                <th className={s.num}>Valor</th>
                <th className={s.num}>% da glosa</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.gloss_code}>
                  <td>{c.gloss_code}</td>
                  <td className={s.num}>{int(c.sessions)}</td>
                  <td className={s.num}>{int(c.beneficiaries)}</td>
                  <td className={s.num}>{brl(c.gloss)}</td>
                  <td className={s.num}>{pct(Number(c.gloss), gloss)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Glosas por paciente</h2>
        <p className={s.sectionNote}>Ordenado pelo valor glosado. Glosa não é perda definitiva até o recurso ser avaliado.</p>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Paciente</th>
                <th>Carteirinha</th>
                <th>Códigos</th>
                <th className={s.num}>Sessões</th>
                <th className={s.num}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={`${p.name}|${p.last4}`}>
                  <td>{p.name}</td>
                  <td>…{p.last4}</td>
                  <td>{[...p.codes].join(', ')}</td>
                  <td className={s.num}>{int(p.n)}</td>
                  <td className={s.num}>{brl(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details>
          <summary>Ver as {glosses.length} sessões glosadas uma a uma</summary>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Atendimento</th>
                  <th>Guia</th>
                  <th>Paciente</th>
                  <th>Código</th>
                  <th className={s.num}>Glosado</th>
                  <th>Demonstrativo</th>
                  <th>Recurso</th>
                </tr>
              </thead>
              <tbody>
                {glosses.map((g) => (
                  <tr key={g.item_key}>
                    <td>{dataBR(g.realization_date)}</td>
                    <td>{g.provider_guide_number}</td>
                    <td>{g.beneficiary_name}</td>
                    <td>{g.gloss_codes}</td>
                    <td className={s.num}>{brl(g.gloss_value)}</td>
                    <td>{g.statement_number}</td>
                    <td>{APPEAL[g.appeal_status] ?? g.appeal_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Mesmo paciente cobrado mais de uma vez no mesmo dia</h2>
        <p className={s.sectionNote}>
          Guias diferentes, mesmo paciente, mesma data. Nos dados da Unimed, toda glosa 1702 caiu nesse padrão — é erro de
          registro evitável. Linhas sem glosa foram pagas duas vezes: confirme se houve de fato duas sessões.
        </p>
        {duplicates.length === 0 ? (
          <p className={s.muted} style={{ fontSize: 14, marginBottom: 10 }}>
            Nenhum caso.
          </p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Paciente</th>
                  <th>Guias</th>
                  <th className={s.num}>Cobranças</th>
                  <th className={s.num}>Liberado</th>
                  <th className={s.num}>Glosado</th>
                </tr>
              </thead>
              <tbody>
                {duplicates.map((d, i) => (
                  <tr key={i}>
                    <td>{dataBR(d.realization_date)}</td>
                    <td>
                      {d.beneficiary_name} <span className={s.muted}>…{d.card_last4}</span>
                    </td>
                    <td>{d.guides}</td>
                    <td className={s.num}>{int(d.sessions)}</td>
                    <td className={s.num}>{brl(d.released_value)}</td>
                    <td className={s.num}>
                      {Number(d.gloss_value) === 0 ? <span className={s.badgeWarn}>pago em dobro?</span> : brl(d.gloss_value)}
                    </td>
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
