// =======================================================
// PONTE REGISTRO DE GUIAS — ADM Registro de Guia ↔ HOPE CORE
// Arquivo NOVO do projeto "ADM Registro de Guia". Não altera nenhuma
// função existente do Code.gs (todas as funções aqui começam com
// "ponte", "hope" ou terminam com "Supabase"; o doGet continua igual).
//
// O que faz:
//   1) doPost: a página nova do HOPE CORE (/financeiro/guias) chama as
//      MESMAS funções do Code.gs (getListaPsicologas, buscarDadosBackend,
//      salvarDadosPaciente, salvarStatusGuia, ...). Nada de lógica nova:
//      a planilha continua sendo gravada exatamente como hoje.
//      Só aceita chamadas com o token HOPE_PONTE_TOKEN.
//   2) sincronizarBDGuiasSupabase: envia a aba BD_GUIAS inteira ao
//      Supabase (espelho), de hora em hora.
//
// Configuração (uma vez só):
//   Configurações do projeto (engrenagem) → Propriedades do script:
//     HOPE_PONTE_TOKEN   = token enviado pelo Claude para a página nova
//     SUPABASE_URL       = https://wqktlmcsfytfwquungey.supabase.co
//     SUPABASE_ANON_KEY  = chave anon pública do projeto
//     HOPE_SYNC_TOKEN    = o MESMO token usado no Calculo RPA
//   Depois: rode verificarConfiguracaoPonte(), sincronizarBDGuiasSupabase()
//   e instalarGatilhoBDGuiasSupabase(). Por fim publique uma NOVA VERSÃO
//   da implantação do app da Web (Implantar → Gerenciar implantações →
//   editar → Versão: Nova versão) para o doPost passar a valer.
// =======================================================

var PONTE_FUSO = 'America/Sao_Paulo';

// Funções do Code.gs que a página nova pode chamar (as mesmas usadas no Index.html)
function ponteFuncoes_() {
  return {
    getListaPsicologas: getListaPsicologas,
    getListaPacientes: getListaPacientes,
    buscarDadosBackend: buscarDadosBackend,
    buscarStatusDetalhadoGuias: buscarStatusDetalhadoGuias,
    buscarTodasGlosas: buscarTodasGlosas,
    salvarDadosPaciente: salvarDadosPaciente,
    gerarRelatorioPDF: gerarRelatorioPDF,
    buscarDetalhesGuiaComGlosa: buscarDetalhesGuiaComGlosa,
    buscarDadosAgendaPaciente: buscarDadosAgendaPaciente,
    salvarStatusGuia: salvarStatusGuia,
    buscarTelefonePaciente: buscarTelefonePaciente,
    buscarGlosa: buscarGlosa,
    verificarEAplicarGlosasPendentes: verificarEAplicarGlosasPendentes,
    hopeMapaPsicologas: hopeMapaPsicologas
  };
}

function doPost(e) {
  var saida;
  try {
    var texto = (e && e.postData && e.postData.contents) ? e.postData.contents : '';
    var corpo = JSON.parse(texto || '{}');
    var esperado = PropertiesService.getScriptProperties().getProperty('HOPE_PONTE_TOKEN');
    if (!esperado || String(esperado).length < 32) throw new Error('HOPE_PONTE_TOKEN não configurado no Apps Script.');
    if (String(corpo.token || '') !== String(esperado)) throw new Error('Token inválido');

    var mapa = ponteFuncoes_();
    var nome = String(corpo.fn || '');
    if (!Object.prototype.hasOwnProperty.call(mapa, nome)) throw new Error('Função não permitida: ' + nome);

    var args = Array.isArray(corpo.args) ? corpo.args : [];
    var resultado = mapa[nome].apply(null, args);
    saida = { ok: true, resultado: resultado === undefined ? null : resultado, extra: ponteExtra_(nome, args, resultado) };
  } catch (err) {
    saida = { ok: false, erro: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(saida)).setMimeType(ContentService.MimeType.JSON);
}

/** Dados extras para o HOPE CORE espelhar no banco o que acabou de ser gravado. */
function ponteExtra_(nome, args, resultado) {
  try {
    if (nome === 'salvarStatusGuia' && resultado && resultado.sucesso) {
      return { idPlanilha: getIdPlanilhaDaPsicologa(args[0]) || '' };
    }
    if (nome === 'salvarDadosPaciente' && resultado && resultado.sucesso && resultado.linha) {
      var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOME_ABA_DB);
      if (!aba) return {};
      var ultimaCol = Math.max(aba.getLastColumn(), 16);
      var valores = aba.getRange(Number(resultado.linha), 1, 1, ultimaCol).getValues()[0];
      return { linhaValores: valores.map(ponteNormalizarCelula_) };
    }
  } catch (e) {
    return { erroExtra: String(e.message || e) };
  }
  return {};
}

