import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { MenuLateral } from './menu-lateral'
import s from '../financeiro/financeiro.module.css'
import m from './shell.module.css'

/**
 * Casca comum do HOPE CORE: menu lateral (rola sozinho, pode ser recolhido)
 * + área da direita com barra do topo e conteúdo (rola sozinha).
 */
export async function AppShell({ email, titulo, children }: { email: string; titulo: string; children: ReactNode }) {
  const pref = (await cookies()).get('hc_menu')?.value
  const recolhido = pref === '1' ? true : pref === '0' ? false : null
  return (
    <div className={s.shell}>
      <div className={m.corpo}>
        <MenuLateral email={email} recolhidoInicial={recolhido} />
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
