import { Titulo } from '../titulo'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { brl, dataBR } from '@/lib/financeiro/format'
import {
  DIAS_SEMANA_CURTO,
  MESES_PT,
  estadoItem,
  hojeSaoPaulo,
  intervaloMes,
  montarAgenda,
  valorItem,
  type Celula,
  type LinhaAgenda,
} from '@/lib/financeiro/agenda'
import type { CashflowCalendarRow } from '@/lib/financeiro/db-types'
import { ImportOrizonForm } from './import-orizon-form'
import { AutoConciliar } from '../banco/auto-conciliar'
import { ignorar } from '../banco/actions'
import { cancelarLancamento, desfazerRealizado, marcarRealizado, novoLancamento, salvarPrazo } from './actions'
import s from '../financeiro.module.css'
import a from './agenda.module.css'

export const metadata = { title: 'Agenda financeira — HOPE CORE' }

const num = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pad = (n: number) => String(n).padStart(2, '0')
const SEMANA_LONGA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const BASES: Record<string, string> = { envio: 'data de envio', liberacao: 'data de liberação', nf: 'emissão da nota fiscal' }

function mesVizinho(ano: number, mes: number, delta: number) {
  const d = new Date(Date.UTC(ano, mes - 1 + delta, 1))
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 }
}
const chaveMes = (ano: number, mes: number) => `${ano}-${pad(mes)}`

