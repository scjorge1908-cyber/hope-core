'use client'

import { useState } from 'react'
import p from './pagamentos.module.css'

/** Copia o "Pix Copia e Cola" para colar no app do banco. */
export function CopiarPix({ codigo }: { codigo: string }) {
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo)
    } catch {
      // navegador sem permissão de área de transferência: seleciona o texto
      const t = document.createElement('textarea')
      t.value = codigo
      document.body.appendChild(t)
      t.select()
      document.execCommand('copy')
      t.remove()
    }
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2500)
  }

  return (
    <button type="button" className={p.botaoCopiar} onClick={copiar} aria-live="polite">
      {copiado ? '✓ Copiado' : 'Copiar Pix (copia e cola)'}
    </button>
  )
}
