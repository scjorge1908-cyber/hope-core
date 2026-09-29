'use client'

import { useState } from 'react'
import g from './projecao.module.css'

export type PontoGrafico = {
  rotulo: string
  real: number | null
  p10: number | null
  p50: number | null
  p90: number | null
  parcial?: boolean
}

const W = 760
const H = 280
const M = { l: 64, r: 16, t: 14, b: 30 }

function passoBonito(bruto: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(Math.max(bruto, 1e-9))))
  const f = bruto / exp
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp
}

/** Linha do realizado + mediana projetada (tracejada) + faixa de 80% (P10–P90), com mira e dica ao passar o mouse. */
export function GraficoFaixa({
  titulo,
  pontos,
  formato,
  rotuloReal = 'Realizado',
  rotuloParcial = 'Lançado até hoje',
}: {
  titulo: string
  pontos: PontoGrafico[]
  formato: 'int' | 'brl'
  rotuloReal?: string
  rotuloParcial?: string
}) {
  const [foco, setFoco] = useState<number | null>(null)
  const fmt = (v: number) =>
    formato === 'brl'
      ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
      : Math.round(v).toLocaleString('pt-BR')
  const fmtEixo = (v: number) =>
    formato === 'brl' ? (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `${Math.round(v)}`) : Math.round(v).toLocaleString('pt-BR')

  const valores = pontos.flatMap((p) => [p.real, p.p10, p.p90, p.p50]).filter((v): v is number => v !== null && Number.isFinite(v))
  const vMin = Math.min(0, ...valores)
  const vMax = Math.max(1, ...valores)
  const passo = passoBonito((vMax - vMin) / 4)
  const yMin = Math.floor(vMin / passo) * passo
  const yMax = Math.ceil(vMax / passo) * passo
  const ticks: number[] = []
  for (let v = yMin; v <= yMax + passo / 2; v += passo) ticks.push(v)

  const pw = W - M.l - M.r
  const ph = H - M.t - M.b
  const col = pw / Math.max(pontos.length, 1)
  const x = (i: number) => M.l + (i + 0.5) * col
  const y = (v: number) => M.t + ph - ((v - yMin) / (yMax - yMin || 1)) * ph

  const reais = pontos.map((p, i) => ({ i, v: p.real, parcial: p.parcial })).filter((p) => p.v !== null && !p.parcial) as { i: number; v: number }[]
  const linhaReal = reais.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')

  const proj = pontos.map((p, i) => ({ i, p })).filter(({ p }) => p.p50 !== null)
  const ancora = reais.filter((r) => proj.length && r.i < proj[0].i).slice(-1)[0]
  const linhaProj = [...(ancora ? [{ i: ancora.i, v: ancora.v }] : []), ...proj.map(({ i, p }) => ({ i, v: p.p50 as number }))]
    .map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(' ')
  const faixaPts = proj.filter(({ p }) => p.p10 !== null && p.p90 !== null)
  const baseFaixa = ancora ? [{ i: ancora.i, lo: ancora.v, hi: ancora.v }] : []
  const fx = [...baseFaixa, ...faixaPts.map(({ i, p }) => ({ i, lo: p.p10 as number, hi: p.p90 as number }))]
  const poligono = fx.length
    ? [...fx.map((f) => `${x(f.i).toFixed(1)},${y(f.hi).toFixed(1)}`), ...[...fx].reverse().map((f) => `${x(f.i).toFixed(1)},${y(f.lo).toFixed(1)}`)].join(' ')
    : ''

  const pf = foco !== null ? pontos[foco] : null
  const esquerda = foco !== null ? (x(foco) / W) * 100 : 0

  return (
    <figure className={g.grafico}>
      <div className={g.legenda} aria-hidden>
        <span>
          <i className={g.legReal} /> {rotuloReal}
        </span>
        <span>
          <i className={g.legProj} /> Projeção (mediana)
        </span>
        <span>
          <i className={g.legFaixa} /> 80% de chance (P10–P90)
        </span>
      </div>
      <div className={g.area} onMouseLeave={() => setFoco(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={titulo} className={g.svg}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className={t === 0 && yMin < 0 ? g.zero : g.grade} />
              <text x={M.l - 8} y={y(t)} className={g.eixoY} dominantBaseline="middle" textAnchor="end">
                {fmtEixo(t)}
              </text>
            </g>
          ))}
          {pontos.map((p, i) => (
            <text key={p.rotulo + i} x={x(i)} y={H - 8} textAnchor="middle" className={foco === i ? g.eixoXAtivo : g.eixoX}>
              {p.rotulo}
            </text>
          ))}
          {poligono && <polygon points={poligono} className={g.faixa} />}
          {linhaReal && <path d={linhaReal} className={g.linhaReal} />}
          {linhaProj && <path d={linhaProj} className={g.linhaProj} />}
          {foco !== null && <line x1={x(foco)} x2={x(foco)} y1={M.t} y2={M.t + ph} className={g.mira} />}
          {reais.map((p) => (
            <circle key={`r${p.i}`} cx={x(p.i)} cy={y(p.v)} r={foco === p.i ? 6 : 4} className={g.pontoReal} />
          ))}
          {pontos.map((p, i) =>
            p.parcial && p.real !== null ? <circle key={`pa${i}`} cx={x(i)} cy={y(p.real)} r={foco === i ? 6 : 4} className={g.pontoParcial} /> : null,
          )}
          {proj.map(({ i, p }) => (
            <circle key={`p${i}`} cx={x(i)} cy={y(p.p50 as number)} r={foco === i ? 6 : 4} className={g.pontoProj} />
          ))}
          {pontos.map((p, i) => (
            <rect
              key={`h${i}`}
              x={M.l + i * col}
              y={M.t}
              width={col}
              height={ph}
              fill="transparent"
              onMouseEnter={() => setFoco(i)}
              onTouchStart={() => setFoco(i)}
            />
          ))}
        </svg>
        {pf && (
          <div className={g.dica} style={{ left: `${Math.min(Math.max(esquerda, 14), 86)}%` }} role="status">
            <strong>{pf.rotulo}</strong>
            {pf.real !== null && (
              <div>
                {pf.parcial ? rotuloParcial : rotuloReal}: <b>{fmt(pf.real)}</b>
              </div>
            )}
            {pf.p50 !== null && (
              <div>
                Projeção: <b>{fmt(pf.p50)}</b>
              </div>
            )}
            {pf.p10 !== null && pf.p90 !== null && (
              <div className={g.dicaFaixa}>
                80% de chance entre {fmt(pf.p10)} e {fmt(pf.p90)}
              </div>
            )}
          </div>
        )}
      </div>
    </figure>
  )
}
