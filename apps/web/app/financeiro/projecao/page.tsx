import { Titulo } from '../titulo'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { brl, int } from '@/lib/financeiro/format'
import { configCora, saldoCora } from '@/lib/cora/cliente'
import {
  PLANOS,
  ROTULO_PLANO,
  leituras,
  nomeMes,
  pontoDeEquilibrio,
  projetar,
  type BaseProjecao,
  type Faixa,
  type Projecao,
} from '@/lib/financeiro/projecao'
import { GraficoFaixa, type PontoGrafico } from './grafico'
import s from '../financeiro.module.css'
import g from './projecao.module.css'

export const metadata = { title: 'Projeção — HOPE CORE' }
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const rot = (mes: string) => `${CURTO[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`
const pc = (v: number | null | undefined, casas = 0) =>
  v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: casas })}%`
const n1 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }))
const mil = (v: number) => brl(Math.round(v))

function Celula({ f, tipo }: { f: Faixa; tipo: 'int' | 'brl' }) {
  const fmt = (v: number) => (tipo === 'brl' ? mil(v) : int(Math.round(v)))
  return (
    <td className={f.p50 < 0 ? g.neg : undefined}>
      {fmt(f.p50)}
      <span className={g.faixaTxt}>
        {fmt(f.p10)} a {fmt(f.p90)}
      </span>
    </td>
  )
}

export default async function ProjecaoPage({ searchParams }: PageProps<'/financeiro/projecao'>) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return null
  const sp = await searchParams
  const metaParam = Number(String(sp.meta ?? '').replace(/\D/g, '')) || null

  const cfg = configCora()
  const [{ data, error }, saldo] = await Promise.all([
    supabase.rpc('projecao_base'),
    cfg
      ? saldoCora(cfg)
          .then((r) => Number(r.balance))
          .catch(() => null)
      : Promise.resolve(null),
  ])

  if (error || !data) {
    return (
      <>
        <Titulo titulo="Projeção">Curva de vendas e projeção de caixa com probabilidades.</Titulo>
        <div className={s.alertBad}>Erro ao buscar os dados da projeção: {error?.message ?? 'sem dados'}</div>
      </>
    )
  }

  const p: Projecao = projetar(data as unknown as BaseProjecao, {
    saldoInicial: saldo !== null && Number.isFinite(saldo) ? saldo : null,
    meta: metaParam,
  })
  const frases = leituras(p)
  const pe = pontoDeEquilibrio(p)
  const prox = p.meses[0]
  const ultimoMesProj = p.meses[p.meses.length - 1]
  const pm = p.premissas

  // ---------- séries dos gráficos (8 meses de histórico + 4 projetados) ----------
  const hist = p.historico.slice(-8)
  const pontosSessoes: PontoGrafico[] = [
    ...hist.map((h) =>
      h.parcial
        ? { rotulo: rot(h.mes), real: h.sessoes, p10: p.nowcast.sessoes.p10, p50: p.nowcast.sessoes.p50, p90: p.nowcast.sessoes.p90, parcial: true }
        : { rotulo: rot(h.mes), real: h.sessoes, p10: null, p50: null, p90: null },
    ),
    ...p.meses.map((m) => ({ rotulo: rot(m.mes), real: null, p10: m.sessoes.p10, p50: m.sessoes.p50, p90: m.sessoes.p90 })),
  ]
  const histCaixa = hist.filter((h) => h.temCaixa)
  const pontosReceita: PontoGrafico[] = [
    ...histCaixa.map((h) => ({ rotulo: rot(h.mes), real: h.receitaTotal, p10: null, p50: null, p90: null })),
    ...p.meses.map((m) => ({ rotulo: rot(m.mes), real: null, p10: m.receitaTotal.p10, p50: m.receitaTotal.p50, p90: m.receitaTotal.p90 })),
  ]
  const pontosResultado: PontoGrafico[] = [
    ...histCaixa.map((h) => ({ rotulo: rot(h.mes), real: h.resultado, p10: null, p50: null, p90: null })),
    ...p.meses.map((m) => ({ rotulo: rot(m.mes), real: null, p10: m.resultado.p10, p50: m.resultado.p50, p90: m.resultado.p90 })),
  ]
  const pontosSaldo: PontoGrafico[] | null =
    p.saldoInicial === null
      ? null
      : [
          { rotulo: 'Hoje', real: p.saldoInicial, p10: null, p50: null, p90: null },
          ...p.meses.map((m) => ({ rotulo: rot(m.mes), real: null, p10: m.saldo!.p10, p50: m.saldo!.p50, p90: m.saldo!.p90 })),
        ]

  const maxSens = Math.max(1, ...p.sensibilidade.flatMap((x) => [Math.abs(x.baixo), Math.abs(x.alto)]))
  const larg = (v: number) => `${(Math.abs(v) / maxSens) * 48}%`

  const linhas: { rotulo: string; chave: keyof (typeof p.meses)[number]; tipo: 'int' | 'brl'; destaque?: boolean; sinal?: string }[] = [
    { rotulo: 'Sessões realizadas', chave: 'sessoes', tipo: 'int', destaque: true },
    { rotulo: 'Receita Unimed (XML pago no Cora)', chave: 'receitaUnimed', tipo: 'brl', sinal: '+' },
    { rotulo: 'Receita Bradesco (lotes Orizon, outro banco)', chave: 'receitaBradesco', tipo: 'brl', sinal: '+' },
    { rotulo: 'Particulares e outros convênios', chave: 'receitaOutros', tipo: 'brl', sinal: '+' },
    { rotulo: 'Receita total', chave: 'receitaTotal', tipo: 'brl', destaque: true },
    { rotulo: 'Repasse às psicólogas', chave: 'repasse', tipo: 'brl', sinal: '−' },
    { rotulo: 'Impostos e taxas', chave: 'impostos', tipo: 'brl', sinal: '−' },
    { rotulo: 'Despesas fixas', chave: 'despesas', tipo: 'brl', sinal: '−' },
    { rotulo: 'Resultado operacional', chave: 'resultado', tipo: 'brl', destaque: true },
    { rotulo: 'Empréstimos, cartões, retiradas', chave: 'naoOperacional', tipo: 'brl', sinal: '−' },
  ]

  return (
    <div className={g.pagina}>
      <Titulo titulo="Projeção">
        <strong>Curva de vendas e caixa dos próximos 4 meses, com probabilidades.</strong> O sistema cruza as planilhas das
        psicólogas (sessões por dia útil, por plano, corrigidas pelo atraso de lançamento), os XML da Unimed (valor por sessão e
        quanto o banco de fato pagou), os lotes Orizon do Bradesco, o extrato do Cora (DRE) e a base de pacientes (novos e
        perdidos). Roda {int(pm.simulacoes)} cenários (Monte Carlo): cada um sorteia ritmo, tendência, valor por sessão, repasse,
        impostos e despesas a partir do que já aconteceu. <b>Mediana</b> = metade dos cenários fica acima, metade abaixo.{' '}
        <b>Faixa de 80%</b> = em 8 de cada 10 cenários o valor cai entre P10 e P90. Feriados nacionais e dias úteis contam.
      </Titulo>

      <form className={g.filtros}>
        <label className={s.field}>
          Meta de sessões/mês
          <input type="number" name="meta" min={1} step={1} defaultValue={Math.round(p.meta)} />
        </label>
        <button type="submit" className={s.button}>
          Recalcular
        </button>
        <span className={s.muted} style={{ fontSize: 13 }}>
          Padrão: o recorde mensal ({int(Math.round(p.meta))}). Dados até {p.hoje.split('-').reverse().join('/')}.
        </span>
      </form>

      <div className={s.cards}>
        <div className={s.cardInfo}>
          <div className={s.cardLabel}>Fechamento de {nomeMes(p.mesAtual)}</div>
          <div className={s.cardValue}>{int(Math.round(p.nowcast.sessoes.p50))} sessões</div>
          <div className={s.cardHint}>
            {int(p.nowcast.observadas)} já lançadas · 80%: {int(Math.round(p.nowcast.sessoes.p10))}–{int(Math.round(p.nowcast.sessoes.p90))}
          </div>
        </div>
        <div className={s.card}>
          <div className={s.cardLabel}>Sessões em {nomeMes(prox.mes)}</div>
          <div className={s.cardValue}>{int(Math.round(prox.sessoes.p50))}</div>
          <div className={s.cardHint}>
            80%: {int(Math.round(prox.sessoes.p10))}–{int(Math.round(prox.sessoes.p90))} · chance de bater {int(Math.round(p.meta))}: {pc(prox.pMetaSessoes)}
          </div>
        </div>
        <div className={s.card}>
          <div className={s.cardLabel}>Receita {rot(prox.mes)}–{rot(ultimoMesProj.mes)}</div>
          <div className={s.cardValue}>{mil(p.acumulado.receita.p50)}</div>
          <div className={s.cardHint}>
            80%: {mil(p.acumulado.receita.p10)} a {mil(p.acumulado.receita.p90)}
          </div>
        </div>
        <div className={p.acumulado.pPositivo >= 0.5 ? s.cardGood : s.cardBad}>
          <div className={s.cardLabel}>Resultado operacional (4 meses)</div>
          <div className={s.cardValue}>{mil(p.acumulado.resultado.p50)}</div>
          <div className={s.cardHint}>chance de ficar positivo: {pc(p.acumulado.pPositivo)}</div>
        </div>
        {p.pSaldoNegativo !== null ? (
          <div className={p.pSaldoNegativo > 0.3 ? s.cardWarn : s.card}>
            <div className={s.cardLabel}>Saldo Cora hoje</div>
            <div className={s.cardValue}>{mil(p.saldoInicial ?? 0)}</div>
            <div className={s.cardHint}>chance de ficar negativo até {nomeMes(ultimoMesProj.mes)}: {pc(p.pSaldoNegativo)}</div>
          </div>
        ) : (
          pe && (
            <div className={s.card}>
              <div className={s.cardLabel}>Ponto de equilíbrio</div>
              <div className={s.cardValue}>{int(Math.round(pe.sessoes))} sessões/mês</div>
              <div className={s.cardHint}>margem de {brl(pe.margemSessao)} por sessão de convênio</div>
            </div>
          )
        )}
      </div>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Leitura do analista</h2>
        <ul className={g.leitura}>
          {frases.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Curva de vendas — sessões realizadas por mês</h2>
        <p className={s.sectionNote}>
          Todos os planos. O ponto vazado de {nomeMes(p.mesAtual)} é o que já foi lançado; a faixa mostra onde o mês deve fechar.
          {pe ? ` Ponto de equilíbrio ≈ ${int(Math.round(pe.sessoes))} sessões/mês.` : ''}
        </p>
        <GraficoFaixa titulo="Sessões realizadas por mês, realizado e projeção" pontos={pontosSessoes} formato="int" />
      </section>

      <div className={g.duas}>
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Receita por mês</h2>
          <p className={s.sectionNote}>Cora (Unimed + particulares + outros) + lotes do Bradesco pela data prevista.</p>
          <GraficoFaixa titulo="Receita por mês, realizado e projeção" pontos={pontosReceita} formato="brl" />
        </section>
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Resultado operacional por mês</h2>
          <p className={s.sectionNote}>Receita − repasse − impostos − despesas fixas (sem empréstimos e retiradas).</p>
          <GraficoFaixa titulo="Resultado operacional por mês, realizado e projeção" pontos={pontosResultado} formato="brl" />
        </section>
      </div>

      {pontosSaldo && (
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Saldo projetado no fim de cada mês</h2>
          <p className={s.sectionNote}>
            Parte do saldo de hoje no Cora e soma todas as entradas (inclusive Bradesco) e saídas, inclusive empréstimos e cartões.
          </p>
          <GraficoFaixa titulo="Saldo projetado no fim de cada mês" pontos={pontosSaldo} formato="brl" rotuloReal="Saldo hoje" />
        </section>
      )}

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Projeção mês a mês</h2>
        <p className={s.sectionNote}>Número grande = mediana. Embaixo = faixa de 80% (P10 a P90).</p>
        <div className={s.tableWrap}>
          <table className={g.tabela}>
            <thead>
              <tr>
                <th>Linha</th>
                {p.meses.map((m) => (
                  <th key={m.mes}>{rot(m.mes)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave} className={l.destaque ? g.destaque : undefined}>
                  <td>
                    {l.sinal ? `${l.sinal} ` : ''}
                    {l.rotulo}
                  </td>
                  {p.meses.map((m) => (
                    <Celula key={m.mes} f={m[l.chave] as Faixa} tipo={l.tipo} />
                  ))}
                </tr>
              ))}
              {p.saldoInicial !== null && (
                <tr className={g.destaque}>
                  <td>Saldo no fim do mês</td>
                  {p.meses.map((m) => (
                    <Celula key={m.mes} f={m.saldo!} tipo="brl" />
                  ))}
                </tr>
              )}
              {PLANOS.map((pl) => (
                <tr key={pl} className={g.prob}>
                  <td>Sessões {ROTULO_PLANO[pl]}</td>
                  {p.meses.map((m) => (
                    <td key={m.mes}>
                      <b>{int(Math.round(m.sessoesPlano[pl].p50))}</b>
                    </td>
                  ))}
                </tr>
              ))}
              <tr className={g.prob}>
                <td>Chance de resultado positivo</td>
                {p.meses.map((m) => (
                  <td key={m.mes}>
                    <b>{pc(m.pResultadoPositivo)}</b>
                  </td>
                ))}
              </tr>
              <tr className={g.prob}>
                <td>Chance de bater {int(Math.round(p.meta))} sessões</td>
                {p.meses.map((m) => (
                  <td key={m.mes}>
                    <b>{pc(m.pMetaSessoes)}</b>
                  </td>
                ))}
              </tr>
              <tr className={g.prob}>
                <td>Chance de crescer sobre o mês anterior</td>
                {p.meses.map((m) => (
                  <td key={m.mes}>
                    <b>{pc(m.pCresceSessoes)}</b>
                  </td>
                ))}
              </tr>
              <tr className={g.prob}>
                <td>Receita já conhecida (XML emitido / lote Orizon)</td>
                {p.meses.map((m) => (
                  <td key={m.mes}>
                    <b>{mil(m.receitaConhecida)}</b>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>O que mais mexe no resultado dos 4 meses</h2>
        <p className={s.sectionNote}>
          Cada linha muda uma variável e mantém o resto igual (mesmos cenários). Barra = quanto a mediana do resultado de{' '}
          {rot(prox.mes)} a {rot(ultimoMesProj.mes)} sobe (azul) ou cai (laranja).
        </p>
        <div className={g.tornado}>
          {p.sensibilidade.map((x) => {
            const neg = Math.min(x.baixo, x.alto)
            const pos = Math.max(x.baixo, x.alto)
            return (
              <div key={x.rotulo} className={g.tLinha}>
                <div className={g.tRotulo}>
                  {x.rotulo}
                  <small>{x.detalhe}</small>
                </div>
                <div className={g.tBarra} title={`${x.rotulo}: ${mil(x.baixo)} / ${mil(x.alto)}`}>
                  <span className={g.tMeio} />
                  {neg < 0 && (
                    <>
                      <span className={g.tNeg} style={{ width: larg(neg) }} />
                      <span className={g.tValor} style={{ right: `calc(50% + ${larg(neg)} + 6px)` }}>
                        {mil(neg)}
                      </span>
                    </>
                  )}
                  {pos > 0 && (
                    <>
                      <span className={g.tPos} style={{ width: larg(pos) }} />
                      <span className={g.tValor} style={{ left: `calc(50% + ${larg(pos)} + 6px)` }}>
                        +{mil(pos)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Motores — as variáveis cruzadas mês a mês</h2>
        <p className={s.sectionNote}>
          Perda = pacientes do mês anterior que não tiveram sessão no mês. Mês atual ainda incompleto (em itálico).
          {p.equilibrio
            ? ` Mantidos ~${Math.round(p.equilibrio.novosMes)} novos/mês e ${pc(p.equilibrio.taxaPerda)} de perda, a base tende a ~${Math.round(p.equilibrio.pacientes)} pacientes.`
            : ''}
        </p>
        <div className={s.tableWrap}>
          <table className={g.tabela}>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Sessões</th>
                <th>Pacientes</th>
                <th>Novos</th>
                <th>Perdidos</th>
                <th>Perda</th>
                <th>Sessões/paciente</th>
                <th>Psicólogas</th>
                <th>Sessões/psicóloga</th>
                <th>Faltas</th>
                <th>Unimed R$/sessão</th>
                <th>Glosa</th>
              </tr>
            </thead>
            <tbody>
              {p.motores.map((m) => (
                <tr key={m.mes} style={m.parcial ? { fontStyle: 'italic' } : undefined}>
                  <td>
                    {rot(m.mes)}
                    {m.parcial ? ' (parcial)' : ''}
                  </td>
                  <td>{int(m.sessoes)}</td>
                  <td>{int(m.pacientes)}</td>
                  <td>{int(m.novos)}</td>
                  <td>{int(m.perdidos)}</td>
                  <td>{pc(m.taxaPerda)}</td>
                  <td>{n1(m.sessoesPorPaciente)}</td>
                  <td>{int(m.psicologas)}</td>
                  <td>{n1(m.sessoesPorPsicologa)}</td>
                  <td>{pc(m.faltasPct, 1)}</td>
                  <td>{m.valorUnimedSessao === null ? '—' : brl(m.valorUnimedSessao)}</td>
                  <td>{pc(m.glosaPct, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={s.section}>
        <details className={g.premissas}>
          <summary>Premissas usadas (tiradas dos seus dados)</summary>
          <ul>
            <li>
              Ritmo atual por dia útil: Unimed {n1(pm.taxaDiaUtil.unimed)}, Bradesco {n1(pm.taxaDiaUtil.bradesco)}, outros {n1(pm.taxaDiaUtil.outros)} —
              ajuste nas últimas {pm.semanasAjuste} semanas. Tendência semanal: Unimed {pc(pm.tendenciaSemanal.unimed, 1)}, Bradesco{' '}
              {pc(pm.tendenciaSemanal.bradesco, 1)}, outros {pc(pm.tendenciaSemanal.outros, 1)} (amortecida 10% por semana).
            </li>
            <li>
              Atraso de lançamento: a semana atual está {pc(pm.completudeSemanaAtual)} lançada, pela curva real de registro das psicólogas; o
              restante é estimado.
            </li>
            <li>
              Unimed: {brl(pm.valorXmlPorSessao.media)} por sessão ({pm.valorXmlPorSessao.fonte}
              {pm.valorXmlPorSessao.amostras ? `, ${pm.valorXmlPorSessao.amostras} meses` : ''}); o banco pagou em média {pc(pm.pagoSobreLiberado.media, 1)} do
              liberado ({pm.pagoSobreLiberado.amostras} demonstrativos). XML pago no dia 25 do mês seguinte à emissão.
            </li>
            <li>Bradesco: {brl(pm.valorGuiaBradesco)} por guia, lote pago ~2 meses depois da sessão (entra no banco Bradesco).</li>
            <li>
              Repasse: {brl(pm.repassePorSessao.media)} por sessão do mês anterior ({pm.repassePorSessao.amostras} meses). Impostos:{' '}
              {pc(pm.aliquotaImpostos.media, 1)} da receita do mês anterior ({pm.aliquotaImpostos.amostras} meses).
            </li>
            <li>
              Despesas fixas: {mil(pm.despesasFixas.media)}/mês ± {mil(pm.despesasFixas.dp)}; particulares e outros convênios:{' '}
              {mil(pm.outrasReceitas.media)}/mês ± {mil(pm.outrasReceitas.dp)}; empréstimos/cartões: {mil(pm.naoOperacional.media)}/mês (últimos{' '}
              {pm.despesasFixas.amostras} meses do extrato Cora).
            </li>
            <li>
              Limites: despesas pagas por outro banco não entram; “Outras despesas” sem classificação na DRE entram como fixas — classificar na DRE
              melhora a projeção. Sazonalidade de fim de ano ainda não tem histórico (a clínica tem menos de 1 ano de dados completos).
            </li>
          </ul>
        </details>
      </section>
    </div>
  )
}
