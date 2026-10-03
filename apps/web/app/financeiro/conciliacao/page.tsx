import { Titulo } from '../titulo'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { dataBR } from '@/lib/financeiro/format'
import { MESES, processarRelatorio, type BaseRpaLegado, type LinhaRelatorio } from '@/lib/financeiro/rpa-legado'
import {
  ALERTAS,
  motorCentralAtivo,
  statusConciliacao,
  type AlertaAtendimento,
  type DivergenciaUnimed,
  type FechamentoMotor,
  type FotoFechamento,
  type Pendencia,
  type MesResumo,
  situacaoMes,
} from '@/lib/financeiro/motor'
import { fecharCompetencia } from './actions'
import s from '../financeiro.module.css'

export const metadata = { title: 'Conciliação — HOPE CORE' }
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NOMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const brl = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

// Fechamento de SETEMBRO/2026 aprovado na auditoria (não pode mudar)
// (qtd_ok = 714: 709 com valor em número + 5 "R$ 45,00" em texto da Josane — a auditoria tinha contado só os 709)
const REFERENCIA_SET_2026 = { total_bruto: 32924.5, repasse_bruto: 13169.8, inss: 1290.28, liquido: 11879.52, qtd_ok: 714 }

function valorCelula(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'vazio'
  if (typeof v === 'number') return brl(v)
  return `"${String(v)}"`
}

const COR_STATUS: Record<string, string> = {
  CONCILIADO: s.badgeGood,
  PENDENTE: s.badgeWarn,
  DIVERGENTE: s.badgeBad,
  'SEM VALOR': s.badge,
  'ERRO DE SINCRONIZAÇÃO': s.badgeBad,
  'SÓ NO MOTOR': s.badgeInfo,
}

