'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ORDEM_AREAS, type DetalheTabela } from '@/lib/sistema/banco'
import s from '../../../../financeiro/financeiro.module.css'
import b from '../../banco.module.css'
import { descrever } from '../../actions'

/** Cabeçalho da tabela: o descritivo (para que serve, de onde vem, onde é usada) — editável. */
export function Cabecalho({ detalhe: d, total }: { detalhe: DetalheTabela; total: number | null }) {
  const router = useRouter()
  const [editando, setEditando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()
  const desc = d.descricao
  const paraQue = desc?.para_que ?? d.comentario

  const salvar = (fd: FormData) => {
    const campos = Object.fromEntries(['area', 'titulo', 'paraQue', 'origem', 'usadoEm'].map((k) => [k, String(fd.get(k) ?? '').trim()]))
    setErro(null)
    iniciar(async () => {
      const r = await descrever(d.esquema, d.tabela, null, campos)
      if (!r.ok) setErro(r.erro)
      else {
        setEditando(false)
        router.refresh()
      }
    })
  }

  return (
    <header className={b.cabecalho}>
      <div className={b.cabecalhoTopo}>
        <div>
          <h1 className={s.pageTitle}>{desc?.titulo ?? d.tabela}</h1>
          <code className={b.nomeTecnico}>
            {d.esquema}.{d.tabela}
          </code>
        </div>
        <div className={b.selos}>
          {desc?.area && <span className={b.seloInfo}>{desc.area}</span>}
          <span className={b.seloNeutro}>{d.tipo}</span>
          {total !== null && <span className={b.seloNeutro}>{total.toLocaleString('pt-BR')} linhas</span>}
          <span className={b.seloNeutro}>{d.colunas.length} colunas</span>
          {d.somenteLeitura ? <span className={b.seloAviso}>somente leitura</span> : <span className={b.seloBom}>editável</span>}
          {d.porClinica && <span className={b.seloNeutro}>separada por clínica</span>}
        </div>
      </div>

      {!editando ? (
        <>
          <dl className={b.descritivo}>
            <div>
              <dt>Para que serve</dt>
              <dd>{paraQue ?? <span className={s.muted}>Ainda sem descrição. Clique em “Editar descrição”.</span>}</dd>
            </div>
            <div>
              <dt>De onde vêm os dados</dt>
              <dd>{desc?.origem ?? <span className={s.muted}>—</span>}</dd>
            </div>
            <div>
              <dt>Onde é usada</dt>
              <dd>{desc?.usado_em ?? <span className={s.muted}>—</span>}</dd>
            </div>
          </dl>
          <button type="button" className={s.buttonSmall} onClick={() => setEditando(true)}>
            Editar descrição
          </button>
        </>
      ) : (
        <form action={salvar} className={b.formDescricao}>
          <div className={s.formRow}>
            <label className={s.field}>
              Nome amigável
              <input name="titulo" defaultValue={desc?.titulo ?? ''} placeholder={d.tabela} />
            </label>
            <label className={s.field}>
              Grupo (área)
              <input name="area" list="areas-banco" defaultValue={desc?.area ?? ''} placeholder="Ex.: Financeiro e banco" />
              <datalist id="areas-banco">
                {ORDEM_AREAS.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </label>
          </div>
          <label className={s.field}>
            Para que serve
            <textarea name="paraQue" rows={3} defaultValue={desc?.para_que ?? ''} />
          </label>
          <label className={s.field}>
            De onde vêm os dados
            <input name="origem" defaultValue={desc?.origem ?? ''} placeholder="Ex.: Apps Script, importação de XML, digitado na tela…" />
          </label>
          <label className={s.field}>
            Onde é usada
            <input name="usadoEm" defaultValue={desc?.usado_em ?? ''} placeholder="Telas e relatórios que usam esta tabela" />
          </label>
          {erro && <div className={s.alertBad}>{erro}</div>}
          <div className={b.acoes}>
            <button type="submit" className={s.button} disabled={pendente}>
              {pendente ? 'Salvando…' : 'Salvar descrição'}
            </button>
            <button type="button" className={s.buttonSmall} onClick={() => setEditando(false)} disabled={pendente}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </header>
  )
}
