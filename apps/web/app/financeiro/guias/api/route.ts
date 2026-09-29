import { NextResponse, type NextRequest } from 'next/server'
import { getFinanceAccess } from '@/lib/financeiro/server'
import { chamarPonte } from '@/lib/registro-guias/ponte'
import { FUNCAO_UNIMED, FUNCOES_ESCRITA, funcaoPermitida } from '@/lib/registro-guias/funcoes'

// Chamadas do Index.html original (google.script.run) chegam aqui.
// "Grava nos dois": a planilha é gravada pelo Code.gs original e, só depois
// que ele confirma, o banco é atualizado (legacy_registro_espelhar).
export const maxDuration = 60
export const dynamic = 'force-dynamic'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

function responder(corpo: Record<string, unknown>, status = 200) {
  return NextResponse.json(corpo, { status, headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  const acesso = await getFinanceAccess()
  if (!acesso.allowed) {
    return responder(
      { erro: acesso.status === 401 ? 'Sessão expirada. Entre de novo no HOPE CORE.' : 'Seu usuário não tem acesso ao financeiro.' },
      acesso.status
    )
  }
  const { supabase } = acesso

  let corpo: { fn?: unknown; args?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return responder({ erro: 'Pedido inválido.' }, 400)
  }
  const fn = String(corpo?.fn ?? '')
  const args = Array.isArray(corpo?.args) ? (corpo.args as unknown[]) : []

  // Cruzamento com os demonstrativos da Unimed — resolvido no próprio banco
  if (fn === FUNCAO_UNIMED) {
    const guias = (Array.isArray(args[0]) ? args[0] : [])
      .map((g) => String(g ?? '').trim())
      .filter((g) => g.length > 0)
      .slice(0, 3000)
    if (!guias.length) return responder({ resultado: [] })
    const { data, error } = await supabase.rpc('claim_status_por_guias', { p_guias: guias })
    if (error) return responder({ erro: error.message }, 500)
    return responder({ resultado: data ?? [] })
  }

  // Filtro "Psicóloga" com TODAS: inclui na aba ID do Registro quem está no
  // Calculo RPA e falta lá (hopeListaPsicologasCompleta). Se a ponte ainda
  // não tiver essa função, cai na lista original.
  if (fn === 'getListaPsicologas') {
    const { data: planilhas } = await supabase.rpc('legacy_planilhas_nomes')
    const extras = (planilhas ?? [])
      .filter((p) => p.ativo !== false && p.nome_abreviado)
      .map((p) => ({ nome: String(p.nome_abreviado).trim(), id: p.spreadsheet_id }))
    if (extras.length) {
      try {
        const { resultado } = await chamarPonte('hopeListaPsicologasCompleta', [extras])
        return responder({ resultado })
      } catch (e) {
        if (!/Função não permitida/.test((e as Error).message)) return responder({ erro: (e as Error).message }, 502)
      }
    }
  }

  if (!funcaoPermitida(fn)) return responder({ erro: `Função não permitida: ${fn}` }, 400)

  try {
    const { resultado, extra } = await chamarPonte(fn, args)
    let aviso: string | undefined
    if (FUNCOES_ESCRITA.has(fn)) {
      const { error } = await supabase.rpc('legacy_registro_espelhar', {
        p: { funcao: fn, args: args as Json, resposta: resultado as Json, extra: extra as Json },
      })
      if (error) {
        aviso = `Salvo na planilha, mas o banco não foi atualizado agora (${error.message}). A sincronização de hora em hora corrige.`
      }
    }
    return responder(aviso ? { resultado, aviso } : { resultado })
  } catch (e) {
    return responder({ erro: (e as Error).message }, 502)
  }
}