export default async function ConciliacaoPage({ searchParams }: PageProps<'/financeiro/conciliacao'>) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return null

  const sp = await searchParams
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const mesPadrao = agora.getMonth() === 0 ? 12 : agora.getMonth() // mês anterior
  const anoPadrao = agora.getMonth() === 0 ? agora.getFullYear() - 1 : agora.getFullYear()
  const mes = Number(sp.mes) >= 1 && Number(sp.mes) <= 12 ? Number(sp.mes) : mesPadrao
  const ano = /^\d{4}$/.test(String(sp.ano)) ? Number(sp.ano) : anoPadrao
  const competencia = `${ano}-${String(mes).padStart(2, '0')}-01`
  const erroAcao = typeof sp.erro === 'string' ? sp.erro : null

  const [motorR, fotoR, alertasR, varreduraR, pendR, baseR, pagR, anoR] = await Promise.all([
    supabase.rpc('fin_fechamento_mes', { p_ano: ano, p_mes: mes }),
    supabase.rpc('fin_fechamento_foto', { p_ano: ano, p_mes: mes }),
    supabase.rpc('fin_alertas_mes', { p_ano: ano, p_mes: mes }),
    supabase.rpc('fin_varredura_unimed_33'),
    supabase.rpc('fin_pendencias'),
    supabase.rpc('legacy_rpa_base'),
    supabase.from('repasse_pagamentos').select('spreadsheet_id, valor_pago, pago, data_pagamento').eq('competencia', competencia),
    supabase.rpc('fin_resumo_ano', { p_ano: ano }),
  ])

  if (motorR.error) {
    return (
      <>
        <Titulo titulo="Conciliação financeira">Faturamento × Motor central × RPA × Pagamentos.</Titulo>
        <div className={s.alertBad}>
          O motor financeiro ainda não está disponível no banco ({motorR.error.message}). Aplique a migration_030 no SQL Editor do Supabase.
        </div>
      </>
    )
  }

  const motor = motorR.data as unknown as FechamentoMotor
  const foto = (fotoR.data ?? null) as unknown as FotoFechamento | null
  const alertas = (alertasR.data ?? []) as unknown as AlertaAtendimento[]
  const varredura = (varreduraR.data ?? []) as unknown as DivergenciaUnimed[]
  const pendencias = ((pendR.data ?? []) as unknown as Pendencia[]).filter((p) => !p.regularizado)

  let legado: LinhaRelatorio[] = []
  let erroLegado: string | null = baseR.error?.message ?? null
  if (!baseR.error) {
    try {
      legado = processarRelatorio(baseR.data as unknown as BaseRpaLegado, MESES[mes - 1], ano).relatorioFinal
    } catch (e) {
      erroLegado = (e as Error).message
    }
  }
  const legadoPorId = new Map(legado.map((l) => [l.id, l]))
  const fotoPorId = new Map((foto?.profissionais ?? []).map((p) => [p.spreadsheet_id, p]))
  const pagoPorId = new Map((pagR.data ?? []).filter((p) => p.pago).map((p) => [p.spreadsheet_id, p]))

  const linhas = motor.profissionais.map((p) => {
    const leg = legadoPorId.get(p.spreadsheet_id)
    const ft = fotoPorId.get(p.spreadsheet_id)
    const pg = pagoPorId.get(p.spreadsheet_id)
    const liquidoRpa = leg && !leg.erro ? leg.valorLiquido : null
    const st = statusConciliacao({
      erro: p.erro_sincronizacao,
      liquidoMotor: p.liquido === null ? null : Number(p.liquido),
      liquidoRpa,
      liquidoFoto: ft ? Number(ft.liquido) : null,
      pago: pg ? Number(pg.valor_pago) : null,
    })
    return { p, leg, ft, pg, liquidoRpa, ...st }
  })
  const semErro = linhas.filter((l) => !l.p.erro_sincronizacao)
  const soma = (f: (l: (typeof linhas)[number]) => number) => r2(semErro.reduce((t, l) => t + f(l), 0))
  const tot = {
    qtd_ok: semErro.reduce((t, l) => t + l.p.qtd_ok, 0),
    total_bruto: soma((l) => Number(l.p.total_bruto)),
    repasse_bruto: soma((l) => Number(l.p.repasse_bruto)),
    inss: soma((l) => Number(l.p.inss ?? 0)),
    liquido: soma((l) => Number(l.p.liquido ?? 0)),
    parcela_hope: soma((l) => Number(l.p.parcela_hope)),
    rpa: r2(legado.reduce((t, l) => t + (l.erro ? 0 : l.valorLiquido), 0)),
    pago: r2([...pagoPorId.values()].reduce((t, p) => t + Number(p.valor_pago), 0)),
  }
  const pendente = r2(linhas.filter((l) => !l.pg && !l.p.erro_sincronizacao).reduce((t, l) => t + Number(l.p.liquido ?? 0), 0))
  const divergentes = linhas.filter((l) => l.status === 'DIVERGENTE').length

  // Validação de SETEMBRO/2026 (critério para ligar FIN_MOTOR=central)
  const ehSetembro = competencia === '2026-09-01'
  const conferencia = ehSetembro
    ? (Object.keys(REFERENCIA_SET_2026) as (keyof typeof REFERENCIA_SET_2026)[]).map((k) => ({
        k,
        esperado: REFERENCIA_SET_2026[k],
        motor: tot[k],
        ok: Math.abs(REFERENCIA_SET_2026[k] - tot[k]) < 0.005,
      }))
    : []
  const motorIgualRpa = semErro.filter((l) => l.liquidoRpa !== null).every((l) => Math.abs(Number(l.p.liquido ?? 0) - (l.liquidoRpa ?? 0)) < 0.005)

  const contagemAlertas = new Map<string, number>()
  for (const a of alertas) for (const c of a.alertas) contagemAlertas.set(c, (contagemAlertas.get(c) ?? 0) + 1)

  // Resumo do ano (visão da clínica), mês a mês
  const resumoAno = ((anoR.data ?? []) as unknown as MesResumo[])
  const hojeCompetencia = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-01`
  const somaAno = (k: 'qtd_ok' | 'total_bruto' | 'parcela_hope' | 'repasse_bruto' | 'inss' | 'liquido' | 'pago') =>
    r2(resumoAno.reduce((t, m) => t + Number(m[k] || 0), 0))
  const COR_SIT = { bom: s.badgeGood, ruim: s.badgeBad, atencao: s.badgeWarn, neutro: s.badge }

  const mesEncerrado = competencia < `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-01`

  return (
    <>
      <Titulo titulo="Conciliação financeira">
        Compara, por profissional, o <strong>motor financeiro central</strong> (regra única no banco) com o <strong>RPA atual</strong>, a{' '}
        <strong>foto do mês fechado</strong> e o que foi <strong>pago</strong>. Competência = coluna A (data de lançamento). Divergência não é
        corrigida sozinha: aparece aqui. Telas de Repasse e Pagamentos usam hoje:{' '}
        {motorCentralAtivo() ? <span className={s.badgeGood}>motor central</span> : <span className={s.badgeInfo}>RPA atual (modo sombra)</span>}.
      </Titulo>

      <form className={s.formRow} method="get" style={{ marginBottom: 16 }}>
        <label className={s.field}>
          Mês
          <select name="mes" defaultValue={mes}>
            {NOMES.map((n, i) => (
              <option key={n} value={i + 1}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className={s.field}>
          Ano
          <input name="ano" defaultValue={ano} size={5} inputMode="numeric" />
        </label>
        <button className={s.button} type="submit">
          Ver
        </button>
      </form>

      {erroAcao && <div className={s.alertBad}>{erroAcao}</div>}
      {sp.fechado === '1' && <div className={s.alertGood}>Competência fechada: a foto foi gravada.</div>}
      {erroLegado && <div className={s.alertWarn}>Não foi possível calcular o RPA atual para comparar: {erroLegado}</div>}

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Mês a mês — visão da clínica — {ano}</h2>
        <form className={s.formRow} method="get" style={{ marginBottom: 12 }}>
          <input type="hidden" name="mes" value={mes} />
          <label className={s.field}>
            Ano
            <select name="ano" defaultValue={ano}>
              {Array.from({ length: Math.max(1, agora.getFullYear() - 2024 + 1) }, (_, i) => agora.getFullYear() - i).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <button className={s.button} type="submit">
            Ver ano
          </button>
        </form>
        {anoR.error ? (
          <div className={s.alertWarn}>Resumo do ano indisponível: {anoR.error.message}</div>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className={s.num}>Atendimentos OK</th>
                  <th className={s.num}>Faturamento bruto</th>
                  <th className={s.num}>Parcela Bruta Hope</th>
                  <th className={s.num}>Repasse bruto (profissionais)</th>
                  <th className={s.num}>INSS retido</th>
                  <th className={s.num}>Líquido a pagar</th>
                  <th className={s.num}>Pago</th>
                  <th className={s.num}>Falta pagar</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {resumoAno.map((m) => {
                  const n = Number(m.competencia.slice(5, 7))
                  const sit = situacaoMes(m, hojeCompetencia)
                  const falta = r2(Math.max(0, Number(m.liquido) - Number(m.pago)))
                  const vazio = m.competencia > hojeCompetencia && !m.qtd_ok
                  return (
                    <tr key={m.competencia} style={n === mes ? { fontWeight: 600 } : undefined}>
                      <td>
                        <a className={s.link} href={`/financeiro/conciliacao?ano=${ano}&mes=${n}`}>
                          {NOMES[n - 1]}
                        </a>
                        {m.foto && <span className={s.badgeGood} style={{ marginLeft: 6 }}>fechado</span>}
                      </td>
                      <td className={s.num}>{vazio ? '—' : m.qtd_ok}</td>
                      <td className={s.num}>{vazio ? '—' : brl(m.total_bruto)}</td>
                      <td className={s.numGood}>{vazio ? '—' : brl(m.parcela_hope)}</td>
                      <td className={s.num}>{vazio ? '—' : brl(m.repasse_bruto)}</td>
                      <td className={s.num}>{vazio ? '—' : brl(m.inss)}</td>
                      <td className={s.num}>{vazio ? '—' : brl(m.liquido)}</td>
                      <td className={s.num}>{vazio ? '—' : brl(m.pago)}</td>
                      <td className={falta > 0 && m.competencia < hojeCompetencia ? s.numBad : s.num}>{vazio ? '—' : brl(falta)}</td>
                      <td>
                        <span className={COR_SIT[sit.tipo]}>{sit.texto}</span>
                        {m.divergencias_unimed > 0 && <div className={s.muted}>{m.divergencias_unimed} Unimed com valor ≠ R$ 33</div>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total {ano}</td>
                  <td className={s.num}>{somaAno('qtd_ok')}</td>
                  <td className={s.num}>{brl(somaAno('total_bruto'))}</td>
                  <td className={s.num}>{brl(somaAno('parcela_hope'))}</td>
                  <td className={s.num}>{brl(somaAno('repasse_bruto'))}</td>
                  <td className={s.num}>{brl(somaAno('inss'))}</td>
                  <td className={s.num}>{brl(somaAno('liquido'))}</td>
                  <td className={s.num}>{brl(somaAno('pago'))}</td>
                  <td className={s.num}>{brl(r2(Math.max(0, somaAno('liquido') - somaAno('pago'))))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className={s.sectionNote}>
          Totais da clínica pelo motor central (competência = coluna A). Faturamento bruto = Parcela Bruta Hope + repasse bruto aos
          profissionais; o INSS retido sai do repasse e não é receita da Hope. Pago = Pagamentos de repasse marcados como pagos (controle
          começou em 09/2026). Clique no mês para ver o detalhe.
        </p>
      </section>

      {ehSetembro && (
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Validação de SETEMBRO/2026 (antes de ligar o motor central)</h2>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className={s.num}>Aprovado na auditoria</th>
                  <th className={s.num}>Motor hoje</th>
                  <th>Confere</th>
                </tr>
              </thead>
              <tbody>
                {conferencia.map((c) => (
                  <tr key={c.k}>
                    <td>{{ total_bruto: 'Bruto', repasse_bruto: 'Repasse bruto', inss: 'INSS', liquido: 'Líquido', qtd_ok: 'Atendimentos OK' }[c.k]}</td>
                    <td className={s.num}>{c.k === 'qtd_ok' ? c.esperado : brl(c.esperado)}</td>
                    <td className={s.num}>{c.k === 'qtd_ok' ? c.motor : brl(c.motor)}</td>
                    <td>{c.ok ? <span className={s.badgeGood}>OK</span> : <span className={s.badgeBad}>DIFERENTE</span>}</td>
                  </tr>
                ))}
                <tr>
                  <td>Motor × RPA atual, profissional a profissional</td>
                  <td colSpan={2} />
                  <td>{motorIgualRpa ? <span className={s.badgeGood}>OK</span> : <span className={s.badgeBad}>DIFERENTE</span>}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className={s.cards}>
        <div className={s.card}>
          <div className={s.cardLabel}>Bruto financeiro ({tot.qtd_ok} OK)</div>
          <div className={s.cardValue}>{brl(tot.total_bruto)}</div>
        </div>
        <div className={s.card}>
          <div className={s.cardLabel}>Repasse bruto profissionais</div>
          <div className={s.cardValue}>{brl(tot.repasse_bruto)}</div>
        </div>
        <div className={s.card}>
          <div className={s.cardLabel}>INSS retido (não é receita da Hope)</div>
          <div className={s.cardValue}>{brl(tot.inss)}</div>
        </div>
        <div className={s.card}>
          <div className={s.cardLabel}>Líquido a pagar</div>
          <div className={s.cardValue}>{brl(tot.liquido)}</div>
        </div>
        <div className={s.cardGood}>
          <div className={s.cardLabel}>Parcela Bruta Hope</div>
          <div className={s.cardValue}>{brl(tot.parcela_hope)}</div>
        </div>
        <div className={s.card}>
          <div className={s.cardLabel}>Pago / pendente</div>
          <div className={s.cardValue}>
            {brl(tot.pago)} / {brl(pendente)}
          </div>
        </div>
        <div className={divergentes ? s.cardBad : s.card}>
          <div className={s.cardLabel}>Divergências</div>
          <div className={s.cardValue}>{divergentes}</div>
        </div>
      </div>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>
          Por profissional — {NOMES[mes - 1]}/{ano}{' '}
          {foto ? (
            <span className={s.badgeGood}>fechado em {dataBR(foto.fechado_em.slice(0, 10))}</span>
          ) : (
            <span className={s.badge}>não fechado</span>
          )}
        </h2>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Profissional</th>
                <th>Tipo</th>
                <th className={s.num}>OK</th>
                <th className={s.num}>Bruto</th>
                <th className={s.num}>Repasse bruto</th>
                <th className={s.num}>INSS</th>
                <th className={s.num}>Líquido (motor)</th>
                <th className={s.num}>Líquido (RPA atual)</th>
                <th className={s.num}>Foto</th>
                <th className={s.num}>Pago</th>
                <th className={s.num}>Parcela Hope</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.p.spreadsheet_id}>
                  <td>
                    {l.p.profissional}
                    {l.p.desligada && <span className={s.badge}> desligada</span>}
                    {l.p.qtd_unimed33 > 0 && <div className={s.muted}>{l.p.qtd_unimed33} Unimed R$ 33</div>}
                  </td>
                  <td>{l.p.tipo === 'CNPJ' ? `CNPJ ${l.p.percentual_cnpj}%` : 'PF'}</td>
                  <td className={s.num}>{l.p.qtd_ok}</td>
                  <td className={s.num}>{brl(l.p.total_bruto)}</td>
                  <td className={s.num}>{brl(l.p.repasse_bruto)}</td>
                  <td className={s.num}>{brl(l.p.inss)}</td>
                  <td className={s.num}>
                    <strong>{brl(l.p.liquido)}</strong>
                  </td>
                  <td className={s.num}>{brl(l.liquidoRpa)}</td>
                  <td className={s.num}>{brl(l.ft?.liquido)}</td>
                  <td className={s.num}>{brl(l.pg ? Number(l.pg.valor_pago) : null)}</td>
                  <td className={s.num}>{brl(l.p.parcela_hope)}</td>
                  <td>
                    <span className={COR_STATUS[l.status] ?? s.badge}>{l.status}</span>
                    <div className={s.muted}>{l.motivo}</div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td className={s.num}>{tot.qtd_ok}</td>
                <td className={s.num}>{brl(tot.total_bruto)}</td>
                <td className={s.num}>{brl(tot.repasse_bruto)}</td>
                <td className={s.num}>{brl(tot.inss)}</td>
                <td className={s.num}>{brl(tot.liquido)}</td>
                <td className={s.num}>{brl(tot.rpa)}</td>
                <td className={s.num}>{brl(foto?.liquido)}</td>
                <td className={s.num}>{brl(tot.pago)}</td>
                <td className={s.num}>{brl(tot.parcela_hope)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className={s.sectionNote}>
          RPA atual = cálculo de hoje do Sistema Mestre RPA (só profissionais na aba ID). O motor também inclui quem foi desligado, para o
          histórico não sumir. Profissional com erro de leitura da planilha fica fora dos totais (igual ao RPA).
        </p>
        {!foto && mesEncerrado && (
          <form action={fecharCompetencia} className={s.formRow} style={{ marginTop: 12 }}>
            <input type="hidden" name="ano" value={ano} />
            <input type="hidden" name="mes" value={mes} />
            <label className={s.field}>
              Observação (opcional)
              <input name="observacao" maxLength={500} size={40} />
            </label>
            <button className={s.button} type="submit">
              Fechar {NOMES[mes - 1]}/{ano} (gravar foto)
            </button>
          </form>
        )}
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Unimed 0025/25 com valor diferente de R$ 33 na planilha ({varredura.length})</h2>
        <p className={s.sectionNote}>
          Varredura de toda a competência a partir de 01/10/2026. Só leitura: o fechamento já usa R$ 33 (R$ 18 profissional / R$ 15 Hope); a
          planilha não é alterada. A correção da origem só com autorização.
        </p>
        {varredura.length === 0 ? (
          <p className={s.muted}>Nenhuma divergência.</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Profissional</th>
                  <th>Competência</th>
                  <th>ID do atendimento</th>
                  <th>Data da sessão</th>
                  <th>Status</th>
                  <th className={s.num}>Valor registrado</th>
                  <th className={s.num}>Valor correto</th>
                </tr>
              </thead>
              <tbody>
                {varredura.map((v) => (
                  <tr key={`${v.profissional}-${v.linha}-${v.competencia}`}>
                    <td>{v.profissional}</td>
                    <td>{v.competencia.slice(5, 7)}/{v.competencia.slice(0, 4)}</td>
                    <td>{v.id_atendimento}</td>
                    <td>{v.data_sessao ? dataBR(v.data_sessao) : '—'}</td>
                    <td>{v.status || 'sem status'}</td>
                    <td className={s.numBad}>{valorCelula(v.valor_registrado)}</td>
                    <td className={s.num}>{brl(v.valor_esperado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Alertas dos atendimentos de {NOMES[mes - 1]}/{ano}</h2>
        {contagemAlertas.size === 0 ? (
          <p className={s.muted}>Nenhum alerta.</p>
        ) : (
          <>
            <ul className={s.list}>
              {[...contagemAlertas.entries()].map(([c, n]) => (
                <li key={c}>
                  <strong>{n}</strong> × {ALERTAS[c] ?? c} <code>{c}</code>
                </li>
              ))}
            </ul>
            <details style={{ marginTop: 8 }}>
              <summary>Ver atendimentos ({alertas.length})</summary>
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Profissional</th>
                      <th>Linha</th>
                      <th>Sessão</th>
                      <th>Status</th>
                      <th>Plano</th>
                      <th className={s.num}>Registrado</th>
                      <th className={s.num}>Aplicado</th>
                      <th>Regra</th>
                      <th>Alertas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alertas.slice(0, 500).map((a) => (
                      <tr key={`${a.spreadsheet_id}-${a.linha}`}>
                        <td>{a.profissional}</td>
                        <td>{a.id_atendimento ?? a.linha}</td>
                        <td>{a.data_sessao ? dataBR(a.data_sessao) : '—'}</td>
                        <td>{a.status || 'sem status'}</td>
                        <td>{a.plano || '—'}</td>
                        <td className={s.num}>{valorCelula(a.valor_registrado)}</td>
                        <td className={s.num}>{brl(a.valor_bruto)}</td>
                        <td>{a.regra}</td>
                        <td>{a.alertas.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Alterados depois do fechamento ({pendencias.length})</h2>
        <p className={s.sectionNote}>
          Atendimento incluído, alterado ou retirado numa competência já fechada. O mês não é reaberto e o valor não vai sozinho para o mês
          seguinte: fica aqui para decisão administrativa.
        </p>
        {pendencias.length === 0 ? (
          <p className={s.muted}>Nenhuma pendência.</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Competência</th>
                  <th>Profissional</th>
                  <th>Situação</th>
                  <th>Linha / ID</th>
                  <th className={s.num}>Hoje</th>
                  <th className={s.num}>Na foto</th>
                </tr>
              </thead>
              <tbody>
                {pendencias.map((p, i) => (
                  <tr key={i}>
                    <td>{p.competencia.slice(5, 7)}/{p.competencia.slice(0, 4)}</td>
                    <td>{p.profissional ?? p.spreadsheet_id}</td>
                    <td>
                      <span className={s.badgeWarn}>{p.situacao === 'NOVO_OU_ALTERADO' ? 'Novo ou alterado' : 'Retirado ou alterado'}</span>
                    </td>
                    <td>{p.id_atendimento ?? p.linha ?? '—'}</td>
                    <td className={s.num}>{brl(p.valor_atual)}</td>
                    <td className={s.num}>{brl(p.valor_fechado)}</td>
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
