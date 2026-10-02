'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import m from './shell.module.css'

type Item = { href: string; label: string; icone: string; comum?: boolean }
type Grupo = { titulo: string; itens: Item[] }

// Mesma organização do "Sistema Gerencial e BI" (Apps Script) + o financeiro do HOPE CORE.
// "comum": rota servida fora do Next (HTML original) → link normal, sem prefetch.
export const GRUPOS: Grupo[] = [
  {
    titulo: 'Clínica',
    itens: [
      { href: '/bi', label: 'Dashboard', icone: '🏠' },
      { href: '/dashboard', label: 'Painel de gestão', icone: '📈' },
      { href: '/bi/psicologas', label: 'Psicólogas', icone: '🩺' },
      { href: '/bi/faltas', label: 'Faltas', icone: '⚠️' },
      { href: '/bi/planos', label: 'Planos', icone: '💳' },
      { href: '/bi/perfil', label: 'Perfil dos pacientes', icone: '📊' },
      { href: '/bi/salas', label: 'Agendamento de salas', icone: '📅' },
      { href: '/bi/agenda-paciente', label: 'Agenda paciente', icone: '🗂️' },
    ],
  },
  {
    titulo: 'Guias',
    itens: [
      { href: '/financeiro/guias', label: 'Registro de guias', icone: '📋', comum: true },
      { href: '/bi/gerar-guias', label: 'Gerar guias', icone: '🧾' },
      { href: '/financeiro/nao-lancadas', label: 'Guias não lançadas', icone: '📄' },
      { href: '/financeiro/conferencia', label: 'Conferência de guias', icone: '🔎' },
      { href: '/financeiro/divergencias', label: 'Divergências', icone: '❗' },
    ],
  },
  {
    titulo: 'Financeiro',
    itens: [
      { href: '/financeiro', label: 'Painel financeiro', icone: '💼' },
      { href: '/financeiro/agenda', label: 'Agenda de recebimentos', icone: '🗓️' },
      { href: '/financeiro/banco', label: 'Banco (Cora)', icone: '🏦' },
      { href: '/financeiro/dre', label: 'DRE', icone: '🧮' },
      { href: '/financeiro/projecao', label: 'Projeção', icone: '🔮' },
      { href: '/financeiro/repasse', label: 'RPA / Repasse', icone: '💰' },
      { href: '/financeiro/pagamentos', label: 'Pagamentos de repasse', icone: '💸' },
      { href: '/financeiro/importar', label: 'Importar XML', icone: '⬆️' },
      { href: '/financeiro/notas', label: 'Notas fiscais', icone: '🧾' },
    ],
  },
  {
    titulo: 'Sistema',
    itens: [{ href: '/sistema/banco', label: 'Banco de dados', icone: '🗄️' }],
  },
]

const ativo = (atual: string, href: string) =>
  href === '/financeiro' || href === '/bi' ? atual === href : atual === href || atual.startsWith(`${href}/`)

// Telas largas: o menu entra recolhido (só ícones) para a página usar a tela toda.
const RECOLHER_AUTOMATICO = ['/financeiro/dre']
const COOKIE = 'hc_menu'

/**
 * Menu lateral fixo (desktop) / gaveta (celular), com o item da página atual
 * destacado. No desktop pode ser recolhido para 64px (só ícones) pelo botão
 * « / » — a escolha fica guardada num cookie; em RECOLHER_AUTOMATICO ele já
 * abre recolhido (dá para abrir de novo pelo mesmo botão).
 */
export function MenuLateral({ email, recolhidoInicial = null }: { email: string; recolhidoInicial?: boolean | null }) {
  const atual = usePathname() ?? ''
  const [aberto, setAberto] = useState(false)
  const [pref, setPref] = useState<boolean | null>(recolhidoInicial)
  const [manualEm, setManualEm] = useState<string | null>(null)
  const lateral = useRef<HTMLElement>(null)

  const automatico = RECOLHER_AUTOMATICO.some((r) => atual === r || atual.startsWith(`${r}/`))
  const recolhido = automatico && manualEm !== atual ? true : !!pref

  // deixa o item da página atual visível dentro do menu (quando o menu rola)
  useEffect(() => {
    lateral.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' })
  }, [atual])

  const alternar = () => {
    const novo = !recolhido
    setPref(novo)
    setManualEm(atual)
    document.cookie = `${COOKIE}=${novo ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`
  }

  const classeLateral = aberto ? m.lateralAberta : recolhido ? `${m.lateral} ${m.recolhido}` : m.lateral

  return (
    <>
      <button
        type="button"
        className={m.hamburguer}
        aria-label={aberto ? 'Fechar menu' : 'Abrir menu'}
        aria-expanded={aberto}
        aria-controls="menu-lateral"
        onClick={() => setAberto((v) => !v)}
      >
        <span className={m.hamburguerIcone} aria-hidden />
      </button>
      {aberto && <div className={m.fundo} onClick={() => setAberto(false)} aria-hidden />}
      <aside id="menu-lateral" ref={lateral} className={classeLateral}>
        <div className={m.topoLateral}>
          <Link href="/bi" className={m.marca} title="HOPE CORE — Clínica Hope">
            <span className={m.marcaLogo} aria-hidden>
              H
            </span>
            <span className={m.marcaTexto}>
              HOPE CORE
              <small>Clínica Hope</small>
            </span>
          </Link>
          <button
            type="button"
            className={m.recolher}
            onClick={alternar}
            aria-label={recolhido ? 'Mostrar menu completo' : 'Recolher menu'}
            title={recolhido ? 'Mostrar menu completo' : 'Recolher menu (tela cheia)'}
            aria-expanded={!recolhido}
            aria-controls="menu-lateral"
          >
            {recolhido ? '»' : '«'}
          </button>
        </div>
        <nav className={m.nav} aria-label="Menu principal" onClick={() => setAberto(false)}>
          {GRUPOS.map((g) => (
            <div key={g.titulo} className={m.grupo}>
              <div className={m.grupoTitulo}>{g.titulo}</div>
              {g.itens.map((i) => {
                const on = ativo(atual, i.href)
                const props = {
                  className: on ? m.itemAtivo : m.item,
                  'aria-current': on ? ('page' as const) : undefined,
                  title: i.label,
                }
                const conteudo = (
                  <>
                    <span className={m.icone} aria-hidden>
                      {i.icone}
                    </span>
                    <span className={m.rotulo}>{i.label}</span>
                  </>
                )
                return i.comum ? (
                  <a key={i.href} href={i.href} {...props}>
                    {conteudo}
                  </a>
                ) : (
                  <Link key={i.href} href={i.href} {...props}>
                    {conteudo}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
        <div className={m.usuario} title={email}>
          {email}
        </div>
      </aside>
    </>
  )
}
