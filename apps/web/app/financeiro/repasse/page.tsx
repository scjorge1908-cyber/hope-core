import { requireFinanceAccess } from '@/lib/financeiro/server'
import { dataBR } from '@/lib/financeiro/format'
import { MESES, processarRelatorio, type BaseRpaLegado, type LinhaRelatorio, type TipoRelatorio } from '@/lib/financeiro/rpa-legado'
import { BotaoImprimir } from './botao-imprimir'
import { BotaoSincronizar } from '../sincronizar/botao-sincronizar'
import s from '../financeiro.module.css'
import r from './relatorio.module.css'

const NOMES_MES: Record<string, string> = {
  JANEIRO: 'Janeiro', FEVEREIRO: 'Fevereiro', MARCO: 'Março', ABRIL: 'Abril', MAIO: 'Maio', JUNHO: 'Junho',
  JULHO: 'Julho', AGOSTO: 'Agosto', SETEMBRO: 'Setembro', OUTUBRO: 'Outubro', NOVEMBRO: 'Novembro', DEZEMBRO: 'Dezembro',
}

// Mesmas formatações do gerarPDFNoDrive() do Apps Script
const f2 = (v: number) => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fMin2 = (v: number) => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

type Ok = Extract<LinhaRelatorio, { erro: false }>

