import 'server-only'
import { request } from 'node:https'
import { lerPem, mascarar } from '../cora/cliente'
import { FORMATOS_DATA, formatarData, type ExtratoBradesco, type FormatoData } from './extrato'

// ================================================================
// Bradesco — API "Saldo e extrato" (PJ), produção, OAuth2 + mTLS.
//   token:   POST https://openapi.bradesco.com.br/auth/server-mtls/v2/token
//            (x-www-form-urlencoded: grant_type=client_credentials,
//             client_id, client_secret) — vale 1 h, reaproveitado
//   extrato: GET  https://openapi.bradesco.com.br/v1/fornecimento-extratos-contas/extratos
//            ?agencia&conta&tipo=cc&dataInicio&dataFim
// Toda chamada leva o certificado A1 (e-CNPJ) da clínica + chave privada
// (mTLS). Segredos só nas variáveis da Vercel:
//   BRADESCO_CLIENT_ID, BRADESCO_CLIENT_SECRET
//   BRADESCO_CERT  = certificado PEM (ou base64 do PEM)
//   BRADESCO_KEY   = chave privada PEM (ou base64 do PEM)
//   BRADESCO_AGENCIA, BRADESCO_CONTA (sem dígito)
//   BRADESCO_VALOR_CENTAVOS = 1 só se a API mandar valores em centavos
// ================================================================

const HOST = 'https://openapi.bradesco.com.br'

export type ConfigBradesco = {
  clientId: string
  clientSecret: string
  cert: string
  key: string
  agencia: string
  conta: string
  valorEmCentavos: boolean
}

const soDigitos = (v: string | undefined) => String(v ?? '').replace(/\D/g, '')

export function configBradesco(): ConfigBradesco | null {
  const clientId = String(process.env.BRADESCO_CLIENT_ID ?? '').trim()
  const clientSecret = String(process.env.BRADESCO_CLIENT_SECRET ?? '').trim()
  const cert = lerPem(process.env.BRADESCO_CERT)
  const key = lerPem(process.env.BRADESCO_KEY)
  const agencia = soDigitos(process.env.BRADESCO_AGENCIA)
  const conta = soDigitos(process.env.BRADESCO_CONTA)
  if (!clientId || !clientSecret || !cert || !key || !agencia || !conta) return null
  return { clientId, clientSecret, cert, key, agencia, conta, valorEmCentavos: process.env.BRADESCO_VALOR_CENTAVOS === '1' }
}

/** Quais variáveis faltam (para mostrar na tela, sem valores). */
export function faltandoBradesco(): string[] {
  const nomes = ['BRADESCO_CLIENT_ID', 'BRADESCO_CLIENT_SECRET', 'BRADESCO_CERT', 'BRADESCO_KEY', 'BRADESCO_AGENCIA', 'BRADESCO_CONTA']
  return nomes.filter((n) => {
    const v = process.env[n]
    if (n === 'BRADESCO_CERT' || n === 'BRADESCO_KEY') return !lerPem(v)
    return !String(v ?? '').trim()
  })
}

type Resposta = { status: number; corpo: string }

function chamar(cfg: ConfigBradesco, metodo: 'GET' | 'POST', caminho: string, headers: Record<string, string>, corpo?: string): Promise<Resposta> {
  const url = new URL(caminho, HOST)
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: metodo,
        cert: cfg.cert,
        key: cfg.key,
        headers: { Accept: 'application/json', ...headers, ...(corpo ? { 'Content-Length': Buffer.byteLength(corpo).toString() } : {}) },
        timeout: 45_000,
      },
      (res) => {
        const partes: Buffer[] = []
        res.on('data', (c: Buffer) => partes.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8') }))
      }
    )
    req.on('timeout', () => req.destroy(new Error('Bradesco não respondeu em 45 s')))
    req.on('error', reject)
    if (corpo) req.write(corpo)
    req.end()
  })
}

// O Bradesco pede para reaproveitar o token durante a hora de validade
// (gerar um por chamada pode bloquear). Renovamos 5 min antes.
let cache: { chave: string; token: string; expira: number } | null = null

