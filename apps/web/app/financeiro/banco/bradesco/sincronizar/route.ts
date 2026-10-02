import { NextResponse, type NextRequest } from 'next/server'
import { getFinanceAccess } from '@/lib/financeiro/server'
import { sincronizarBradesco } from '@/lib/bradesco/sincronizar'

// Lê o extrato do Bradesco (API Saldo e extrato, mTLS) e concilia com a Agenda.
//   POST                 → grava o que é novo (1ª vez: desde 1º de janeiro)
//   POST ?ler=1          → só lê e devolve uma amostra (não grava nada)
//   POST ?desde=AAAA-MM-DD → relê a partir dessa data
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const acesso = await getFinanceAccess()
  if (!acesso.allowed) return NextResponse.json({ erro: 'Sem acesso ao financeiro.' }, { status: acesso.status })
  const q = request.nextUrl.searchParams
  const desde = q.get('desde')
  try {
    const resultado = await sincronizarBradesco(acesso.supabase, {
      apenasLer: q.get('ler') === '1',
      inicio: desde && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : undefined,
    })
    return NextResponse.json({ resultado }, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 502 })
  }
}
