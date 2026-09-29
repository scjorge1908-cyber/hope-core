'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Resp = { pulado?: boolean; erro?: string; resultado?: { previstos_confirmados?: number; lancamentos_novos?: number } }

/**
 * Ao abrir a página, pede ao servidor para buscar o extrato do Cora e
 * conciliar com a Agenda (o servidor só busca se a última foi há 30+ min).
 * Se algo foi confirmado, recarrega os dados da tela.
 */
export function AutoConciliar({ forcar = false }: { forcar?: boolean }) {
  const router = useRouter()
  const feito = useRef(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (feito.current) return
    feito.current = true
    fetch(`/financeiro/banco/sincronizar${forcar ? '?forcar=1' : ''}`, { method: 'POST' })
      .then((r) => r.json() as Promise<Resp>)
      .then((j) => {
        const n = j.resultado?.previstos_confirmados ?? 0
        if (n > 0) {
          setMsg(`Banco: ${n} recebimento${n === 1 ? '' : 's'} confirmado${n === 1 ? '' : 's'} pelo extrato do Cora.`)
          router.refresh()
        }
      })
      .catch(() => {})
  }, [forcar, router])

  if (!msg) return null
  return (
    <div role="status" style={{ fontSize: 13, fontWeight: 600, color: 'var(--fin-good)', margin: '0 0 16px' }}>
      ✓ {msg}
    </div>
  )
}
