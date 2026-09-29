'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import s from './sincronizar.module.css'

type Linha = { id: string; nome: string | null; ultima: string | null; erro: string | null }
type Fase = 'parado' | 'pedindo' | 'aguardando' | 'rodando' | 'pronto' | 'erro'

const API = '/financeiro/sincronizar'
const INTERVALO_MS = 8_000
const LIMITE_MS = 6 * 60_000

async function lerStatus(): Promise<Linha[]> {
  const r = await fetch(API, { cache: 'no-store' })
  const j = await r.json()
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
  return j.linhas as Linha[]
}

/**
 * Botão "Sincronizar planilhas": pede ao Calculo RPA para rodar
 * sincronizarPlanilhasSupabase() agora e acompanha pelo banco quantas
 * planilhas já chegaram. No fim, recarrega os dados da tela.
 */
export function BotaoSincronizar({ compacto = false }: { compacto?: boolean }) {
  const router = useRouter()
  const [fase, setFase] = useState<Fase>('parado')
  const [msg, setMsg] = useState('')
  const [feitas, setFeitas] = useState(0)
  const [total, setTotal] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  async function sincronizar() {
    if (fase === 'pedindo' || fase === 'aguardando' || fase === 'rodando') return
    setFase('pedindo')
    setMsg('Enviando pedido ao Calculo RPA…')
    setFeitas(0)
    const inicio = Date.now()
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
      setFase('aguardando')
      setMsg(String(j.resultado?.mensagem || 'Sincronização agendada — começa em até 1 minuto.'))
    } catch (e) {
      setFase('erro')
      setMsg((e as Error).message)
      return
    }

    // Referência: horário do pedido (com 1 min de folga p/ relógio do Google)
    const desde = inicio - 60_000
    let semMudanca = 0
    let ultimoFeitas = -1

    const passo = async () => {
      try {
        const linhas = await lerStatus()
        const n = linhas.filter((l) => l.ultima && new Date(l.ultima).getTime() >= desde).length
        const comErro = linhas.filter((l) => l.erro).length
        setTotal(linhas.length)
        setFeitas(n)
        if (n > 0) {
          setFase('rodando')
          setMsg(`Lendo planilhas… ${n} de ${linhas.length}`)
        }
        semMudanca = n === ultimoFeitas && n > 0 ? semMudanca + 1 : 0
        ultimoFeitas = n
        const terminou = linhas.length > 0 && n >= linhas.length - comErro
        // 90 s sem nenhuma planilha nova depois de começar = terminou (as que faltam deram erro)
        const parou = semMudanca >= Math.ceil(90_000 / INTERVALO_MS)
        if (terminou || parou) {
          setFase('pronto')
          setMsg(
            `Pronto: ${n} de ${linhas.length} planilhas atualizadas` +
              (comErro ? ` · ${comErro} com erro (veja a tabela)` : '') +
              '.'
          )
          router.refresh()
          return
        }
        if (Date.now() - inicio > LIMITE_MS) {
          setFase('pronto')
          setMsg(`Ainda rodando no Google (${n} de ${linhas.length}). Ela continua sozinha — atualize a página em alguns minutos.`)
          router.refresh()
          return
        }
      } catch (e) {
        setMsg(`Acompanhando… (${(e as Error).message})`)
      }
      timer.current = setTimeout(passo, INTERVALO_MS)
    }
    timer.current = setTimeout(passo, INTERVALO_MS)
  }

  const ocupado = fase === 'pedindo' || fase === 'aguardando' || fase === 'rodando'
  const pct = total ? Math.min(100, Math.round((feitas / total) * 100)) : 0

  return (
    <div className={compacto ? `${s.caixa} ${s.compacto}` : s.caixa}>
      <button type="button" className={s.botao} onClick={sincronizar} disabled={ocupado} aria-busy={ocupado}>
        <span className={ocupado ? `${s.icone} ${s.girando}` : s.icone} aria-hidden>
          ⟳
        </span>
        {ocupado ? 'Sincronizando…' : 'Sincronizar planilhas'}
      </button>
      {msg && (
        <span className={fase === 'erro' ? `${s.msg} ${s.msgErro}` : fase === 'pronto' ? `${s.msg} ${s.msgOk}` : s.msg} role="status">
          {msg}
        </span>
      )}
      {fase === 'rodando' && total > 0 && (
        <span className={s.barra} aria-hidden>
          <span className={s.preenchido} style={{ width: `${pct}%` }} />
        </span>
      )}
    </div>
  )
}
