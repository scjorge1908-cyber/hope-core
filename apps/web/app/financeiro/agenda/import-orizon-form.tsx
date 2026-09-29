'use client'

import { useActionState } from 'react'
import { importarOrizon, type ImportOrizonState } from './actions'
import s from '../financeiro.module.css'

const inicial: ImportOrizonState = { detalhes: [] }

export function ImportOrizonForm() {
  const [estado, acao, enviando] = useActionState(importarOrizon, inicial)
  return (
    <>
      <form action={acao} className={s.form} style={{ maxWidth: 'none' }}>
        <div className={s.drop} style={{ padding: 18 }}>
          Relatório <strong>“Lotes Exportados e Liberados”</strong> do portal Orizon (.xlsx)
          <br />
          <input type="file" name="arquivo" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
        </div>
        <button className={s.button} disabled={enviando}>
          {enviando ? 'Importando…' : 'Importar lotes do Bradesco'}
        </button>
      </form>
      {estado.erro && (
        <div className={s.alertBad} style={{ marginTop: 12 }}>
          {estado.erro}
        </div>
      )}
      {estado.ok && (
        <div className={s.alertGood} style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600 }}>{estado.titulo}</div>
          <ul className={s.list}>
            {estado.detalhes.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
