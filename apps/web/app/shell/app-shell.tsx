import type { ReactNode } from 'react'
import { MenuLateral } from './menu-lateral'
import s from '../financeiro/financeiro.module.css'
import m from './shell.module.css'

/** Casca comum do HOPE CORE: menu lateral + barra do topo + conteúdo. */
export function AppShell({ email, titulo, children }: { email: string; titulo: string; children: ReactNode }) {
  return (
    <div className={s.shell}>
      <div className={m.corpo}>
        <MenuLateral email={email} />
        <div className={m.coluna}>
          <header className={m.topo}>
            <span className={m.topoTitulo}>{titulo}</span>
            <span className={m.topoUsuario}>{email}</span>
          </header>
          <main className={s.main}>{children}</main>
        </div>
      </div>
    </div>
  )
}
