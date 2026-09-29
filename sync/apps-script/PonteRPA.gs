// =======================================================
// PONTE RPA — botão "Sincronizar planilhas" do HOPE CORE
// Arquivo NOVO do projeto "Calculo RPA" (ao lado do SyncSupabase.gs).
// Não altera nenhuma função existente: só acrescenta o doPost e
// funções que começam com "ponteRpa".
//
// Como funciona:
//   O HOPE CORE (servidor da Vercel) faz um POST com o token. Como a
//   sincronização completa leva ~1 minuto, o doPost NÃO roda ela na
//   hora: agenda um gatilho único para daqui a instantes e responde
//   na mesma hora. O gatilho chama sincronizarPlanilhasSupabase()
//   (a mesma função do comando manual e do gatilho de hora em hora).
//
// Configuração (uma vez só):
//   1. Propriedades do script → adicionar
//        HOPE_PONTE_TOKEN = (o mesmo token da ponte do ADM Registro de Guia)
//   2. Rodar verificarPonteRPA() uma vez (confere o token).
//   3. Implantar → Nova implantação → Tipo "App da Web"
//        Executar como: Eu  |  Quem pode acessar: Qualquer pessoa
//      e enviar a URL /exec ao Claude (vai na Vercel como HOPE_RPA_URL).
// =======================================================

const PONTE_RPA_HANDLER = 'ponteRpaSincronizarAgora';
const PONTE_RPA_PROP_PEDIDO = 'PONTE_RPA_PEDIDO_EM';

function doPost(e) {
  var saida;
  try {
    var texto = (e && e.postData && e.postData.contents) ? e.postData.contents : '';
    var corpo = JSON.parse(texto || '{}');
    var esperado = PropertiesService.getScriptProperties().getProperty('HOPE_PONTE_TOKEN');
    if (!esperado || String(esperado).length < 32) throw new Error('HOPE_PONTE_TOKEN não configurado no Calculo RPA.');
    if (String(corpo.token || '') !== String(esperado)) throw new Error('Token inválido');

    var fn = String(corpo.fn || '');
    var args = Array.isArray(corpo.args) ? corpo.args : [];
    var resultado;
    if (fn === 'sincronizarPlanilhasSupabase') resultado = ponteRpaAgendar_();
    else if (fn === 'sincronizarUmaSupabase') resultado = ponteRpaUma_(args[0]);
    else if (fn === 'status') resultado = ponteRpaStatus_();
    else throw new Error('Função não permitida: ' + fn);

    saida = { ok: true, resultado: resultado, extra: {} };
  } catch (err) {
    saida = { ok: false, erro: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(saida)).setMimeType(ContentService.MimeType.JSON);
}

/** Handler do gatilho único criado pelo botão. Apaga o próprio gatilho e sincroniza. */
function ponteRpaSincronizarAgora() {
  ponteRpaRemoverGatilhos_();
  PropertiesService.getScriptProperties().deleteProperty(PONTE_RPA_PROP_PEDIDO);
  sincronizarPlanilhasSupabase();
}

/** Confere se o token da ponte está configurado (rodar uma vez no editor). */
function verificarPonteRPA() {
  var t = PropertiesService.getScriptProperties().getProperty('HOPE_PONTE_TOKEN');
  if (!t || String(t).length < 32) throw new Error('Falta HOPE_PONTE_TOKEN nas Propriedades do script.');
  console.log('✅ HOPE_PONTE_TOKEN ok (' + String(t).length + ' caracteres). ' +
    'Agora: Implantar → Nova implantação → App da Web (Executar como: Eu | Acesso: Qualquer pessoa).');
  console.log('Status atual: ' + JSON.stringify(ponteRpaStatus_()));
}

// ---------------- funções internas ----------------

function ponteRpaAgendar_() {
  var st = ponteRpaStatus_();
  // gatilho esquecido (pedido há mais de 5 min e não disparou): recria
  if (st.agendada && st.pedidoEm && Date.now() - new Date(st.pedidoEm).getTime() > 5 * 60 * 1000) {
    ponteRpaRemoverGatilhos_();
    st.agendada = false;
  }
  if (st.agendada) return { agendada: true, jaEstava: true, mensagem: 'Sincronização já agendada — começa em instantes.' };
  if (st.emAndamento) return { agendada: true, jaEstava: true, mensagem: 'Sincronização em andamento — continua sozinha.' };
  ScriptApp.newTrigger(PONTE_RPA_HANDLER).timeBased().after(1000).create();
  PropertiesService.getScriptProperties().setProperty(PONTE_RPA_PROP_PEDIDO, new Date().toISOString());
  return { agendada: true, jaEstava: false, mensagem: 'Sincronização agendada — começa em até 1 minuto.' };
}

function ponteRpaUma_(nome) {
  nome = String(nome || '').trim();
  if (!nome) throw new Error('Informe o nome abreviado da psicóloga (como na aba ID).');
  sincronizarUmaSupabase(nome);
  return { sincronizada: nome };
}

function ponteRpaStatus_() {
  var props = PropertiesService.getScriptProperties();
  var gatilhos = ScriptApp.getProjectTriggers();
  var pendente = gatilhos.some(function (t) { return t.getHandlerFunction() === PONTE_RPA_HANDLER; });
  var continuacao = !!props.getProperty('SYNC_SUPABASE_CONTINUACAO');
  return {
    agendada: pendente,
    emAndamento: continuacao || !!props.getProperty('SYNC_SUPABASE_CURSOR'),
    pedidoEm: props.getProperty(PONTE_RPA_PROP_PEDIDO) || null,
    gatilhoHoraEmHora: gatilhos.some(function (t) { return t.getHandlerFunction() === 'sincronizarPlanilhasSupabase'; })
  };
}

function ponteRpaRemoverGatilhos_() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === PONTE_RPA_HANDLER; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}
