// =======================================================
// SYNC SUPABASE — Ponte planilhas das psicólogas → HOPE CORE
// Arquivo NOVO do projeto "Calculo RPA". Não altera nenhuma
// função existente (todas as funções aqui começam com "sync"
// ou terminam com "Supabase").
//
// O que faz:
//   Lê a aba "ID" desta planilha (mesma lista do Sistema Mestre RPA),
//   abre a planilha de cada psicóloga, copia a aba "Atendimentos"
//   INTEIRA (cabeçalho + linhas, como estão), o nome (DadosPsi!B2) e a
//   chave Pix (DadosPsi!O2) e envia ao Supabase. Envia também a aba
//   "ExencaoCNPJ" e a lista/ordem atual da aba "ID".
//   No banco, cada envio SUBSTITUI a cópia anterior (espelho) — nunca
//   duplica. Com isso o HOPE CORE calcula o repasse com a MESMA regra
//   do Sistema Mestre RPA.
//
// Configuração (uma vez só):
//   Configurações do projeto (engrenagem) → Propriedades do script:
//     SUPABASE_URL       = https://wqktlmcsfytfwquungey.supabase.co
//     SUPABASE_ANON_KEY  = chave anon pública do projeto
//     HOPE_SYNC_TOKEN    = token enviado pelo Claude (NÃO colar no código)
//   Depois: rode verificarConfiguracaoSupabase(), depois
//   sincronizarPlanilhasSupabase() (1ª vez pede autorização),
//   e por fim instalarGatilhoSupabase() para rodar de hora em hora.
// =======================================================

const SYNC_ABA_ID = 'ID';
const SYNC_ABA_ATENDIMENTOS = 'Atendimentos';
const SYNC_FUSO = 'America/Sao_Paulo';
const SYNC_LIMITE_MS = 4.5 * 60 * 1000; // Apps Script para em 6 min; paramos antes
const SYNC_PROP_CURSOR = 'SYNC_SUPABASE_CURSOR';

/** Executa a sincronização de todas as psicólogas (retoma de onde parou, se preciso). */
function sincronizarPlanilhasSupabase() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) {
    console.log('Outra sincronização já está rodando. Saindo.');
    return;
  }
  const inicio = Date.now();
  const props = PropertiesService.getScriptProperties();
  try {
    const cfg = syncLerConfiguracao_();
    const lista = syncListarPsicologas_();
    let cursor = Number(props.getProperty(SYNC_PROP_CURSOR) || 0);
    if (cursor >= lista.length) cursor = 0;

    const resumo = [];
    if (cursor === 0) {
      try {
        const n = syncEnviarExencoesELista_(cfg, lista);
        resumo.push(`✅ ExencaoCNPJ: ${n} linhas | aba ID: ${lista.length} psicólogas`);
      } catch (e) {
        resumo.push(`❌ ExencaoCNPJ/aba ID: ${e.message}`);
      }
      try {
        const s = syncEnviarSalas_(cfg);
        if (s !== null) resumo.push(`✅ Salas (Painel): ${s} linhas`);
      } catch (e) {
        resumo.push(`❌ Salas (Painel): ${e.message}`);
      }
    }
    for (let i = cursor; i < lista.length; i++) {
      if (Date.now() - inicio > SYNC_LIMITE_MS) {
        props.setProperty(SYNC_PROP_CURSOR, String(i));
        syncAgendarContinuacao_();
        console.log(`Tempo quase esgotado. Continua da psicóloga ${i + 1}/${lista.length} em 1 minuto.`);
        console.log(resumo.join('\n'));
        return;
      }
      const psi = lista[i];
      try {
        const n = syncEnviarPsicologa_(cfg, psi);
        resumo.push(`✅ ${psi.nomeAbreviado}: ${n} linhas`);
      } catch (e) {
        resumo.push(`❌ ${psi.nomeAbreviado}: ${e.message}`);
        syncReportarErro_(cfg, psi, e.message);
      }
    }

    props.deleteProperty(SYNC_PROP_CURSOR);
    syncRemoverContinuacoes_();
    console.log(`Sincronização concluída em ${Math.round((Date.now() - inicio) / 1000)} s\n` + resumo.join('\n'));
  } finally {
    lock.releaseLock();
  }
}

