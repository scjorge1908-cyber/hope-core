'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { sincronizarBanco } from '@/lib/cora/conciliar'

function voltar(fd: FormData, extra: Record<string, string>): never {
  const q = new URLSearchParams()
  for (const k of ['inicio', 'fim']) {
    const v = String(fd.get(k) ?? '')
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) q.set(k, v)
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v)
  revalidatePath('/financeiro/banco')
  revalidatePath('/financeiro/agenda')
  redirect(`/financeiro/banco?${q}#conciliacao`)
}

export async function buscarAgora(fd: FormData) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) voltar(fd, { erro: 'Sem acesso ao financeiro.' })
  let texto: string
  try {
    // "desde janeiro": relê o ano todo (para confirmar os pagamentos antigos)
    const hoje = new Date()
    const dias = fd.get('desde') === 'ano' ? Math.ceil((hoje.getTime() - Date.UTC(hoje.getUTCFullYear(), 0, 1)) / 86_400_000) + 1 : 60
    const r = await sincronizarBanco(supabase, dias)
    const n = r.previstos_confirmados ?? 0
    texto = `Extrato lido (${r.lancamentos_novos ?? 0} lançamento(s) novo(s)). ${n ? `${n} recebimento(s) confirmado(s) na Agenda.` : 'Nada novo para confirmar.'}`
  } catch (e) {
    voltar(fd, { erro: (e as Error).message })
  }
  voltar(fd, { ok: texto })
}

export async function vincular(fd: FormData) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) voltar(fd, { erro: 'Sem acesso ao financeiro.' })
  const { error } = await supabase.rpc('bank_vincular', {
    p_tx: String(fd.get('tx') ?? ''),
    p_origem: String(fd.get('origem') ?? ''),
    p_target: String(fd.get('target') ?? ''),
  })
  if (error) voltar(fd, { erro: error.message })
  voltar(fd, { ok: 'Recebimento confirmado na Agenda.' })
}

export async function desvincular(fd: FormData) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) voltar(fd, { erro: 'Sem acesso ao financeiro.' })
  const { error } = await supabase.rpc('bank_desvincular', {
    p_origem: String(fd.get('origem') ?? ''),
    p_target: String(fd.get('target') ?? ''),
  })
  if (error) voltar(fd, { erro: error.message })
  voltar(fd, { ok: 'Desfeito: voltou para previsto e o crédito voltou para conferir.' })
}

export async function ignorar(fd: FormData) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) voltar(fd, { erro: 'Sem acesso ao financeiro.' })
  const { error } = await supabase.rpc('bank_ignorar', { p_tx: String(fd.get('tx') ?? ''), p_ignorar: fd.get('ignorar') !== '0' })
  if (error) voltar(fd, { erro: error.message })
  voltar(fd, { ok: fd.get('ignorar') !== '0' ? 'Crédito marcado como “não é de plano”.' : 'Crédito voltou para conferir.' })
}
