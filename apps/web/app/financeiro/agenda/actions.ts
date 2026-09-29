'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { parseOrizonXlsx } from '@/lib/financeiro/orizon-parser'
import { hojeSaoPaulo, lerValorBR, somarMeses } from '@/lib/financeiro/agenda'
import { brl, dataBR } from '@/lib/financeiro/format'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type ImportOrizonState = { ok?: boolean; titulo?: string; detalhes: string[]; erro?: string }

const ISO = /^\d{4}-\d{2}-\d{2}$/

function voltar(fd: FormData, extra?: Record<string, string>): never {
  const q = new URLSearchParams()
  const mes = String(fd.get('voltarMes') ?? '')
  const sel = String(fd.get('voltarSel') ?? '')
  if (/^\d{4}-\d{2}$/.test(mes)) q.set('mes', mes)
  if (sel) q.set('sel', sel)
  for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v)
  revalidatePath('/financeiro/agenda')
  redirect(`/financeiro/agenda${q.size ? `?${q}` : ''}`)
}

// ---------------- Importar Excel da Orizon (Bradesco) ----------------
export async function importarOrizon(_prev: ImportOrizonState, fd: FormData): Promise<ImportOrizonState> {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return { detalhes: [], erro: 'Sem acesso ao financeiro.' }

  const arquivo = fd.get('arquivo')
  if (!(arquivo instanceof File) || arquivo.size === 0) return { detalhes: [], erro: 'Escolha o arquivo .xlsx exportado da Orizon.' }
  if (arquivo.size > 10 * 1024 * 1024) return { detalhes: [], erro: 'Arquivo maior que 10 MB.' }

  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  let lido
  try {
    lido = parseOrizonXlsx(bytes)
  } catch (e) {
    return { detalhes: [], erro: (e as Error).message }
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  const { data, error } = await supabase.rpc('import_orizon_lotes', {
    p: { fileName: arquivo.name, sha256, linhas: lido.linhas as unknown as Json },
  })
  if (error) {
    return { detalhes: [], erro: error.code === '23505' ? 'Este arquivo já foi importado.' : error.message }
  }
  const r = data as { total: number; novos: number; atualizados: number; semMudanca: number; primeiroPagamento: string; ultimoPagamento: string }
  revalidatePath('/financeiro/agenda')
  return {
    ok: true,
    titulo: `${r.total} lote(s) lidos — ${brl(lido.total)}`,
    detalhes: [
      `${r.novos} novo(s), ${r.atualizados} atualizado(s), ${r.semMudanca} sem mudança.`,
      `Pagamentos previstos de ${dataBR(r.primeiroPagamento)} a ${dataBR(r.ultimoPagamento)} (45 dias da data de envio, no próximo dia útil).`,
      ...lido.avisos,
    ],
  }
}

// ---------------- Lançamento manual (entrada ou saída) ----------------
export async function novoLancamento(fd: FormData) {
  const { supabase, allowed, tenantId, user } = await requireFinanceAccess()
  if (!allowed || !tenantId) voltar(fd, { erro: 'Sem acesso ao financeiro.' })

  const kind = fd.get('kind') === 'saida' ? 'saida' : 'entrada'
  const planoId = String(fd.get('plano') ?? '')
  const categoriaLivre = String(fd.get('categoria') ?? '').trim()
  const data = String(fd.get('data') ?? '')
  const valor = lerValorBR(String(fd.get('valor') ?? ''))
  const descricao = String(fd.get('descricao') ?? '').trim() || null
  const repetir = Math.min(Math.max(Number(fd.get('repetir') ?? 1) || 1, 1), 24)

  if (!ISO.test(data)) voltar(fd, { erro: 'Data inválida.' })
  if (valor == null || valor <= 0) voltar(fd, { erro: 'Valor inválido.' })

  let categoria = categoriaLivre
  let insurance_plan_id: string | null = null
  if (kind === 'entrada' && planoId) {
    const { data: plano } = await supabase.from('insurance_plans').select('id, name, short_name').eq('id', planoId).single()
    if (!plano) voltar(fd, { erro: 'Plano não encontrado.' })
    insurance_plan_id = plano.id
    categoria = plano.short_name || plano.name
  }
  if (!categoria) voltar(fd, { erro: kind === 'entrada' ? 'Escolha o plano ou escreva a origem.' : 'Escreva a despesa (ex.: INSS, Sala 507).' })

  const linhas = Array.from({ length: repetir }, (_, i) => ({
    tenant_id: tenantId!,
    kind: kind as 'entrada' | 'saida',
    insurance_plan_id,
    category: categoria,
    source: 'manual' as const,
    amount: valor!,
    expected_date: somarMeses(data, i),
    description: descricao,
    created_by: user.id,
  }))
  const { error } = await supabase.from('cashflow_items').insert(linhas)
  if (error) voltar(fd, { erro: error.message })
  voltar(fd, { mes: data.slice(0, 7), ok: repetir > 1 ? `${repetir} lançamentos criados.` : 'Lançamento criado.' })
}

// ---------------- Confirmar recebimento/pagamento ----------------
export async function marcarRealizado(fd: FormData) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) voltar(fd, { erro: 'Sem acesso ao financeiro.' })
  const id = String(fd.get('id') ?? '')
  const origem = String(fd.get('origem') ?? '')
  const data = String(fd.get('data') ?? '') || hojeSaoPaulo()
  const valor = lerValorBR(String(fd.get('valor') ?? ''))
  if (!ISO.test(data)) voltar(fd, { erro: 'Data inválida.' })
  if (valor == null || valor < 0) voltar(fd, { erro: 'Valor inválido.' })

  const { error } =
    origem === 'nota_fiscal'
      ? await supabase.from('operator_invoices').update({ status: 'paid', paid_on: data, paid_amount: valor }).eq('id', id)
      : await supabase
          .from('cashflow_items')
          .update({ status: 'realizado', realized_date: data, realized_amount: valor, realized_source: 'manual' })
          .eq('id', id)
  if (error) voltar(fd, { erro: error.message })
  voltar(fd, { ok: 'Confirmado.' })
}

