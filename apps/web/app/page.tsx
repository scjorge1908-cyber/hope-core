import { redirect } from 'next/navigation'

// Tela inicial do HOPE CORE = Dashboard do BI (quem não está logado vai para o login pelo proxy).
// O painel de gestão antigo continua em /dashboard.
export default function Home() {
  redirect('/bi')
}
