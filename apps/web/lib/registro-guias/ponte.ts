import 'server-only'

export type RespostaPonte = { resultado: unknown; extra: Record<string, unknown> }

/**
 * Chama uma função do Code.gs do ADM Registro de Guia pelo doPost do
 * PonteRegistroGuias.gs (app da Web publicado). O token fica só no
 * servidor (variáveis HOPE_REGISTRO_URL e HOPE_REGISTRO_TOKEN na Vercel).
 */
export async function chamarPonte(fn: string, args: unknown[]): Promise<RespostaPonte> {
  const url = process.env.HOPE_REGISTRO_URL
  const token = process.env.HOPE_REGISTRO_TOKEN
  if (!url || !token) {
    throw new Error('Falta configurar HOPE_REGISTRO_URL e HOPE_REGISTRO_TOKEN na Vercel.')
  }

  const resp = await fetch(url, {
    method: 'POST',
    // text/plain evita pré-checagem e o Apps Script lê o corpo do mesmo jeito
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, fn, args }),
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(55_000),
  })

  const texto = await resp.text()
  let j: { ok?: boolean; erro?: string; resultado?: unknown; extra?: Record<string, unknown> }
  try {
    j = JSON.parse(texto)
  } catch {
    throw new Error(
      `O Apps Script respondeu ${resp.status} sem JSON. Confira se a implantação do app da Web foi atualizada para a nova versão e está com acesso "Qualquer pessoa".`
    )
  }
  if (!j.ok) throw new Error(j.erro || 'Erro no Apps Script')
  return { resultado: j.resultado ?? null, extra: j.extra ?? {} }
}
