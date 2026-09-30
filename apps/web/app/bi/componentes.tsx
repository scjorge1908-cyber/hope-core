'use client'

import { useState, type ChangeEvent, type ReactNode } from 'react'
import b from './bi.module.css'

// ---------------------------------------------------------------- filtros
type OpcoesFiltro = { psicologas: { sid: string; nome: string }[]; planos: string[]; cidades: string[] }
type Valores = { psi?: string; plano?: string; cidade?: string; faixa?: string; periodo?: number }

/** Barra de filtros (GET). `campos` escolhe quais aparecem em cada tela. */
export function BarraFiltros({
  opcoes,
  valores,
  campos,
  extra,
}: {
  opcoes: OpcoesFiltro
  valores: Valores
  campos: ('psi' | 'periodo' | 'plano' | 'cidade' | 'faixa')[]
  extra?: ReactNode
}) {
  const tem = (c: (typeof campos)[number]) => campos.includes(c)
  const enviar = (e: ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit()
  return (
    <form className={b.filtros}>
      {tem('periodo') && (
        <label>
          Período
          <select name="periodo" defaultValue={String(valores.periodo ?? 1)} onChange={enviar}>
            <option value="1">Mês atual</option>
            <option value="3">Últimos 3 meses</option>
            <option value="6">Últimos 6 meses</option>
            <option value="12">Últimos 12 meses</option>
          </select>
        </label>
      )}
      {tem('psi') && (
        <label>
          Psicóloga
          <select name="psi" defaultValue={valores.psi ?? ''} onChange={enviar}>
            <option value="">Todas as psicólogas</option>
            {opcoes.psicologas.map((p) => (
              <option key={p.sid} value={p.sid}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
      )}
      {tem('plano') && (
        <label>
          Plano
          <select name="plano" defaultValue={valores.plano ?? ''} onChange={enviar}>
            <option value="">Todos os planos</option>
            {opcoes.planos.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      )}
      {tem('cidade') && (
        <label>
          Cidade
          <select name="cidade" defaultValue={valores.cidade ?? ''} onChange={enviar}>
            <option value="">Todas as cidades</option>
            {opcoes.cidades.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      )}
      {tem('faixa') && (
        <label>
          Faixa etária
          <select name="faixa" defaultValue={valores.faixa ?? ''} onChange={enviar}>
            <option value="">Todas as idades</option>
            <option value="crianca">Crianças (0–11)</option>
            <option value="adolescente">Adolescentes (12–17)</option>
            <option value="adulto">Adultos (18–59)</option>
            <option value="idoso">Idosos (60+)</option>
          </select>
        </label>
      )}
      {extra}
      <noscript>
        <button type="submit">Aplicar</button>
      </noscript>
      <a href="?" className={b.limpar}>
        Limpar filtros
      </a>
    </form>
  )
}

// ---------------------------------------------------------------- linhas
export type Serie = { nome: string; valores: number[]; cor: 's1' | 's2' | 's3' }
const W = 760
const H = 260
const M = { l: 44, r: 90, t: 12, b: 28 }

function passoBonito(bruto: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(Math.max(bruto, 1e-9))))
  const f = bruto / exp
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp
}

/** Gráfico de linhas (até 3 séries, um eixo), com mira e dica ao passar o mouse e rótulo no fim de cada linha. */
export function GraficoLinhas({ titulo, rotulos, series }: { titulo: string; rotulos: string[]; series: Serie[] }) {
  const [foco, setFoco] = useState<number | null>(null)
  const max = Math.max(1, ...series.flatMap((s) => s.valores))
  const passo = passoBonito(max / 4)
  const yMax = Math.ceil(max / passo) * passo
  const ticks: number[] = []
  for (let v = 0; v <= yMax + passo / 2; v += passo) ticks.push(v)
  const pw = W - M.l - M.r
  const ph = H - M.t - M.b
  const n = Math.max(rotulos.length, 1)
  const x = (i: number) => M.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw)
  const y = (v: number) => M.t + ph - (v / yMax) * ph
  const cor = (c: Serie['cor']) => `var(--${c})`

  if (!rotulos.length) return <p className={b.kpiNota}>Ainda não há dados suficientes para o gráfico.</p>

  return (
    <figure style={{ margin: 0 }}>
      <div className={b.legenda} aria-hidden>
        {series.map((s) => (
          <span key={s.nome} style={{ color: cor(s.cor) }}>
            <i />
            <span style={{ color: 'var(--fin-muted)' }}>{s.nome}</span>
          </span>
        ))}
      </div>
      <div className={b.area} onMouseLeave={() => setFoco(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className={b.svg} role="img" aria-label={titulo}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className={b.grade} />
              <text x={M.l - 8} y={y(t)} className={b.eixo} textAnchor="end" dominantBaseline="middle">
                {Math.round(t).toLocaleString('pt-BR')}
              </text>
            </g>
          ))}
          {rotulos.map((r, i) => (
            <text key={r + i} x={x(i)} y={H - 8} textAnchor="middle" className={foco === i ? b.eixoAtivo : b.eixo}>
              {r}
            </text>
          ))}
          {foco !== null && <line x1={x(foco)} x2={x(foco)} y1={M.t} y2={M.t + ph} className={b.mira} />}
          {series.map((s) => (
            <g key={s.nome}>
              <path
                d={s.valores.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
                className={b.linha}
                style={{ stroke: cor(s.cor) }}
              />
              {s.valores.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={foco === i ? 5 : 3} className={b.ponto} style={{ fill: cor(s.cor) }} />
              ))}
              <text
                x={x(s.valores.length - 1) + 8}
                y={y(s.valores[s.valores.length - 1] ?? 0)}
                dominantBaseline="middle"
                className={b.rotuloFim}
                style={{ fill: 'var(--fin-text)' }}
              >
                {s.nome}
              </text>
            </g>
          ))}
          {rotulos.map((_, i) => {
            const meio = n === 1 ? pw : pw / (n - 1)
            return (
              <rect
                key={`h${i}`}
                x={x(i) - meio / 2}
                y={M.t}
                width={meio}
                height={ph}
                fill="transparent"
                onMouseEnter={() => setFoco(i)}
                onTouchStart={() => setFoco(i)}
              />
            )
          })}
        </svg>
        {foco !== null && (
          <div className={b.dica} style={{ left: `${Math.min(Math.max((x(foco) / W) * 100, 14), 80)}%` }} role="status">
            <strong>{rotulos[foco]}</strong>
            {series.map((s) => (
              <div key={s.nome}>
                <i style={{ background: cor(s.cor) }} />
                {s.nome}: <b>{(s.valores[foco] ?? 0).toLocaleString('pt-BR')}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  )
}

// ---------------------------------------------------------------- barras
/** Lista de barras horizontais ordenada (substitui as pizzas do BI antigo). */
export function Barras({ itens, formato = 'int', limite = 12 }: { itens: { rotulo: string; valor: number; dica?: string }[]; formato?: 'int' | 'pct'; limite?: number }) {
  const [todos, setTodos] = useState(false)
  const lista = todos ? itens : itens.slice(0, limite)
  const max = Math.max(1, ...itens.map((i) => i.valor))
  const total = itens.reduce((t, i) => t + i.valor, 0)
  if (!itens.length) return <p className={b.kpiNota}>Sem dados.</p>
  return (
    <div className={b.barras}>
      {lista.map((i) => (
        <div key={i.rotulo} className={b.barraLinha} title={i.dica ?? `${i.rotulo}: ${i.valor.toLocaleString('pt-BR')}`}>
          <span className={b.barraRotulo}>{i.rotulo}</span>
          <span className={b.barraTrilho}>
            <span className={b.barraCheia} style={{ width: `${(i.valor / max) * 100}%`, display: 'block' }} />
          </span>
          <span className={b.barraValor}>
            {formato === 'pct'
              ? `${(i.valor * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
              : `${i.valor.toLocaleString('pt-BR')}${total ? ` · ${((i.valor / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : ''}`}
          </span>
        </div>
      ))}
      {itens.length > limite && (
        <button type="button" className={b.limpar} style={{ background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setTodos((v) => !v)}>
          {todos ? 'Mostrar menos' : `Mostrar todos (${itens.length})`}
        </button>
      )}
    </div>
  )
}
