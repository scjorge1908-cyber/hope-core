import QRCode from 'qrcode'
import { Titulo } from '../titulo'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { dataBR } from '@/lib/financeiro/format'
import { MESES, processarRelatorio, type BaseRpaLegado } from '@/lib/financeiro/rpa-legado'
import { gerarPixCopiaECola, normalizarChavePix, type ChavePix } from '@/lib/financeiro/pix-brcode'
import {
  competenciaDe,
  janelaExtrato,
  sugerirPix,
  txidRepasse,
  type LinhaOk,
  type Sugestao,
  type TransacaoExtrato,
} from '@/lib/financeiro/repasse-pagamentos'
import type { RepassePagamentoRow } from '@/lib/financeiro/db-types'
import { BotaoImprimir } from '../repasse/botao-imprimir'
import { CopiarPix } from './copiar-pix'
import { desfazerPago, marcarPago } from './actions'
import s from '../financeiro.module.css'
import r from '../repasse/relatorio.module.css'
import p from './pagamentos.module.css'

const NOMES_MES: Record<string, string> = {
  JANEIRO: 'Janeiro', FEVEREIRO: 'Fevereiro', MARCO: 'Março', ABRIL: 'Abril', MAIO: 'Maio', JUNHO: 'Junho',
  JULHO: 'Julho', AGOSTO: 'Agosto', SETEMBRO: 'Setembro', OUTUBRO: 'Outubro', NOVEMBRO: 'Novembro', DEZEMBRO: 'Dezembro',
}

const CIDADE_PIX = 'PALHOCA'
const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const FORMA: Record<RepassePagamentoRow['forma'], string> = {
  pix_qrcode: 'QR Code Pix',
  pix_copia_cola: 'Pix copia e cola',
  extrato: 'Pix do extrato (Cora)',
  outro: 'Outro',
}

type Situacao = 'pago' | 'pendente' | 'sem_valor'

type Linha = {
  d: LinhaOk
  valor: number
  situacao: Situacao
  pagamento: RepassePagamentoRow | null
  chave: ChavePix
  pix: { codigo: string; svg: string } | null
  pixErro: string | null
  sugestao: Sugestao | null
  extratoDoPago: TransacaoExtrato | null
}

