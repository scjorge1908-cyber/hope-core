'use client'

import { useActionState, useState } from 'react'
import { registrarNota, type NotaState } from './actions'
import s from '../financeiro.module.css'

export interface StatementOption {
  id: string
  label: string
  released: number
}

const initial: NotaState = {}

export function NotaForm({ statements }: { statements: StatementOption[] }) {
  const [state, action, pending] = useActionState(registrarNota, initial)
  const [amount, setAmount] = useState('')

  if (statements.length === 0) {
    return <p className={s.muted}>Todos os demonstrativos já têm nota registrada.</p>
  }

  return (
    <form action={action} className={s.form}>
      <label className={s.field}>
        Demonstrativo
        <select
          name="statement_id"
          required
          defaultValue=""
          onChange={(e) => {
            const st = statements.find((x) => x.id === e.target.value)
            if (st) setAmount(st.released.toFixed(2).replace('.', ','))
          }}
        >
          <option value="" disabled>
            Escolha…
          </option>
          {statements.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <div className={s.formRow}>
        <label className={s.field}>
          Nº da nota
          <input name="invoice_number" required maxLength={60} />
        </label>
        <label className={s.field}>
          Valor (R$)
          <input name="amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      </div>
      <div className={s.formRow}>
        <label className={s.field}>
          Emissão
          <input type="date" name="issue_date" required />
        </label>
        <label className={s.field}>
          Pagamento previsto (opcional)
          <input type="date" name="expected_payment_date" />
        </label>
      </div>
      <label className={s.field}>
        Observação (opcional)
        <input name="notes" maxLength={500} />
      </label>
      <button className={s.button} disabled={pending}>
        {pending ? 'Salvando…' : 'Registrar nota'}
      </button>
      {state.error && <div className={s.alertBad}>{state.error}</div>}
      {state.ok && <div className={s.alertGood}>{state.ok}</div>}
    </form>
  )
}
