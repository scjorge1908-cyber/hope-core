'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireFinanceAccess } from '@/lib/financeiro/server'

const BASE = '/financeiro/pagamentos'

/** Volta para a mesma tela (mesmo mês/ano/filtro), com um aviso opcional. */
function voltarPara(fd: FormData, aviso?: { ok?: string; erro?: string }): never {
  const bruto = String(fd.get('voltar') ?? BASE)
  const url = new URL(bruto.startsWith(BASE) ? bruto : BASE, 'http://x')
  url.searchParams.delete('ok')
  url.searchParams.delete('erro')
  if (aviso?.ok) url.searchParams.set('ok', aviso.ok)
  if (aviso?.erro) url.searchParams.set('erro', aviso.erro)
  redirect(`${url.pathname}${url.search}${String(fd.get('ancora') ?? '')}`)
}

const ID_PLANILHA = /^[a-zA-Z0-9_-]{20,}$/
const DATA = /^\d{4}-\d{2}-\d{2}$/
const COMPETENCIA = /^\d{4}-\d{2}-01$/

/**
 * Marca o repasse de uma psicóloga no mês como PAGO.
 * • Pelo QR Code / copia e cola: grava o valor calculado do RPA naquele
 *   momento e a data informada.
 * • Pelo extrato (bankTx): valor e data vêm do lançamento do Cora,
 *   nunca do formulário.
 */
export async function marcarPago(fd: FormData) {
  const { supabase, user, tenantId, allowed } = await requireFinanceAccess()
  if (!allowed || !tenantId) voltarPara(fd, { erro: 'Sem acesso ao financeiro.' })

  const spreadsheetId = String(fd.get('spreadsheetId') ?? '')
  const competencia = String(fd.get('competencia') ?? '')
  const nome = String(fd.get('nome') ?? '').trim().slice(0, 200)
  const tipo = fd.get('tipo') === 'CNPJ' ? 'CNPJ' : 'PF'
  const formaBruta = String(fd.get('forma') ?? 'pix_qrcode')
  const bankTx = String(fd.get('bankTx') ?? '')

  if (!ID_PLANILHA.test(spreadsheetId) || !COMPETENCIA.test(competencia) || !nome) {
    voltarPara(fd, { erro: 'Dados do pagamento incompletos.' })
  }

  let valor = Number(String(fd.get('valor') ?? '').replace(',', '.'))
  let data = String(fd.get('data') ?? '')
  let forma = (['pix_qrcode', 'pix_copia_cola', 'outro'] as const).find((f) => f === formaBruta) ?? 'pix_qrcode'
  let bankTransactionId: string | null = null

  if (bankTx) {
    const { data: tx, error } = await supabase
      .from('bank_transactions')
      .select('id, kind, amount, occurred_on')
      .eq('id', bankTx)
      .maybeSingle()
    if (error || !tx || tx.kind !== 'saida') voltarPara(fd, { erro: 'Lançamento do extrato não encontrado.' })
    valor = Number(tx!.amount)
    data = tx!.occurred_on
    forma = 'extrato' as typeof forma
    bankTransactionId = tx!.id
  }

  if (!Number.isFinite(valor) || valor < 0) voltarPara(fd, { erro: 'Valor inválido.' })
  if (!DATA.test(data)) voltarPara(fd, { erro: 'Informe a data do pagamento.' })

  const { error } = await supabase.from('repasse_pagamentos').upsert(
    {
      tenant_id: tenantId!,
      competencia,
      spreadsheet_id: spreadsheetId,
      psicologa_nome: nome,
      tipo,
      valor_pago: Math.round(valor * 100) / 100,
      pago: true,
      data_pagamento: data,
      forma: forma as 'pix_qrcode' | 'pix_copia_cola' | 'extrato' | 'outro',
      bank_transaction_id: bankTransactionId,
      marcado_por: user.id,
      marcado_em: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,spreadsheet_id,competencia' }
  )
  if (error) {
    const msg = /uq_repasse_pagamentos_tx/.test(error.message)
      ? 'Este Pix do extrato já está vinculado a outro pagamento.'
      : /repasse_pagamentos/.test(error.message) && /does not exist|não existe|schema cache/.test(error.message)
        ? 'Falta aplicar a migration 028 no banco (tabela repasse_pagamentos).'
        : error.message
    voltarPara(fd, { erro: msg })
  }

  revalidatePath(BASE)
  voltarPara(fd, { ok: `${nome}: marcado como pago.` })
}

/** Desfaz o "pago" (não apaga: volta pago = false e solta o Pix do extrato). */
export async function desfazerPago(fd: FormData) {
  const { supabase, user, allowed } = await requireFinanceAccess()
  if (!allowed) voltarPara(fd, { erro: 'Sem acesso ao financeiro.' })
  const id = String(fd.get('id') ?? '')
  if (!/^[0-9a-f-]{36}$/.test(id)) voltarPara(fd, { erro: 'Registro inválido.' })

  const { error } = await supabase
    .from('repasse_pagamentos')
    .update({ pago: false, bank_transaction_id: null, marcado_por: user.id, marcado_em: new Date().toISOString() })
    .eq('id', id)
  if (error) voltarPara(fd, { erro: error.message })

  revalidatePath(BASE)
  voltarPara(fd, { ok: 'Pagamento desfeito.' })
}
