import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { alertas, indicadores, rotuloEixo, rotuloMes, type Painel } from '@/lib/painel/painel'
import { Barras, Colunas, ColunasDuplas, MiniBarra } from './graficos'
import { BotaoSincronizar } from '@/app/financeiro/sincronizar/botao-sincronizar'
import d from './dashboard.module.css'

export const metadata = { title: 'Painel da clínica — HOPE CORE' }
export const maxDuration = 30

const brl = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brl0 = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const int = (v: number) => Number(v || 0).toLocaleString('pt-BR')
const pct = (v: number, casas = 1) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`
const DIAS = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const MES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

function Menu({ email }: { email: string }) {
  return (
    <header className={d.topo}>
      <span className={d.marca}>HOPE CORE</span>
      <nav className={d.menu}>
        <a href="/dashboard" className={d.ativo}>
          Painel
        </a>
        <a href="/financeiro/agenda">Agenda</a>
        <a href="/financeiro/guias">Registro de Guias</a>
        <a href="/financeiro/divergencias">Divergências</a>
        <a href="/financeiro/conferencia">Conferência</a>
        <a href="/financeiro/nao-lancadas">Não lançadas</a>
        <a href="/financeiro/repasse">Repasse</a>
        <a href="/financeiro">Unimed</a>
        <a href="/financeiro/importar">Importar XML</a>
        <a href="/financeiro/notas">Notas fiscais</a>
      </nav>
      <span className={d.usuario}>{email}</span>
    </header>
  )
}

export default async function DashboardPage() {
  const supabase = await createClient()

  // getUser() valida o JWT com o Supabase Auth — seguro para decisões de acesso
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/login')
  }

  // Busca tenants — RLS policy `tenant_self_access` deve retornar apenas 1 row
  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, name, legal_name, cnpj, plan, billing_status, created_at')

  const fin = await requireFinanceAccess()
  let painel: Painel | null = null
  let erroPainel: string | null = null
  if (fin.allowed) {
    const { data, error } = await fin.supabase.rpc('painel_gestao')
    if (error) erroPainel = error.message
    else painel = data as unknown as Painel
  }

  const diagnostico = (
    <details className={d.diag}>
      <summary>Diagnóstico técnico</summary>
      <section style={{ marginTop: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Tenants visíveis (via RLS)</h2>
        {tenantsError && (
          <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 12 }}>
            <strong style={{ color: '#dc2626' }}>Erro RLS:</strong> <code style={{ fontSize: 12 }}>{tenantsError.message}</code>
          </div>
        )}
        {!tenantsError && tenants && (
          <p>
            {tenants.length === 1
              ? '✅ 1 tenant retornado — RLS funcionando corretamente'
              : `⚠️ ${tenants.length} tenant(s) retornado(s) — verifique as policies`}
            {tenants.map((t) => ` · ${t.name} (${t.id.slice(0, 8)}…)`)}
          </p>
        )}
      </section>
    </details>
  )

  if (!fin.allowed || !painel) {
    return (
      <div className={d.shell}>
        <Menu email={user.email ?? ''} />
        <main className={d.main}>
          <h1 className={d.titulo}>Painel da clínica</h1>
          <p className={d.sub}>
            {erroPainel
              ? `Não foi possível carregar os números: ${erroPainel}`
              : 'O painel de gestão é liberado para dono, gestor e equipe administrativa.'}
          </p>
          {diagnostico}
        </main>
      </div>
    )
  }

  const p = painel
  const k = indicadores(p)
  const lista = alertas(p)
  const hoje = p.atualizacao.hoje
  const mesNome = MES_LONGO[Number(hoje.slice(5, 7)) - 1]
  const anteriorNome = k.anterior ? MES_LONGO[Number(k.anterior.mes.slice(5, 7)) - 1] : ''
  const emRisco = (k.risco.okGlosado?.glosado ?? 0) + (k.risco.faltaFaturada?.liberado ?? 0)

  // mix de planos no último mês fechado
  const planosAnt = p.planos.filter((x) => k.anterior && x.mes === k.anterior.mes && x.realizadas > 0).sort((a, b) => b.realizadas - a.realizadas)
  const totalAnt = planosAnt.reduce((t, x) => t + x.realizadas, 0)

  const psis = p.psicologas.filter((x) => x.ativo || x.realizadas_mes_anterior > 0)
  const maxPsi = Math.max(1, ...psis.map((x) => x.realizadas_mes_anterior))
  const faltasSemana = p.semana.map((s) => ({ ...s, taxa: s.realizadas + s.faltas ? s.faltas / (s.realizadas + s.faltas) : 0 }))
  const piorDia = [...faltasSemana].sort((a, b) => b.taxa - a.taxa)[0]
  const unimedFechados = p.unimed.filter((u) => u.month < k.mesAtualIso && u.informed > 100)
  const vrUnimed = p.valor_real.find((v) => v.plano === 'Unimed')

  return (
    <div className={d.shell}>
      <Menu email={user.email ?? ''} />
      <main className={d.main}>
        <h1 className={d.titulo}>Painel da clínica</h1>
        <p className={d.sub}>
          Dados reais cruzados: planilhas das psicólogas (atualizadas {quando(p.atualizacao.planilhas)}), demonstrativos da
          Unimed (último de {p.atualizacao.ultimo_demonstrativo ? p.atualizacao.ultimo_demonstrativo.split('-').reverse().join('/') : '—'}),
          lotes do Bradesco/Orizon e Registro de Guias.
        </p>

        {/* ---------- o que precisa de atenção ---------- */}
        {lista.length ? (
          <section className={d.alertas} aria-label="Precisa de atenção">
            {lista.map((a, i) => (
              <div key={i} className={`${d.alerta} ${d[a.severidade]}`}>
                <span className={d.icone}>{a.severidade === 'critico' ? '● Crítico' : a.severidade === 'atencao' ? '▲ Atenção' : 'ℹ Info'}</span>
                <div>
                  <strong>{a.titulo}</strong>
                  <p>{a.detalhe}</p>
                </div>
                {a.link ? <a href={a.link}>{a.acao ?? 'Abrir'} →</a> : <span />}
              </div>
            ))}
          </section>
        ) : (
          <div className={d.tudoCerto}>✓ Nada crítico hoje.</div>
        )}

        {/* ---------- indicadores principais ---------- */}
        <section className={d.kpis}>
          <div className={d.kpi}>
            <small>Sessões em {mesNome}</small>
            <strong>{int(k.atual?.realizadas ?? 0)}</strong>
            <span>
              ritmo para ~{int(k.projecao)} no mês · {anteriorNome} {int(k.anterior?.realizadas ?? 0)}
            </span>
          </div>
          <div className={d.kpi}>
            <small>Sessões em {anteriorNome}</small>
            <strong>{int(k.anterior?.realizadas ?? 0)}</strong>
            <span>
              média 3 meses {int(Math.round(k.media3))}{' '}
              {k.variacaoAnterior != null && (
                <b className={k.variacaoAnterior >= 0 ? d.sobe : d.desce}>
                  {k.variacaoAnterior >= 0 ? '▲' : '▼'} {pct(Math.abs(k.variacaoAnterior))}
                </b>
              )}
            </span>
          </div>
          <div className={d.kpi}>
            <small>Pacientes ativos (30 dias)</small>
            <strong>{int(p.retencao.ativos_30)}</strong>
            <span>
              +{int(p.retencao.novos_30)} novos · {int(p.retencao.sem_sessao_ha_30)} sem sessão há 30+ dias
            </span>
          </div>
          <div className={d.kpi}>
            <small>Faltas (90 dias)</small>
            <strong>{pct(k.taxaFalta90)}</strong>
            <span>
              {int(k.faltas90)} faltas{piorDia ? ` · pior dia: ${DIAS[piorDia.dow]} (${pct(piorDia.taxa, 0)})` : ''}
            </span>
          </div>
          <div className={d.kpi}>
            <small>A receber (30 dias)</small>
            <strong>{brl0(p.caixa.receber_30)}</strong>
            <span className={p.caixa.atrasado > 0 ? d.desce : ''}>
              {p.caixa.atrasado > 0 ? `${brl0(p.caixa.atrasado)} vencido sem confirmação` : 'nada vencido'}
            </span>
          </div>
          <div className={d.kpi}>
            <small>Recebido em {mesNome}</small>
            <strong>{brl0(p.caixa.recebido_mes)}</strong>
            <span>confirmado na Agenda</span>
          </div>
          <div className={d.kpi}>
            <small>Glosa Unimed (3 meses)</small>
            <strong>{pct(k.glosa3m)}</strong>
            <span>{brl(k.glosaValor3m)} glosados</span>
          </div>
          <div className={d.kpi}>
            <small>Repasse em risco</small>
            <strong className={emRisco > 0 ? d.desce : ''}>{brl0(emRisco)}</strong>
            <span>OK glosado + falta faturada</span>
          </div>
        </section>

        {/* ---------- gráficos ---------- */}
        <section className={d.grade}>
          <div className={d.cartao}>
            <h2>Sessões realizadas por mês</h2>
            <p className={d.nota}>Todas as psicólogas, pela data da sessão. {mesNome} ainda em andamento.</p>
            <Colunas
              itens={p.mensal.map((m) => ({
                rotulo: rotuloEixo(m.mes),
                valor: m.realizadas,
                texto: int(m.realizadas),
                parcial: m.mes === k.mesAtualIso,
                dica: `${rotuloMes(m.mes)}: ${int(m.realizadas)} sessões, ${int(m.faltas)} faltas, ${int(m.psicologas)} psicólogas`,
              }))}
              legendaParcial="mês em andamento"
            />
            <details>
              <summary>Ver números</summary>
              <table className={d.tabela}>
                <thead>
                  <tr><th>Mês</th><th className={d.n}>Sessões</th><th className={d.n}>Faltas</th><th className={d.n}>Psicólogas</th><th className={d.n}>Sessões/psicóloga</th></tr>
                </thead>
                <tbody>
                  {p.mensal.map((m) => (
                    <tr key={m.mes}>
                      <td>{rotuloMes(m.mes)}</td>
                      <td className={d.n}>{int(m.realizadas)}</td>
                      <td className={d.n}>{int(m.faltas)}</td>
                      <td className={d.n}>{int(m.psicologas)}</td>
                      <td className={d.n}>{m.psicologas ? int(Math.round(m.realizadas / m.psicologas)) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>

          <div className={d.cartao}>
            <h2>Pacientes atendidos × novos</h2>
            <p className={d.nota}>Pacientes diferentes com sessão no mês e quantos tiveram a 1ª sessão naquele mês.</p>
            <ColunasDuplas
              nomes={['Pacientes atendidos', 'Novos']}
              itens={p.mensal.map((m) => ({ rotulo: rotuloEixo(m.mes), a: m.pacientes, b: m.novos, textoA: int(m.pacientes), textoB: int(m.novos) }))}
            />
            <div className={d.insight}>
              Base histórica: <b>{int(p.retencao.total_historico)}</b> pacientes já atendidos. Nos últimos 30 dias:{' '}
              <b>{int(p.retencao.ativos_30)}</b> ativos, <b>{int(p.retencao.novos_30)}</b> novos e{' '}
              <b>{int(p.retencao.sem_sessao_ha_30)}</b> que vinham e pararam (altas ou abandono).
            </div>
          </div>

          <div className={d.cartao}>
            <h2>Unimed: faturado × pago por mês de atendimento</h2>
            <p className={d.nota}>Valor informado nas guias e valor liberado nos demonstrativos (XML). A diferença é a glosa.</p>
            <ColunasDuplas
              nomes={['Informado', 'Liberado']}
              itens={unimedFechados.map((u) => ({
                rotulo: rotuloEixo(u.month),
                a: Number(u.informed),
                b: Number(u.released),
                textoA: brl0(u.informed),
                textoB: `${brl0(u.released)} (glosa ${pct(u.informed ? u.gloss / u.informed : 0)})`,
              }))}
            />
            <details>
              <summary>Ver números</summary>
              <table className={d.tabela}>
                <thead>
                  <tr><th>Mês</th><th className={d.n}>Sessões</th><th className={d.n}>Informado</th><th className={d.n}>Liberado</th><th className={d.n}>Glosa</th><th className={d.n}>Dias até o demonstrativo</th></tr>
                </thead>
                <tbody>
                  {unimedFechados.map((u) => (
                    <tr key={u.month}>
                      <td>{rotuloMes(u.month)}</td>
                      <td className={d.n}>{int(u.sessions)}</td>
                      <td className={d.n}>{brl(u.informed)}</td>
                      <td className={d.n}>{brl(u.released)}</td>
                      <td className={d.n}>{brl(u.gloss)} ({pct(u.informed ? u.gloss / u.informed : 0)})</td>
                      <td className={d.n}>{u.median_days_to_statement ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>

          <div className={d.cartao}>
            <h2>Atendimentos por dia da semana</h2>
            <p className={d.nota}>Últimos 90 dias. Mostra onde há espaço na agenda e nas salas.</p>
            <Colunas
              itens={faltasSemana.map((s) => ({
                rotulo: DIAS[s.dow],
                valor: s.realizadas,
                texto: int(s.realizadas),
                dica: `${DIAS[s.dow]}: ${int(s.realizadas)} sessões, ${int(s.faltas)} faltas (${pct(s.taxa)})`,
              }))}
            />
            <div className={d.insight}>
              Faltas por dia: {faltasSemana.map((s) => `${DIAS[s.dow]} ${pct(s.taxa, 0)}`).join(' · ')}.
            </div>
          </div>

          <div className={d.cartao}>
            <h2>Sessões por plano — {anteriorNome}</h2>
            <p className={d.nota}>
              Plano confirmado pelo XML da Unimed ou pelo lote da Orizon; o restante pelo formato do nº da guia.
            </p>
            <Barras
              itens={planosAnt.map((x) => ({
                rotulo: x.plano,
                valor: x.realizadas,
                texto: int(x.realizadas),
                detalhe: `${pct(totalAnt ? x.realizadas / totalAnt : 0, 0)} · ${brl0(x.valor_ok)} tabela`,
              }))}
            />
          </div>

          <div className={d.cartao}>
            <h2>Valor por sessão: planilha × o que a operadora paga</h2>
            <p className={d.nota}>Sessões dos últimos 6 meses conferidas com o XML (Unimed) e com os lotes da Orizon (Bradesco).</p>
            <Barras
              cor="serie2"
              itens={p.valor_real.flatMap((v) => [
                { rotulo: `${v.plano} — planilha`, valor: Number(v.media_planilha), texto: brl(v.media_planilha) },
                { rotulo: `${v.plano} — pago`, valor: Number(v.media_pago), texto: brl(v.media_pago), detalhe: `${int(v.sessoes)} sessões` },
              ])}
            />
            {vrUnimed && (
              <div className={d.insight}>
                Na Unimed, a planilha usa <b>{brl(vrUnimed.media_planilha)}</b> por sessão, mas a operadora paga em média{' '}
                <b>{brl(vrUnimed.media_pago)}</b> ({brl(vrUnimed.media_planilha - vrUnimed.media_pago)} a menos). O repasse de
                40% sobre a planilha ({brl(vrUnimed.media_planilha * 0.4)}) equivale a{' '}
                <b>{pct(vrUnimed.media_pago ? (vrUnimed.media_planilha * 0.4) / vrUnimed.media_pago : 0, 0)}</b> do que a clínica
                recebe de fato.
              </div>
            )}
          </div>
        </section>

        {/* ---------- psicólogas ---------- */}
        <section className={`${d.cartao} ${d.largo}`}>
          <h2>Psicólogas</h2>
          <p className={d.nota}>
            Sessões realizadas, comparação com a média dos 3 meses anteriores, faltas, pacientes ativos e sessões antigas sem
            status (repasse e faturamento parados).
          </p>
          <div className={d.tabelaWrap}>
            <table className={d.tabela}>
              <thead>
                <tr>
                  <th>Psicóloga</th>
                  <th className={d.n}>{anteriorNome}</th>
                  <th className={d.n}>Média 3m</th>
                  <th className={d.n}>Variação</th>
                  <th className={d.n}>{mesNome} até hoje</th>
                  <th className={d.n}>Pacientes ativos</th>
                  <th className={d.n}>Faltas 90d</th>
                  <th className={d.n}>Sem status +30d</th>
                  <th className={d.n}>Faturado {anteriorNome} (tabela)</th>
                </tr>
              </thead>
              <tbody>
                {psis.map((x) => {
                  const variacao = x.media_3m ? x.realizadas_mes_anterior / x.media_3m - 1 : null
                  const taxaFalta = x.agendadas_90 ? x.faltas_90 / x.agendadas_90 : 0
                  return (
                    <tr key={x.spreadsheet_id}>
                      <td>
                        {x.psi}
                        {!x.ativo && <span className={`${d.selo} ${d.seloAtencao}`} style={{ marginLeft: 6 }}>fora da aba ID</span>}
                      </td>
                      <td className={d.n}>
                        {int(x.realizadas_mes_anterior)}
                        <MiniBarra valor={x.realizadas_mes_anterior} max={maxPsi} />
                      </td>
                      <td className={d.n}>{x.media_3m.toLocaleString('pt-BR')}</td>
                      <td className={d.n}>
                        {variacao == null ? '—' : (
                          <span className={variacao >= 0 ? d.sobe : variacao < -0.25 ? d.desce : ''}>
                            {variacao >= 0 ? '▲' : '▼'} {pct(Math.abs(variacao), 0)}
                          </span>
                        )}
                      </td>
                      <td className={d.n}>{int(x.realizadas_mes)}</td>
                      <td className={d.n}>{int(x.pacientes_ativos)}</td>
                      <td className={d.n}>
                        <span className={`${d.selo} ${taxaFalta > 0.12 ? d.seloRuim : taxaFalta > 0.06 ? d.seloAtencao : d.seloBom}`}>{pct(taxaFalta, 0)}</span>
                      </td>
                      <td className={d.n}>
                        {x.pendentes_antigas ? <span className={`${d.selo} ${d.seloRuim}`}>{int(x.pendentes_antigas)} · {brl0(x.valor_pendente_antigo)}</span> : '—'}
                      </td>
                      <td className={d.n}>{brl0(x.valor_ok_mes_anterior)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className={d.grade} style={{ marginTop: 14 }}>
          <div className={d.cartao}>
            <h2>Recebimentos previstos (30 dias)</h2>
            <p className={d.nota}>Da Agenda financeira: inclui o que já venceu e não foi confirmado.</p>
            {p.caixa.por_plano_30.length ? (
              <Barras itens={p.caixa.por_plano_30.map((x) => ({ rotulo: x.plano, valor: Number(x.valor), texto: brl0(x.valor) }))} />
            ) : (
              <p className={d.nota}>Nada previsto.</p>
            )}
            <div className={d.insight}>
              <a href="/financeiro/agenda">Abrir a Agenda →</a>
            </div>
          </div>
          <div className={d.cartao}>
            <h2>Controles do faturamento</h2>
            <p className={d.nota}>Qualidade do processo de guias do mês passado e do mês atual.</p>
            <table className={d.tabela}>
              <tbody>
                <tr>
                  <td>Guias de {anteriorNome} lançadas no Registro de Guias</td>
                  <td className={d.n}>
                    {int(p.registro_guias.registradas)} / {int(p.registro_guias.guias_mes_anterior)}{' '}
                    {k.cobertura != null && <span className={`${d.selo} ${k.cobertura >= 0.95 ? d.seloBom : d.seloRuim}`}>{pct(k.cobertura)}</span>}
                  </td>
                </tr>
                <tr>
                  <td>Sessões sem status até 30 dias (normal no ciclo)</td>
                  <td className={d.n}>{int(p.pendencias.ate_30_dias)}</td>
                </tr>
                <tr>
                  <td>Sessões sem status há mais de 30 dias</td>
                  <td className={d.n}>
                    {int(p.pendencias.mais_30_dias)} · {brl0(p.pendencias.valor_mais_30_dias)}
                  </td>
                </tr>
                <tr>
                  <td>Divergências planilha × Unimed</td>
                  <td className={d.n}>
                    <a href="/financeiro/divergencias">{int(p.divergencias.reduce((t, x) => t + x.qtd, 0))} guias →</a>
                  </td>
                </tr>
                <tr>
                  <td>Dias da sessão até o demonstrativo Unimed (mediana, último mês)</td>
                  <td className={d.n}>{k.unimedUltimo?.median_days_to_statement ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div className={d.rodape}>
          <span>Planilhas: {quando(p.atualizacao.planilhas)}</span>
          <span>Registro de Guias: {quando(p.atualizacao.bd_guias)}</span>
          <span>Orizon: {quando(p.atualizacao.ultima_orizon)}</span>
          <span>Pacientes são contados sem expor nomes.</span>
        </div>
        <div style={{ marginTop: 12 }}>
          <BotaoSincronizar compacto />
        </div>

        {diagnostico}
      </main>
    </div>
  )
}
