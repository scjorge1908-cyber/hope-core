import { requireFinanceAccess } from '@/lib/financeiro/server'
import { AppShell } from '../shell/app-shell'
import s from './financeiro.module.css'

export const metadata = { title: 'Financeiro — HOPE CORE' }

// O menu de abas (nav-financeiro.tsx) virou o menu lateral comum (app/shell).
export default async function FinanceiroLayout({ children }: LayoutProps<'/financeiro'>) {
  const { allowed, user } = await requireFinanceAccess()

  return (
    <AppShell email={user.email ?? ''} titulo="Financeiro">
      {allowed ? (
        children
      ) : (
        <div className={s.alertBad}>
          Seu usuário não tem acesso ao financeiro. O acesso é liberado para dono, gestor e equipe administrativa.
        </div>
      )}
    </AppShell>
  )
}
