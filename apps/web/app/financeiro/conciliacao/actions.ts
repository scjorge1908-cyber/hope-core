'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireFinanceAccess } from '@/lib/financeiro/server'

/**
 * Fecha a competência (grava a foto imutável do motor). O banco recusa
 * mês ainda em andamento, mês já fechado e planilha com erro de leitura.
 */
export async function fecharCompetencia(formData: FormData) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return
  const ano = Number(formData.get('ano'))
  const mes = Number(formData.get('mes'))
  const observacao = String(formData.get('observacao') ?? '').trim().slice(0, 500) || null
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12) return

  const { error } = await supabase.rpc('fin_fechar_mes', { p_ano: ano, p_mes: mes, p_observacao: observacao })
  const volta = `/financeiro/conciliacao?ano=${ano}&mes=${mes}`
  revalidatePath('/financeiro/conciliacao')
  redirect(error ? `${volta}&erro=${encodeURIComponent(error.message)}` : `${volta}&fechado=1`)
}
