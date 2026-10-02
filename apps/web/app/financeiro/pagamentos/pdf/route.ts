import { NextResponse, type NextRequest } from 'next/server'
import { getFinanceAccess } from '@/lib/financeiro/server'
import { MESES } from '@/lib/financeiro/rpa-legado'
import { normalizarChavePix } from '@/lib/financeiro/pix-brcode'
import { carregarRepasseDoMes } from '@/lib/financeiro/pagamentos-dados'
import { ordenarFila, situacaoDe } from '@/lib/financeiro/repasse-pagamentos'
import { gerarPdfPagamentos, type LinhaPdfPagamento } from '@/lib/financeiro/pdf-pagamentos'
import type { RepassePagamentoRow } from '@/lib/financeiro/db-types'

// PDF do "Controle de pagamento do repasse" (?mes=SETEMBRO&ano=2026):
// mesma tabela da tela Pagamentos de repasse, para baixar e arquivar.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const FORMA: Record<RepassePagamentoRow['forma'], string> = {
  pix_qrcode: 'QR Code Pix',
  pix_copia_cola: 'Pix copia e cola',
  extrato: 'Pix do extrato (Cora)',
  outro: 'Outro',
}

export async function GET(request: NextRequest) {
  const acesso = await getFinanceAccess()
  if (!acesso.allowed) {
    return NextResponse.json({ erro: acesso.status === 401 ? 'Sessão expirada.' : 'Sem acesso ao financeiro.' }, { status: acesso.status })
  }
  const q = request.nextUrl.searchParams
  const mes = String(q.get('mes') ?? '').toUpperCase()
  const ano = String(q.get('ano') ?? '')
  if (!MESES.includes(mes as (typeof MESES)[number]) || !/^\d{4}$/.test(ano)) {
    return NextResponse.json({ erro: 'Informe mes (ex.: SETEMBRO) e ano (ex.: 2026).' }, { status: 400 })
  }

  const dados = await carregarRepasseDoMes(acesso.supabase, mes, ano)
  if (dados.erro) return NextResponse.json({ erro: dados.erro }, { status: 500 })

  const fila = ordenarFila(
    dados.ok.map((d) => {
      const valor = Number(d.valorLiquido) || 0
      const pagamento = dados.pagamentos.get(d.id) ?? null
      return { d, valor, pagamento, situacao: situacaoDe(valor, pagamento) }
    })
  ).filter((l) => l.situacao !== 'sem_valor')

  const linhas: LinhaPdfPagamento[] = fila.map((l) => {
    const chave = normalizarChavePix(l.d.pixKey)
    const pago = l.situacao === 'pago'
    return {
      nome: l.d.nome,
      tipo: l.d.isIsenta ? 'CNPJ' : 'PF',
      chavePix: chave.ok ? chave.chave : String(l.d.pixKey ?? ''),
      aPagar: l.valor,
      pago,
      dataPagamento: pago ? (l.pagamento?.data_pagamento ?? null) : null,
      forma: pago && l.pagamento ? FORMA[l.pagamento.forma] : '',
      valorPago: pago && l.pagamento ? Number(l.pagamento.valor_pago) : null,
      confirmadoExtrato: pago && !!l.pagamento?.bank_transaction_id,
    }
  })

  const geradoEm = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const bytes = await gerarPdfPagamentos(linhas, { competencia: `${mes}/${ano}`, geradoEm })
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="Controle-pagamento-repasse-${mes}-${ano}.pdf"`,
      'cache-control': 'no-store',
    },
  })
}