/** Sincroniza só uma psicóloga, pelo nome abreviado da aba ID (útil para teste). */
function sincronizarUmaSupabase(nomeAbreviado) {
  const cfg = syncLerConfiguracao_();
  const psi = syncListarPsicologas_().find(p => String(p.nomeAbreviado).trim() === String(nomeAbreviado).trim());
  if (!psi) throw new Error(`Psicóloga "${nomeAbreviado}" não encontrada na aba ID.`);
  const n = syncEnviarPsicologa_(cfg, psi);
  console.log(`✅ ${psi.nomeAbreviado}: ${n} linhas enviadas.`);
}

/** Confere se as 3 propriedades estão preenchidas e se o banco aceita o token. */
function verificarConfiguracaoSupabase() {
  const cfg = syncLerConfiguracao_();
  console.log('URL: ' + cfg.url);
  console.log('Chave anon: ' + (cfg.anonKey ? 'ok (' + cfg.anonKey.length + ' caracteres)' : 'FALTANDO'));
  console.log('Token: ' + (cfg.token ? 'ok (' + cfg.token.length + ' caracteres)' : 'FALTANDO'));
  const resp = syncChamarRpc_(cfg, 'legacy_ingest_sheet', {
    p_token: cfg.token,
    p: { spreadsheetId: 'invalido', linhas: [] }
  });
  // Esperado: o banco aceita o token e recusa o ID inválido de propósito.
  const texto = resp.getContentText();
  if (texto.indexOf('Token inválido') >= 0) throw new Error('O banco recusou o token. Confira HOPE_SYNC_TOKEN.');
  if (texto.indexOf('spreadsheetId inválido') >= 0) {
    console.log('✅ Conexão e token OK. Pode rodar sincronizarPlanilhasSupabase().');
    return;
  }
  throw new Error(`Resposta inesperada (${resp.getResponseCode()}): ${texto.slice(0, 300)}`);
}

/** Cria o gatilho de hora em hora (remove antes qualquer gatilho antigo desta função). */
function instalarGatilhoSupabase() {
  removerGatilhoSupabase();
  ScriptApp.newTrigger('sincronizarPlanilhasSupabase').timeBased().everyHours(1).create();
  console.log('✅ Gatilho instalado: sincronização a cada 1 hora.');
}

/** Remove todos os gatilhos desta sincronização. */
function removerGatilhoSupabase() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizarPlanilhasSupabase')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

// ---------------- funções internas ----------------

function syncLerConfiguracao_() {
  const p = PropertiesService.getScriptProperties();
  const cfg = {
    url: String(p.getProperty('SUPABASE_URL') || '').replace(/\/+$/, ''),
    anonKey: String(p.getProperty('SUPABASE_ANON_KEY') || ''),
    token: String(p.getProperty('HOPE_SYNC_TOKEN') || '')
  };
  if (!cfg.url || !cfg.anonKey || !cfg.token) {
    throw new Error('Configure SUPABASE_URL, SUPABASE_ANON_KEY e HOPE_SYNC_TOKEN em Propriedades do script.');
  }
  return cfg;
}

/** Mesma leitura da aba ID usada pelo Sistema Mestre RPA (coluna A = nome, B = ID). */
function syncListarPsicologas_() {
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SYNC_ABA_ID);
  if (!aba) throw new Error(`Aba "${SYNC_ABA_ID}" não encontrada.`);
  const ultima = aba.getLastRow();
  if (ultima < 2) return [];
  return aba.getRange(2, 1, ultima - 1, 2).getValues()
    .filter(r => r[1])
    .map(r => ({ nomeAbreviado: String(r[0] || '').trim(), id: String(r[1]).trim() }));
}

