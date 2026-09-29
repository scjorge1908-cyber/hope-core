import 'server-only'

/**
 * Chama o doPost do PonteRPA.gs (projeto "Calculo RPA", app da Web).
 * URL e token ficam só no servidor: HOPE_RPA_URL e HOPE_RPA_TOKEN na
 * Vercel (se HOPE_RPA_TOKEN não existir, usa o mesmo HOPE_REGISTRO_TOKEN).
 */
export async function chamarPonteRpa(fn: 'sincronizarPlanilhasSupabase' | 'sincronizarUmaSupabase' | 'status', args: unknown[] = []) {
  const url = process.env.HOPE_RPA_URL
  const token = process.env.HOPE_RPA_TOKEN || process.env.HOPE_REGISTRO_TOKEN
  if (!url || !token) {
    throw new Error('Botão ainda não ligado: falta HOPE_RPA_URL (URL /exec do Calculo RPA) na Vercel.')
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, fn, args }),
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(55_000),
  })

  const texto = await resp.text()
  let j: { ok?: boolean; erro?: string; resultado?: unknown }
  try {
    j = JSON.parse(texto)
  } catch {
    throw new Error(
      `O Calculo RPA respondeu ${resp.status} sem JSON. Confira se o PonteRPA.gs foi colado e a implantação (App da Web, acesso "Qualquer pessoa") é a mais nova.`
    )
  }
  if (!j.ok) throw new Error(j.erro || 'Erro no Apps Script do Calculo RPA')
  return j.resultado as Record<string, unknown> | null
}