export default async function AgendaPage({ searchParams }: PageProps<'/financeiro/agenda'>) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return null

  const sp = await searchParams
  const hoje = hojeSaoPaulo()
  const m = /^(\d{4})-(\d{2})$/.exec(String(sp.mes ?? ''))
  const ano = m ? Number(m[1]) : Number(hoje.slice(0, 4))
  const mes = m ? Math.min(Math.max(Number(m[2]), 1), 12) : Number(hoje.slice(5, 7))
  const mesStr = chaveMes(ano, mes)
  const sel = String(sp.sel ?? '')
  const ok = typeof sp.ok === 'string' ? sp.ok : ''
  const erro = typeof sp.erro === 'string' ? sp.erro : ''
  const { inicio, fim } = intervaloMes(ano, mes)
  const ate = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 1, Number(hoje.slice(8, 10)) + 14))
    .toISOString()
    .slice(0, 10)

  // garante que todo demonstrativo (XML) importado já tem o recebimento previsto na Agenda
  await supabase.rpc('previstos_demonstrativos_sync')

  const [planosRes, rowsRes, saidasRes, feriadosRes, proximosRes] = await Promise.all([
    supabase
      .from('insurance_plans')
      .select('id, name, short_name, display_order, active, payment_days, payment_base, payment_business_day, operator_ans_code, tenant_id')
      .order('display_order', { ascending: true, nullsFirst: false }),
    supabase.from('cashflow_calendar').select('*').gte('calendar_date', inicio).lte('calendar_date', fim),
    supabase.from('cashflow_items').select('category').eq('kind', 'saida').neq('status', 'cancelado').limit(2000),
    supabase.from('bank_holidays').select('day, name').gte('day', inicio).lte('day', fim),
    supabase
      .from('cashflow_calendar')
      .select('*')
      .neq('status', 'realizado')
      .lte('calendar_date', ate)
      .order('calendar_date', { ascending: true })
      .limit(2000),
  ])
  const erroCarga = [planosRes, rowsRes, saidasRes, feriadosRes, proximosRes].find((r) => r.error)?.error
  const planos = (planosRes.data ?? []).filter((p) => p.active)
  const rows = (rowsRes.data ?? []) as CashflowCalendarRow[]
  const categoriasSaida = [...new Set((saidasRes.data ?? []).map((x) => x.category))].sort((x, y) => x.localeCompare(y, 'pt-BR'))
  const feriados = feriadosRes.data ?? []

  const agenda = montarAgenda(rows, {
    ano,
    mes,
    hojeIso: hoje,
    planos: planos.map((p, i) => ({ nome: p.short_name || p.name, ordem: Number(p.display_order ?? 50 + i) })),
    categoriasSaida,
    feriados: feriados.map((f) => f.day),
  })

  // célula selecionada: "YYYY-MM-DD|entrada|Bradesco"
  const [selDia, selKind, ...selCat] = sel.split('|')
  const selCategoria = selCat.join('|')
  const itensSel = sel
    ? rows
        .filter((r) => r.calendar_date === selDia && r.kind === selKind && r.category === selCategoria)
        .sort((x, y) => String(x.external_ref ?? '').localeCompare(String(y.external_ref ?? '')))
    : []

  // próximos 14 dias (inclui atrasados ainda não confirmados)
  const proximos = new Map<string, { total: number; porCat: Map<string, number>; atrasado: boolean }>()
  for (const r of (proximosRes.data ?? []) as CashflowCalendarRow[]) {
    if (r.kind !== 'entrada') continue
    const d = r.calendar_date
    const g = proximos.get(d) ?? { total: 0, porCat: new Map(), atrasado: d < hoje }
    g.total += valorItem(r)
    g.porCat.set(r.category, (g.porCat.get(r.category) ?? 0) + valorItem(r))
    proximos.set(d, g)
  }

  const linkSel = (dia: string, l: LinhaAgenda) =>
    `/financeiro/agenda?${new URLSearchParams({ mes: mesStr, sel: `${dia}|${l.kind}|${l.categoria}` })}#detalhe`

  const vizinhos = [-2, -1, 0, 1, 2, 3].map((d) => mesVizinho(ano, mes, d))
  const ant = mesVizinho(ano, mes, -1)
  const prox = mesVizinho(ano, mes, 1)

  const celula = (l: LinhaAgenda, c: Celula | undefined, dia: { dia: number; iso: string; fimDeSemana: boolean; hoje: boolean }) => {
    const classes = [dia.fimDeSemana ? a.fds : '', dia.hoje ? a.hojeCol : ''].join(' ')
    if (!c) return <td key={dia.dia} className={classes} />
    const selecionada = sel === `${dia.iso}|${l.kind}|${l.categoria}`
    return (
      <td key={dia.dia} className={classes}>
        <a
          className={`${a.celula} ${a[c.estado]} ${c.banco === 'conciliado' ? a.bancoConciliado : c.banco === 'sem_previsao' ? a.bancoSemPrevisao : ''} ${selecionada ? a.selecionada : ''}`}
          href={linkSel(dia.iso, l)}
          title={`${l.categoria} — ${dataBR(dia.iso)}: ${brl(c.valor)} (${c.itens.length} ${c.itens.length === 1 ? 'lançamento' : 'lançamentos'})${
            c.banco === 'conciliado' ? ' · conciliado com o extrato do Cora' : c.banco === 'sem_previsao' ? ' · entrou no Cora sem previsão' : ''
          }`}
        >
          {num(c.valor)}
          {c.banco && <span className={a.marcaBanco} aria-label={c.banco === 'conciliado' ? 'conciliado com o banco' : 'recebido no banco sem previsão'} />}
        </a>
      </td>
    )
  }

  const linhasTabela = (ls: LinhaAgenda[]) =>
    ls.map((l) => (
      <tr key={`${l.kind}-${l.categoria}`}>
        <td className={a.colCat}>{l.categoria}</td>
        {agenda.dias.map((d) => celula(l, l.porDia[d.dia], d))}
        <td className={a.colTotal}>{l.total ? num(l.total) : ''}</td>
      </tr>
    ))

  const totalLinha = (rotulo: string, porDia: Record<number, number>, total: number) => (
    <tr className={a.linhaTotal}>
      <td className={a.colCat}>{rotulo}</td>
      {agenda.dias.map((d) => (
        <td key={d.dia} className={d.hoje ? a.hojeCol : ''}>
          {porDia[d.dia] ? num(porDia[d.dia]) : ''}
        </td>
      ))}
      <td className={a.colTotal}>{num(total)}</td>
    </tr>
  )

  const totalEntradas = agenda.entradas.reduce((t, l) => t + l.total, 0)
  const totalSaidas = agenda.saidas.reduce((t, l) => t + l.total, 0)

  // lista por dia (celular): só dias com movimento
  const diasComMov = agenda.dias.filter((d) => agenda.entradaDia[d.dia] || agenda.saidaDia[d.dia])

  return (
    <>
      <Titulo titulo="Agenda financeira">
        O que entra e o que sai em cada dia, por plano de saúde e por despesa. Bradesco vem do relatório da Orizon (45 dias da
        data de envio, no próximo dia útil); Unimed vem do demonstrativo (XML), com pagamento previsto no dia 25 do mês seguinte; o resto é lançado aqui. Azul = previsto, verde =
        recebido/pago, vermelho = data passou e ainda não foi confirmado.
        <br />
        <br />
        Recebimentos que caem na conta do Cora são confirmados sozinhos ao abrir esta página (no máximo a cada 30 min). O que
        o banco não conseguiu casar aparece em Banco (Cora) → Entradas a conferir. Na grade: faixa verde escura + ponto =
        conciliado automaticamente com o extrato do Cora; borda tracejada = dinheiro que entrou no Cora sem nada previsto
        (particulares, Pix etc.), na linha do plano quando o pagador indica qual é.
      </Titulo>
      <AutoConciliar />

      {ok && <div className={s.alertGood}>{ok}</div>}
      {erro && <div className={s.alertBad}>{erro}</div>}
      {erroCarga && <div className={s.alertBad}>Erro ao carregar: {erroCarga.message}</div>}

      <nav className={a.mesNav} aria-label="Meses">
        <a className={a.seta} href={`/financeiro/agenda?mes=${chaveMes(ant.ano, ant.mes)}`} aria-label="Mês anterior">
          ‹
        </a>
        {vizinhos.map((v) => (
          <a
            key={chaveMes(v.ano, v.mes)}
            href={`/financeiro/agenda?mes=${chaveMes(v.ano, v.mes)}`}
            className={v.ano === ano && v.mes === mes ? a.mesAtual : ''}
          >
            {MESES_PT[v.mes - 1]}
            {v.ano !== Number(hoje.slice(0, 4)) ? ` ${v.ano}` : ''}
          </a>
        ))}
        <a className={a.seta} href={`/financeiro/agenda?mes=${chaveMes(prox.ano, prox.mes)}`} aria-label="Próximo mês">
          ›
        </a>
      </nav>

      <div className={a.cardsResumo}>
        <div className={`${a.cardResumo} ${a.corReceber}`}>
          <small>A receber em {MESES_PT[mes - 1].toLowerCase()}</small>
          <strong>{brl(agenda.resumo.aReceber)}</strong>
        </div>
        <div className={`${a.cardResumo} ${a.corRecebido}`}>
          <small>Recebido</small>
          <strong>{brl(agenda.resumo.recebido)}</strong>
        </div>
        <div className={`${a.cardResumo} ${a.corAtrasado}`}>
          <small>Não confirmado (data passou)</small>
          <strong>{brl(agenda.resumo.atrasado)}</strong>
        </div>
        <div className={`${a.cardResumo} ${a.corPagar}`}>
          <small>A pagar / pago</small>
          <strong>{brl(agenda.resumo.aPagar + agenda.resumo.pago)}</strong>
        </div>
        <div className={`${a.cardResumo} ${a.corSaldo}`}>
          <small>Saldo previsto do mês</small>
          <strong className={agenda.resumo.saldoPrevisto < 0 ? a.negativo : ''}>{brl(agenda.resumo.saldoPrevisto)}</strong>
        </div>
      </div>

      {/* ---------- grade do mês (computador / tablet) ---------- */}
      <div className={a.grade}>
        <div className={a.gradeScroll}>
          <table className={a.tabela}>
            <thead>
              <tr>
                <th className={a.colCat}>
                  {MESES_PT[mes - 1]} {ano}
                </th>
                {agenda.dias.map((d) => (
                  <th key={d.dia} className={`${d.fimDeSemana ? a.fds : ''} ${d.hoje ? a.hojeCol : ''}`}>
                    {DIAS_SEMANA_CURTO[d.semana]}
                    <b>{d.dia}</b>
                  </th>
                ))}
                <th className={a.colTotal}>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className={a.faixa}>
                <td colSpan={agenda.dias.length + 2}>A receber</td>
              </tr>
              {linhasTabela(agenda.entradas)}
              {totalLinha('Total a receber', agenda.entradaDia, totalEntradas)}
              <tr className={`${a.faixa} ${a.faixaSaida}`}>
                <td colSpan={agenda.dias.length + 2}>A pagar</td>
              </tr>
              {agenda.saidas.length ? (
                linhasTabela(agenda.saidas)
              ) : (
                <tr>
                  <td className={a.colCat} style={{ fontWeight: 400, color: 'var(--fin-muted)' }}>
                    Nenhuma despesa lançada
                  </td>
                  <td colSpan={agenda.dias.length + 1} />
                </tr>
              )}
              {totalLinha('Total a pagar', agenda.saidaDia, totalSaidas)}
              <tr className={a.linhaSaldo}>
                <td className={a.colCat}>Saldo do dia</td>
                {agenda.dias.map((d) => {
                  const v = (agenda.entradaDia[d.dia] ?? 0) - (agenda.saidaDia[d.dia] ?? 0)
                  return (
                    <td key={d.dia} className={`${d.hoje ? a.hojeCol : ''} ${v < 0 ? a.negativo : ''}`}>
                      {v ? num(v) : ''}
                    </td>
                  )
                })}
                <td className={`${a.colTotal} ${totalEntradas - totalSaidas < 0 ? a.negativo : ''}`}>{num(totalEntradas - totalSaidas)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className={a.legenda}>
          <span className={a.previsto}>previsto</span>
          <span className={a.realizado}>recebido / pago</span>
          <span className={a.atrasado}>data passou, não confirmado</span>
          <span className={a.misto}>parte confirmado</span>
          <span className={`${a.realizado} ${a.bancoConciliado} ${a.legendaBanco}`}>
            conciliado (Cora)
            <span className={a.marcaBanco} />
          </span>
          <span className={`${a.realizado} ${a.bancoSemPrevisao} ${a.legendaBanco}`}>
            entrou no Cora sem previsão
            <span className={a.marcaBanco} />
          </span>
          <span style={{ color: 'var(--fin-muted)' }}>Clique no valor para ver os lotes e confirmar o recebimento.</span>
        </div>
      </div>

      {/* ---------- lista por dia (celular) ---------- */}
      <div className={a.listaDias}>
        {diasComMov.length === 0 && <div className={s.alert}>Nada previsto em {MESES_PT[mes - 1].toLowerCase()}.</div>}
        {diasComMov.map((d) => (
          <div key={d.dia} className={`${a.diaCard} ${d.hoje ? a.diaHoje : ''}`}>
            <header>
              {pad(d.dia)}/{pad(mes)} <span>{SEMANA_LONGA[d.semana]}{d.hoje ? ' · hoje' : ''}</span>
            </header>
            {[...agenda.entradas, ...agenda.saidas]
              .filter((l) => l.porDia[d.dia])
              .map((l) => {
                const c = l.porDia[d.dia]
                return (
                  <a key={`${l.kind}-${l.categoria}`} className={`${a.diaLinha} ${a[c.estado]}`} href={linkSel(d.iso, l)}>
                    <span>
                      {l.kind === 'saida' ? '↓ ' : '↑ '}
                      {l.categoria}
                      {c.itens.length > 1 ? ` (${c.itens.length})` : ''}
                      {c.banco === 'conciliado' ? ' · conciliado (Cora)' : c.banco === 'sem_previsao' ? ' · Cora, sem previsão' : ''}
                    </span>
                    <strong>{brl(c.valor)}</strong>
                  </a>
                )
              })}
          </div>
        ))}
      </div>

      {/* ---------- detalhe da célula ---------- */}
      {sel && (
        <section id="detalhe" className={`${s.section} ${a.detalhe}`}>
          <h2 className={s.sectionTitle}>
            {selCategoria} — {dataBR(selDia)} ({selKind === 'saida' ? 'a pagar' : 'a receber'})
          </h2>
          <p className={s.sectionNote}>
            {itensSel.length} lançamento(s), total {brl(itensSel.reduce((t, r) => t + valorItem(r), 0))}.{' '}
            <a href={`/financeiro/agenda?mes=${mesStr}`}>Fechar</a>
          </p>
          <div className={a.itens}>
            {itensSel.map((r) => {
              const est = estadoItem(r, hoje)
              const hidden = (
                <>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="origem" value={r.origem} />
                  <input type="hidden" name="voltarMes" value={mesStr} />
                  <input type="hidden" name="voltarSel" value={sel} />
                </>
              )
              return (
                <div key={r.id} className={a.item}>
                  <div className={a.itemTopo}>
                    <span>
                      {r.source === 'orizon' && <>Lote/guia <strong>{r.external_ref}</strong> · enviado {dataBR(r.reference_date)}</>}
                      {r.source === 'nf' && <>{r.description}</>}
                      {r.source === 'manual' && <>{r.description || 'Lançamento manual'}</>}
                      {r.source === 'unimed_xml' && <>{r.description}</>}
                      {r.source === 'banco' && <>{r.description}</>}
                    </span>
                    <span>
                      <strong>{brl(valorItem(r))}</strong>{' '}
                      <span className={est === 'realizado' ? s.badgeGood : est === 'atrasado' ? s.badgeBad : s.badgeWarn}>
                        {est === 'realizado'
                          ? `${selKind === 'saida' ? 'pago' : 'recebido'} ${dataBR(r.realized_date)}`
                          : est === 'atrasado'
                            ? 'não confirmado'
                            : 'previsto'}
                      </span>
                      {r.origem === 'banco' ? (
                        <span className={s.badgeWarn} style={{ marginLeft: 6 }}>
                          Cora · sem previsão
                        </span>
                      ) : r.realized_source === 'banco' ? (
                        <span className={s.badgeInfo} style={{ marginLeft: 6 }} title="Confirmado automaticamente pelo extrato do Cora">
                          conciliado (Cora)
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className={a.itemAcoes}>
                    {r.origem === 'banco' ? (
                      <>
                        <a className={s.buttonSmall} href="/financeiro/banco#conciliacao">
                          Vincular a um previsto
                        </a>
                        <form action={ignorar}>
                          <input type="hidden" name="tx" value={r.id} />
                          <input type="hidden" name="ignorar" value="1" />
                          <button className={a.botaoSec} title="Ex.: transferência própria — some da Agenda">
                            Não é recebimento da clínica
                          </button>
                        </form>
                      </>
                    ) : r.status !== 'realizado' ? (
                      <form action={marcarRealizado} className={a.itemAcoes}>
                        {hidden}
                        <label className={s.field}>
                          Data
                          <input type="date" name="data" defaultValue={r.calendar_date <= hoje ? r.calendar_date : hoje} required />
                        </label>
                        <label className={s.field}>
                          Valor
                          <input name="valor" defaultValue={num(Number(r.amount))} inputMode="decimal" required />
                        </label>
                        <button className={s.buttonSmall}>{selKind === 'saida' ? 'Confirmar pagamento' : 'Confirmar recebimento'}</button>
                      </form>
                    ) : (
                      <form action={desfazerRealizado}>
                        {hidden}
                        <button className={a.botaoSec}>Desfazer confirmação</button>
                      </form>
                    )}
                    {r.source === 'manual' && (
                      <form action={cancelarLancamento}>
                        {hidden}
                        <button className={a.botaoSec}>Excluir lançamento</button>
                      </form>
                    )}
                  </div>
                </div>
              )
            })}
            {!itensSel.length && <div className={s.muted}>Nada neste dia.</div>}
          </div>
        </section>
      )}

      {/* ---------- próximos 14 dias ---------- */}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>Próximos recebimentos (até {dataBR(ate)})</h2>
        <p className={s.sectionNote}>Inclui o que já passou da data e ainda não foi confirmado.</p>
        <div className={a.proximos} style={{ marginBottom: 12 }}>
          {[...proximos.entries()].map(([d, g]) => (
            <a
              key={d}
              className={a.proximoDia}
              href={`/financeiro/agenda?mes=${d.slice(0, 7)}`}
              style={g.atrasado ? { background: 'var(--fin-bad-soft)', color: 'var(--fin-bad)' } : undefined}
            >
              <span>
                <strong>{dataBR(d)}</strong> {g.atrasado ? '· não confirmado' : ''}
              </span>
              <span>
                {[...g.porCat.entries()].map(([c, v]) => `${c} ${brl(v)}`).join(' · ')} — <strong>{brl(g.total)}</strong>
              </span>
            </a>
          ))}
          {!proximos.size && <div className={s.muted}>Nada previsto.</div>}
        </div>
      </section>

      <div className={a.duasColunas}>
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Novo lançamento</h2>
          <p className={s.sectionNote}>Planos sem importação automática, despesas (INSS, salas…) e valores avulsos.</p>
          <form action={novoLancamento} className={s.form} style={{ maxWidth: 'none', marginBottom: 12 }}>
            <input type="hidden" name="voltarMes" value={mesStr} />
            <div className={s.formRow}>
              <label className={s.field}>
                Tipo
                <select name="kind" defaultValue="entrada">
                  <option value="entrada">A receber</option>
                  <option value="saida">A pagar</option>
                </select>
              </label>
              <label className={s.field}>
                Plano (a receber)
                <select name="plano" defaultValue="">
                  <option value="">—</option>
                  {planos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.short_name || p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className={s.field}>
              Despesa ou outra origem (se não for plano)
              <input name="categoria" list="categorias-saida" placeholder="ex.: INSS, Sala 507, Sala 311" />
              <datalist id="categorias-saida">
                {['INSS', 'Sala 507', 'Sala 311', ...categoriasSaida].filter((v, i, arr) => arr.indexOf(v) === i).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <div className={s.formRow}>
              <label className={s.field}>
                Data
                <input type="date" name="data" required defaultValue={mesStr === hoje.slice(0, 7) ? hoje : inicio} />
              </label>
              <label className={s.field}>
                Valor (R$)
                <input name="valor" required inputMode="decimal" placeholder="10.000,00" />
              </label>
              <label className={s.field}>
                Repetir por
                <select name="repetir" defaultValue="1">
                  {[1, 2, 3, 4, 5, 6, 12].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? 'só este mês' : `${n} meses`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className={s.field}>
              Descrição (opcional)
              <input name="descricao" placeholder="ex.: guia INSS setembro" />
            </label>
            <button className={s.button}>Lançar</button>
          </form>
        </section>

        <section className={s.section}>
          <h2 className={s.sectionTitle}>Importar Bradesco (Orizon)</h2>
          <p className={s.sectionNote}>
            Portal Orizon → Relatórios → “Lotes Exportados e Liberados” → Excel. Pode importar o mesmo período de novo: lotes
            repetidos não duplicam.
          </p>
          <div style={{ marginBottom: 12 }}>
            <ImportOrizonForm />
          </div>
        </section>
      </div>

      <section className={s.section}>
        <details>
          <summary>Prazos de pagamento por plano</summary>
          <p className={s.sectionNote}>
            Define a data prevista dos lotes importados e das notas fiscais sem data informada. Dias corridos; com “dia útil”, se
            cair em fim de semana ou feriado bancário vai para o próximo dia útil.
          </p>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Plano</th>
                  <th>Prazo atual</th>
                  <th>Alterar</th>
                </tr>
              </thead>
              <tbody>
                {planos.map((p) => (
                  <tr key={p.id}>
                    <td>{p.short_name || p.name}</td>
                    <td>
                      {p.payment_days != null
                        ? `${p.payment_days} dias da ${BASES[p.payment_base ?? 'envio']}${p.payment_business_day ? ' (dia útil)' : ''}`
                        : <span className={s.muted}>não definido</span>}
                    </td>
                    <td>
                      <form action={salvarPrazo} className={a.itemAcoes}>
                        <input type="hidden" name="plano" value={p.id} />
                        <input type="hidden" name="voltarMes" value={mesStr} />
                        <input name="dias" type="number" min={0} max={365} defaultValue={p.payment_days ?? ''} placeholder="dias" style={{ width: 80 }} />
                        <select name="base" defaultValue={p.payment_base ?? 'envio'} className={a.botaoSec}>
                          <option value="envio">da data de envio</option>
                          <option value="liberacao">da liberação</option>
                          <option value="nf">da nota fiscal</option>
                        </select>
                        <label style={{ fontSize: 13 }}>
                          <input type="checkbox" name="util" defaultChecked={p.payment_business_day !== false} style={{ width: 'auto' }} /> dia útil
                        </label>
                        <button className={a.botaoSec}>Salvar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </>
  )
}
