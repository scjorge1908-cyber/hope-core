'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import s from '../../financeiro.module.css'

type Amostra = { id: string; type: string; amount: number; createdAt: string; transaction: { description: string | null; counterParty: { name: string | null } } }
type Resultado = {
  inicio: string
  fim: string
  recebidos: number
  lancamentos_novos?: number
  previstos_confirmados?: number
  saldoCentavos: number | null
  formatoData: string | null
  amostra?: Amostra[]
}

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

/** "Testar leitura" (não grava) e "Sincronizar extrato" (grava e concilia). */
export function BotoesBradesco() {
  const router = useRouter()
  const [rodando, setRodando] = useState<'' | 'ler' | 'gravar'>('')
  const [erro, setErro] = useState('')
  const [res, setRes] = useState<Resultado | null>(null)

  async function chamar(modo: 'ler' | 'gravar') {
    setRodando(modo)
    setErro('')
    try {
      const r = await fetch(`/financeiro/banco/bradesco/sincronizar${modo === 'ler' ? '?ler=1' : ''}`, { method: 'POST' })
      const j = (await r.json()) as { resultado?: Resultado; erro?: string }
      if (!r.ok || j.erro) throw new Error(j.erro || `Erro ${r.status}`)
      setRes(j.resultado ?? null)
      if (modo === 'gravar') router.refresh()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setRodando('')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" className={s.buttonSmall} onClick={() => chamar('ler')} disabled={!!rodando}>
          {rodando === 'ler' ? 'Lendo…' : '🔎 Testar leitura (não grava)'}
        </button>
        <button type="button" className={s.button} onClick={() => chamar('gravar')} disabled={!!rodando}>
          {rodando === 'gravar' ? 'Sincronizando…' : '⟳ Sincronizar extrato'}
        </button>
      </div>
      {erro && <div className={s.alertBad}>{erro}</div>}
      {res && (
        <div className={s.alertGood}>
          Período {dataBR(res.inicio)} a {dataBR(res.fim)}: {res.recebidos} lançamento(s) lido(s)
          {res.lancamentos_novos !== undefined && <> · {res.lancamentos_novos} novo(s) gravado(s)</>}
          {res.previstos_confirmados !== undefined && <> · {res.previstos_confirmados} recebimento(s) da Agenda confirmado(s)</>}
          {res.saldoCentavos !== null && <> · saldo após o último lançamento: <strong>{brl(res.saldoCentavos)}</strong></>}
          {res.formatoData && <> · (data aceita pela API: {res.formatoData})</>}
        </div>
      )}
      {res?.amostra && res.amostra.length > 0 && (
        <div className={s.tableWrap} style={{ marginTop: 12 }}>
          <p className={s.sectionNote}>Amostra dos últimos lançamentos lidos — confira os valores com o extrato do Net Empresa antes de sincronizar:</p>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th className={s.num}>Valor</th>
                <th>Contraparte</th>
                <th>Descrição</th>
              </tr>
            </thead>
            <tbody>
              {res.amostra.map((a) => (
                <tr key={a.id}>
                  <td>{dataBR(a.createdAt)}</td>
                  <td>{a.type === 'CREDIT' ? 'Entrada' : 'Saída'}</td>
                  <td className={a.type === 'CREDIT' ? s.numGood : s.numBad}>{brl(a.amount)}</td>
                  <td>{a.transaction.counterParty.name ?? '—'}</td>
                  <td>{a.transaction.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
