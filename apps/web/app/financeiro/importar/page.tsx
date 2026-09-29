import { requireFinanceAccess } from '@/lib/financeiro/server'
import { ImportForm } from './import-form'
import s from '../financeiro.module.css'

// Vale para a Server Action de importação desta página: até 12 arquivos,
// cada um gravado numa transação própria no banco (limite de 60 s por
// arquivo na função import_claim_statement — migration 007).
export const maxDuration = 60

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
