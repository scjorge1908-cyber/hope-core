'use server'

import { revalidatePath } from 'next/cache'
import { requireFinanceAccess } from '@/lib/financeiro/server'

export interface NotaState {
  ok?: string
  error?: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f-]{36}$/i

/** "21.024,74" | "21024.74" | "21024,74" → 21024.74 */
function parseValor(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let s = raw.trim().replace(/[R$\s]/g, '')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

export async function registrarNota(_prev: NotaState, fd: FormData): Promise<NotaState> {
  const { supabase, allowed, tenantId, user } = await requireFinanceAccess()
  if (!allowed || !tenantId) return { error: 'Sem permissão.' }

  const statementId = String(fd.get('statement_id') ?? '')
  const invoiceNumber = String(fd.get('invoice_number') ?? '').trim()
  const issueDate = String(fd.get('issue_date') ?? '')
  const expected = String(fd.get('expected_payment_date') ?? '')
  const amount = parseValor(fd.get('amount'))
  const notes = String(fd.get('notes') ?? '').trim().slice(0, 500)

  if (!UUID.test(statementId)) return { error: 'Escolha o demonstrativo.' }
  if (!invoiceNumber || invoiceNumber.length > 60) return { error: 'Informe o número da nota.' }
  if (!DATE.test(issueDate)) return { error: 'Data de emissão inválida.' }
  if (expected && !DATE.test(expected)) return { error: 'Data prevista de pagamento inválida.' }
  if (amount === null) return { error: 'Valor inválido.' }

  // plano vem do demonstrativo (lido pelo banco com RLS), nunca do formulário
  const { data: st, error: stErr } = await supabase
    .from('claim_statement_overview')
    .select('id, insurance_plan_id, items_released, statement_number')
    .eq('id', statementId)
    .single()
  if (stErr || !st) return { error: 'Demonstrativo não encontrado.' }

  const { error } = await supabase.from('operator_invoices').insert({
    tenant_id: tenantId,
    insurance_plan_id: st.insurance_plan_id,
    statement_id: st.id,
    invoice_number: invoiceNumber,
    issue_date: issueDate,
    amount,
    expected_payment_date: expected || null,
    notes: notes || null,
    created_by: user.id,
  })
  if (error) {
    if (error.code === '23505') return { error: `Já existe uma nota com o número ${invoiceNumber}.` }
    return { error: `Erro ao salvar: ${error.message}` }
  }

  revalidatePath('/financeiro')
  revalidatePath('/financeiro/notas')
  const diff = Math.round((amount - Number(st.items_released)) * 100) / 100
  return {
    ok:
      `Nota ${invoiceNumber} registrada para o demonstrativo ${st.statement_number}.` +
      (diff !== 0 ? ` Atenção: difere do valor liberado em ${diff.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` : ''),
  }
}

export async function marcarPaga(fd: FormData) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return

  const id = String(fd.get('id') ?? '')
  const paidOn = String(fd.get('paid_on') ?? '')
  const paidAmount = parseValor(fd.get('paid_amount'))
  if (!UUID.test(id) || !DATE.test(paidOn) || paidAmount === null) return

  await supabase.from('operator_invoices').update({ status: 'paid', paid_on: paidOn, paid_amount: paidAmount }).eq('id', id)
  revalidatePath('/financeiro')
  revalidatePath('/financeiro/notas')
}

export async function cancelarNota(fd: FormData) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return
  const id = String(fd.get('id') ?? '')
  if (!UUID.test(id)) return
  await supabase.from('operator_invoices').update({ status: 'cancelled' }).eq('id', id).neq('status', 'paid')
  revalidatePath('/financeiro')
  revalidatePath('/financeiro/notas')
}
