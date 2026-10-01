'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition, type KeyboardEvent } from 'react'
import { chaveDaLinha, deTexto, familia, paraCsv, paraTexto, resumo, type Coluna, type Linha } from '@/lib/sistema/banco'
import s from '../../../../financeiro/financeiro.module.css'
import b from '../../banco.module.css'
import { excluirLinha, salvarLinha } from '../../actions'

type Props = {
  esquema: string
  tabela: string
  colunas: Coluna[]
  chave: string[]
  linhas: Linha[]
  editavel: boolean
  ordem: string
  desc: boolean
  busca: string
}

type Teclado = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void

/** Campo de edição conforme o tipo da coluna (sim/não, JSON/texto longo, número, data, texto). */
function Campo({
  coluna,
  valor,
  mudar,
  foco = false,
  aoTeclar,
  aoSair,
}: {
  coluna: Coluna
  valor: string
  mudar: (v: string) => void
  foco?: boolean
  aoTeclar?: Teclado
  aoSair?: () => void
}) {
  const f = familia(coluna.tipo)
  if (f === 'booleano')
    return (
      <select autoFocus={foco} value={valor} onChange={(e) => mudar(e.target.value)} onKeyDown={aoTeclar} onBlur={aoSair} className={b.editor} aria-label={coluna.nome}>
        <option value="">—</option>
        <option value="true">sim</option>
        <option value="false">não</option>
      </select>
    )
  if (f === 'json' || valor.length > 60)
    return (
      <textarea
        autoFocus={foco}
        value={valor}
        rows={Math.min(6, Math.max(2, Math.ceil(valor.length / 50)))}
        onChange={(e) => mudar(e.target.value)}
        onKeyDown={aoTeclar}
        onBlur={aoSair}
        className={`${b.editor} ${b.editorLongo}`}
        aria-label={coluna.nome}
      />
    )
  return (
    <input
      autoFocus={foco}
      value={valor}
      onChange={(e) => mudar(e.target.value)}
      onKeyDown={aoTeclar}
      onBlur={aoSair}
      inputMode={f === 'numero' ? 'decimal' : undefined}
      placeholder={f === 'data' ? 'AAAA-MM-DD' : undefined}
      className={b.editor}
      aria-label={coluna.nome}
    />
  )
}

/**
 * Célula em edição: Enter (ou clicar fora) salva, Esc cancela. O "feito"
 * impede salvar duas vezes (Enter + perda de foco) ou salvar depois do Esc.
 */
function EditorCelula({
  coluna,
  inicial,
  onSalvar,
  onCancelar,
}: {
  coluna: Coluna
  inicial: string
  onSalvar: (texto: string) => boolean
  onCancelar: () => void
}) {
  const [texto, setTexto] = useState(inicial)
  const feito = useRef(false)
  const salvar = () => {
    if (feito.current) return
    feito.current = onSalvar(texto) // false = valor inválido: continua editando
  }
  return (
    <Campo
      coluna={coluna}
      valor={texto}
      mudar={setTexto}
      foco
      aoTeclar={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          feito.current = true
          onCancelar()
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          salvar()
        }
      }}
      aoSair={salvar}
    />
  )
}

/**
 * Grade estilo planilha: clique na célula → edita → Enter salva (só aquela
 * coluna vai para o banco). "+ Nova linha" abre uma linha em branco no topo.
 * Excluir pede confirmação na própria linha.
 */