function syncEnviarPsicologa_(cfg, psi) {
  const ss = SpreadsheetApp.openById(psi.id);

  // Mesma leitura de getListaPsicologasCompleta(): nome em B2, Pix em O2
  let nomeCompleto = psi.nomeAbreviado;
  let pixKey = '';
  const dadosPsi = ss.getSheetByName('DadosPsi');
  if (dadosPsi) {
    const nome = dadosPsi.getRange('B2').getValue();
    if (nome) nomeCompleto = nome;
    const pix = dadosPsi.getRange('O2').getValue();
    if (pix) pixKey = pix;
  }

  const aba = ss.getSheetByName(SYNC_ABA_ATENDIMENTOS);
  if (!aba) throw new Error(`Aba "${SYNC_ABA_ATENDIMENTOS}" não encontrada.`);

  const valores = aba.getDataRange().getValues();
  const cabecalho = (valores[0] || []).map(v => String(v === null || v === undefined ? '' : v).trim());

  const linhas = [];
  for (let i = 1; i < valores.length; i++) {
    const celulas = valores[i].map(syncNormalizarCelula_);
    const vazia = celulas.every(c => c === '' || c === null || (typeof c === 'string' && c.trim() === ''));
    if (vazia) continue;
    linhas.push({ linha: i + 1, celulas: celulas });
  }

  const resp = syncChamarRpc_(cfg, 'legacy_ingest_sheet', {
    p_token: cfg.token,
    p: {
      spreadsheetId: psi.id,
      nomeAbreviado: psi.nomeAbreviado,
      nomeCompleto: String(nomeCompleto),
      pixKey: String(pixKey),
      aba: SYNC_ABA_ATENDIMENTOS,
      cabecalho: cabecalho,
      linhas: linhas
    }
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error(`Supabase respondeu ${resp.getResponseCode()}: ${resp.getContentText().slice(0, 300)}`);
  }

  // BI (migration 024): Agenda + Cancelados, só os campos dos indicadores.
  // Uma falha aqui não desfaz o envio dos Atendimentos — só fica no log.
  try {
    const r = syncEnviarAgendaCancelados_(cfg, psi, ss);
    console.log(`   ↳ ${psi.nomeAbreviado}: Agenda ${r.agenda} | Cancelados ${r.cancelados}`);
  } catch (e) {
    console.log(`   ↳ ${psi.nomeAbreviado}: Agenda/Cancelados não enviados — ${e.message}`);
  }
  return linhas.length;
}

// =======================================================
// BI — Agenda, Cancelados e Salas (migration 024)
// Só os campos que os indicadores usam. NÃO envia: CPF, telefone,
// e-mail, carteirinha, médico, CRM, CID, responsável, anexos, sexo
// nem observações.
//   Agenda (coluna):     A dia | B horário | C paciente | E plano |
//                        F psicóloga | H valor | I sala | M nascimento |
//                        O cidade | P bairro | AA data de início
//   Cancelados (coluna): A cancelamento | B dia | C horário | D paciente |
//                        F plano | I valor | J sala | N nascimento |
//                        P cidade | Q bairro | AB data de início
// Salas: aba "Painel" da planilha de Salas, cujo ID fica na
// propriedade do script SALAS_SPREADSHEET_ID (opcional).
// =======================================================

const SYNC_COLS_AGENDA = [0, 1, 2, 4, 5, 7, 8, 12, 14, 15, 26];
const SYNC_COLS_CANCELADOS = [0, 1, 2, 3, 5, 8, 9, 13, 15, 16, 27];

function syncEnviarAgendaCancelados_(cfg, psi, ss) {
  const planilha = ss || SpreadsheetApp.openById(psi.id);
  const ler = (nome, cols, ehAgenda) => {
    const aba = planilha.getSheetByName(nome);
    if (!aba) return null;
    const valores = aba.getDataRange().getValues();
    const out = [];
    for (let i = 1; i < valores.length; i++) {
      const r = valores[i];
      const c = cols.map(k => syncNormalizarCelula_(k < r.length ? r[k] : ''));
      const vazia = c.every(x => x === '' || x === null || (typeof x === 'string' && x.trim() === ''));
      if (vazia) continue;
      if (ehAgenda && !r[0] && !r[1]) continue; // sem dia nem horário: não é horário da grade
      out.push({ linha: i + 1, c: c });
    }
    return out;
  };
  const agenda = ler('Agenda', SYNC_COLS_AGENDA, true);
  const cancelados = ler('Cancelados', SYNC_COLS_CANCELADOS, false);

  const corpo = { spreadsheetId: psi.id };
  if (agenda) corpo.agenda = agenda;
  if (cancelados) corpo.cancelados = cancelados;
  const resp = syncChamarRpc_(cfg, 'legacy_ingest_agenda', { p_token: cfg.token, p: corpo });
  if (resp.getResponseCode() !== 200) {
    throw new Error(`Supabase respondeu ${resp.getResponseCode()}: ${resp.getContentText().slice(0, 300)}`);
  }
  return { agenda: agenda ? agenda.length : 'sem aba', cancelados: cancelados ? cancelados.length : 'sem aba' };
}

/** Envia a aba Painel da planilha de Salas (grade de salas × horários). */
function syncEnviarSalas_(cfg) {
  const id = String(PropertiesService.getScriptProperties().getProperty('SALAS_SPREADSHEET_ID') || '').trim();
  if (!id) return null; // não configurado: segue sem salas
  const aba = SpreadsheetApp.openById(id).getSheetByName('Painel');
  if (!aba) throw new Error('Aba "Painel" não encontrada na planilha de Salas.');
  const valores = aba.getDataRange().getDisplayValues();
  const cabecalho = (valores[0] || []).map(v => String(v || '').trim());
  const linhas = [];
  for (let i = 1; i < valores.length; i++) {
    const r = valores[i].map(v => String(v || '').trim());
    if (!r[0] && !r[1]) continue;
    linhas.push({ linha: i + 1, celulas: r });
  }
  const resp = syncChamarRpc_(cfg, 'legacy_ingest_salas', { p_token: cfg.token, p: { cabecalho: cabecalho, linhas: linhas } });
  if (resp.getResponseCode() !== 200) {
    throw new Error(`Supabase respondeu ${resp.getResponseCode()}: ${resp.getContentText().slice(0, 300)}`);
  }
  return linhas.length;
}

/** Teste: envia Agenda/Cancelados de uma psicóloga (nome da aba ID) e as Salas. */
function testarAgendaSalasSupabase(nomeAbreviado) {
  const cfg = syncLerConfiguracao_();
  const lista = syncListarPsicologas_();
  const psi = nomeAbreviado
    ? lista.find(p => String(p.nomeAbreviado).trim() === String(nomeAbreviado).trim())
    : lista[0];
  if (!psi) throw new Error('Psicóloga não encontrada na aba ID.');
  console.log(JSON.stringify(syncEnviarAgendaCancelados_(cfg, psi)));
  const s = syncEnviarSalas_(cfg);
  console.log(s === null ? 'Salas: configure SALAS_SPREADSHEET_ID nas Propriedades do script.' : `Salas: ${s} linhas`);
}

/**
 * Datas viram {"$date": "yyyy-MM-ddTHH:mm:ss"} no fuso de SP (assim o banco
 * sabe que a célula ERA data, como o RPA verifica com "instanceof Date").
 * Números e booleanos ficam como estão. Texto vai SEM alteração (o RPA faz
 * o próprio trim onde precisa).
 */
function syncNormalizarCelula_(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return { $date: Utilities.formatDate(v, SYNC_FUSO, "yyyy-MM-dd'T'HH:mm:ss") };
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v === null || v === undefined) return '';
  return String(v);
}

