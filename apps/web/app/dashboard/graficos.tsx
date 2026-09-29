// Gráficos simples em HTML/CSS (sem biblioteca): responsivos no celular,
// tablet e computador; cada barra tem dica (title) com o valor exato e
// cada gráfico tem a tabela com os números logo abaixo (acessibilidade).
import g from './graficos.module.css'

export type ItemColuna = { rotulo: string; valor: number; texto: string; parcial?: boolean; dica?: string }

export function Colunas({ itens, cor = 'serie1', legendaParcial }: { itens: ItemColuna[]; cor?: 'serie1' | 'serie2'; legendaParcial?: string }) {
  const max = Math.max(1, ...itens.map((i) => i.valor))
  return (
    <div className={g.colunas} role="img" aria-label={itens.map((i) => `${i.rotulo}: ${i.texto}`).join('; ')}>
      {itens.map((i, idx) => (
        <div key={i.rotulo + idx} className={g.coluna} title={i.dica ?? `${i.rotulo}: ${i.texto}`}>
          <span className={g.valorTopo}>{idx === itens.length - 1 || i.valor === max ? i.texto : ''}</span>
          <div className={g.trilho}>
            <div className={`${g.barra} ${g[cor]} ${i.parcial ? g.parcial : ''}`} style={{ height: `${(i.valor / max) * 100}%` }} />
          </div>
          <span className={g.rotulo}>{i.rotulo}</span>
        </div>
      ))}
      {legendaParcial && itens.some((i) => i.parcial) && <div className={g.notaParcial}>▨ {legendaParcial}</div>}
    </div>
  )
}

export type ItemDuplo = { rotulo: string; a: number; b: number; textoA: string; textoB: string }

export function ColunasDuplas({ itens, nomes }: { itens: ItemDuplo[]; nomes: [string, string] }) {
  const max = Math.max(1, ...itens.flatMap((i) => [i.a, i.b]))
  return (
    <>
      <div className={g.legenda}>
        <span>
          <i className={g.serie1} /> {nomes[0]}
        </span>
        <span>
          <i className={g.serie2} /> {nomes[1]}
        </span>
      </div>
      <div className={g.colunas} role="img" aria-label={itens.map((i) => `${i.rotulo}: ${nomes[0]} ${i.textoA}, ${nomes[1]} ${i.textoB}`).join('; ')}>
        {itens.map((i) => (
          <div key={i.rotulo} className={g.coluna} title={`${i.rotulo}\n${nomes[0]}: ${i.textoA}\n${nomes[1]}: ${i.textoB}`}>
            <span className={g.valorTopo} />
            <div className={`${g.trilho} ${g.dupla}`}>
              <div className={`${g.barra} ${g.serie1}`} style={{ height: `${(i.a / max) * 100}%` }} />
              <div className={`${g.barra} ${g.serie2}`} style={{ height: `${(i.b / max) * 100}%` }} />
            </div>
            <span className={g.rotulo}>{i.rotulo}</span>
          </div>
        ))}
      </div>
    </>
  )
}

export type ItemBarra = { rotulo: string; valor: number; texto: string; detalhe?: string }

export function Barras({ itens, cor = 'serie1' }: { itens: ItemBarra[]; cor?: 'serie1' | 'serie2' }) {
  const max = Math.max(1, ...itens.map((i) => i.valor))
  return (
    <div className={g.barras}>
      {itens.map((i) => (
        <div key={i.rotulo} className={g.linhaBarra} title={`${i.rotulo}: ${i.texto}${i.detalhe ? ` — ${i.detalhe}` : ''}`}>
          <span className={g.rotuloBarra}>{i.rotulo}</span>
          <div className={g.trilhoH}>
            <div className={`${g.barraH} ${g[cor]}`} style={{ width: `${(i.valor / max) * 100}%` }} />
          </div>
          <span className={g.valorBarra}>
            {i.texto}
            {i.detalhe && <small> {i.detalhe}</small>}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Mini barra dentro de célula de tabela. */
export function MiniBarra({ valor, max }: { valor: number; max: number }) {
  return (
    <span className={g.mini} aria-hidden>
      <span className={g.serie1} style={{ width: `${Math.min(100, (valor / Math.max(1, max)) * 100)}%` }} />
    </span>
  )
}
