'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { importarDemonstrativos, type ImportState } from './actions'
import s from '../financeiro.module.css'

const initial: ImportState = { outcomes: [] }

export function ImportForm() {
  const [state, action, pending] = useActionState(importarDemonstrativos, initial)

  return (
    <>
      <form action={action} className={s.form}>
        <div className={s.drop}>
          Escolha um ou mais XMLs de demonstrativo (análise de conta).
          <br />
          <input type="file" name="arquivos" accept=".xml,text/xml,application/xml" multiple required />
        </div>
        <button className={s.button} disabled={pending}>
          {pending ? 'Importando…' : 'Importar'}
        </button>
      </form>

      {state.error && (
        <div className={s.alertBad} style={{ marginTop: 16 }}>
          {state.error}
        </div>
      )}

      {state.outcomes.length > 0 && (
        <div style={{ marginTop: 20 }}>
          {state.outcomes.map((o, i) => (
            <div key={i} className={o.ok ? (o.divergences.length ? s.alertWarn : s.alertGood) : s.alertBad}>
              <div style={{ fontWeight: 600 }}>{o.fileName}</div>
              <div>{o.title}</div>
              {o.details.length > 0 && (
                <ul className={s.list}>
                  {o.details.map((d, j) => (
                    <li key={j}>{d}</li>
                  ))}
                </ul>
              )}
              {o.divergences.length > 0 && (
                <>
                  <div style={{ marginTop: 6, fontWeight: 600 }}>Avisos (importado mesmo assim):</div>
                  <ul className={s.list}>
                    {o.divergences.map((d, j) => (
                      <li key={j}>{d}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))}
          <Link className={s.button} href="/financeiro">
            Ver o painel
          </Link>
        </div>
      )}
    </>
  )
}
