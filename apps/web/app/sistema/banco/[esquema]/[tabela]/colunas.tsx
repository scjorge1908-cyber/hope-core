'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { Coluna } from '@/lib/sistema/banco'
import s from '../../../../financeiro/financeiro.module.css'
import b from '../../banco.module.css'
import { descrever } from '../../actions'

/** Lista das colunas com tipo, regras e descrição editável. */
export function Colunas({ esquema, tabela, colunas }: { esquema: string; tabela: string; colunas: Coluna[] }) {
  const router = useRouter()
  const [editando, setEditando] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()

  const abrir = (c: Coluna) => {
    setEditando(c.nome)
    setTexto(c.descricao ?? '')
    setErro(null)
  }

  const salvar = (coluna: string) =>
    iniciar(async () => {
      const r = await descrever(esquema, tabela, coluna, { descricao: texto.trim() })
      if (!r.ok) setErro(r.erro)
      else {
        setEditando(null)
        router.refresh()
      }
    })

  return (
    <div className={s.tableWrap}>
      <table className={`${s.table} ${b.tabelaColunas}`}>
        <thead>
          <tr>
            <th>Coluna</th>
            <th>Tipo</th>
            <th>Regras</th>
            <th>Descrição</th>
          </tr>
        </thead>
        <tbody>
          {colunas.map((c) => (
            <tr key={c.nome}>
              <td>
                <code>{c.nome}</code>
              </td>
              <td className={s.muted}>{c.tipo}</td>
              <td>
                <span className={b.regras}>
                  {c.pk && <span className={b.seloInfo}>chave</span>}
                  {!c.nulo && !c.pk && <span className={b.seloNeutro}>obrigatória</span>}
                  {c.gerada && <span className={b.seloNeutro}>automática</span>}
                  {c.oculta && <span className={b.seloAviso}>protegida (não aparece)</span>}
                  {c.referencia && (
                    <Link className={b.seloLink} href={`/sistema/banco/${c.referencia.esquema}/${c.referencia.tabela}`}>
                      → {c.referencia.tabela}
                    </Link>
                  )}
                  {c.padrao && !c.gerada && <span className={b.padrao} title={c.padrao}>padrão: {c.padrao.length > 28 ? `${c.padrao.slice(0, 27)}…` : c.padrao}</span>}
                </span>
              </td>
              <td className={b.celDescricao}>
                {editando === c.nome ? (
                  <span className={b.editaDescricao}>
                    <input
                      autoFocus
                      value={texto}
                      onChange={(e) => setTexto(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') salvar(c.nome)
                        if (e.key === 'Escape') setEditando(null)
                      }}
                      aria-label={`Descrição da coluna ${c.nome}`}
                    />
                    <button type="button" className={s.buttonSmall} disabled={pendente} onClick={() => salvar(c.nome)}>
                      {pendente ? '…' : 'Salvar'}
                    </button>
                    <button type="button" className={b.linkBotao} onClick={() => setEditando(null)}>
                      cancelar
                    </button>
                    {erro && <span className={b.erroPequeno}>{erro}</span>}
                  </span>
                ) : (
                  <>
                    {c.descricao ?? <span className={s.muted}>—</span>}{' '}
                    <button type="button" className={b.linkBotao} onClick={() => abrir(c)}>
                      descrever
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
