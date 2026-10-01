'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { SEM_AREA, type TabelaCatalogo } from '@/lib/sistema/banco'
import b from './banco.module.css'

const normal = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Um botão por tabela, agrupado por área, com busca por nome/descrição. */
export function ListaTabelas({ grupos }: { grupos: { area: string; tabelas: TabelaCatalogo[] }[] }) {
  const [busca, setBusca] = useState('')
  const filtrados = useMemo(() => {
    const q = normal(busca.trim())
    if (!q) return grupos
    return grupos
      .map((g) => ({
        ...g,
        tabelas: g.tabelas.filter((t) =>
          normal([t.tabela, t.esquema, t.titulo, t.paraQue, t.origem, t.usadoEm, g.area].filter(Boolean).join(' ')).includes(q)
        ),
      }))
      .filter((g) => g.tabelas.length > 0)
  }, [busca, grupos])

  return (
    <>
      <div className={b.buscaLinha}>
        <input
          type="search"
          className={b.busca}
          placeholder="Procurar tabela pelo nome ou pela descrição…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Procurar tabela"
        />
      </div>
      {filtrados.length === 0 && <p className={b.vazio}>Nenhuma tabela encontrada para “{busca}”.</p>}
      {filtrados.map((g) => (
        <section key={g.area} className={b.grupo}>
          <h2 className={b.grupoTitulo}>
            {g.area}
            <span>{g.tabelas.length}</span>
          </h2>
          {g.area === SEM_AREA && (
            <p className={b.grupoNota}>Tabelas novas no banco. Abra e preencha “Para que serve” para elas irem para o grupo certo.</p>
          )}
          <div className={b.botoes}>
            {g.tabelas.map((t) => (
              <Link key={`${t.esquema}.${t.tabela}`} href={`/sistema/banco/${t.esquema}/${t.tabela}`} className={b.botaoTabela}>
                <span className={b.botaoTopo}>
                  <span className={b.botaoTitulo}>{t.titulo ?? t.tabela}</span>
                  <span className={b.botaoLinhas}>{t.linhas === null ? '—' : t.linhas.toLocaleString('pt-BR')}</span>
                </span>
                <code className={b.botaoNome}>
                  {t.esquema}.{t.tabela}
                </code>
                {t.paraQue && <span className={b.botaoDesc}>{t.paraQue}</span>}
                <span className={b.selos}>
                  {t.tipo !== 'tabela' && <span className={b.seloInfo}>{t.tipo}</span>}
                  {t.somenteLeitura && t.tipo === 'tabela' && <span className={b.seloNeutro}>só leitura</span>}
                  {t.linhas === 0 && <span className={b.seloNeutro}>vazia</span>}
                  <span className={b.seloNeutro}>{t.colunas} colunas</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
