import { Titulo } from '../titulo'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { brl, dataBR, int } from '@/lib/financeiro/format'
import { hojeSaoPaulo } from '@/lib/financeiro/agenda'
import { CATEGORIAS_DRE, montarDre, type LinhaDreBanco } from '@/lib/financeiro/dre'
import { classificar } from './actions'
import s from '../financeiro.module.css'
import d from './dre.module.css'

export const metadata = { title: 'DRE — HOPE CORE' }
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const num = (v: number) => (v ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—')
const pctTxt = (v: number, base: number) => (base ? `${((v / base) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—')

const FILTROS_CLS = {
  pendentes: { rotulo: 'A revisar (Outras / Particulares)', cats: ['Outras despesas', 'Receita de particulares'] },
  saidas: { rotulo: 'Todas as saídas', cats: null },
  entradas: { rotulo: 'Todas as entradas', cats: null },
} as const

export default async function DrePage({ searchParams }: PageProps<'/financeiro/dre'>) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return null

  const sp = await searchParams
  const hoje = hojeSaoPaulo()
  const anoAtual = Number(hoje.slice(0, 4))
  const ano = /^\d{4}$/.test(String(sp.ano)) ? Number(sp.ano) : anoAtual
  const ultimoMes = ano === anoAtual ? Number(hoje.slice(5, 7)) : 12
  const cls = (String(sp.cls ?? 'pendentes') in FILTROS_CLS ? String(sp.cls ?? 'pendentes') : 'pendentes') as keyof typeof FILTROS_CLS
  const ok = typeof sp.ok === 'string' ? sp.ok : ''
  const erroAcao = typeof sp.erro === 'string' ? sp.erro : ''

  const [{ data: dados, error }, { data: contrapartes }, { data: sync }] = await Promise.all([
    supabase.rpc('dre_caixa', { p_ano: ano }),
    supabase.rpc('dre_contrapartes', { p_ano: ano }),
    supabase.from('bank_sync').select('last_period_start, last_synced_at').maybeSingle(),
  ])
  const { linhas, receitaBruta } = montarDre((dados ?? []) as LinhaDreBanco[])
  const meses = Array.from({ length: ultimoMes }, (_, i) => i)
  const rb = receitaBruta.reduce((t, v) => t + v, 0)
  const valorDe = (k: string) => linhas.find((l) => l.chave === k)?.total ?? 0

  const lista = (contrapartes ?? []).filter((c) => {
    if (c.categoria === 'Transferência entre contas (fora do DRE)') return false
    if (cls === 'pendentes') return (FILTROS_CLS.pendentes.cats as readonly string[]).includes(c.categoria)
    if (cls === 'saidas') return c.tipo === 'saida'
    return c.tipo === 'entrada'
  })

  return (
    <>
      <Titulo titulo="DRE da clínica">
        <strong>Demonstração do resultado — regime de caixa.</strong> Fonte: extrato da conta da clínica no Cora (o que de fato
        entrou e saiu, mês a mês). Cada lançamento cai numa categoria: regras que você salvar abaixo têm prioridade; depois,
        recebimentos conciliados com a Agenda viram “Convênios” (por plano); pagamentos a psicólogas da aba ID viram
        “Repasse”; e nomes conhecidos (Ministério da Fazenda, Celesc, contabilidade, Facebook…) caem na categoria certa.
        Transferências entre contas da própria clínica ficam fora. O que entra ou sai por outro banco ainda não aparece aqui.
      </Titulo>

      <form className={d.filtros}>
        <label className={s.field}>
          Ano
          <select name="ano" defaultValue={String(ano)}>
            {[anoAtual, anoAtual - 1].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={s.button}>
          Ver
        </button>
        <span className={s.muted} style={{ fontSize: 13 }}>
          Extrato lido desde {sync?.last_period_start ? dataBR(sync.last_period_start) : '—'}.
        </span>
      </form>

      {error && <div className={s.alertBad}>Erro ao montar o DRE: {error.message}</div>}

      <div className={s.cards}>
        <div className={s.cardGood}>
          <div className={s.cardLabel}>Receita bruta {ano}</div>
          <div className={s.cardValue}>{brl(rb)}</div>
          <div className={s.cardHint}>convênios {brl(valorDe('conv'))} · particulares {brl(valorDe('part'))}</div>
        </div>
        <div className={s.cardInfo}>
          <div className={s.cardLabel}>Margem de contribuição</div>
          <div className={s.cardValue}>{brl(valorDe('margem'))}</div>
          <div className={s.cardHint}>{pctTxt(valorDe('margem'), rb)} da receita · após impostos e repasse</div>
        </div>
        <div className={valorDe('oper') >= 0 ? s.cardGood : s.cardBad}>
          <div className={s.cardLabel}>Resultado operacional</div>
          <div className={s.cardValue}>{brl(valorDe('oper'))}</div>
          <div className={s.cardHint}>{pctTxt(valorDe('oper'), rb)} da receita</div>
        </div>
        <div className={valorDe('caixa') >= 0 ? s.card : s.cardWarn}>
          <div className={s.cardLabel}>Resultado de caixa</div>
          <div className={s.cardValue}>{brl(valorDe('caixa'))}</div>
          <div className={s.cardHint}>depois de retiradas e empréstimos</div>
        </div>
      </div>

      <section className={s.section}>
        <h2 className={s.sectionTitle}>
          DRE {ano} — mês a mês {ano === anoAtual ? `(até ${MESES[ultimoMes - 1].toLowerCase()})` : ''}
        </h2>
        <p className={s.sectionNote}>Valores em R$. Saídas aparecem negativas. % = sobre a receita bruta do ano.</p>
        <div className={s.tableWrap}>
          <table className={d.tabela}>
            <thead>
              <tr>
                <th className={d.rotulo}>Conta</th>
                {meses.map((m) => (
                  <th key={m}>{MESES[m]}</th>
                ))}
                <th>Total</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {linhas
                .filter((l) => l.tipo !== 'subitem' || l.total !== 0)
                .map((l) => (
                  <tr key={l.chave} className={d[l.tipo]}>
                    <td className={d.rotulo}>
                      {l.sinal && <span className={d.sinal}>{l.sinal}</span>}
                      {l.rotulo}
                    </td>
                    {meses.map((m) => (
                      <td key={m} className={l.porMes[m] < 0 ? d.neg : undefined}>
                        {num(l.porMes[m])}
                      </td>
                    ))}
                    <td className={l.total < 0 ? d.neg : undefined}>
                      <strong>{num(l.total)}</strong>
                    </td>
                    <td className={d.pct}>{pctTxt(l.total, rb)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="classificar" className={s.section}>
        <h2 className={s.sectionTitle}>Classificar pagadores e recebedores</h2>
        <p className={s.sectionNote}>
          Escolha a categoria e salve: vale para todos os lançamentos daquele nome, deste e dos próximos meses. “Automático”
          devolve para a regra do sistema. Comece pelos maiores valores em “Outras despesas” (psicólogas fora da aba ID,
          sócios, fornecedores).
        </p>
        {ok && <div className={s.alertGood}>{ok}</div>}
        {erroAcao && <div className={s.alertBad}>{erroAcao}</div>}
        <nav className={d.abas} aria-label="Filtro da classificação">
          {(Object.keys(FILTROS_CLS) as (keyof typeof FILTROS_CLS)[]).map((k) => (
            <a key={k} href={`/financeiro/dre?${new URLSearchParams({ ano: String(ano), cls: k })}#classificar`} className={cls === k ? d.abaAtiva : d.aba}>
              {FILTROS_CLS[k].rotulo}
            </a>
          ))}
        </nav>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Tipo</th>
                <th className={s.num}>Lançamentos</th>
                <th className={s.num}>Total no ano</th>
                <th>Último</th>
                <th>Categoria</th>
              </tr>
            </thead>
            <tbody>
              {lista.slice(0, 120).map((c) => (
                <tr key={`${c.chave}-${c.tipo}`}>
                  <td style={{ whiteSpace: 'normal', maxWidth: 260 }}>{c.nome}</td>
                  <td>{c.tipo === 'entrada' ? <span className={s.badgeGood}>entrada</span> : <span className={s.badgeWarn}>saída</span>}</td>
                  <td className={s.num}>{int(c.qtd)}</td>
                  <td className={c.tipo === 'entrada' ? s.numGood : s.numBad}>{brl(Number(c.valor))}</td>
                  <td>{dataBR(c.ultimo)}</td>
                  <td>
                    <form action={classificar} className={d.classForm}>
                      <input type="hidden" name="chave" value={c.chave} />
                      <input type="hidden" name="tipo" value={c.tipo} />
                      <input type="hidden" name="nome" value={c.nome} />
                      <input type="hidden" name="ano" value={String(ano)} />
                      <input type="hidden" name="filtro" value={cls} />
                      <select name="categoria" defaultValue={c.por_regra ? c.categoria : ''} aria-label={`Categoria de ${c.nome}`}>
                        <option value="">Automático ({c.categoria})</option>
                        {CATEGORIAS_DRE.filter((k) =>
                          c.tipo === 'entrada'
                            ? ['receita', 'nao_operacional', 'fora'].includes(k.grupo) && k.categoria !== 'Retiradas dos sócios' && k.categoria !== 'Empréstimos e cartões (pagamentos)'
                            : k.grupo !== 'receita' && k.categoria !== 'Aportes e empréstimos recebidos'
                        ).map((k) => (
                          <option key={k.categoria} value={k.categoria}>
                            {k.categoria}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className={s.buttonSmall}>
                        Salvar
                      </button>
                      {c.por_regra && <span className={d.auto}>regra salva</span>}
                    </form>
                  </td>
                </tr>
              ))}
              {!lista.length && (
                <tr>
                  <td colSpan={6} className={s.muted}>
                    Nada para revisar neste filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
