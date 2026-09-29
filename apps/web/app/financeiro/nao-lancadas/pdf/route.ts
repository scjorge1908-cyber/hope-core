import { NextResponse, type NextRequest } from 'next/server'
import { getFinanceAccess } from '@/lib/financeiro/server'
import { agruparAdmSemSessao, agruparNaoLancadas, type LinhaAdmSemSessao, type LinhaConferencia, type PsicologaNaoLancada } from '@/lib/financeiro/conferencia'
import { hojeSaoPaulo } from '@/lib/financeiro/agenda'
import { gerarPdfNaoLancadas } from '@/lib/financeiro/pdf-nao-lancadas'

// PDF para baixar e encaminhar à psicóloga: mesmos filtros da tela
// (?psi=&de=AAAA-MM&ate=AAAA-MM&semguia=0|1). Sem psi = todas, uma por página.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MES_RE = /^(\d{4})-(\d{2})$/

function lerMes(v: string | null, padrao: string) {
  const m = MES_RE.exec(String(v ?? ''))
  if (!m) return padrao
  return `${m[1]}-${String(Math.min(Math.max(Number(m[2]), 1), 12)).padStart(2, '0')}`
}
function somarMes(ym: string, k: number) {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + k, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const rotuloMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`
const arquivo = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export async function GET(request: NextRequest) {
  const acesso = await getFinanceAccess()
  if (!acesso.allowed) {
    return NextResponse.json({ erro: acesso.status === 401 ? 'Sessão expirada.' : 'Sem acesso ao financeiro.' }, { status: acesso.status })
  }
  const q = request.nextUrl.searchParams
  const atual = hojeSaoPaulo().slice(0, 7)
  let de = lerMes(q.get('de'), somarMes(atual, -2))
  let ate = lerMes(q.get('ate'), atual)
  if (de > ate) [de, ate] = [ate, de]
  if (somarMes(de, 11) < ate) de = somarMes(ate, -11)
  const psi = q.get('psi') ?? ''
  const incluirSemGuia = q.get('semguia') !== '0'
  const modo: 'adm' | 'planilha' = q.get('modo') === 'planilha' ? 'planilha' : 'adm'

  let todas: PsicologaNaoLancada[]
  if (modo === 'adm') {
    const fim = new Date(Date.UTC(Number(ate.slice(0, 4)), Number(ate.slice(5, 7)), 0)).toISOString().slice(0, 10)
    const { data, error } = await acesso.supabase.rpc('guias_adm_sem_sessao', { p_de: `${de}-01`, p_ate: fim })
    if (error) return NextResponse.json({ erro: error.message }, { status: 500 })
    todas = agruparAdmSemSessao((data ?? []) as LinhaAdmSemSessao[])
  } else {
    const meses: string[] = []
    for (let m = de; m <= ate; m = somarMes(m, 1)) meses.push(m)
    const respostas = await Promise.all(
      meses.map((m) => acesso.supabase.rpc('conferencia_guias', { p_ano: Number(m.slice(0, 4)), p_mes: Number(m.slice(5, 7)) }))
    )
    const erro = respostas.find((r) => r.error)?.error
    if (erro) return NextResponse.json({ erro: erro.message }, { status: 500 })
    const linhas = respostas.flatMap((r) => (r.data ?? []) as LinhaConferencia[])
    todas = agruparNaoLancadas(linhas, incluirSemGuia)
  }
  const grupos = psi ? todas.filter((g) => g.psicologa === psi) : todas.sort((a, b) => a.psicologa.localeCompare(b.psicologa, 'pt-BR'))
  const periodo = de === ate ? rotuloMes(de) : `${rotuloMes(de)} a ${rotuloMes(ate)}`
  const MES_LONGO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
  const extenso = (ym: string) => `${MES_LONGO[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`
  const periodoExtenso =
    de === ate
      ? extenso(de)
      : de.slice(0, 4) === ate.slice(0, 4)
        ? `${MES_LONGO[Number(de.slice(5, 7)) - 1]} a ${extenso(ate)}`
        : `${extenso(de)} a ${extenso(ate)}`
  const agora = new Date()
  const geradoEm = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  // psicóloga escolhida sem pendência: PDF com o nome dela e "nenhuma pendência"
  const bytes = await gerarPdfNaoLancadas(
    psi && !grupos.length ? [{ psicologa: psi, spreadsheet_id: null, pacientes: [], guias: 0, sessoes: 0 }] : grupos,
    { periodo, geradoEm, incluirSemGuia, modo, periodoExtenso }
  )
  const nome = `${modo === 'adm' ? 'Guias-sem-sessao-na-planilha' : 'Guias-pendentes'}-${arquivo(psi || 'todas')}-${de}${de === ate ? '' : `-a-${ate}`}.pdf`
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${nome}"`,
      'cache-control': 'no-store',
    },
  })
}
