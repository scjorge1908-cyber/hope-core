import { requireFinanceAccess } from '@/lib/financeiro/server'
import { ImportForm } from './import-form'
import s from '../financeiro.module.css'

export default async function ImportarPage() {
  const { allowed } = await requireFinanceAccess()
  if (!allowed) return null

  return (
    <>
      <h1 className={s.pageTitle}>Importar XML da operadora</h1>
      <p className={s.lead}>
        Aceita o Demonstrativo de Análise de Conta no padrão TISS (o XML “ANALITICA … DETALHADO” da Unimed). Pode enviar
        vários de uma vez e em qualquer ordem. O mesmo arquivo nunca entra duas vezes, e uma sessão que reaparece em outro
        demonstrativo é atualizada, não duplicada. Nome, carteirinha e senha do paciente ficam criptografados no banco.
      </p>
      <ImportForm />
    </>
  )
}
