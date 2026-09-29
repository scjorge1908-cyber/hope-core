import { redirect } from 'next/navigation'

// Tela inicial do HOPE CORE = Painel da clínica (quem não está logado vai para o login pelo proxy)
export default function Home() {
  redirect('/dashboard')
}