export async function tokenBradesco(cfg: ConfigBradesco): Promise<string> {
  const chave = cfg.clientId
  if (cache && cache.chave === chave && Date.now() < cache.expira) return cache.token
  const corpo = new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString()
  const r = await chamar(cfg, 'POST', '/auth/server-mtls/v2/token', { 'Content-Type': 'application/x-www-form-urlencoded' }, corpo)
  if (r.status !== 200) throw new Error(`Bradesco recusou o token (${r.status}): ${r.corpo.slice(0, 300)}`)
  const j = JSON.parse(r.corpo) as { access_token?: string; expires_in?: number }
  if (!j.access_token) throw new Error('Bradesco não devolveu access_token')
  cache = { chave, token: j.access_token, expira: Date.now() + (Number(j.expires_in ?? 3600) - 300) * 1000 }
  return j.access_token
}

// formato de data que a API aceitou (descoberto na 1ª chamada)
let formatoOk: FormatoData | null = null

export type ResultadoExtrato = { extrato: ExtratoBradesco; formato: FormatoData; semRegistros: boolean }

/** Extrato de um período (YYYY-MM-DD), conta corrente. */
export async function extratoBradesco(cfg: ConfigBradesco, inicio: string, fim: string): Promise<ResultadoExtrato> {
  const token = await tokenBradesco(cfg)
  const formatos = formatoOk ? [formatoOk, ...FORMATOS_DATA.filter((f) => f !== formatoOk)] : [...FORMATOS_DATA]
  let ultimo = ''
  for (const formato of formatos) {
    const q = new URLSearchParams({
      agencia: cfg.agencia,
      conta: cfg.conta,
      tipo: 'cc',
      dataInicio: formatarData(inicio, formato),
      dataFim: formatarData(fim, formato),
    })
    const r = await chamar(cfg, 'GET', `/v1/fornecimento-extratos-contas/extratos?${q}`, { Authorization: `Bearer ${token}` })
    if (r.status === 401) cache = null
    if (r.status === 200) {
      formatoOk = formato
      return { extrato: JSON.parse(r.corpo) as ExtratoBradesco, formato, semRegistros: false }
    }
    // CTAS0014 = nenhum registro no período (não é erro)
    if (r.status === 422 && /CTAS0014/.test(r.corpo)) {
      formatoOk = formato
      return { extrato: {}, formato, semRegistros: true }
    }
    ultimo = `Bradesco /extratos respondeu ${r.status}: ${r.corpo.slice(0, 300)}`
    // só tenta outro formato se o erro for de validação de data
    if (!(r.status === 400 && /data/i.test(r.corpo))) break
  }
  throw new Error(ultimo || 'Bradesco não respondeu')
}

// ---------------- diagnóstico (sem revelar segredos) ----------------

export type DiagnosticoBradesco = {
  clientId: string
  agencia: string
  conta: string
  certCN: string | null
  certValidoAte: string | null
  certVencido: boolean | null
  chaveCombina: boolean | null
  erroCert: string | null
}

export async function diagnosticoBradesco(cfg: ConfigBradesco): Promise<DiagnosticoBradesco> {
  const d: DiagnosticoBradesco = {
    clientId: mascarar(cfg.clientId),
    agencia: cfg.agencia,
    conta: mascarar(cfg.conta),
    certCN: null,
    certValidoAte: null,
    certVencido: null,
    chaveCombina: null,
    erroCert: null,
  }
  try {
    const { X509Certificate, createPrivateKey } = await import('node:crypto')
    const x = new X509Certificate(cfg.cert)
    d.certCN = /CN=([^\n,]+)/.exec(x.subject)?.[1]?.trim() ?? null
    d.certValidoAte = x.validTo
    d.certVencido = new Date(x.validTo).getTime() < Date.now()
    try {
      d.chaveCombina = x.checkPrivateKey(createPrivateKey(cfg.key))
    } catch (e) {
      d.chaveCombina = false
      d.erroCert = `Chave privada inválida: ${(e as Error).message}`
    }
  } catch (e) {
    d.erroCert = `Certificado inválido: ${(e as Error).message}`
  }
  return d
}
