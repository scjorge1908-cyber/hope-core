import Link from 'next/link'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import s from './financeiro.module.css'

export const metadata = { title: 'Financeiro — HOPE CORE' }

export default async function FinanceiroLayout({ children }: LayoutProps<'/financeiro'>) {
  const { allowed, user } = await requireFinanceAccess()

  return (
    <div className={s.shell}>
      <header className={s.header}>
        <span className={s.brand}>HOPE CORE · Financeiro</span>
        {allowed && (
          <nav className={s.nav}>
            <Link href="/financeiro">Painel</Link>
            <Link href="/financeiro/agenda">Agenda</Link>
            <Link href="/financeiro/importar">Importar XML</Link>
            <Link href="/financeiro/notas">Notas fiscais</Link>
            <Link href="/financeiro/repasse">Repasse (RPA)</Link>
            {/* rota que serve o Index.html original: link comum, sem prefetch */}
            <a href="/financeiro/guias">Registro de Guias</a>
            <Link href="/financeiro/divergencias">Divergências</Link>
            <Link href="/dashboard">Voltar ao início</Link>
          </nav>
        )}
        <span className={s.muted} style={{ marginLeft: 'auto', fontSize: 13 }}>
          {user.email}
        </span>
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
