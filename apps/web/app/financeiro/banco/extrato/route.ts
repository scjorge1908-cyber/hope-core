import { NextResponse, type NextRequest } from 'next/server'
import { getFinanceAccess } from '@/lib/financeiro/server'
import { hojeSaoPaulo } from '@/lib/financeiro/agenda'
import { configCora, extratoCora } from '@/lib/cora/cliente'
import { gerarPdfExtrato, gerarXlsxExtrato, linhasDoExtrato } from '@/lib/cora/exportar'

// Download do extrato do Cora: ?inicio=AAAA-MM-DD&fim=AAAA-MM-DD&formato=xlsx|pdf
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const acesso = await getFinanceAccess()
  if (!acesso.allowed) return NextResponse.json({ erro: 'Sem acesso ao financeiro.' }, { status: acesso.status })
  const cfg = configCora()
  if (!cfg) return NextResponse.json({ erro: 'Integração com o Cora não configurada.' }, { status: 400 })

  const q = request.nextUrl.searchParams
  const hoje = hojeSaoPaulo()
  let fim = ISO.test(q.get('fim') ?? '') ? String(q.get('fim')) : hoje
  if (fim > hoje) fim = hoje
  const inicio = ISO.test(q.get('inicio') ?? '') ? String(q.get('inicio')) : `${fim.slice(0, 8)}01`
  const formato = q.get('formato') === 'pdf' ? 'pdf' : 'xlsx'

  try {
    const ex = await extratoCora(cfg, inicio, fim, hoje)
    const linhas = linhasDoExtrato(ex)
    const meta = {
      empresa: ex.header?.businessName ?? 'Hope Clínica Multidisciplinar',
      documentoEmpresa: ex.header?.businessDocument ?? '',
      inicio,
      fim,
      saldoInicial: ex.start ? Number(ex.start.balance) / 100 : null,
      saldoFinal: ex.end ? Number(ex.end.balance) / 100 : null,
      geradoEm: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      ambiente: cfg.ambiente,
    }
    const nome = `Extrato-Cora-${inicio}-a-${fim}.${formato}`
    const bytes = formato === 'pdf' ? await gerarPdfExtrato(linhas, meta) : gerarXlsxExtrato(linhas, meta)
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'content-type': formato === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${nome}"`,
        'cache-control': 'no-store',
      },
    })
  } catch (e) {
    return NextResponse.json({ erro: (e as Error).message }, { status: 502 })
  }
}
