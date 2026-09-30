import { requireFinanceAccess } from '@/lib/financeiro/server'
import { AppShell } from '../shell/app-shell'
import s from '../financeiro/financeiro.module.css'

export const metadata = { title: 'Clínica — HOPE CORE' }

export default async function BiLayout({ children }: LayoutProps<'/bi'>) {
  const { allowed, user } = await requireFinanceAccess()

  return (
    <AppShell email={user.email ?? ''} titulo="Sistema gerencial e BI">
      {allowed ? (
        children
      ) : (
        <div className={s.alertBad}>Seu usuário não tem acesso a esta área. O acesso é liberado para dono, gestor e equipe administrativa.</div>
      )}
    </AppShell>
  )
}