export function Grade({ esquema, tabela, colunas, chave, linhas, editavel, ordem, desc, busca }: Props) {
  const router = useRouter()
  const [pendente, iniciar] = useTransition()
  const [celula, setCelula] = useState<{ linha: number; coluna: string } | null>(null)
  const [salvando, setSalvando] = useState<string | null>(null)
  const [novo, setNovo] = useState<Record<string, string> | null>(null)
  const [confirmar, setConfirmar] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // tenant_id é sempre a própria clínica: não ocupa espaço na grade
  const visiveis = colunas.filter((c) => !c.oculta && c.nome !== 'tenant_id')
  const ocultas = colunas.filter((c) => c.oculta).length
  const podeEditar = (c: Coluna) => editavel && !c.gerada && c.nome !== 'tenant_id'

  const hrefOrdem = (c: string) => {
    const q = new URLSearchParams()
    if (busca) q.set('q', busca)
    q.set('ordem', c)
    if (ordem === c && !desc) q.set('desc', '1')
    return `/sistema/banco/${esquema}/${tabela}?${q}`
  }

  const terminar = (ok: string) => {
    setAviso(ok)
    router.refresh()
    window.setTimeout(() => setAviso(null), 3500)
  }

  // ---------- editar uma célula ----------
  const salvarCelula = (i: number, col: Coluna, texto: string): boolean => {
    const linha = linhas[i]
    if (texto === paraTexto(linha[col.nome])) {
      setCelula(null)
      return true
    }
    let valor: unknown
    try {
      valor = deTexto(texto, col.tipo)
    } catch (e) {
      setErro(`${col.nome}: ${(e as Error).message}`)
      return false
    }
    const id = `${i}:${col.nome}`
    setErro(null)
    setSalvando(id)
    setCelula(null)
    iniciar(async () => {
      const r = await salvarLinha(esquema, tabela, chaveDaLinha(linha, chave), { [col.nome]: valor })
      setSalvando(null)
      if (!r.ok) setErro(r.erro)
      else terminar(`Salvo: ${col.nome}.`)
    })
    return true
  }

  // ---------- nova linha ----------
  const salvarNova = () => {
    if (!novo) return
    const valores: Record<string, unknown> = {}
    try {
      for (const c of visiveis) {
        const t = novo[c.nome]
        if (t === undefined || t.trim() === '') continue // vazio: o banco usa o padrão
        valores[c.nome] = deTexto(t, c.tipo)
      }
    } catch (e) {
      setErro((e as Error).message)
      return
    }
    setErro(null)
    iniciar(async () => {
      const r = await salvarLinha(esquema, tabela, null, valores)
      if (!r.ok) setErro(r.erro)
      else {
        setNovo(null)
        terminar('Linha criada.')
      }
    })
  }

  // ---------- excluir ----------
  const excluir = (i: number) => {
    setErro(null)
    iniciar(async () => {
      const r = await excluirLinha(esquema, tabela, chaveDaLinha(linhas[i], chave))
      setConfirmar(null)
      if (!r.ok) setErro(r.erro)
      else terminar('Linha excluída.')
    })
  }

  // ---------- exportar ----------
  const exportar = () => {
    const nomes = visiveis.map((c) => c.nome)
    const blob = new Blob([`﻿${paraCsv(nomes, linhas)}`], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${esquema}.${tabela}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const mostrar = (c: Coluna, v: unknown) => {
    if (v === null || v === undefined) return <span className={b.nulo}>—</span>
    if (typeof v === 'boolean') return v ? '✓ sim' : '✗ não'
    if (familia(c.tipo) === 'numero' && typeof v === 'number') return v.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
    return resumo(v)
  }

  return (
    <>
      <div className={b.ferramentas}>
        {editavel && !novo && (
          <button type="button" className={s.button} onClick={() => setNovo({})} disabled={pendente}>
            + Nova linha
          </button>
        )}
        <button type="button" className={s.buttonSmall} onClick={exportar} disabled={linhas.length === 0}>
          Baixar esta página (CSV / Excel)
        </button>
        {pendente && <span className={b.status}>Gravando no banco…</span>}
        {aviso && !pendente && <span className={b.statusOk}>{aviso}</span>}
        {ocultas > 0 && (
          <span className={b.status}>
            {ocultas} {ocultas === 1 ? 'coluna protegida não aparece' : 'colunas protegidas não aparecem'} (dados criptografados/pessoais)
          </span>
        )}
      </div>
      {erro && (
        <div className={s.alertBad} role="alert">
          {erro}{' '}
          <button type="button" className={b.linkBotao} onClick={() => setErro(null)}>
            fechar
          </button>
        </div>
      )}

      <div className={b.gradeWrap}>
        <table className={b.grade}>
          <thead>
            <tr>
              <th className={b.colNum}>#</th>
              {visiveis.map((c) => (
                <th key={c.nome} title={[c.tipo, c.descricao].filter(Boolean).join(' — ')}>
                  <Link href={hrefOrdem(c.nome)} className={b.ordenar}>
                    {c.pk && <span aria-label="chave">🔑 </span>}
                    {c.nome}
                    {ordem === c.nome && <span aria-hidden>{desc ? ' ▼' : ' ▲'}</span>}
                  </Link>
                  <span className={b.tipoCol}>{c.tipo}</span>
                </th>
              ))}
              {editavel && <th className={b.colAcoes}>Ações</th>}
            </tr>
          </thead>
          <tbody>
            {novo && (
              <tr className={b.linhaNova}>
                <td className={b.colNum}>novo</td>
                {visiveis.map((c) => (
                  <td key={c.nome}>
                    {podeEditar(c) ? (
                      <>
                        <Campo
                          coluna={c}
                          valor={novo[c.nome] ?? ''}
                          mudar={(v) => setNovo({ ...novo, [c.nome]: v })}
                          aoTeclar={(e) => {
                            if (e.key === 'Escape') setNovo(null)
                          }}
                        />
                        {(c.padrao || !c.nulo) && <span className={b.dica}>{c.padrao ? 'vazio = padrão' : 'obrigatória'}</span>}
                      </>
                    ) : (
                      <span className={b.nulo}>automático</span>
                    )}
                  </td>
                ))}
                <td className={b.colAcoes}>
                  <span className={b.acoesLinha}>
                    <button type="button" className={s.buttonSmall} onClick={salvarNova} disabled={pendente}>
                      Salvar
                    </button>
                    <button type="button" className={b.linkBotao} onClick={() => setNovo(null)} disabled={pendente}>
                      cancelar
                    </button>
                  </span>
                </td>
              </tr>
            )}
            {linhas.length === 0 && !novo && (
              <tr>
                <td colSpan={visiveis.length + 2} className={b.vazioGrade}>
                  Nenhuma linha.
                </td>
              </tr>
            )}
            {linhas.map((l, i) => (
              <tr key={i} className={confirmar === i ? b.linhaExcluir : undefined}>
                <td className={b.colNum}>{i + 1}</td>
                {visiveis.map((c) => {
                  const ativa = celula?.linha === i && celula.coluna === c.nome
                  const texto = paraTexto(l[c.nome])
                  return (
                    <td
                      key={c.nome}
                      className={`${podeEditar(c) ? b.celEditavel : ''} ${salvando === `${i}:${c.nome}` ? b.celSalvando : ''} ${familia(c.tipo) === 'numero' ? b.celNumero : ''}`}
                      title={!ativa && texto.length > 80 ? texto.slice(0, 1500) : undefined}
                      onClick={() => {
                        if (!ativa && podeEditar(c) && !pendente) {
                          setErro(null)
                          setCelula({ linha: i, coluna: c.nome })
                        }
                      }}
                    >
                      {ativa ? (
                        <EditorCelula coluna={c} inicial={texto} onSalvar={(t) => salvarCelula(i, c, t)} onCancelar={() => setCelula(null)} />
                      ) : (
                        mostrar(c, l[c.nome])
                      )}
                    </td>
                  )
                })}
                {editavel && (
                  <td className={b.colAcoes}>
                    {confirmar === i ? (
                      <span className={b.acoesLinha}>
                        <button type="button" className={b.botaoPerigo} onClick={() => excluir(i)} disabled={pendente}>
                          Confirmar exclusão
                        </button>
                        <button type="button" className={b.linkBotao} onClick={() => setConfirmar(null)}>
                          não
                        </button>
                      </span>
                    ) : (
                      <button type="button" className={b.linkPerigo} onClick={() => setConfirmar(i)} disabled={pendente} title="Excluir esta linha do banco">
                        Excluir
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