export async function desfazerRealizado(fd: FormData) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) voltar(fd, { erro: 'Sem acesso ao financeiro.' })
  const id = String(fd.get('id') ?? '')
  const origem = String(fd.get('origem') ?? '')
  const { error } =
    origem === 'nota_fiscal'
      ? await supabase.from('operator_invoices').update({ status: 'issued', paid_on: null, paid_amount: null }).eq('id', id)
      : await supabase
          .from('cashflow_items')
          .update({ status: 'previsto', realized_date: null, realized_amount: null, realized_source: null })
          .eq('id', id)
  if (error) voltar(fd, { erro: error.message })
  // se tinha sido confirmado pelo extrato do banco, solta o vínculo (o crédito volta para "a conferir")
  await supabase.rpc('bank_desvincular', { p_origem: origem === 'nota_fiscal' ? 'nota_fiscal' : 'item', p_target: id })
  voltar(fd, { ok: 'Voltou para previsto.' })
}

/** Só lançamentos manuais: some da agenda (fica registrado como cancelado). */
export async function cancelarLancamento(fd: FormData) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) voltar(fd, { erro: 'Sem acesso ao financeiro.' })
  const id = String(fd.get('id') ?? '')
  const { error } = await supabase.from('cashflow_items').update({ status: 'cancelado' }).eq('id', id).eq('source', 'manual')
  if (error) voltar(fd, { erro: error.message })
  voltar(fd, { ok: 'Lançamento removido da agenda.' })
}

// ---------------- Prazo de pagamento por plano ----------------
export async function salvarPrazo(fd: FormData) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) voltar(fd, { erro: 'Sem acesso ao financeiro.' })
  const id = String(fd.get('plano') ?? '')
  const diasTxt = String(fd.get('dias') ?? '').trim()
  const dias = diasTxt === '' ? null : Number(diasTxt)
  const base = String(fd.get('base') ?? 'envio')
  if (dias != null && (!Number.isInteger(dias) || dias < 0 || dias > 365)) voltar(fd, { erro: 'Prazo deve ser de 0 a 365 dias.' })
  if (!['envio', 'liberacao', 'nf'].includes(base)) voltar(fd, { erro: 'Base do prazo inválida.' })
  const { error } = await supabase
    .from('insurance_plans')
    .update({ payment_days: dias, payment_base: base as 'envio' | 'liberacao' | 'nf', payment_business_day: fd.get('util') === 'on' })
    .eq('id', id)
  if (error) voltar(fd, { erro: error.message })
  voltar(fd, { ok: 'Prazo salvo. Vale para as próximas importações.' })
}
