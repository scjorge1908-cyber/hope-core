import { NextResponse, type NextRequest } from 'next/server'
import { getFinanceAccess } from '@/lib/financeiro/server'
import { montarPagina } from '@/lib/registro-guias/pagina'
import original from '@/lib/registro-guias/index-original.json'

// Registro de Guias: o Index.html ORIGINAL do ADM Registro de Guia
// (mesmo layout), servido só para quem tem acesso ao financeiro.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const acesso = await getFinanceAccess()
  if (!acesso.allowed) {
    return NextResponse.redirect(new URL(acesso.status === 401 ? '/login' : '/financeiro', request.url))
  }
  return new Response(montarPagina(original.html), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'SAMEORIGIN',
    },
  })
}