/** Nome (como aparece na lista) + ID da planilha de cada psicóloga da aba ID. */
function hopeMapaPsicologas() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOME_ABA_ID);
  if (!aba) return [];
  var dados = aba.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < dados.length; i++) {
    var nome = String(dados[i][0] || '').trim();
    if (!nome) continue;
    var id = String(dados[i][1] || '').trim();
    var m = id.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (m) id = m[1];
    out.push({ nome: nome, id: id });
  }
  return out;
}

// ---------------- Espelho da aba BD_GUIAS no Supabase ----------------

function sincronizarBDGuiasSupabase() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20 * 1000)) {
    console.log('Planilha ocupada (alguém salvando). Tenta na próxima execução.');
    return;
  }
  var inicio = Date.now();
  try {
    var cfg = ponteLerConfiguracao_();
    var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOME_ABA_DB);
    if (!aba) throw new Error('Aba ' + NOME_ABA_DB + ' não encontrada.');
    var valores = aba.getDataRange().getValues();
    var linhas = [];
    for (var i = 1; i < valores.length; i++) {
      var celulas = valores[i].map(ponteNormalizarCelula_);
      var vazia = celulas.every(function (c) { return c === '' || c === null; });
      if (vazia) continue;
      linhas.push({ linha: i + 1, celulas: celulas });
    }
    var resp = ponteChamarRpc_(cfg, 'legacy_ingest_bd_guias', { p_token: cfg.token, p: { linhas: linhas } });
    if (resp.getResponseCode() !== 200) {
      throw new Error('Supabase respondeu ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));
    }
    console.log('✅ BD_GUIAS: ' + linhas.length + ' linhas enviadas em ' + Math.round((Date.now() - inicio) / 1000) + ' s');
  } finally {
    lock.releaseLock();
  }
}

/** Confere token da página nova, propriedades do Supabase e se o banco aceita o HOPE_SYNC_TOKEN. */
function verificarConfiguracaoPonte() {
  var p = PropertiesService.getScriptProperties();
  var ponte = String(p.getProperty('HOPE_PONTE_TOKEN') || '');
  console.log('HOPE_PONTE_TOKEN: ' + (ponte.length >= 32 ? 'ok (' + ponte.length + ' caracteres)' : 'FALTANDO ou curto'));
  var cfg = ponteLerConfiguracao_();
  console.log('URL: ' + cfg.url);
  console.log('Chave anon: ok (' + cfg.anonKey.length + ' caracteres)');
  console.log('HOPE_SYNC_TOKEN: ok (' + cfg.token.length + ' caracteres)');
  // Esperado: o banco aceita o token e recusa o conteúdo vazio de propósito.
  var resp = ponteChamarRpc_(cfg, 'legacy_ingest_bd_guias', { p_token: cfg.token, p: {} });
  var texto = resp.getContentText();
  if (texto.indexOf('Token inválido') >= 0) throw new Error('O banco recusou o HOPE_SYNC_TOKEN.');
  if (texto.indexOf('linhas deve ser uma lista') >= 0) {
    if (ponte.length < 32) throw new Error('Supabase OK, mas falta HOPE_PONTE_TOKEN.');
    console.log('✅ Tudo certo. Rode sincronizarBDGuiasSupabase() e depois instalarGatilhoBDGuiasSupabase().');
    return;
  }
  throw new Error('Resposta inesperada (' + resp.getResponseCode() + '): ' + texto.slice(0, 300));
}

function instalarGatilhoBDGuiasSupabase() {
  removerGatilhoBDGuiasSupabase();
  ScriptApp.newTrigger('sincronizarBDGuiasSupabase').timeBased().everyHours(1).create();
  console.log('✅ Gatilho instalado: BD_GUIAS enviada a cada 1 hora.');
}

function removerGatilhoBDGuiasSupabase() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'sincronizarBDGuiasSupabase'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

// ---------------- funções internas ----------------

function ponteLerConfiguracao_() {
  var p = PropertiesService.getScriptProperties();
  var cfg = {
    url: String(p.getProperty('SUPABASE_URL') || '').replace(/\/+$/, ''),
    anonKey: String(p.getProperty('SUPABASE_ANON_KEY') || ''),
    token: String(p.getProperty('HOPE_SYNC_TOKEN') || '')
  };
  if (!cfg.url || !cfg.anonKey || !cfg.token) {
    throw new Error('Configure SUPABASE_URL, SUPABASE_ANON_KEY e HOPE_SYNC_TOKEN em Propriedades do script.');
  }
  return cfg;
}

/** Mesmo formato do Calculo RPA: datas viram {"$date": "..."} no fuso de SP. */
function ponteNormalizarCelula_(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return { $date: Utilities.formatDate(v, PONTE_FUSO, "yyyy-MM-dd'T'HH:mm:ss") };
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v === null || v === undefined) return '';
  return String(v);
}

function ponteChamarRpc_(cfg, funcao, corpo) {
  return UrlFetchApp.fetch(cfg.url + '/rest/v1/rpc/' + funcao, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey },
    payload: JSON.stringify(corpo),
    muteHttpExceptions: true
  });
}
