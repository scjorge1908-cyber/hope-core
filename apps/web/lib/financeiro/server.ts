import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { FinanceDatabase } from './db-types'

/** Cliente Supabase tipado para o módulo financeiro (ver db-types.ts). */
export async function createFinanceClient() {
  const cookieStore = await cookies()
  return createServerClient<FinanceDatabase>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Server Component — cookies só podem ser escritos em Server Actions ou Route Handlers
          }
        },
      },
    }
  )
}

/**
 * Garante usuário logado COM acesso ao financeiro (owner/manager/admin_staff).
 * Usar em toda página e toda Server Action do módulo — a checagem na tela
 * não é barreira de segurança; o banco confere de novo (RLS + funções).
 */
export async function requireFinanceAccess() {
  const supabase = await createFinanceClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: allowed, error } = await supabase.rpc('has_finance_access')
  if (error || !allowed) {
    return { supabase, user, tenantId: null as string | null, allowed: false as const }
  }

  const { data: me } = await supabase.from('users').select('tenant_id').eq('id', user.id).single()
  return { supabase, user, tenantId: me?.tenant_id ?? null, allowed: true as const }
}