export default async function PagamentosPage({ searchParams }: PageProps<'/financeiro/pagamentos'>) {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return null

  const sp = await searchParams
  const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  // padrão: o mês anterior (o repasse de setembro é pago em outubro)
  const anterior = new Date(agoraSP.getFullYear(), agoraSP.getMonth() - 1, 1)
  const mes = MESES.includes(String(sp.mes) as (typeof MESES)[number]) ? String(sp.mes) : MESES[anterior.getMonth()]
  const ano = /^\d{4}$/.test(String(sp.ano)) ? String(sp.ano) : String(anterior.getFullYear())
  const filtro = sp.situacao === 'pendentes' || sp.situacao === 'pagos' ? sp.situacao : 'todos'
  const competencia = competenciaDe(mes, ano)
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const voltar = `/financeiro/pagamentos?mes=${mes}&ano=${ano}&situacao=${filtro}`
  const okMsg = typeof sp.ok === 'string' ? sp.ok : null
  const erroMsg = typeof sp.erro === 'string' ? sp.erro : null

  // 1) valores a pagar = cálculo do RPA (mesma função do relatório "Apenas Valor a Pagar")
  let erro: string | null = null
  let resultado: ReturnType<typeof processarRelatorio> | null = null
  const { data: base, error: erroBase } = await supabase.rpc('legacy_rpa_base')
  if (erroBase) erro = erroBase.message
  else {
    try {
      resultado = processarRelatorio(base as unknown as BaseRpaLegado, mes, ano)
    } catch (e) {
      erro = (e as Error).message
    }
  }
  const comErro = (resultado?.relatorioFinal.filter((d) => d.erro) ?? []) as Extract<
    NonNullable<typeof resultado>['relatorioFinal'][number],
    { erro: true }
  >[]
  const ok = (resultado?.relatorioFinal.filter((d) => !d.erro) ?? []) as LinhaOk[]

  // 2) o que já foi marcado como pago neste mês
  const { data: pagamentosRaw, error: erroPag } = await supabase
    .from('repasse_pagamentos')
    .select('*')
    .eq('competencia', competencia)
  const tabelaFalta = !!erroPag
  const pagamentos = new Map((pagamentosRaw ?? []).map((x) => [x.spreadsheet_id, x]))

  // 3) Pix de saída do extrato do Cora na janela de pagamento
  const janela = janelaExtrato(competencia)
  const { data: txRaw } = await supabase
    .from('bank_transactions')
    .select('id, occurred_on, amount, counterparty_name, counterparty_doc, transaction_type')
    .eq('kind', 'saida')
    .eq('ignored', false)
    .gte('occurred_on', janela.de)
    .lte('occurred_on', janela.ate)
    .order('occurred_on')
  const transacoes = (txRaw ?? []).map((t) => ({ ...t, amount: Number(t.amount) })) as TransacaoExtrato[]
  const txPorId = new Map(transacoes.map((t) => [t.id, t]))

  // Pix já vinculados a qualquer pagamento (qualquer mês) não são sugeridos de novo
  const usadas = new Set<string>()
  if (transacoes.length && !tabelaFalta) {
    const { data: vinculos } = await supabase
      .from('repasse_pagamentos')
      .select('bank_transaction_id')
      .eq('pago', true)
      .in('bank_transaction_id', transacoes.map((t) => t.id))
    for (const v of vinculos ?? []) if (v.bank_transaction_id) usadas.add(v.bank_transaction_id)
  }

  const linhas: Linha[] = []
  for (const d of ok) {
    const valor = Number(d.valorLiquido) || 0
    const pg = pagamentos.get(d.id) ?? null
    const pago = !!pg?.pago
    const situacao: Situacao = pago ? 'pago' : valor > 0 ? 'pendente' : 'sem_valor'
    const chave = normalizarChavePix(d.pixKey)
    let pix: Linha['pix'] = null
    let pixErro: string | null = null
    if (situacao === 'pendente') {
      if (!chave.ok) pixErro = chave.erro
      else {
        try {
          const codigo = gerarPixCopiaECola({
            chave: chave.chave,
            nome: d.nome,
            cidade: CIDADE_PIX,
            valor,
            txid: txidRepasse(competencia, d.id),
            descricao: `Repasse ${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`,
          })
          const svg = await QRCode.toString(codigo, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', width: 220 })
          pix = { codigo, svg }
        } catch (e) {
          pixErro = (e as Error).message
        }
      }
    }
    const sugestao =
      situacao === 'pendente' || (pago && !pg?.bank_transaction_id)
        ? sugerirPix(d.nome, pago ? Number(pg!.valor_pago) : valor, transacoes, usadas)
        : null
    if (sugestao) usadas.add(sugestao.transacao.id) // não oferecer o mesmo Pix a duas psicólogas
    const extratoDoPago = pg?.bank_transaction_id ? (txPorId.get(pg.bank_transaction_id) ?? null) : null
    linhas.push({ d, valor, situacao, pagamento: pg, chave, pix, pixErro, sugestao, extratoDoPago })
  }

  const aPagar = linhas.filter((l) => l.valor > 0 || l.situacao === 'pago')
  const totalCalculado = aPagar.reduce((t, l) => t + l.valor, 0)
  const totalPago = linhas.filter((l) => l.situacao === 'pago').reduce((t, l) => t + Number(l.pagamento!.valor_pago), 0)
  const totalPendente = linhas.filter((l) => l.situacao === 'pendente').reduce((t, l) => t + l.valor, 0)
  const qtdPagos = linhas.filter((l) => l.situacao === 'pago').length
  const qtdPendentes = linhas.filter((l) => l.situacao === 'pendente').length
  const qtdConfirmados = linhas.filter((l) => l.situacao === 'pago' && l.pagamento?.bank_transaction_id).length

  const visiveis = linhas.filter((l) =>
    filtro === 'pendentes' ? l.situacao === 'pendente' : filtro === 'pagos' ? l.situacao === 'pago' : l.situacao !== 'sem_valor'
  )
  const semValor = linhas.filter((l) => l.situacao === 'sem_valor')

  return (
    <>
      <div className={r.naoImprimir}>
        <Titulo titulo="Pagamentos de repasse">
          Os valores são os mesmos do relatório “Apenas Valor a Pagar (Líquido)” do RPA, calculados sobre a cópia das
          planilhas. Para pagar: abra o app do Cora → Pix → Pagar com QR Code e aponte para o QR da psicóloga (ou use
          “Copiar Pix” e cole em Pix Copia e Cola). Confira o nome que o banco mostra, autorize e clique em “Marcar como
          pago”. Quando o extrato do Cora já tiver o Pix, aparece o botão para vincular — fica confirmado pelo banco.
        </Titulo>

        <form className={s.form} style={{ maxWidth: 760, marginBottom: 20 }}>
          <div className={s.formRow}>
            <label className={s.field}>
              Mês do repasse (competência)
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
              Mostrar
              <select name="situacao" defaultValue={filtro}>
                <option value="todos">Todos</option>
                <option value="pendentes">Só não pagos</option>
                <option value="pagos">Só pagos</option>
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className={s.button}>Atualizar</button>
            <BotaoImprimir />
          </div>
        </form>

        {okMsg && <div className={s.alertGood}>{okMsg}</div>}
        {erroMsg && <div className={s.alertBad}>Erro: {erroMsg}</div>}
        {erro && <div className={s.alertBad}>Erro ao calcular o repasse: {erro}</div>}
        {tabelaFalta && (
          <div className={s.alertWarn}>
            O registro de pagamentos ainda não está ativo no banco (falta aplicar a migration 028). Os QR Codes funcionam,
            mas “Marcar como pago” só grava depois disso.
          </div>
        )}
        {comErro.length > 0 && (
          <div className={s.alertWarn}>
            Sem cálculo (planilha com erro na última leitura): {comErro.map((x) => `${x.nome} — ${x.msg}`).join(' · ')}
          </div>
        )}

        <div className={s.cards}>
          <div className={s.cardInfo}>
            <div className={s.cardLabel}>Total a pagar · {NOMES_MES[mes]}/{ano}</div>
            <div className={s.cardValue}>{brl(totalCalculado)}</div>
          </div>
          <div className={s.cardGood}>
            <div className={s.cardLabel}>Pago ({qtdPagos})</div>
            <div className={s.cardValue}>{brl(totalPago)}</div>
          </div>
          <div className={qtdPendentes ? s.cardWarn : s.cardGood}>
            <div className={s.cardLabel}>Falta pagar ({qtdPendentes})</div>
            <div className={s.cardValue}>{brl(totalPendente)}</div>
          </div>
          <div className={s.cardInfo}>
            <div className={s.cardLabel}>Confirmados no extrato</div>
            <div className={s.cardValue}>
              {qtdConfirmados} de {qtdPagos}
            </div>
          </div>
        </div>

        {visiveis.length === 0 && resultado && (
          <p className={s.muted} style={{ marginBottom: 24 }}>
            {filtro === 'pendentes' ? 'Nenhum repasse pendente neste mês. 🎉' : 'Nada para mostrar com este filtro.'}
          </p>
        )}

        <div className={p.lista}>
          {visiveis.map((l) => (
            <article
              key={l.d.id}
              id={`psi-${l.d.id}`}
              className={l.situacao === 'pago' ? p.itemPago : p.item}
            >
              <div className={p.info}>
                <div className={p.cabecalho}>
                  <h3 className={p.nome}>{l.d.nome}</h3>
                  <span className={l.d.isIsenta ? s.badgeInfo : s.badge}>{l.d.isIsenta ? 'CNPJ' : 'PF'}</span>
                  {l.situacao === 'pago' ? <span className={s.badgeGood}>Pago</span> : <span className={s.badgeWarn}>A pagar</span>}
                </div>

                <div className={p.valor}>{brl(l.valor)}</div>

                <div className={p.detalhe}>
                  ✅ Pacientes OK: {l.d.qtdPacientes || 0}
                  <br />
                  {l.d.isIsenta ? (
                    <>
                      Faturamento bruto {brl(l.d.totalFaturamento)} × {l.d.percentualIsenta}% (sem INSS)
                    </>
                  ) : (
                    <>
                      Base RPA {brl(l.d.repasseBruto)} − INSS {brl(l.d.retencaoInss)}
                      {l.d.qtdSessoes33 > 0 && (
                        <>
                          <br />• Demais sessões (40%): {brl(l.d.comissaoPadrao)}
                          <br />• {l.d.qtdSessoes33} sessão(ões) de R$ 33 Unimed (R$ 18,00 cada): {brl(l.d.comissaoSessoes33)}
                        </>
                      )}
                    </>
                  )}
                  <br />
                  🔑 Chave Pix: {l.d.pixKey ? <code>{String(l.d.pixKey)}</code> : 'não informada'}
                  {l.chave.ok && <span className={p.tipoChave}> ({l.chave.rotulo})</span>}
                </div>

                {l.d.qtdSessoes33SemUnimed > 0 && (
                  <div className={p.alerta}>
                    ⚠️ {l.d.qtdSessoes33SemUnimed} sessão(ões) de R$ 33 sem plano Unimed — calculadas a 40%. Conferir.
                  </div>
                )}
                {l.d.qtdPendencias > 0 && (
                  <div className={p.alerta}>
                    ⚠️ {l.d.qtdPendencias} sessão{l.d.qtdPendencias !== 1 ? 'ões' : ''} sem status na planilha (fora deste valor)
                  </div>
                )}

                {l.situacao === 'pago' && l.pagamento && (
                  <div className={p.pago}>
                    <strong>Pago {brl(Number(l.pagamento.valor_pago))}</strong>
                    {l.pagamento.data_pagamento && <> em {dataBR(l.pagamento.data_pagamento)}</>} · {FORMA[l.pagamento.forma]}
                    {l.extratoDoPago ? (
                      <div className={p.confirmado}>
                        ✔ Confirmado no extrato: Pix de {brl(l.extratoDoPago.amount)} para {l.extratoDoPago.counterparty_name} em{' '}
                        {dataBR(l.extratoDoPago.occurred_on)}
                      </div>
                    ) : l.pagamento.bank_transaction_id ? (
                      <div className={p.confirmado}>✔ Confirmado no extrato</div>
                    ) : null}
                    {Math.abs(Number(l.pagamento.valor_pago) - l.valor) > 0.01 && (
                      <div className={p.alerta}>
                        ⚠️ O cálculo atual do RPA é {brl(l.valor)} — diferença de {brl(l.valor - Number(l.pagamento.valor_pago))}{' '}
                        (a planilha mudou depois do pagamento).
                      </div>
                    )}
                  </div>
                )}

                {l.sugestao && (
                  <form action={marcarPago} className={l.sugestao.valorConfere ? p.sugestao : p.sugestaoDivergente}>
                    <input type="hidden" name="voltar" value={voltar} />
                    <input type="hidden" name="ancora" value={`#psi-${l.d.id}`} />
                    <input type="hidden" name="spreadsheetId" value={l.d.id} />
                    <input type="hidden" name="competencia" value={competencia} />
                    <input type="hidden" name="nome" value={l.d.nome} />
                    <input type="hidden" name="tipo" value={l.d.isIsenta ? 'CNPJ' : 'PF'} />
                    <input type="hidden" name="bankTx" value={l.sugestao.transacao.id} />
                    <span>
                      🏦 {l.situacao === 'pago' ? 'Pix no extrato' : 'Já existe um Pix no extrato'}:{' '}
                      <strong>{brl(l.sugestao.transacao.amount)}</strong> para {l.sugestao.transacao.counterparty_name} em{' '}
                      {dataBR(l.sugestao.transacao.occurred_on)}
                      {!l.sugestao.valorConfere && <> — valor diferente do calculado</>}
                    </span>
                    <button className={s.buttonSmall}>
                      {l.situacao === 'pago' ? 'Vincular ao extrato' : 'Marcar como pago com este Pix'}
                    </button>
                  </form>
                )}

                {l.situacao === 'pago' && l.pagamento && (
                  <form action={desfazerPago} className={p.desfazer}>
                    <input type="hidden" name="voltar" value={voltar} />
                    <input type="hidden" name="ancora" value={`#psi-${l.d.id}`} />
                    <input type="hidden" name="id" value={l.pagamento.id} />
                    <button className={p.botaoLink}>Desfazer “pago”</button>
                  </form>
                )}
              </div>

              {l.situacao === 'pendente' && (
                <div className={p.qrPainel}>
                  {l.pix ? (
                    <>
                      <div className={p.qr} dangerouslySetInnerHTML={{ __html: l.pix.svg }} aria-label={`QR Code Pix de ${brl(l.valor)} para ${l.d.nome}`} />
                      <div className={p.qrValor}>{brl(l.valor)}</div>
                      <CopiarPix codigo={l.pix.codigo} />
                    </>
                  ) : (
                    <div className={p.semQr}>Sem QR Code: {l.pixErro}</div>
                  )}

                  <form action={marcarPago} className={p.formPago}>
                    <input type="hidden" name="voltar" value={voltar} />
                    <input type="hidden" name="ancora" value={`#psi-${l.d.id}`} />
                    <input type="hidden" name="spreadsheetId" value={l.d.id} />
                    <input type="hidden" name="competencia" value={competencia} />
                    <input type="hidden" name="nome" value={l.d.nome} />
                    <input type="hidden" name="tipo" value={l.d.isIsenta ? 'CNPJ' : 'PF'} />
                    <input type="hidden" name="valor" value={l.valor.toFixed(2)} />
                    <label className={p.campoPequeno}>
                      Pago em
                      <input type="date" name="data" defaultValue={hoje} max={hoje} required />
                    </label>
                    <label className={p.campoPequeno}>
                      Como
                      <select name="forma" defaultValue={l.pix ? 'pix_qrcode' : 'outro'}>
                        <option value="pix_qrcode">QR Code</option>
                        <option value="pix_copia_cola">Copia e cola</option>
                        <option value="outro">Outro</option>
                      </select>
                    </label>
                    <button className={s.button}>✓ Marcar como pago</button>
                  </form>
                </div>
              )}
            </article>
          ))}
        </div>

        {semValor.length > 0 && filtro !== 'pagos' && (
          <p className={s.muted} style={{ fontSize: 13, margin: '8px 0 24px' }}>
            Sem valor a pagar neste mês: {semValor.map((l) => l.d.nome).join(', ')}.
          </p>
        )}
      </div>

      {/* ---------------- RELATÓRIO: pagos × não pagos (é o que sai na impressão) ---------------- */}
      {resultado && (
        <div className={r.relatorio} style={{ marginTop: 8 }}>
          <h1>
            Controle de pagamento do repasse - {mes}/{ano}
          </h1>
          <p style={{ fontSize: 11, color: '#666', marginTop: 0 }}>
            Valor a pagar = relatório “Apenas Valor a Pagar (Líquido)” do RPA. Emitido em{' '}
            {new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.
          </p>
          <div className={p.tabelaRolagem}>
            <table>
              <thead>
                <tr>
                  <th>Profissional</th>
                  <th>Tipo</th>
                  <th className={r.valor}>A pagar</th>
                  <th>Situação</th>
                  <th>Data</th>
                  <th>Forma</th>
                  <th className={r.valor}>Valor pago</th>
                  <th>Extrato Cora</th>
                </tr>
              </thead>
              <tbody>
                {aPagar.map((l) => {
                  const pg = l.situacao === 'pago' ? l.pagamento : null
                  const diverge = pg && Math.abs(Number(pg.valor_pago) - l.valor) > 0.01
                  return (
                    <tr key={l.d.id}>
                      <td style={{ fontWeight: 'bold' }}>{l.d.nome}</td>
                      <td>{l.d.isIsenta ? 'CNPJ' : 'PF'}</td>
                      <td className={r.valor}>{brl(l.valor)}</td>
                      <td style={{ color: pg ? '#2e7d32' : '#dc3545', fontWeight: 'bold' }}>{pg ? 'PAGO' : 'NÃO PAGO'}</td>
                      <td>{pg?.data_pagamento ? dataBR(pg.data_pagamento) : '—'}</td>
                      <td>{pg ? FORMA[pg.forma] : '—'}</td>
                      <td className={r.valor} style={diverge ? { color: '#dc3545' } : undefined}>
                        {pg ? brl(Number(pg.valor_pago)) : '—'}
                        {diverge && ' ⚠️'}
                      </td>
                      <td>{pg?.bank_transaction_id ? '✔ confirmado' : pg ? 'não vinculado' : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className={r.total}>
            <span>TOTAL A PAGAR:</span>
            <span>{brl(totalCalculado)}</span>
          </div>
          <div className={r.total} style={{ borderTop: 'none', marginTop: 4, paddingTop: 0 }}>
            <span>PAGO ({qtdPagos}):</span>
            <span>{brl(totalPago)}</span>
          </div>
          <div className={r.total} style={{ borderTop: 'none', marginTop: 4, paddingTop: 0, color: totalPendente > 0 ? '#dc3545' : undefined }}>
            <span>FALTA PAGAR ({qtdPendentes}):</span>
            <span>{brl(totalPendente)}</span>
          </div>
        </div>
      )}
    </>
  )
}
