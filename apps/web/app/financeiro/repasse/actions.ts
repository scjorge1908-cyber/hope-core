'use server'

import { revalidatePath } from 'next/cache'
import { requireFinanceAccess } from '@/lib/financeiro/server'

/**
 * Marca/desmarca a psicóloga como desligada da clínica. A planilha continua
 * no banco (histórico e repasse de meses antigos); só sai do filtro
 * "Psicóloga" do Registro de Guias.
 */
export async function marcarDesligada(fd: FormData) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return
  const id = String(fd.get('spreadsheetId') ?? '')
  const desligada = fd.get('desligada') === '1'
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(id)) return
  await supabase.rpc('legacy_marcar_desligada', { p_spreadsheet_id: id, p_desligada: desligada })
  revalidatePath('/financeiro/repasse')
}
