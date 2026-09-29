'use client'

import { useEffect, useRef, useState } from 'react'
import a from './agenda.module.css'

/**
 * Barra de rolagem horizontal que fica SEMPRE visível, presa no rodapé da
 * tela enquanto a grade estiver à vista, sincronizada com a grade.
 */
export function BarraRolagemFixa({ alvo }: { alvo: string }) {
  const barra = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(0)
  const [visivel, setVisivel] = useState(false)

  useEffect(() => {
    const grade = document.getElementById(alvo)
    const b = barra.current
    if (!grade || !b) return
    let origem: 'grade' | 'barra' | null = null
    const medir = () => {
      setLargura(grade.scrollWidth)
      setVisivel(grade.scrollWidth > grade.clientWidth + 1)
      b.scrollLeft = grade.scrollLeft
    }
    const daGrade = () => {
      if (origem === 'barra') return
      origem = 'grade'
      b.scrollLeft = grade.scrollLeft
      requestAnimationFrame(() => (origem = null))
    }
    const daBarra = () => {
      if (origem === 'grade') return
      origem = 'barra'
      grade.scrollLeft = b.scrollLeft
      requestAnimationFrame(() => (origem = null))
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(grade)
    grade.addEventListener('scroll', daGrade, { passive: true })
    b.addEventListener('scroll', daBarra, { passive: true })
    window.addEventListener('resize', medir)
    // a grade pode ter sido rolada até hoje logo depois de montar
    const t = setTimeout(medir, 300)
    return () => {
      ro.disconnect()
      grade.removeEventListener('scroll', daGrade)
      b.removeEventListener('scroll', daBarra)
      window.removeEventListener('resize', medir)
      clearTimeout(t)
    }
  }, [alvo])

  return (
    <div ref={barra} className={a.barraFixa} style={{ display: visivel ? 'block' : 'none' }} aria-hidden>
      <div style={{ width: largura, height: 1 }} />
    </div>
  )
}
