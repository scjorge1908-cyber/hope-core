import { Titulo } from '../../financeiro/titulo'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { gerarGuias, type GerarGuiasBase } from '@/lib/bi/gerar-guias'
import s from '../../financeiro/financeiro.module.css'
import b from '../bi.module.css'

export const metadata = { title: 'Gerar guias — HOPE CORE' }
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
const br = (iso: string) => iso.split('-').reverse().join('/')

export default async function GerarGuias({ searchParams }: PageProps<'/bi/gerar-guias'>) {
  const sp = await searchParams
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return null
  const { data, error } = await supabase.rpc('bi_gerar_guias_base')
  if (error || !data) return <div className={s.alertBad}>Não foi possível carregar: {error?.message}</div>
  const base = data as unknown as GerarGuiasBase
  const hoje = base.hoje
  const mes = Number(um(sp.mes)) || Number(hoje.slice(5, 7))
  const ano = Number(um(sp.ano)) || Number(hoje.slice(0, 4))
  const r = gerarGuias(base, mes, ano)
  const semanaHoje = r.semanas.find((c) => c.inicio <= hoje && hoje <= c.fim)?.numero ?? 1
  const semana = Math.min(Math.max(Number(um(sp.semana)) || semanaHoje, 1), r.semanas.length || 1)
  const sem = r.semanas.find((c) => c.numero === semana)
  const psi = um(sp.psi)
  const detalhe = sem?.linhas.find((l) => l.sid === psi)
  const tot = (sem?.linhas ?? []).reduce((t, l) => ({ previsto: t.previsto + l.previsto, gerado: t.gerado + l.gerado, falta: t.falta + l.falta }), { previsto: 0, gerado: 0, falta: 0 })
  const q = (extra: Record<string, string | number>) => `?${new URLSearchParams({ mes: String(mes), ano: String(ano), semana: String(semana), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) })}`

  return (
    <div className={b.pagina}>
      <Titulo titulo="Gerar guias">
        <strong>Guias previstas pela Agenda × guias já geradas no Registro de Guias, por semana.</strong> Semanas de segunda a sábado (a
        última vai até o fim do mês). Bradesco: 2 guias por atendimento na semana; Select: 1 guia no mês; demais planos: 1 por atendimento.
        Particular e Sublocação ficam de fora. Só conta a partir da data de início do paciente. A BD_GUIAS tem 2 espaços por semana: quando
        o previsto passa de 2, aparece o aviso “limite da planilha”.
      </Titulo>

      <form className={b.filtros}>
        <label>
          Mês
          <select name="mes" defaultValue={String(mes)}>
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ano
          <select name="ano" defaultValue={String(ano)}>
            {[ano - 1, ano, ano + 1].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={s.buttonSmall}>
          Buscar
        </button>
      </form>

      <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }} aria-label="Semanas">
        {r.semanas.map((c) => (
          <a key={c.numero} href={q({ semana: c.numero })} className={c.numero === semana ? s.button : s.buttonSmall} aria-current={c.numero === semana ? 'page' : undefined}>
            {c.numero}ª semana · {br(c.inicio).slice(0, 5)}–{br(c.fim).slice(0, 5)}
          </a>
        ))}
      </nav>

      {!base.agenda.length && (
        <div className={b.aviso}>A Agenda das psicólogas ainda não chegou ao HOPE CORE — atualize o SyncSupabase.gs no Calculo RPA e sincronize.</div>
      )}

      <section className={s.section}>
        <h2 className={s.sectionTitle}>
          {semana}ª semana de {MESES[mes - 1].toLowerCase()} ({sem ? `${br(sem.inicio)} a ${br(sem.fim)}` : '—'})
        </h2>
        <div className={s.tableWrap}>
          <table className={b.tabela}>
            <thead>
              <tr>
                <th>#</th>
                <th className={b.esq}>Psicóloga</th>
                <th>Previstas</th>
                <th>Já geradas</th>
                <th>Falta gerar</th>
                <th className={b.esq}>Status</th>
              </tr>
            </thead>
            <tbody>
              {(sem?.linhas ?? []).map((l, i) => (
                <tr key={l.sid}>
                  <td>{i + 1}</td>
                  <td className={b.esq}>
                    <a href={q({ psi: l.sid })}>{l.psicologa}</a>
                  </td>
                  <td>{l.previsto}</td>
                  <td>{l.gerado}</td>
                  <td>{l.falta}</td>
                  <td className={b.esq}>
                    <span className={l.falta ? s.badgeWarn : s.badgeGood}>{l.falta ? 'Falta gerar' : 'OK'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td className={b.esq}>Total</td>
                <td>{tot.previsto}</td>
                <td>{tot.gerado}</td>
                <td>{tot.falta}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        {base.bdSincronizado && (
          <p className={s.muted} style={{ fontSize: 12, marginTop: 8 }}>
            Registro de Guias sincronizado em {new Date(base.bdSincronizado).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.
          </p>
        )}
      </section>

      {detalhe && (
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Guias faltando gerar — {detalhe.psicologa}</h2>
          <div className={s.tableWrap}>
            <table className={b.tabela}>
              <thead>
                <tr>
                  <th className={b.esq}>Paciente</th>
                  <th className={b.esq}>Plano</th>
                  <th>Previsto</th>
                  <th>Já gerado</th>
                  <th>Falta</th>
                </tr>
              </thead>
              <tbody>
                {detalhe.detalhe.map((d) => (
                  <tr key={d.paciente}>
                    <td className={b.esq}>{d.paciente}</td>
                    <td className={b.esq}>{d.plano}</td>
                    <td>{d.previsto}</td>
                    <td>{d.gerado}</td>
                    <td>
                      {d.falta}
                      {d.limitePlanilha && (
                        <span className={s.badgeInfo} style={{ marginLeft: 6 }} title="A BD_GUIAS só tem 2 espaços por semana">
                          limite da planilha
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {r.avisos.length > 0 && (
        <details className={s.section}>
          <summary>{r.avisos.length} aviso(s) de leitura da Agenda</summary>
          <ul style={{ fontSize: 13, marginTop: 8 }}>
            {r.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
