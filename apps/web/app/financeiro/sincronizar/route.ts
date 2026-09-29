import { NextResponse, type NextRequest } from 'next/server'
import { getFinanceAccess } from '@/lib/financeiro/server'
import { chamarPonteRpa } from '@/lib/financeiro/ponte-rpa'

// Botão "Sincronizar planilhas": POST agenda sincronizarPlanilhasSupabase()
// no Calculo RPA; GET devolve o andamento lido do banco (legacy_sync_status).
export const maxDuration = 60
export const dynamic = 'force-dynamic'

function responder(corpo: Record<string, unknown>, status = 200) {
  return NextResponse.json(corpo, { status, headers: { 'cache-control': 'no-store' } })
}

async function acessoOuErro() {
  const acesso = await getFinanceAccess()
  if (acesso.allowed) return { acesso, erro: null }
  return {
    acesso,
    erro: responder(
      { erro: acesso.status === 401 ? 'Sessão expirada. Entre de novo no HOPE CORE.' : 'Seu usuário não tem acesso ao financeiro.' },
      acesso.status
    ),
  }
}

export async function GET() {
  const { acesso, erro } = await acessoOuErro()
  if (erro) return erro
  const { data, error } = await acesso.supabase.rpc('legacy_sync_status')
  if (error) return responder({ erro: error.message }, 500)
  const linhas = (data ?? []).map((x) => ({
    id: x.spreadsheet_id,
    nome: x.nome,
    ultima: x.ultima_sincronizacao,
    erro: x.ultimo_erro,
  }))
  return responder({ linhas })
}

export async function POST(request: NextRequest) {
  const { erro } = await acessoOuErro()
  if (erro) return erro

  let corpo: { nome?: unknown } = {}
  try {
    corpo = await request.json()
  } catch {
    // corpo vazio = sincronizar todas
  }
  const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim().slice(0, 120) : ''

  try {
    const resultado = nome
      ? await chamarPonteRpa('sincronizarUmaSupabase', [nome])
      : await chamarPonteRpa('sincronizarPlanilhasSupabase')
    return responder({ resultado })
  } catch (e) {
    return responder({ erro: (e as Error).message }, 502)
  }
}
