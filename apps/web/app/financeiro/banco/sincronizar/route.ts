import { NextResponse, type NextRequest } from 'next/server'
import { getFinanceAccess } from '@/lib/financeiro/server'
import { precisaSincronizar, sincronizarBanco } from '@/lib/cora/conciliar'

// Busca o extrato do Cora e concilia com a Agenda. Chamado sozinho ao abrir a
// Agenda/Banco (no máximo a cada 30 min) ou pelo botão (?forcar=1).
// 1ª vez: desde 1º de janeiro; depois: só o período novo.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const acesso = await getFinanceAccess()
  if (!acesso.allowed) return NextResponse.json({ erro: 'Sem acesso ao financeiro.' }, { status: acesso.status })
  const forcar = request.nextUrl.searchParams.get('forcar') === '1'
  try {
    if (!forcar && !(await precisaSincronizar(acesso.supabase))) {
      return NextResponse.json({ pulado: true }, { headers: { 'cache-control': 'no-store' } })
    }
    const resultado = await sincronizarBanco(acesso.supabase)
    return NextResponse.json({ resultado }, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 502 })
  }
}
