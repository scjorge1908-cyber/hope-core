'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import s from './financeiro.module.css'

type Item = { href: string; label: string; comum?: boolean }

// "comum": rota que serve o Index.html original → link normal, sem prefetch
const ITENS: Item[] = [
  { href: '/financeiro', label: 'Painel' },
  { href: '/financeiro/agenda', label: 'Agenda' },
  { href: '/financeiro/importar', label: 'Importar XML' },
  { href: '/financeiro/notas', label: 'Notas fiscais' },
  { href: '/financeiro/repasse', label: 'Repasse (RPA)' },
  { href: '/financeiro/guias', label: 'Registro de Guias', comum: true },
  { href: '/financeiro/divergencias', label: 'Divergências' },
  { href: '/financeiro/conferencia', label: 'Conferência de guias' },
  { href: '/financeiro/nao-lancadas', label: 'Guias não lançadas' },
  { href: '/financeiro/banco', label: 'Banco (Cora)' },
  { href: '/financeiro/dre', label: 'DRE' },
]

/** Abas do financeiro com a página atual destacada. */
export function NavFinanceiro() {
  const atual = usePathname() ?? ''
  const ativo = (href: string) => (href === '/financeiro' ? atual === href : atual === href || atual.startsWith(`${href}/`))

  return (
    <nav className={s.nav} aria-label="Financeiro">
      {ITENS.map((i) => {
        const on = ativo(i.href)
        const props = { className: on ? s.navAtivo : s.navItem, 'aria-current': on ? ('page' as const) : undefined }
        return i.comum ? (
          <a key={i.href} href={i.href} {...props}>
            {i.label}
          </a>
        ) : (
          <Link key={i.href} href={i.href} {...props}>
            {i.label}
          </Link>
        )
      })}
      <Link href="/dashboard" className={s.navVoltar}>
        ← Voltar ao início
      </Link>
    </nav>
  )
}
