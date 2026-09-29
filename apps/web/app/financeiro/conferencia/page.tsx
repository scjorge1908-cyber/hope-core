import { Titulo } from '../titulo'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { BotaoSincronizar } from '../sincronizar/botao-sincronizar'
import { brl, dataBR, int } from '@/lib/financeiro/format'
import {
  PROBLEMAS,
  ROTULO_OPERADORA,
  chaveNome,
  normalizarPlano,
  problemas,
  resumir,
  type CodigoProblema,
  type LinhaConferencia,
} from '@/lib/financeiro/conferencia'
import { hojeSaoPaulo } from '@/lib/financeiro/agenda'
import s from '../financeiro.module.css'
import c from './conferencia.module.css'

export const metadata = { title: 'Conferência de guias — HOPE CORE' }
export const maxDuration = 30

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const ORDEM_PROB: CodigoProblema[] = ['ok_glosado', 'falta_faturada', 'pago_sem_ok', 'sem_anexo', 'fora_do_adm', 'sem_guia', 'sem_status', 'so_admin']

export default async function ConferenciaPage({ searchParams }: PageProps<'/financeiro/conferencia'>) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return null

  const sp = await searchParams
  const hoje = hojeSaoPaulo()
  const m = /^(\d{4})-(\d{2})$/.exec(String(sp.mes ?? ''))
  // padrão: mês anterior (o mês atual ainda está sendo faturado)
  const padrao = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 2, 1))
  const ano = m ? Number(m[1]) : padrao.getUTCFullYear()
  const mes = m ? Math.min(Math.max(Number(m[2]), 1), 12) : padrao.getUTCMonth() + 1
  const mesStr = `${ano}-${String(mes).padStart(2, '0')}`
  const psiFiltro = typeof sp.psi === 'string' ? sp.psi : ''
  const probFiltro = (typeof sp.prob === 'string' ? sp.prob : '') as CodigoProblema | 'todos' | 'ok' | ''

  const [{ data, error }, { data: sincronizadas }] = await Promise.all([
    supabase.rpc('conferencia_guias', { p_ano: ano, p_mes: mes }),
    supabase.rpc('legacy_planilhas_nomes'),
  ])
  const linhas = (data ?? []) as LinhaConferencia[]

  // psicólogas cujas planilhas estão na aba ID do Cálculo RPA (sincronizadas de hora em hora)
  const nomesComPlanilha = new Set(
    (sincronizadas ?? []).flatMap((p) => [chaveNome(p.nome_abreviado), chaveNome(p.nome_completo)]).filter(Boolean)
  )
  const resumo = resumir(linhas)
  const totalProb = Object.fromEntries(ORDEM_PROB.map((p) => [p, 0])) as Record<CodigoProblema, number>
  const comProb = linhas.map((l) => ({ l, ps: problemas(l) }))
  for (const { ps } of comProb) for (const p of ps) totalProb[p]++
  const sessoes = linhas.filter((l) => l.origem === 'sessao' && l.status_classe !== 'falta').length
  const completas = comProb.filter(({ l, ps }) => l.origem === 'sessao' && l.status_classe !== 'falta' && !ps.length).length

  const filtradas = comProb
    .filter(({ l }) => !psiFiltro || l.psicologa === psiFiltro)
    .filter(({ ps }) => (!probFiltro || probFiltro === 'todos' ? true : probFiltro === 'ok' ? ps.length === 0 : ps.includes(probFiltro)))
    .sort((a, b) => String(a.l.psicologa).localeCompare(String(b.l.psicologa), 'pt-BR') || String(a.l.data_sessao).localeCompare(String(b.l.data_sessao)))

  const link = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ mes: mesStr })
    if (psiFiltro) q.set('psi', psiFiltro)
    if (probFiltro) q.set('prob', probFiltro)
    for (const [k, v] of Object.entries(extra)) {
      if (v) q.set(k, v)
      else q.delete(k)
    }
    return `/financeiro/conferencia?${q}#lista`
  }

  const cel = (n: number, prob?: CodigoProblema, psi?: string) =>
    n ? (
      <a href={link({ prob: prob ?? '', psi: psi ?? '' })} className={prob && PROBLEMAS[prob].grave ? c.numGrave : c.numAtencao}>
        {int(n)}
      </a>
    ) : (
      <span className={s.muted}>—</span>
    )

  return (
    <>
      <Titulo titulo="Conferência de guias">
        Cada sessão cruzada nas 3 pontas: <b>psicóloga</b> (aba Atendimentos — guia na coluna E, anexo na coluna H, status na
        coluna S), <b>admin</b> (lançada no ADM Registro de Guia) e <b>plano</b> (XML da Unimed sessão a sessão; lote da Orizon
        para o Bradesco). Outros planos ainda não têm retorno integrado.
      </Titulo>
      <BotaoSincronizar />

      <form className={c.filtros}>
        <label className={s.field}>
          Mês
          <input type="month" name="mes" defaultValue={mesStr} />
        </label>
        <label className={s.field}>
          Psicóloga
          <select name="psi" defaultValue={psiFiltro}>
            <option value="">Todas</option>
            {resumo.map((r) => (
              <option key={r.psicologa} value={r.psicologa}>
                {r.psicologa}
              </option>
            ))}
          </select>
        </label>
        <label className={s.field}>
          Mostrar
          <select name="prob" defaultValue={probFiltro || 'todos'}>
            <option value="todos">Todas as linhas</option>
            <option value="ok">Só as completas</option>
            {ORDEM_PROB.map((p) => (
              <option key={p} value={p}>
                {PROBLEMAS[p].rotulo}
              </option>
            ))}
          </select>
        </label>
        <button className={s.button}>Filtrar</button>
      </form>

      {error && <div className={s.alertBad}>Erro: {error.message}</div>}

      <div className={c.cards}>
        <div className={c.card}>
          <small>Sessões em {MESES[mes - 1]}</small>
          <strong>{int(sessoes)}</strong>
          <span>
            {int(completas)} completas nas 3 pontas ({sessoes ? Math.round((completas / sessoes) * 100) : 0}%)
          </span>
        </div>
        {ORDEM_PROB.map((p) => (
          <a key={p} href={link({ prob: p, psi: '' })} className={`${c.card} ${totalProb[p] ? (PROBLEMAS[p].grave ? c.grave : c.atencao) : c.ok}`}>
            <small>{PROBLEMAS[p].rotulo}</small>
            <strong>{int(totalProb[p])}</strong>
            <span>{PROBLEMAS[p].explica}</span>
          </a>
        ))}
      </div>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>Por psicóloga — {MESES[mes - 1]} de {ano}</h2>
        <p className={s.sectionNote}>Clique num número para ver as guias.</p>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Psicóloga</th>
                <th className={s.num}>Sessões</th>
                <th className={s.num}>Pagas</th>
                <th className={s.num}>Aguardando</th>
                <th className={s.num}>Sem anexo</th>
                <th className={s.num}>Fora do ADM</th>
                <th className={s.num}>Sem status</th>
                <th className={s.num}>OK glosada</th>
                <th className={s.num}>Paga sem OK</th>
                <th className={s.num}>Falta faturada</th>
                <th className={s.num}>Só no ADM</th>
              </tr>
            </thead>
            <tbody>
              {resumo.map((r) => (
                <tr key={r.psicologa}>
                  <td>
                    <a href={link({ psi: r.psicologa, prob: '' })}>{r.psicologa}</a>
                    {!nomesComPlanilha.has(chaveNome(r.psicologa)) && (
                      <span className={s.badgeWarn} style={{ marginLeft: 6 }} title="Está no ADM Registro de Guia, mas a planilha dela não está na aba ID do Cálculo RPA (não é sincronizada).">
                        planilha não sincronizada
                      </span>
                    )}
                  </td>
                  <td className={s.num}>{int(r.sessoes)}</td>
                  <td className={s.num}>{int(r.pagas)}</td>
                  <td className={s.num}>{int(r.aguardando)}</td>
                  <td className={s.num}>{cel(r.semAnexo, 'sem_anexo', r.psicologa)}</td>
                  <td className={s.num}>{cel(r.foraDoAdm + r.semGuia, 'fora_do_adm', r.psicologa)}</td>
                  <td className={s.num}>{cel(r.semStatus, 'sem_status', r.psicologa)}</td>
                  <td className={s.num}>{cel(r.okGlosado, 'ok_glosado', r.psicologa)}</td>
                  <td className={s.num}>{cel(r.pagoSemOk, 'pago_sem_ok', r.psicologa)}</td>
                  <td className={s.num}>{cel(r.faltaFaturada, 'falta_faturada', r.psicologa)}</td>
                  <td className={s.num}>{cel(r.soAdmin, 'so_admin', r.psicologa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="lista" className={s.section}>
        <h2 className={s.sectionTitle}>
          Guias {psiFiltro ? `— ${psiFiltro}` : ''} {probFiltro && probFiltro !== 'todos' ? `— ${probFiltro === 'ok' ? 'completas' : PROBLEMAS[probFiltro].rotulo}` : ''} ({int(filtradas.length)})
        </h2>
        <p className={s.sectionNote}>
          {(psiFiltro || (probFiltro && probFiltro !== 'todos')) && <a href={`/financeiro/conferencia?mes=${mesStr}#lista`}>Limpar filtros</a>}
        </p>
        <div className={s.tableWrap}>
          <table className={`${s.table} ${c.lista}`}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Psicóloga</th>
                <th>Paciente</th>
                <th>Guia</th>
                <th>Plano</th>
                <th>Anexo (psicóloga)</th>
                <th>ADM</th>
                <th>Coluna S</th>
                <th>Plano pagou?</th>
                <th>Pendências</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.slice(0, 1500).map(({ l, ps }, i) => (
                <tr key={`${l.spreadsheet_id}-${l.guia}-${l.data_sessao}-${i}`} className={ps.some((p) => PROBLEMAS[p].grave) ? c.linhaGrave : ''}>
                  <td>{l.data_sessao ? dataBR(l.data_sessao) : '—'}</td>
                  <td>{l.psicologa}</td>
                  <td>{l.paciente}</td>
                  <td>
                    {l.guia || '—'}
                    {l.spreadsheet_id && l.guia && (
                      <a
                        className={c.abrir}
                        href={`/financeiro/guias?${new URLSearchParams({ planilha: l.spreadsheet_id, mes: String(mes), ano: String(ano), guia: l.guia })}`}
                        target="_blank"
                        rel="noopener"
                        title="Abrir no Registro de Guias"
                      >
                        ↗
                      </a>
                    )}
                  </td>
                  <td title={`fonte: ${l.plano_fonte}`}>{normalizarPlano(l.plano)}</td>
                  <td>{l.origem === 'so_admin' ? '—' : l.anexo === 'sim' ? <span className={s.badgeGood}>anexou</span> : <span className={s.badgeWarn}>sem anexo</span>}</td>
                  <td>{l.admin_registrou ? <span className={s.badgeGood}>lançada</span> : <span className={s.badgeWarn}>não</span>}</td>
                  <td>{l.origem === 'so_admin' ? '—' : l.status_s || <span className={s.muted}>(vazio)</span>}</td>
                  <td title={[l.operadora_ref, l.operadora_codigos ? `glosa ${l.operadora_codigos}` : ''].filter(Boolean).join(' · ')}>
                    <span className={['pago', 'lote_pago'].includes(l.operadora_status) ? s.badgeGood : l.operadora_status === 'glosado' || l.operadora_status === 'parcial' ? s.badgeBad : s.badgeWarn}>
                      {ROTULO_OPERADORA[l.operadora_status]}
                    </span>
                    {l.operadora_valor != null && <> {brl(l.operadora_valor)}</>}
                    {Number(l.operadora_glosa ?? 0) > 0 && <> · glosa {brl(Number(l.operadora_glosa))}</>}
                  </td>
                  <td>
                    {ps.length ? (
                      ps.map((p) => (
                        <span key={p} className={PROBLEMAS[p].grave ? s.badgeBad : s.badgeWarn} style={{ marginRight: 4 }} title={PROBLEMAS[p].explica}>
                          {PROBLEMAS[p].rotulo}
                        </span>
                      ))
                    ) : (
                      <span className={s.badgeGood}>✓ completa</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtradas.length > 1500 && <p className={s.sectionNote}>Mostrando 1.500 de {int(filtradas.length)}. Use os filtros.</p>}
      </section>
    </>
  )
}
