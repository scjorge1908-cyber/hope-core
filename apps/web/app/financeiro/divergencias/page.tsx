import { requireFinanceAccess } from '@/lib/financeiro/server'
import { brl, int } from '@/lib/financeiro/format'
import type { GuiaDivergenciaRow } from '@/lib/financeiro/db-types'
import s from '../financeiro.module.css'

const TIPOS: Record<GuiaDivergenciaRow['tipo'], { titulo: string; nota: string; cls: string }> = {
  ok_glosado: {
    titulo: 'OK na planilha, mas a Unimed glosou',
    nota: 'Entram no repasse da psicóloga sem a clínica ter recebido. Conferir o motivo da glosa (recurso ou tirar o OK).',
    cls: s.badgeBad,
  },
  pago_sem_ok: {
    titulo: 'A Unimed pagou, mas a planilha não tem OK',
    nota: 'A clínica recebeu e a psicóloga ainda não recebe repasse por estas sessões.',
    cls: s.badgeWarn,
  },
  falta_faturada: {
    titulo: 'FALTA na planilha, mas a guia foi faturada',
    nota: 'Sessão marcada como falta e cobrada da Unimed — risco de auditoria. Confirmar se houve atendimento.',
    cls: s.badgeBad,
  },
}

const ORDEM: GuiaDivergenciaRow['tipo'][] = ['ok_glosado', 'pago_sem_ok', 'falta_faturada']

function linkRegistro(d: GuiaDivergenciaRow) {
  const q = new URLSearchParams({ planilha: d.spreadsheet_id, guia: d.guia })
  if (d.mes) q.set('mes', String(d.mes))
  if (d.ano) q.set('ano', String(d.ano))
  return `/financeiro/guias?${q.toString()}`
}

export default async function DivergenciasPage() {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return null

  const { data, error } = await supabase.rpc('guia_divergencias')
  const linhas = (data ?? []) as GuiaDivergenciaRow[]

  return (
    <>
      <h1 className={s.pageTitle}>Divergências: planilhas × Unimed</h1>
      <p className={s.lead}>
        Cruza o número da guia da aba Atendimentos de cada psicóloga (coluna E) e o status da coluna S com os
        demonstrativos da Unimed já importados. Só aparecem guias que estão nos XMLs. Clique em “Abrir” para ir
        direto à guia no Registro de Guias e corrigir (grava na planilha e no banco).
      </p>

      {error && <div className={s.alertBad}>Erro: {error.message}</div>}

      <div className={s.cards}>
        {ORDEM.map((t) => {
          const grupo = linhas.filter((l) => l.tipo === t)
          const valor = t === 'ok_glosado' ? grupo.reduce((a, l) => a + Number(l.glosado), 0) : grupo.reduce((a, l) => a + Number(l.liberado), 0)
          return (
            <div key={t} className={s.card}>
              <div className={s.cardLabel}>{TIPOS[t].titulo}</div>
              <div className={s.cardValue}>{int(grupo.length)}</div>
              <div className={s.cardHint}>
                {t === 'ok_glosado' ? 'glosado' : 'liberado'}: {brl(valor)}
              </div>
            </div>
          )
        })}
      </div>

      {ORDEM.map((t) => {
        const grupo = linhas.filter((l) => l.tipo === t)
        if (!grupo.length) return null
        return (
          <section key={t} className={s.section}>
            <h2 className={s.sectionTitle}>
              <span className={TIPOS[t].cls}>{int(grupo.length)}</span> {TIPOS[t].titulo}
            </h2>
            <p className={s.sectionNote}>{TIPOS[t].nota}</p>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Psicóloga</th>
                    <th>Paciente</th>
                    <th>Guia</th>
                    <th>Sessão (planilha)</th>
                    <th>Status na planilha</th>
                    <th className={s.num}>Liberado</th>
                    <th className={s.num}>Glosado</th>
                    <th>Glosa</th>
                    <th>Demonstrativo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {grupo.map((d) => (
                    <tr key={`${d.spreadsheet_id}-${d.guia}`}>
                      <td>{d.psicologa}</td>
                      <td>{d.paciente}</td>
                      <td>{d.guia}</td>
                      <td>{d.datas_planilha ?? '—'}</td>
                      <td>{d.status_planilha || <span className={s.muted}>(vazio)</span>}</td>
                      <td className={s.num}>{brl(d.liberado)}</td>
                      <td className={s.num}>{brl(d.glosado)}</td>
                      <td>{d.codigos_glosa ?? '—'}</td>
                      <td>{d.demonstrativos ?? '—'}</td>
                      <td>
                        <a className={s.buttonSmall} href={linkRegistro(d)}>
                          Abrir
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      {!error && !linhas.length && <div className={s.alertGood}>Nenhuma divergência entre as planilhas e os demonstrativos importados.</div>}
    </>
  )
}
