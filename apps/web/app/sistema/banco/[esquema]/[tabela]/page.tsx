import Link from 'next/link'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import type { DetalheTabela, PaginaLinhas } from '@/lib/sistema/banco'
import s from '../../../../financeiro/financeiro.module.css'
import b from '../../banco.module.css'
import { Cabecalho } from './cabecalho'
import { Grade } from './grade'
import { Colunas } from './colunas'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 100

const OPERACAO: Record<string, string> = { inserir: 'Criou linha', editar: 'Editou linha', excluir: 'Excluiu linha' }

export async function generateMetadata({ params }: PageProps<'/sistema/banco/[esquema]/[tabela]'>) {
  const { esquema, tabela } = await params
  return { title: `${esquema}.${tabela} — Banco de dados` }
}

export default async function TabelaPage({ params, searchParams }: PageProps<'/sistema/banco/[esquema]/[tabela]'>) {
  const { esquema, tabela } = await params
  const sp = await searchParams
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const busca = um(sp.q).trim()
  const ordem = um(sp.ordem)
  const desc = um(sp.desc) === '1'
  const pagina = Math.max(1, Number.parseInt(um(sp.p) || '1', 10) || 1)

  const { supabase } = await requireFinanceAccess()
  const [det, lin] = await Promise.all([
    supabase.rpc('db_tabela', { p_esquema: esquema, p_tabela: tabela }),
    supabase.rpc('db_linhas', {
      p_esquema: esquema,
      p_tabela: tabela,
      p_busca: busca || null,
      p_ordem: ordem || null,
      p_desc: desc,
      p_limite: POR_PAGINA,
      p_offset: (pagina - 1) * POR_PAGINA,
    }),
  ])

  if (det.error || !det.data) {
    return (
      <>
        <Link href="/sistema/banco" className={b.voltar}>
          ← Todas as tabelas
        </Link>
        <div className={s.alertBad}>Não foi possível abrir {esquema}.{tabela}: {det.error?.message ?? 'tabela não encontrada'}</div>
      </>
    )
  }

  const d = det.data as unknown as DetalheTabela
  const p = (lin.data ?? { total: 0, linhas: [] }) as unknown as PaginaLinhas
  const paginas = Math.max(1, Math.ceil(p.total / POR_PAGINA))

  const href = (mudar: Record<string, string | null>) => {
    const q = new URLSearchParams()
    const atual: Record<string, string> = { q: busca, ordem, desc: desc ? '1' : '', p: pagina > 1 ? String(pagina) : '' }
    for (const [k, v] of Object.entries({ ...atual, ...mudar })) if (v) q.set(k, v)
    const qs = q.toString()
    return `/sistema/banco/${esquema}/${tabela}${qs ? `?${qs}` : ''}`
  }

  const ligaCom = d.colunas.filter((c) => c.referencia)

  return (
    <div className={b.pagina}>
      <Link href="/sistema/banco" className={b.voltar}>
        ← Todas as tabelas
      </Link>

      <Cabecalho detalhe={d} total={busca ? null : p.total} />

      {/* ---------------- dados ---------------- */}
      <section className={s.section} id="dados">
        <div className={b.secaoTopo}>
          <h2 className={s.sectionTitle}>Dados</h2>
          <form className={b.buscaForm} action={`/sistema/banco/${esquema}/${tabela}`}>
            {ordem && <input type="hidden" name="ordem" value={ordem} />}
            {desc && <input type="hidden" name="desc" value="1" />}
            <input type="search" name="q" defaultValue={busca} placeholder="Buscar em todas as colunas…" className={b.busca} aria-label="Buscar nas linhas" />
            <button type="submit" className={s.buttonSmall}>
              Buscar
            </button>
            {busca && (
              <Link href={href({ q: null, p: null })} className={b.limpar}>
                limpar
              </Link>
            )}
          </form>
        </div>
        <p className={s.sectionNote}>
          {d.somenteLeitura
            ? 'Somente leitura nesta tela.'
            : d.chave.length === 0
              ? 'Esta tabela não tem chave primária: dá para ver, mas não editar por aqui.'
              : 'Clique numa célula para editar · Enter salva · Esc cancela. Toda mudança vai direto para o banco e fica no histórico abaixo.'}
          {d.porClinica && ' Mostrando só as linhas da Clínica Hope.'}
        </p>
        {lin.error && <div className={s.alertBad}>Erro ao ler as linhas: {lin.error.message}</div>}

        <Grade
          key={`${busca}|${ordem}|${desc}|${pagina}`}
          esquema={esquema}
          tabela={tabela}
          colunas={d.colunas}
          chave={d.chave}
          linhas={p.linhas}
          editavel={!d.somenteLeitura && d.chave.length > 0}
          ordem={ordem}
          desc={desc}
          busca={busca}
        />

        <div className={b.paginacao}>
          <span>
            {p.total === 0
              ? busca
                ? 'Nenhuma linha encontrada.'
                : 'Tabela vazia.'
              : `${((pagina - 1) * POR_PAGINA + 1).toLocaleString('pt-BR')}–${Math.min(pagina * POR_PAGINA, p.total).toLocaleString('pt-BR')} de ${p.total.toLocaleString('pt-BR')} linhas`}
          </span>
          {paginas > 1 && (
            <span className={b.paginas}>
              {pagina > 1 ? (
                <Link href={href({ p: String(pagina - 1) })} className={s.buttonSmall}>
                  ← Anterior
                </Link>
              ) : null}
              <span>
                página {pagina} de {paginas}
              </span>
              {pagina < paginas ? (
                <Link href={href({ p: String(pagina + 1) })} className={s.buttonSmall}>
                  Próxima →
                </Link>
              ) : null}
            </span>
          )}
        </div>
      </section>

      {/* ---------------- colunas ---------------- */}
      <section className={s.section} id="colunas">
        <h2 className={s.sectionTitle}>Colunas ({d.colunas.length})</h2>
        <p className={s.sectionNote}>O que cada coluna guarda. Clique em “descrever” para escrever ou corrigir a explicação.</p>
        <Colunas esquema={esquema} tabela={tabela} colunas={d.colunas} />
      </section>

      {/* ---------------- relações ---------------- */}
      <section className={s.section} id="relacoes">
        <h2 className={s.sectionTitle}>Com o que se comunica</h2>
        <div className={b.relacoes}>
          <div>
            <h3>Aponta para</h3>
            {ligaCom.length === 0 ? (
              <p className={s.muted}>Nenhuma outra tabela.</p>
            ) : (
              <ul>
                {ligaCom.map((c) => (
                  <li key={c.nome}>
                    <code>{c.nome}</code> →{' '}
                    <Link className={s.link} href={`/sistema/banco/${c.referencia!.esquema}/${c.referencia!.tabela}`}>
                      {c.referencia!.esquema}.{c.referencia!.tabela}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3>É usada por (tabelas)</h3>
            {d.referenciadaPor.length === 0 ? (
              <p className={s.muted}>Nenhuma tabela aponta para esta.</p>
            ) : (
              <ul>
                {d.referenciadaPor.map((r) => (
                  <li key={`${r.esquema}.${r.tabela}.${r.coluna}`}>
                    <Link className={s.link} href={`/sistema/banco/${r.esquema}/${r.tabela}`}>
                      {r.esquema}.{r.tabela}
                    </Link>{' '}
                    (coluna <code>{r.coluna}</code>)
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3>Visões calculadas a partir dela</h3>
            {d.visoes.length === 0 ? (
              <p className={s.muted}>Nenhuma.</p>
            ) : (
              <ul>
                {d.visoes.map((v) => (
                  <li key={v}>
                    <Link className={s.link} href={`/sistema/banco/public/${v}`}>
                      {v}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3>Funções do banco que leem ou gravam</h3>
            {d.funcoes.length === 0 ? (
              <p className={s.muted}>Nenhuma encontrada.</p>
            ) : (
              <p className={b.funcoes}>
                {d.funcoes.map((f) => (
                  <code key={f}>{f}</code>
                ))}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ---------------- histórico ---------------- */}
      <section className={s.section} id="historico">
        <h2 className={s.sectionTitle}>Últimas alterações por esta tela</h2>
        {d.ultimasAlteracoes.length === 0 ? (
          <p className={`${s.muted} ${b.semHistorico}`}>Nenhuma alteração feita por aqui ainda.</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>O quê</th>
                  <th>Quem</th>
                  <th>Linha</th>
                </tr>
              </thead>
              <tbody>
                {d.ultimasAlteracoes.map((a, i) => (
                  <tr key={i}>
                    <td>{new Date(a.quando).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td>
                    <td>{OPERACAO[a.operacao] ?? a.operacao}</td>
                    <td>{a.quem ?? '—'}</td>
                    <td>
                      <code className={b.chaveHist}>
                        {a.chave
                          ? Object.entries(a.chave)
                              .filter(([k]) => k !== 'tenant_id')
                              .map(([k, v]) => `${k}: ${String(v)}`)
                              .join(' · ')
                          : '—'}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
