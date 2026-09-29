'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireFinanceAccess } from '@/lib/financeiro/server'

/** Salva a categoria de um pagador/recebedor (vale para todos os lançamentos dele, passados e futuros). */
export async function classificar(fd: FormData) {
  const { supabase, allowed } = await requireFinanceAccess()
  const ano = String(fd.get('ano') ?? '')
  const filtro = String(fd.get('filtro') ?? '')
  const volta = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...(ano ? { ano } : {}), ...(filtro ? { cls: filtro } : {}), ...extra })
    revalidatePath('/financeiro/dre')
    redirect(`/financeiro/dre?${q}#classificar`)
  }
  if (!allowed) volta({ erro: 'Sem acesso ao financeiro.' })
  const nome = String(fd.get('nome') ?? '')
  const categoria = String(fd.get('categoria') ?? '')
  const { error } = await supabase.rpc('dre_classificar', {
    p_chave: String(fd.get('chave') ?? ''),
    p_tipo: String(fd.get('tipo') ?? ''),
    p_categoria: categoria,
  })
  if (error) volta({ erro: error.message })
  volta({ ok: categoria ? `${nome}: agora em “${categoria}”.` : `${nome}: voltou para a classificação automática.` })
}
