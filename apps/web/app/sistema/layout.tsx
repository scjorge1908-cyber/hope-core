import { requireFinanceAccess } from '@/lib/financeiro/server'
import { AppShell } from '../shell/app-shell'
import s from '../financeiro/financeiro.module.css'

export const metadata = { title: 'Sistema — HOPE CORE' }

export default async function SistemaLayout({ children }: LayoutProps<'/sistema'>) {
  const { supabase, user } = await requireFinanceAccess()
  const { data: dono } = await supabase.rpc('db_e_dono')

  return (
    <AppShell email={user.email ?? ''} titulo="Sistema">
      {dono ? (
        children
      ) : (
        <div className={s.alertBad}>
          O banco de dados só pode ser aberto pelo dono da clínica. Peça ao dono para acessar ou liberar o que você precisa.
        </div>
      )}
    </AppShell>
  )
}
