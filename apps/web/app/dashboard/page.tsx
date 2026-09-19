import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()

  // getUser() valida o JWT com o Supabase Auth — seguro para decisões de acesso
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/login')
  }

  // Busca tenants — RLS policy `tenant_self_access` deve retornar apenas 1 row
  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, name, legal_name, cnpj, plan, billing_status, created_at')

  return (
    <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>HOPE CORE — Dashboard</h1>
      <p style={{ color: '#6b7280', marginBottom: 32 }}>
        Logado como: <strong>{user.email}</strong>
      </p>

      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
          Tenants visíveis (via RLS)
        </h2>

        {tenantsError && (
          <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 16 }}>
            <strong style={{ color: '#dc2626' }}>Erro RLS:</strong>{' '}
            <code style={{ fontSize: 13 }}>{tenantsError.message}</code>
          </div>
        )}

        {!tenantsError && tenants && (
          <>
            <p style={{ marginBottom: 12, color: '#374151' }}>
              {tenants.length === 1
                ? '✅ 1 tenant retornado — RLS funcionando corretamente'
                : `⚠️ ${tenants.length} tenant(s) retornado(s) — verifique as policies`}
            </p>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  {['id', 'name', 'legal_name', 'plan', 'billing_status', 'created_at'].map((col) => (
                    <th
                      key={col}
                      style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id}>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 12 }}>
                      {t.id.slice(0, 8)}…
                    </td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>{t.name}</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>{t.legal_name}</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>{t.plan}</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>{t.billing_status}</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 12 }}>
                      {new Date(t.created_at!).toLocaleString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  )
}
