'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import s from './financeiro.module.css'

/**
 * Título da página com um botão "?" ao lado. A explicação fica escondida
 * e abre num balão ao clicar (fecha com outro clique, Esc ou clique fora).
 */
export function Titulo({ titulo, children }: { titulo: string; children?: ReactNode }) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false)
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
    }
  }, [aberto])

  return (
    <div className={s.tituloLinha} ref={caixa}>
      <h1 className={s.pageTitle}>{titulo}</h1>
      {children && (
        <>
          <button
            type="button"
            className={aberto ? `${s.infoBotao} ${s.infoBotaoAberto}` : s.infoBotao}
            aria-expanded={aberto}
            aria-controls={id}
            aria-label="Como funciona esta página"
            title="Como funciona esta página"
            onClick={() => setAberto((v) => !v)}
          >
            ?
          </button>
          {aberto && (
            <div id={id} role="note" className={s.infoBalao}>
              {children}
            </div>
          )}
        </>
      )}
    </div>
  )
}