/** Envia a aba ExencaoCNPJ (valores crus) e a lista/ordem da aba ID. */
function syncEnviarExencoesELista_(cfg, lista) {
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ExencaoCNPJ');
  const linhas = [];
  if (aba) {
    const dados = aba.getDataRange().getValues();
    for (let i = 1; i < dados.length; i++) {
      const r = dados[i];
      linhas.push({ linha: i + 1, celulas: [r[0], r[1], r[2]].map(syncNormalizarCelula_) });
    }
  }
  const resp = syncChamarRpc_(cfg, 'legacy_ingest_exencoes', {
    p_token: cfg.token,
    p: { linhas: linhas, psicologas: lista.map(x => ({ id: x.id, nomeAbreviado: x.nomeAbreviado })) }
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error(`Supabase respondeu ${resp.getResponseCode()}: ${resp.getContentText().slice(0, 300)}`);
  }
  return linhas.length;
}

function syncChamarRpc_(cfg, funcao, corpo) {
  return UrlFetchApp.fetch(`${cfg.url}/rest/v1/rpc/${funcao}`, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey },
    payload: JSON.stringify(corpo),
    muteHttpExceptions: true
  });
}

function syncReportarErro_(cfg, psi, mensagem) {
  try {
    syncChamarRpc_(cfg, 'legacy_report_error', {
      p_token: cfg.token,
      p_spreadsheet_id: psi.id,
      p_nome: psi.nomeAbreviado,
      p_mensagem: mensagem
    });
  } catch (e) {
    console.log('Não foi possível registrar o erro no Supabase: ' + e.message);
  }
}

function syncAgendarContinuacao_() {
  syncRemoverContinuacoes_();
  const t = ScriptApp.newTrigger('sincronizarPlanilhasSupabase').timeBased().after(60 * 1000).create();
  PropertiesService.getScriptProperties().setProperty('SYNC_SUPABASE_CONTINUACAO', t.getUniqueId());
}

function syncRemoverContinuacoes_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SYNC_SUPABASE_CONTINUACAO');
  if (!id) return;
  ScriptApp.getProjectTriggers()
    .filter(t => t.getUniqueId() === id)
    .forEach(t => ScriptApp.deleteTrigger(t));
  props.deleteProperty('SYNC_SUPABASE_CONTINUACAO');
}
