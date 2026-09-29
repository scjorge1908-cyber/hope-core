import 'server-only'
import { request } from 'node:https'
import { randomUUID } from 'node:crypto'

// ================================================================
// Cora — Integração Direta (mTLS: certificado + chave privada em TODA
// requisição, mais o token Bearer obtido em /token com client_credentials).
// Credenciais só nas variáveis da Vercel:
//   CORA_AMBIENTE   = stage | producao   (padrão: stage)
//   CORA_CLIENT_ID  = client id da Integração Direta
//   CORA_CERT       = conteúdo do certificate.pem (ou em base64)
//   CORA_KEY        = conteúdo do private-key.key (ou em base64)
// ================================================================

const BASE = {
  stage: 'https://matls-clients.api.stage.cora.com.br',
  producao: 'https://matls-clients.api.cora.com.br',
} as const

export type ConfigCora = { ambiente: keyof typeof BASE; clientId: string; cert: string; key: string }

/** Aceita o PEM colado direto ou em base64 (e "\n" escritos como texto). */
export function lerPem(v: string | undefined): string {
  const t = String(v ?? '').trim()
  if (!t) return ''
  if (t.includes('-----BEGIN')) return t.replace(/\\n/g, '\n')
  try {
    const dec = Buffer.from(t, 'base64').toString('utf8')
    return dec.includes('-----BEGIN') ? dec : ''
  } catch {
    return ''
  }
}

export function configCora(): ConfigCora | null {
  const clientId = String(process.env.CORA_CLIENT_ID ?? '').trim()
  const cert = lerPem(process.env.CORA_CERT)
  const key = lerPem(process.env.CORA_KEY)
  if (!clientId || !cert || !key) return null
  const ambiente = process.env.CORA_AMBIENTE === 'producao' ? 'producao' : 'stage'
  return { ambiente, clientId, cert, key }
}

type Resposta = { status: number; corpo: string }

function chamar(cfg: ConfigCora, metodo: string, caminho: string, headers: Record<string, string>, corpo?: string): Promise<Resposta> {
  const url = new URL(caminho, BASE[cfg.ambiente])
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: metodo,
        cert: cfg.cert,
        key: cfg.key,
        headers: { Accept: 'application/json', ...headers, ...(corpo ? { 'Content-Length': Buffer.byteLength(corpo).toString() } : {}) },
        timeout: 25_000,
      },
      (res) => {
        const partes: Buffer[] = []
        res.on('data', (c: Buffer) => partes.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8') }))
      }
    )
    req.on('timeout', () => req.destroy(new Error('Cora não respondeu em 25 s')))
    req.on('error', reject)
    if (corpo) req.write(corpo)
    req.end()
  })
}

// token em memória da função (dura 24 h no Cora; renovamos 5 min antes)
let cache: { chave: string; token: string; expira: number } | null = null

export async function tokenCora(cfg: ConfigCora): Promise<string> {
  const chave = `${cfg.ambiente}:${cfg.clientId}`
  if (cache && cache.chave === chave && Date.now() < cache.expira) return cache.token
  const corpo = new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId }).toString()
  const r = await chamar(cfg, 'POST', '/token', { 'Content-Type': 'application/x-www-form-urlencoded' }, corpo)
  if (r.status !== 200) throw new Error(`Cora recusou o token (${r.status}): ${r.corpo.slice(0, 200)}`)
  const j = JSON.parse(r.corpo) as { access_token?: string; expires_in?: number }
  if (!j.access_token) throw new Error('Cora não devolveu access_token')
  cache = { chave, token: j.access_token, expira: Date.now() + (Number(j.expires_in ?? 3600) - 300) * 1000 }
  return j.access_token
}

async function getCora<T>(cfg: ConfigCora, caminho: string): Promise<T> {
  const token = await tokenCora(cfg)
  const r = await chamar(cfg, 'GET', caminho, { Authorization: `Bearer ${token}` })
  if (r.status === 401) cache = null
  if (r.status < 200 || r.status >= 300) throw new Error(`Cora ${caminho.split('?')[0]} respondeu ${r.status}: ${r.corpo.slice(0, 200)}`)
  return JSON.parse(r.corpo) as T
}

/** Para chamadas que criam algo (boleto etc.) — já com Idempotency-Key. */
export async function postCora<T>(cfg: ConfigCora, caminho: string, dados: unknown, idempotencia = randomUUID()): Promise<T> {
  const token = await tokenCora(cfg)
  const r = await chamar(cfg, 'POST', caminho, { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencia }, JSON.stringify(dados))
  if (r.status < 200 || r.status >= 300) throw new Error(`Cora ${caminho} respondeu ${r.status}: ${r.corpo.slice(0, 300)}`)
  return JSON.parse(r.corpo) as T
}

// ---------------- saldo e extrato (valores em centavos) ----------------

export type SaldoCora = { balance: number | string }

export type LancamentoCora = {
  id: string
  type: 'CREDIT' | 'DEBIT' | string
  amount: number
  createdAt: string
  transaction?: { id?: string; type?: string; description?: string; counterParty?: { name?: string; identity?: string } }
}

export type ExtratoCora = {
  start?: { date: string; balance: number }
  end?: { date: string; balance: number }
  entries: LancamentoCora[]
  aggregations?: { creditTotal?: number; debitTotal?: number }
  header?: { businessName?: string; businessDocument?: string }
}

export const saldoCora = (cfg: ConfigCora) => getCora<SaldoCora>(cfg, '/third-party/account/balance')

/** Extrato do período (YYYY-MM-DD), todas as páginas (até 20 × 500). */
export async function extratoCora(cfg: ConfigCora, inicio: string, fim: string): Promise<ExtratoCora> {
  let pagina = 1
  let total: ExtratoCora | null = null
  for (; pagina <= 20; pagina++) {
    const q = new URLSearchParams({ start: inicio, end: fim, page: String(pagina), perPage: '500', aggr: pagina === 1 ? 'true' : 'false' })
    const r = await getCora<ExtratoCora>(cfg, `/bank-statement/statement?${q}`)
    if (!total) total = { ...r, entries: [...(r.entries ?? [])] }
    else total.entries.push(...(r.entries ?? []))
    if (!r.entries || r.entries.length < 500) break
  }
  return total ?? { entries: [] }
}
