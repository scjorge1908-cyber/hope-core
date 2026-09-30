import b from './bi.module.css'

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null

/** Mostra quando os dados chegaram das planilhas e avisa se a Agenda/Cancelados ainda não foram enviados. */
export function AvisoSync({ sync, precisaAgenda = true }: { sync: { atendimentos: string | null; agenda: string | null; bdGuias: string | null }; precisaAgenda?: boolean }) {
  if (precisaAgenda && !sync.agenda) {
    return (
      <div className={b.aviso}>
        <strong>A Agenda e os Cancelados das psicólogas ainda não chegaram ao HOPE CORE.</strong> Os números que dependem deles (pacientes
        ativos, novos, cancelamentos, planos, perfil, horas livres) ficam zerados até a primeira sincronização. Para ligar: no projeto
        Apps Script <b>Calculo RPA</b>, atualize o arquivo <code>SyncSupabase.gs</code> com a versão nova, salve e rode{' '}
        <code>sincronizarPlanilhasSupabase</code> (ou use o botão Sincronizar planilhas). Atendimentos e guias já estão valendo.
      </div>
    )
  }
  return (
    <p style={{ fontSize: 12, color: 'var(--fin-muted)', margin: '0 0 14px' }}>
      Planilhas: atendimentos {quando(sync.atendimentos) ?? '—'} · agenda/cancelados {quando(sync.agenda) ?? '—'} · Registro de Guias{' '}
      {quando(sync.bdGuias) ?? '—'}
    </p>
  )
}