export default async function RepassePage({ searchParams }: PageProps<'/financeiro/repasse'>) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return null

  const sp = await searchParams
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const mes = MESES.includes(String(sp.mes) as (typeof MESES)[number]) ? String(sp.mes) : MESES[agora.getMonth()]
  const ano = /^\d{4}$/.test(String(sp.ano)) ? String(sp.ano) : String(agora.getFullYear())
  const tipo: TipoRelatorio = sp.tipo === 'RPA' || sp.tipo === 'PAGAR' ? sp.tipo : 'COMPLETO'
  const gerar = sp.gerar === '1'

  const { data: status } = await supabase.rpc('legacy_sync_status')

  let resultado: ReturnType<typeof processarRelatorio> | null = null
  let erro: string | null = null
  if (gerar) {
    const { data, error } = await supabase.rpc('legacy_rpa_base')
    if (error) erro = error.message
    else {
      try {
        resultado = processarRelatorio(data as unknown as BaseRpaLegado, mes, ano)
      } catch (e) {
        erro = (e as Error).message
      }
    }
  }

  const ok = (resultado?.relatorioFinal.filter((d) => !d.erro) ?? []) as Ok[]
  const dadosRPA = ok.filter((d) => !d.isIsenta)
  const totalBaseRPA = dadosRPA.reduce((t, d) => t + (d.repasseBruto || 0), 0)
  const totalLiquido = ok.reduce((t, d) => t + d.valorLiquido, 0)
  const temIsenta = resultado?.relatorioFinal.some((d) => !d.erro && d.isIsenta) ?? false
  const ultimaSync = (status ?? []).map((x) => x.ultima_sincronizacao).filter(Boolean).sort().at(-1) ?? null

  return (
    <>
      <div className={r.naoImprimir}>
        <h1 className={s.pageTitle}>Repasse das psicólogas (RPA)</h1>
        <p className={s.lead}>
          Mesma regra e mesmo cálculo do Sistema Mestre RPA, sobre a cópia das planilhas no banco: mês pela coluna A
          (registro), valor da coluna N, status da coluna S (“OK” conta, vazio é pendência, outro texto é ignorado); PF
          40% com INSS de 11% até o teto; CNPJ com o percentual da aba ExencaoCNPJ (padrão 45%), sem INSS.
        </p>

        <form className={s.form} style={{ maxWidth: 720, marginBottom: 20 }}>
          <div className={s.formRow}>
            <label className={s.field}>
              Mês
              <select name="mes" defaultValue={mes}>
                {MESES.map((m) => (
                  <option key={m} value={m}>
                    {NOMES_MES[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className={s.field}>
              Ano
              <input name="ano" type="number" defaultValue={ano} min={2020} max={2100} />
            </label>
            <label className={s.field}>
              Tipo de relatório
              <select name="tipo" defaultValue={tipo}>
                <option value="COMPLETO">Completo (RPA + Pagar)</option>
                <option value="RPA">Apenas RPA (Impostos)</option>
                <option value="PAGAR">Apenas Valor a Pagar (Líquido)</option>
              </select>
            </label>
          </div>
          <input type="hidden" name="gerar" value="1" />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className={s.button}>Gerar relatório</button>
            {resultado && <BotaoImprimir />}
          </div>
        </form>

        <p className={s.muted} style={{ fontSize: 13, marginBottom: 16 }}>
          Dados das planilhas atualizados em: <strong>{ultimaSync ? new Date(ultimaSync).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'nunca sincronizado'}</strong>
          {' '}— a cópia é atualizada de hora em hora pelo Apps Script do Calculo RPA.
        </p>

        {erro && <div className={s.alertBad}>Erro: {erro}</div>}

        {resultado && (
          <details className={s.section} style={{ paddingBottom: 12 }}>
            <summary>Log do processamento ({resultado.logs.length})</summary>
            <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{resultado.logs.join('\n')}</pre>
          </details>
        )}
      </div>

      {resultado && (
        <div className={r.relatorio}>
          {(tipo === 'RPA' || tipo === 'COMPLETO') && (
            <section>
              <h1>
                Relatório RPA - {mes}/{ano}
              </h1>
              <p style={{ fontSize: 12 }}>Bases para cálculo do INSS</p>
              <table>
                <thead>
                  <tr>
                    <th className={r.nome}>Nome</th>
                    <th className={r.valor}>Base RPA</th>
                  </tr>
                </thead>
                <tbody>
                  {dadosRPA.map((d) => (
                    <tr key={d.id}>
                      <td className={r.nome}>
                        {d.nome}
                        <div className={r.sub}>Pacientes: {d.qtdPacientes || 0} (ok)</div>
                        <div className={r.subAlerta}>Pendências: {d.qtdPendencias || 0}</div>
                      </td>
                      <td className={r.valor}>R$ {f2(d.repasseBruto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={r.total}>
                <span>TOTAL BASES RPA:</span>
                <span>R$ {fMin2(totalBaseRPA)}</span>
              </div>
              {temIsenta && <p style={{ fontSize: 11, color: '#666', marginTop: 10 }}>(*): Profissionais isentas não aparecem nesta lista.</p>}
            </section>
          )}

          {tipo === 'COMPLETO' && <div className={r.quebra} />}

          {(tipo === 'PAGAR' || tipo === 'COMPLETO') && (
            <section>
              <h1>
                Relatório de Pagamento - {mes}/{ano}
              </h1>
              <p style={{ fontSize: 12, marginBottom: 5 }}>
                📋 <strong>Legenda:</strong>
              </p>
              <p style={{ fontSize: 11, color: '#666', marginTop: 0 }}>
                • <strong>Pessoa Física (PF):</strong> Repasse de 40% do faturamento com desconto de INSS (11%)
                <br />• <strong>Pessoa Jurídica (CNPJ):</strong> Repasse do percentual individual cadastrado por psicóloga,{' '}
                <strong>SEM desconto de INSS</strong>
                <br />• ⚠️ Pendências: sessões sem status definido (em branco)
              </p>
              <table>
                <thead>
                  <tr>
                    <th className={r.nome}>Profissional</th>
                    <th className={r.valor}>Valor Líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {ok.map((d) => (
                    <tr key={d.id}>
                      <td className={r.nome}>
                        <strong>{d.nome}</strong>
                        <div className={r.sub} style={{ marginTop: 5 }}>
                          ✅ Pacientes OK: {d.qtdPacientes || 0}
                          <br />
                          {d.isIsenta ? (
                            <>
                              <span style={{ color: '#004d40', fontWeight: 'bold' }}>
                                CNPJ - Repasse de {d.percentualIsenta}% (sem INSS)
                              </span>
                              <br />
                              Faturamento bruto: R$ {fMin2(d.totalFaturamento)}
                              <br />
                              <span style={{ color: '#2e7d32' }}>
                                Valor a receber ({d.percentualIsenta}%): R$ {fMin2(d.valorLiquido)}
                              </span>
                            </>
                          ) : (
                            <>
                              Base RPA (40%): R$ {fMin2(d.repasseBruto)}
                              <br />
                              INSS (11%): R$ {fMin2(d.retencaoInss)}
                              <br />
                              <span style={{ color: '#2e7d32' }}>Valor líquido: R$ {fMin2(d.valorLiquido)}</span>
                            </>
                          )}
                          <br />
                          🔑 Chave Pix: {d.pixKey ? d.pixKey : 'não informada'}
                          <br />
                          {d.qtdPendencias > 0 && (
                            <span style={{ color: '#dc3545' }}>
                              ⚠️ Pendência: {d.qtdPendencias} sessão{d.qtdPendencias !== 1 ? 's' : ''} sem status
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={r.valor}>R$ {f2(d.valorLiquido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={r.total}>
                <span>TOTAL GERAL A PAGAR:</span>
                <span>R$ {fMin2(totalLiquido)}</span>
              </div>
            </section>
          )}
        </div>
      )}

      <section className={`${s.section} ${r.naoImprimir}`} style={{ marginTop: 24 }}>
        <h2 className={s.sectionTitle}>Sincronização das planilhas</h2>
        <p className={s.sectionNote}>Psicólogas da aba ID do Calculo RPA, na mesma ordem.</p>
        <BotaoSincronizar />
        {!status?.length ? (
          <p className={s.muted} style={{ fontSize: 14, marginBottom: 10 }}>
            Nenhuma planilha recebida ainda. Clique em “Sincronizar planilhas” (ou rode <code>sincronizarPlanilhasSupabase()</code> no Apps Script do Calculo RPA).
          </p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Psicóloga</th>
                  <th className={s.num}>Linhas</th>
                  <th>Última leitura</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {status.map((x) => (
                  <tr key={x.spreadsheet_id}>
                    <td>{x.nome}</td>
                    <td className={s.num}>{x.total_linhas}</td>
                    <td>
                      {x.ultima_sincronizacao
                        ? `${dataBR(new Date(x.ultima_sincronizacao).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }))} ${new Date(x.ultima_sincronizacao).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}`
                        : '—'}
                    </td>
                    <td>
                      {x.ultimo_erro ? (
                        <span className={s.badgeBad} title={x.ultimo_erro}>
                          Erro: {x.ultimo_erro.slice(0, 60)}
                        </span>
                      ) : x.ultima_sincronizacao ? (
                        <span className={s.badgeGood}>OK</span>
                      ) : (
                        <span className={s.badgeWarn}>Aguardando</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
