import { Titulo } from '../../financeiro/titulo'
import b from '../bi.module.css'

export const metadata = { title: 'Agenda paciente — HOPE CORE' }
export const dynamic = 'force-dynamic'

/**
 * Fase 1: a agenda de pacientes (agendar, editar, fila de espera,
 * transferir, dar alta) continua no Hope Painel do Apps Script, aberto
 * aqui dentro. URL da implantação em HOPE_BI_URL (variável do Vercel).
 */
export default function AgendaPaciente() {
  const url = process.env.HOPE_BI_URL ? `${process.env.HOPE_BI_URL}?page=painel` : null
  return (
    <div className={b.pagina}>
      <Titulo titulo="Agenda paciente">
        <strong>Hope Painel — agendar, editar paciente, fila de espera, transferir e dar alta.</strong> Nesta primeira fase ele continua
        rodando no Apps Script (grava direto nas planilhas das psicólogas) e aparece aqui dentro do HOPE CORE.
      </Titulo>
      {url ? (
        <iframe src={url} title="Hope Painel — Agenda Paciente" className={b.iframe} style={{ height: '85vh' }} />
      ) : (
        <div className={b.aviso}>
          Falta a URL do Sistema Gerencial e BI (Apps Script). No Vercel, crie a variável <code>HOPE_BI_URL</code> com o endereço da
          implantação que termina em <code>/exec</code> e faça um novo deploy.
        </div>
      )}
    </div>
  )
}
