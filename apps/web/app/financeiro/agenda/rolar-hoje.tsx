'use client'

import { useEffect } from 'react'

/**
 * Abre a grade já no dia de hoje: rola a tabela para que a coluna de hoje
 * fique logo depois das colunas fixas (plano + total). A barra de rolagem
 * continua funcionando normalmente.
 */
export function RolarParaHoje({ alvo }: { alvo: string }) {
  useEffect(() => {
    const caixa = document.getElementById(alvo)
    if (!caixa) return
    const hoje = caixa.querySelector<HTMLElement>('th[data-hoje="1"]')
    if (!hoje) {
      caixa.scrollLeft = 0
      return
    }
    const fixas = Array.from(caixa.querySelectorAll<HTMLElement>('thead th[data-fixa="1"]'))
    const larguraFixa = fixas.reduce((t, th) => t + th.offsetWidth, 0)
    caixa.scrollLeft = Math.max(0, hoje.offsetLeft - larguraFixa)
  }, [alvo])
  return null
}
