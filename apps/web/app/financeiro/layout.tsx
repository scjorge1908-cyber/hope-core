import { NavFinanceiro } from './nav-financeiro'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import s from './financeiro.module.css'

export const metadata = { title: 'Financeiro — HOPE CORE' }

export default async function FinanceiroLayout({ children }: LayoutProps<'/financeiro'>) {
  const { allowed, user } = await requireFinanceAccess()

  return (
    <div className={s.shell}>
      <header className={s.header}>
        <div className={s.headerTopo}>
          <a href="/dashboard" className={s.brand}>
            <span className={s.brandMarca} aria-hidden>
              H
            </span>
            <span>
              HOPE CORE <span className={s.brandModulo}>· Financeiro</span>
            </span>
          </a>
          <span className={s.usuario}>{user.email}</span>
        </div>
        {allowed && <NavFinanceiro />}
      </header>
      <main className={s.main}>
        {allowed ? (
          children
        ) : (
          <div className={s.alertBad}>
            Seu usuário não tem acesso ao financeiro. O acesso é liberado para dono, gestor e equipe administrativa.
          </div>
        )}
      </main>
    </div>
  )
}
