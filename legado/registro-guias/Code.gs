// ==============================================================
// CONFIGURAÇÕES GLOBAIS
// ==============================================================
const COL_PACIENTE = 2;
const COL_PLANO = 4;
const COL_PSICOLOGA_AGENDA = 5;
const COL_GUIA_ATENDIMENTO = 4;
const COL_OBSERVACAO = 18; // Coluna S (19ª coluna) - ONDE SALVAMOS O STATUS
const NOME_ABA_ATENDIMENTOS = "Atendimentos";
const NOME_ABA_ID = "ID";
const NOME_ABA_DB = "BD_GUIAS";
const NOME_ABA_AGENDA_EXTERNA = "AGENDA";
const NOME_ABA_AUDITORIA = "AUDITORIA_SALVAMENTOS";

// Prioridade usada quando uma guia tem mais de uma observação (mais alto = mais urgente/relevante)
const PRIORIDADE_STATUS = {
  "FALTA": 5,
  "GLOSA_PENDENTE": 4,
  "GLOSA": 3,
  "EXCLUIDO": 2,
  "FATURADA": 1,
  "REGISTRADA": 0
};

// ==============================================================
// FUNÇÕES AUXILIARES
// ==============================================================
function normalizarTexto(texto) {
  if (!texto) return "";
  return String(texto)
    .trim()
    .toUpperCase()
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function formatarGuiasParaExibicao(guia1, guia2) {
  const g1 = String(guia1 || "").trim();
  const g2 = String(guia2 || "").trim();
  if (g1 && g2) {
    if (g1 === g2) return g1;
    return g1 + " / " + g2;
  } else if (g1) {
    return g1;
  } else if (g2) {
    return g2;
  } else {
    return "";
  }
}

function isGuiaValida(valor) {
  var v = String(valor || "").trim();
  if (!v || v === "") return false;
  if (v.toUpperCase() === "GUIA") return false;
  return true;
}

// Normaliza a Data Cancelamento (coluna A de Cancelados) para "DD/MM/AAAA"
function extrairDataAlta(valor) {
  if (!valor && valor !== 0) return "";
  if (valor instanceof Date) {
    try {
      return Utilities.formatDate(valor, "GMT-3", "dd/MM/yyyy");
    } catch (e) { /* segue */ }
  }
  var s = String(valor).trim();
  if (!s) return "";
  var m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    var d = String(m[1]).padStart(2, "0");
    var mes = String(m[2]).padStart(2, "0");
    var a = String(m[3]);
    if (a.length === 2) a = "20" + a;
    return d + "/" + mes + "/" + a;
  }
  return s;
}

// ==============================================================
// CLASSIFICAÇÃO ÚNICA DE STATUS (usada em TODO o sistema)
// ==============================================================
function classificarObservacao(observacaoRaw) {
  var obs = String(observacaoRaw || "").trim();
  var obsUpper = obs.toUpperCase();
  if (obsUpper === "") return "REGISTRADA";
  if (obsUpper.indexOf("FALTA") !== -1) return "FALTA";
  if (obsUpper === "OK") return "FATURADA";
  if (obsUpper.indexOf("GLOSA") !== -1) {
    if (obsUpper.indexOf("PENDENTE") !== -1) return "GLOSA_PENDENTE";
    return "GLOSA";
  }
  return "EXCLUIDO";
}

// ==============================================================
// AUDITORIA E VALIDAÇÃO
// ==============================================================
function criarAbaAuditoria() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(NOME_ABA_AUDITORIA);
  if (!aba) {
    aba = ss.insertSheet(NOME_ABA_AUDITORIA);
    aba.appendRow([
      "Timestamp", "Psicóloga", "Paciente", "Ação", "Guias", "Status", "Usuário", "IP"
    ]);
    aba.freezeRows(1);
  }
  return aba;
}

function registrarAuditoria(psicologa, paciente, acao, guias, status, erro) {
  try {
    var aba = criarAbaAuditoria();
    var agora = new Date();
    var usuario = Session.getActiveUser().getEmail();
    aba.appendRow([
      Utilities.formatDate(agora, "GMT-3", "dd/MM/yyyy HH:mm:ss"),
      psicologa,
      paciente,
      acao,
      guias ? JSON.stringify(guias) : "",
      status,
      usuario,
      erro ? JSON.stringify(erro).substring(0, 100) : ""
    ]);
  } catch (e) {
    console.error("Erro ao registrar auditoria:", e);
  }
}

function validarDadosSalvamento(dados) {
  var erros = [];
  if (!dados || typeof dados !== 'object') {
    erros.push("Dados inválidos (não é um objeto)");
    return { valido: false, erros: erros };
  }
  if (!dados.psicologa || String(dados.psicologa).trim() === "") {
    erros.push("Psicóloga não informada");
  }
  if (!dados.mes || dados.mes < 1 || dados.mes > 12) {
    erros.push("Mês inválido");
  }
  if (!dados.ano || dados.ano < 2020 || dados.ano > 2050) {
    erros.push("Ano inválido");
  }
  if (!dados.paciente || typeof dados.paciente !== 'object') {
    erros.push("Objeto paciente inválido");
    return { valido: false, erros: erros };
  }
  var pac = dados.paciente;
  if (!pac.nome || String(pac.nome).trim() === "") {
    erros.push("Nome do paciente não informado");
  }
  var temGuia =
    (pac.semana1 && String(pac.semana1).trim() !== "") ||
    (pac.semana2 && String(pac.semana2).trim() !== "") ||
    (pac.semana3 && String(pac.semana3).trim() !== "") ||
    (pac.semana4 && String(pac.semana4).trim() !== "") ||
    (pac.semana5 && String(pac.semana5).trim() !== "") ||
    (pac.extras && pac.extras.some(function(e) { return String(e).trim() !== ""; }));
  if (!temGuia) {
    erros.push("Nenhuma guia informada");
  }
  return { valido: erros.length === 0, erros: erros };
}

// ==============================================================
// SALVAMENTO SEGURO COM TRANSAÇÃO
// ==============================================================
function salvarDadosPaciente(dados) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { sucesso: false, erro: "Sistema ocupado. Tente novamente em alguns segundos.", codigo: "LOCK_TIMEOUT" };
  }
  try {
    var validacao = validarDadosSalvamento(dados);
    if (!validacao.valido) {
      registrarAuditoria(dados.psicologa, dados.paciente ? dados.paciente.nome : "DESCONHECIDO", "SALVAMENTO_REJEITADO", null, "FALHA_VALIDAÇÃO", validacao.erros.join("; "));
      return { sucesso: false, erro: "Validação falhou: " + validacao.erros.join("; "), codigo: "VALIDACAO_FALHOU" };
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var abaDb = ss.getSheetByName(NOME_ABA_DB);
    if (!abaDb) {
      abaDb = ss.insertSheet(NOME_ABA_DB);
      abaDb.appendRow([
        "Data","Mês","Ano","Psicóloga","Paciente","Plano",
        "S1 - Guia 1","S1 - Guia 2","S2 - Guia 1","S2 - Guia 2",
        "S3 - Guia 1","S3 - Guia 2","S4 - Guia 1","S4 - Guia 2",
        "S5 - Guia 1","S5 - Guia 2"
      ]);
      abaDb.freezeRows(1);
    }
    var dadosDb = abaDb.getDataRange().getValues();
    var linhaExistente = -1;
    var nomeParaSalvar = dados.paciente.nome;
    if (nomeParaSalvar.includes(" - ALTA")) {
      nomeParaSalvar = nomeParaSalvar.split(" - ")[0].trim();
    }
    if (nomeParaSalvar.includes(" (")) {
      nomeParaSalvar = nomeParaSalvar.split(" (")[0].trim();
    }
    nomeParaSalvar = nomeParaSalvar.trim().replace(/\n/g, " ");
    if (!nomeParaSalvar || nomeParaSalvar === "") {
      return { sucesso: false, erro: "Nome do paciente vazio após limpeza", codigo: "NOME_VAZIO_APOS_LIMPEZA" };
    }
    var nomeNormalizado = normalizarTexto(nomeParaSalvar);
    var psiNormalizado = normalizarTexto(dados.psicologa);
    for (var i = 1; i < dadosDb.length; i++) {
      if (dadosDb[i].length < 5) continue;
      if (String(dadosDb[i][1]) === String(dados.mes) &&
          String(dadosDb[i][2]) === String(dados.ano) &&
          normalizarTexto(String(dadosDb[i][3] || "")) === psiNormalizado &&
          normalizarTexto(String(dadosDb[i][4] || "")) === nomeNormalizado) {
        linhaExistente = i + 1;
        break;
      }
    }
    var separarGuias = function(valor) {
      if (!valor) return ["", ""];
      if (String(valor).includes(" / ")) {
        var p = String(valor).split(" / ");
        return [p[0].trim(), p[1].trim()];
      }
      return [String(valor).trim(), ""];
    };
    var s1 = separarGuias(dados.paciente.semana1);
    var s2 = separarGuias(dados.paciente.semana2);
    var s3 = separarGuias(dados.paciente.semana3);
    var s4 = separarGuias(dados.paciente.semana4);
    var s5 = separarGuias(dados.paciente.semana5);
    var extraPairs = [];
    if (dados.paciente.extras && dados.paciente.extras.length > 0) {
      dados.paciente.extras.forEach(function(ext) {
        var pair = separarGuias(ext);
        extraPairs.push(pair[0]);
        extraPairs.push(pair[1]);
      });
    }
    var dataAtual = Utilities.formatDate(new Date(), "GMT-3", "dd/MM/yyyy HH:mm");
    var nomeFinalParaSalvar = nomeParaSalvar;
    var psicologaFinal = dados.psicologa;
    if (linhaExistente > 0) {
      nomeFinalParaSalvar = String(dadosDb[linhaExistente - 1][4] || nomeParaSalvar).trim();
      psicologaFinal = dadosDb[linhaExistente - 1][3] || dados.psicologa;
    }
    var novaLinha = [
      dataAtual, dados.mes, dados.ano, psicologaFinal, nomeFinalParaSalvar,
      dados.paciente.plano, s1[0], s1[1], s2[0], s2[1], s3[0], s3[1],
      s4[0], s4[1], s5[0], s5[1]
    ];
    extraPairs.forEach(function(val) {
      novaLinha.push(val);
    });
    if (novaLinha[4] === "" || novaLinha[4] === null) {
      return { sucesso: false, erro: "Nome do paciente não pode ser vazio na linha de salvamento", codigo: "NOME_NULO_NA_LINHA" };
    }
    var rangeAlvo;
    var operacao = "";
    if (linhaExistente > 0) {
      rangeAlvo = abaDb.getRange(linhaExistente, 1, 1, novaLinha.length);
      operacao = "ATUALIZAR";
    } else {
      rangeAlvo = abaDb.getRange(abaDb.getLastRow() + 1, 1, 1, novaLinha.length);
      operacao = "INSERIR";
    }
    rangeAlvo.setNumberFormat("@");
    rangeAlvo.setValues([novaLinha]);
    var guiasStr = [s1[0], s1[1], s2[0], s2[1], s3[0], s3[1], s4[0], s4[1], s5[0], s5[1]]
      .concat(extraPairs)
      .filter(function(g) { return g; })
      .join(", ");
    registrarAuditoria(dados.psicologa, nomeFinalParaSalvar, operacao, guiasStr, "SUCESSO");
    return {
      sucesso: true,
      mensagem: operacao === "ATUALIZAR" ? "Atualizado com sucesso!" : "Salvo com sucesso!",
      operacao: operacao,
      linha: linhaExistente > 0 ? linhaExistente : abaDb.getLastRow()
    };
  } catch (e) {
    console.error("Erro ao salvar:", e);
    registrarAuditoria(dados.psicologa, dados.paciente ? dados.paciente.nome : "DESCONHECIDO", "SALVAMENTO_ERRO", null, "EXCEÇÃO", e.toString());
    return { sucesso: false, erro: "Erro interno: " + e.message, codigo: "ERRO_INTERNO" };
  } finally {
    lock.releaseLock();
  }
}

// ==============================================================
// FUNÇÃO SALVAR STATUS
// ==============================================================
function salvarStatusGuia(psicologa, guia, status, observacaoExtra) {
  try {
    console.log("=== SALVANDO STATUS ===");
    console.log("Psicóloga:", psicologa);
    console.log("Guia:", guia);
    console.log("Status recebido:", status);
    console.log("Observação extra:", observacaoExtra);

    if (!psicologa || psicologa === "undefined" || psicologa === "") {
      return { sucesso: false, erro: "Psicóloga não informada" };
    }
    if (!guia || guia === "undefined" || guia === "") {
      return { sucesso: false, erro: "Número da guia não informado" };
    }

    var id = getIdPlanilhaDaPsicologa(psicologa);
    if (!id) {
      return { sucesso: false, erro: "ID da planilha não encontrado para: " + psicologa };
    }

    var ss = SpreadsheetApp.openById(id);
    var abaAtend = ss.getSheetByName(NOME_ABA_ATENDIMENTOS);
    if (!abaAtend) {
      return { sucesso: false, erro: "Aba ATENDIMENTOS não encontrada" };
    }

    var dados = abaAtend.getDataRange().getValues();
    var guiaAlvo = String(guia).trim();
    var linhasEncontradas = [];

    for (var i = 1; i < dados.length; i++) {
      var guiaLinha = String(dados[i][COL_GUIA_ATENDIMENTO] || "").trim();
      if (guiaLinha === guiaAlvo) {
        linhasEncontradas.push({
          numero: i + 1,
          guiaAtual: guiaLinha,
          obsAtual: dados[i][COL_OBSERVACAO] || ""
        });
      }
    }

    if (linhasEncontradas.length === 0) {
      return {
        sucesso: false,
        erro: "Guia não encontrada: " + guia,
        guiaBuscada: guiaAlvo
      };
    }

    var statusTexto = String(status || "").trim();
    var statusUpper = statusTexto.toUpperCase();
    var extra = observacaoExtra ? String(observacaoExtra).trim() : "";
    var valorParaSalvar;

    if (statusTexto === "") {
      valorParaSalvar = "";
    } else if (statusUpper === "OK" || statusUpper === "FATURADA") {
      valorParaSalvar = "OK";
    } else if (statusUpper.indexOf("FALTA") !== -1) {
      valorParaSalvar = statusTexto;
    } else if (statusUpper.indexOf("GLOSA") !== -1) {
      valorParaSalvar = "GLOSA" + (extra ? " - " + extra : "");
    } else if (statusUpper === "EXCLUIDO" || statusUpper === "EXCLUÍDA") {
      valorParaSalvar = extra ? extra : "EXCLUIDO";
    } else {
      valorParaSalvar = statusTexto + (extra ? " - " + extra : "");
    }

    var salvos = 0;
    var erros = [];

    for (var j = 0; j < linhasEncontradas.length; j++) {
      var linha = linhasEncontradas[j];
      try {
        var range = abaAtend.getRange(linha.numero, COL_OBSERVACAO + 1);
        range.setValue(valorParaSalvar);

        var verificado = abaAtend.getRange(linha.numero, COL_OBSERVACAO + 1).getValue();
        if (String(verificado).trim() === valorParaSalvar) {
          salvos++;
          console.log("✅ Linha " + linha.numero + " salva com sucesso: '" + valorParaSalvar + "'");
        } else {
          erros.push("Linha " + linha.numero + ": não foi possível verificar o salvamento");
        }
      } catch (e) {
        erros.push("Linha " + linha.numero + ": " + e.message);
      }
    }

    if (salvos > 0) {
      registrarAuditoria(psicologa, "Guia: " + guia, "SALVAR_STATUS", guia, "SUCESSO", null);
    }

    return {
      sucesso: salvos > 0,
      mensagem: salvos > 0 ? "Status '" + (valorParaSalvar || "LIMPO") + "' salvo em " + salvos + " ocorrência(s)" : "Falha ao salvar",
      salvos: salvos,
      total: linhasEncontradas.length,
      erros: erros,
      valorSalvo: valorParaSalvar,
      statusClassificado: classificarObservacao(valorParaSalvar),
      linhas: linhasEncontradas.map(function(l) { return l.numero; })
    };

  } catch (e) {
    console.error("ERRO:", e);
    return { sucesso: false, erro: e.message };
  }
}

// ==============================================================
// FUNÇÃO BUSCAR STATUS DETALHADO
// ==============================================================
function buscarStatusDetalhadoGuias(psicologa, guias) {
  try {
    var id = getIdPlanilhaDaPsicologa(psicologa);
    if (!id) return {};
    var ss = SpreadsheetApp.openById(id);
    var abaAtend = ss.getSheetByName(NOME_ABA_ATENDIMENTOS);
    if (!abaAtend) return {};
    var dados = abaAtend.getDataRange().getValues();
    var guiasSet = new Set();
    guias.forEach(function(g) {
      var guiaLimpa = String(g).trim();
      if (guiaLimpa && isGuiaValida(guiaLimpa)) {
        guiasSet.add(guiaLimpa);
      }
    });
    if (guiasSet.size === 0) return {};

    var resultado = {};
    guiasSet.forEach(function(guia) {
      resultado[guia] = {
        status: "REGISTRADA",
        temFalta: false,
        temTipoAtendimento: false,
        observacao: "",
        tipoAtendimento: ""
      };
    });

    for (var i = 1; i < dados.length; i++) {
      var linha = dados[i];
      if (!linha || linha.length < 5) continue;
      var guiaLinha = String(linha[COL_GUIA_ATENDIMENTO] || "").trim();
      if (!guiasSet.has(guiaLinha)) continue;

      var observacao = String(linha[COL_OBSERVACAO] || "").trim();
      var tipoAtendimento = String(linha[5] || "").trim().toUpperCase();
      var statusLinha = classificarObservacao(observacao);

      if (statusLinha === "FALTA") {
        resultado[guiaLinha].temFalta = true;
      }
      if (tipoAtendimento && tipoAtendimento !== "" && tipoAtendimento !== "OK") {
        resultado[guiaLinha].temTipoAtendimento = true;
        resultado[guiaLinha].tipoAtendimento = tipoAtendimento;
      }

      if (PRIORIDADE_STATUS[statusLinha] > PRIORIDADE_STATUS[resultado[guiaLinha].status]) {
        resultado[guiaLinha].status = statusLinha;
        resultado[guiaLinha].observacao = observacao.toUpperCase();
      }
    }
    return resultado;
  } catch (e) {
    console.error("Erro ao buscar status detalhado das guias:", e);
    return {};
  }
}

// ==============================================================
// FUNÇÃO BUSCAR STATUS DE UMA GUIA ESPECÍFICA
// ==============================================================
function buscarStatusGuiaEspecifica(psicologa, guia) {
  try {
    var guias = [guia];
    var resultado = buscarStatusDetalhadoGuias(psicologa, guias);
    var guiaLimpa = String(guia).trim();
    if (resultado[guiaLimpa]) {
      return {
        encontrada: true,
        status: resultado[guiaLimpa].status,
        observacao: resultado[guiaLimpa].observacao,
        temFalta: resultado[guiaLimpa].temFalta,
        temTipoAtendimento: resultado[guiaLimpa].temTipoAtendimento
      };
    }
    return { encontrada: false, status: "REGISTRADA" };
  } catch (e) {
    console.error("Erro ao buscar status específico da guia:", e);
    return { encontrada: false, status: null, erro: e.message };
  }
}

// ==============================================================
// FUNÇÃO BUSCAR DETALHES DA GUIA
// ==============================================================
function buscarDetalhesGuia(psicologa, guia) {
  try {
    var id = getIdPlanilhaDaPsicologa(psicologa);
    if (!id) return [];
    var ss = SpreadsheetApp.openById(id);
    var abaAtend = ss.getSheetByName(NOME_ABA_ATENDIMENTOS);
    if (!abaAtend) return [];
    var rangeDados = abaAtend.getDataRange();
    var dados = rangeDados.getValues();
    var richTextValues = abaAtend.getRange(1, 8, dados.length, 1).getRichTextValues();
    var resultados = [];
    var guiaAlvo = String(guia).trim();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL_GUIA_ATENDIMENTO]).trim() === guiaAlvo) {
        var dataFormatada = "";
        var dataCell = dados[i][3];
        if (dataCell instanceof Date) {
          dataFormatada = Utilities.formatDate(dataCell, "GMT-3", "dd/MM/yyyy");
        } else if (dataCell) {
          dataFormatada = String(dataCell);
        }
        var link = "";
        var linkOriginal = "";
        var cellValue = dados[i][7];
        var richText = richTextValues[i][0];
        if (richText && richText.getLinkUrl()) {
          linkOriginal = richText.getLinkUrl();
          link = linkOriginal;
        } else if (typeof cellValue === 'string' && cellValue.includes("http")) {
          var urlMatch = cellValue.match(/["'](https?:\/\/[^"']+)["']/);
          if (urlMatch) {
            linkOriginal = urlMatch[1];
            link = linkOriginal;
          } else {
            var urlMatch2 = cellValue.match(/https?:\/\/[^\s"')]+/);
            if (urlMatch2) {
              linkOriginal = urlMatch2[0];
              link = linkOriginal;
            }
          }
        }
        var linkFinal = link;
        if (link && link.includes("drive.google.com")) {
          try {
            var fileId = null;
            var patterns = [
              /\/d\/([a-zA-Z0-9-_]+)/,
              /id=([a-zA-Z0-9-_]+)/,
              /file\/d\/([a-zA-Z0-9-_]+)/,
              /\/uc\?id=([a-zA-Z0-9-_]+)/,
              /open\?id=([a-zA-Z0-9-_]+)/
            ];
            for (var p = 0; p < patterns.length; p++) {
              var match = link.match(patterns[p]);
              if (match) {
                fileId = match[1];
                break;
              }
            }
            if (!fileId) {
              var idMatch = link.match(/[a-zA-Z0-9-_]{25,}/);
              if (idMatch) fileId = idMatch[0];
            }
            if (fileId) {
              try {
                var arquivo = DriveApp.getFileById(fileId);
                var mimeType = arquivo.getMimeType();
                if (mimeType.startsWith("image/")) {
                  linkFinal = "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w1600";
                } else {
                  linkFinal = "https://drive.google.com/file/d/" + fileId + "/preview";
                }
              } catch (erroDrive) {
                if (link.includes("/view")) {
                  linkFinal = link.replace("/view", "/preview");
                } else if (link.includes("/edit")) {
                  linkFinal = link.replace("/edit", "/preview");
                } else if (!link.includes("/preview")) {
                  linkFinal = link + (link.includes("?") ? "&" : "?") + "preview";
                }
              }
            } else {
              if (link.includes("/view")) {
                linkFinal = link.replace("/view", "/preview");
              } else if (link.includes("/edit")) {
                linkFinal = link.replace("/edit", "/preview");
              } else if (!link.includes("/preview")) {
                linkFinal = link + (link.includes("?") ? "&" : "?") + "preview";
              }
            }
          } catch (e) {
            linkFinal = link;
          }
        }
        var observacao = String(dados[i][COL_OBSERVACAO] || "").trim();
        resultados.push({
          linha: i + 1,
          data: dataFormatada,
          tipo: String(dados[i][5] || ""),
          link: linkFinal,
          linkOriginal: linkOriginal,
          valor: String(dados[i][13] || ""),
          observacao: observacao,
          paciente: String(dados[i][2] || ""),
          temFalta: observacao.toUpperCase().includes("FALTA")
        });
      }
    }
    return resultados;
  } catch (e) {
    console.error("Erro em buscarDetalhesGuia: " + e.toString());
    return [];
  }
}

function buscarDetalhesGuiaComGlosa(psicologa, guia) {
  return buscarDetalhesGuia(psicologa, guia);
}

// ==============================================================
// FUNÇÕES PRINCIPAIS
// ==============================================================
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Sistema de Gestão de Guias')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getListaPsicologas() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var aba = ss.getSheetByName(NOME_ABA_ID);
    if (!aba) return ["ERRO: Crie a aba 'ID' na planilha principal"];
    var ultimaLinha = aba.getLastRow();
    if (ultimaLinha < 2) return [];
    var dados = aba.getRange(2, 1, ultimaLinha - 1, 1)
      .getValues()
      .flat()
      .filter(function(nome) { return nome && String(nome).trim() !== ""; })
      .map(String)
      .sort();
    return dados;
  } catch (e) {
    console.error("Erro ao buscar psicólogas:", e);
    return ["Erro ao carregar lista"];
  }
}

function getIdPlanilhaDaPsicologa(nome) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var aba = ss.getSheetByName(NOME_ABA_ID);
    if (!aba) return null;
    var dados = aba.getDataRange().getValues();
    var busca = normalizarTexto(nome);
    for (var i = 1; i < dados.length; i++) {
      var nomePlanilha = normalizarTexto(dados[i][0]);
      if (nomePlanilha === busca) {
        var id = String(dados[i][1]).trim();
        if (id.includes("/d/")) {
          var match = id.match(/\/d\/([a-zA-Z0-9-_]+)/);
          if (match) return match[1];
        }
        return id;
      }
    }
    var melhorMatch = null;
    var melhorTamanho = 0;
    for (var i = 1; i < dados.length; i++) {
      var nomePlanilha = normalizarTexto(dados[i][0]);
      if (busca.includes(nomePlanilha) || nomePlanilha.includes(busca)) {
        if (nomePlanilha.length > melhorTamanho) {
          melhorTamanho = nomePlanilha.length;
          melhorMatch = dados[i][1];
        }
      }
    }
    if (melhorMatch) {
      var id = String(melhorMatch).trim();
      if (id.includes("/d/")) {
        var match = id.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (match) return match[1];
      }
      return id;
    }
    return null;
  } catch (e) {
    console.error("Erro ao buscar ID:", e);
    return null;
  }
}

function getListaPacientes(psicologa, mesFiltro, anoFiltro) {
  try {
    var id = getIdPlanilhaDaPsicologa(psicologa);
    if (!id) return ["Erro: Psicóloga não encontrada"];
    var ssExterna = SpreadsheetApp.openById(id);
    var pacientes = new Set();
    var psiFiltro = normalizarTexto(psicologa);
    var abaAgenda = ssExterna.getSheetByName(NOME_ABA_AGENDA_EXTERNA);
    if (!abaAgenda) return [];
    var dados = abaAgenda.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      if (dados[i].length <= COL_PSICOLOGA_AGENDA) continue;
      var rPsi = normalizarTexto(dados[i][COL_PSICOLOGA_AGENDA] || "");
      var rPac = String(dados[i][COL_PACIENTE] || "").trim().replace(/\n/g, " ");
      if (rPsi.includes(psiFiltro) && rPac !== "" && !rPac.includes("💚") && !rPac.toUpperCase().includes("LIVRE")) {
        pacientes.add(rPac);
      }
    }
    var abaCancelados = ssExterna.getSheetByName("Cancelados");
    if (abaCancelados) {
      var dadosCanc = abaCancelados.getDataRange().getValues();
      for (var i = 1; i < dadosCanc.length; i++) {
        var psiCancel = (dadosCanc[i].length > 6) ? normalizarTexto(dadosCanc[i][6] || "") : "";
        var dataRaw = dadosCanc[i][0];
        if ((psiCancel.includes(psiFiltro) || psiCancel === "") && dataRaw) {
          var mesCancel = -1; var anoCancel = -1;
          if (dataRaw instanceof Date) {
            mesCancel = dataRaw.getMonth() + 1;
            anoCancel = dataRaw.getFullYear();
          } else if (typeof dataRaw === 'string') {
            try {
              var parts = dataRaw.split(' ')[0].split('/');
              if (parts.length === 3) { mesCancel = parseInt(parts[1]); anoCancel = parseInt(parts[2]); }
            } catch(e) {}
          }
          if (mesCancel == mesFiltro && anoCancel == anoFiltro) {
            var nomePac = String(dadosCanc[i][3] || "").trim().replace(/\n/g, " ");
            if (nomePac) pacientes.add(nomePac + " - ALTA");
          }
        }
      }
    }
    return Array.from(pacientes).sort();
  } catch (e) {
    console.error("Erro ao buscar pacientes:", e);
    return ["Erro: " + e.message];
  }
}

// ==============================================================
// FUNÇÃO BUSCAR DADOS BACKEND
// ==============================================================
function buscarDadosBackend(psicologa, mes, ano, filtroPaciente) {
  try {
    var id = getIdPlanilhaDaPsicologa(psicologa);
    if (!id) return { erro: "ID da planilha não encontrado." };
    var ssExterna = SpreadsheetApp.openById(id);
    var mapaGuiasStatus = {};
    var mapaGuiasObservacao = {};

    var abaAtend = ssExterna.getSheetByName(NOME_ABA_ATENDIMENTOS);
    if (abaAtend) {
      var dadosAtend = abaAtend.getDataRange().getValues();
      var guiaObservacoes = {};

      for (var i = 1; i < dadosAtend.length; i++) {
        var guia = String(dadosAtend[i][COL_GUIA_ATENDIMENTO] || "").trim();
        var observacao = String(dadosAtend[i][COL_OBSERVACAO] || "").trim();

        if (guia !== "" && isGuiaValida(guia)) {
          if (!guiaObservacoes[guia]) guiaObservacoes[guia] = [];
          guiaObservacoes[guia].push(observacao);
        }
      }

      for (var guiaKey in guiaObservacoes) {
        var observacoes = guiaObservacoes[guiaKey];
        var statusFinal = "REGISTRADA";
        var obsFinal = "";
        for (var j = 0; j < observacoes.length; j++) {
          var statusAtual = classificarObservacao(observacoes[j]);
          if (PRIORIDADE_STATUS[statusAtual] > PRIORIDADE_STATUS[statusFinal]) {
            statusFinal = statusAtual;
            obsFinal = observacoes[j];
          } else if (obsFinal === "" && observacoes[j] !== "") {
            obsFinal = observacoes[j];
          }
        }
        mapaGuiasStatus[guiaKey] = statusFinal;
        mapaGuiasObservacao[guiaKey] = obsFinal;
      }
    }

    var mapaPacientes = {};
    var psiFiltro = normalizarTexto(psicologa);
    var filtroLimpo = filtroPaciente;
    var buscaExata = false;
    if (filtroPaciente && filtroPaciente !== "todos") {
      buscaExata = true;
      if (filtroPaciente.includes(" - ALTA")) filtroLimpo = filtroPaciente.split(" - ")[0].trim();
      filtroLimpo = normalizarTexto(filtroLimpo);
    }

    var abaAgenda = ssExterna.getSheetByName(NOME_ABA_AGENDA_EXTERNA);
    if (abaAgenda) {
      var dadosAgenda = abaAgenda.getDataRange().getValues();
      for (var i = 1; i < dadosAgenda.length; i++) {
        if (dadosAgenda[i].length <= COL_PSICOLOGA_AGENDA) continue;
        var rPsi = normalizarTexto(dadosAgenda[i][COL_PSICOLOGA_AGENDA] || "");
        var rPac = String(dadosAgenda[i][COL_PACIENTE] || "").trim().replace(/\n/g, " ");
        var rPacNormalizado = normalizarTexto(rPac);
        var rPlano = String(dadosAgenda[i][COL_PLANO] || "").trim();
        if (rPsi.includes(psiFiltro) && rPac !== "" && !rPac.includes("💚") && !rPac.toUpperCase().includes("LIVRE")) {
          if (!buscaExata || rPacNormalizado === filtroLimpo) {
            if (!mapaPacientes[rPacNormalizado]) {
              mapaPacientes[rPacNormalizado] = {
                nome: rPac,
                plano: rPlano,
                semana1: "",
                semana2: "",
                semana3: "",
                semana4: "",
                semana5: "",
                extras: [],
                isAlta: false
              };
            }
          }
        }
      }
    }

    var abaCancelados = ssExterna.getSheetByName("Cancelados");
    if (abaCancelados) {
      var dadosCanc = abaCancelados.getDataRange().getValues();
      for (var i = 1; i < dadosCanc.length; i++) {
        var dataRaw = dadosCanc[i][0];
        if (!dataRaw) continue;
        var mesCancel = -1, anoCancel = -1;
        if (dataRaw instanceof Date) {
          mesCancel = dataRaw.getMonth() + 1;
          anoCancel = dataRaw.getFullYear();
        } else if (typeof dataRaw === 'string') {
          var partes = dataRaw.split(' ')[0].split('/');
          if (partes.length === 3) {
            mesCancel = parseInt(partes[1]);
            anoCancel = parseInt(partes[2]);
          }
        }
        if (mesCancel !== parseInt(mes) || anoCancel !== parseInt(ano)) continue;
        var psiCanc = normalizarTexto(dadosCanc[i][6] || "");
        if (psiCanc !== "" && !psiCanc.includes(psiFiltro) && !psiFiltro.includes(psiCanc)) continue;
        var nomeCanc = String(dadosCanc[i][3] || "").trim().replace(/\n/g, " ");
        var planoCanc = String(dadosCanc[i][5] || "").trim();
        if (!nomeCanc) continue;
        var nomeCancNormalizado = normalizarTexto(nomeCanc);
        if (buscaExata && nomeCancNormalizado !== filtroLimpo) continue;
        if (mapaPacientes[nomeCancNormalizado]) {
          if (!mapaPacientes[nomeCancNormalizado].nome.includes(" - ALTA")) {
            mapaPacientes[nomeCancNormalizado].nome += " - ALTA";
          }
          mapaPacientes[nomeCancNormalizado].isAlta = true;
        } else {
          mapaPacientes[nomeCancNormalizado] = {
            nome: nomeCanc + " - ALTA",
            plano: planoCanc,
            semana1: "",
            semana2: "",
            semana3: "",
            semana4: "",
            semana5: "",
            extras: [],
            isAlta: true
          };
        }
      }
    }

    var ssLocal = SpreadsheetApp.getActiveSpreadsheet();
    var abaDb = ssLocal.getSheetByName(NOME_ABA_DB);
    if (abaDb) {
      var dadosDb = abaDb.getDataRange().getValues();
      for (var i = 1; i < dadosDb.length; i++) {
        var row = dadosDb[i];
        if (parseInt(row[1]) == parseInt(mes) && parseInt(row[2]) == parseInt(ano) && normalizarTexto(row[3]).includes(psiFiltro)) {
          var pacDb = normalizarTexto(row[4]);
          if (mapaPacientes[pacDb]) {
            mapaPacientes[pacDb].semana1 = formatarGuiasParaExibicao(row[6], row[7]);
            mapaPacientes[pacDb].semana2 = formatarGuiasParaExibicao(row[8], row[9]);
            mapaPacientes[pacDb].semana3 = formatarGuiasParaExibicao(row[10], row[11]);
            mapaPacientes[pacDb].semana4 = formatarGuiasParaExibicao(row[12], row[13]);
            mapaPacientes[pacDb].semana5 = formatarGuiasParaExibicao(row[14], row[15]);
            var extras = [];
            for (var col = 16; col < row.length; col += 2) {
              var v1 = row[col] ? String(row[col]).trim() : "";
              var v2 = (col + 1 < row.length && row[col + 1]) ? String(row[col + 1]).trim() : "";
              var formatted = formatarGuiasParaExibicao(v1, v2);
              if (formatted) extras.push(formatted);
            }
            if (extras.length > 0) mapaPacientes[pacDb].extras = extras;
          }
        }
      }
    }

    var pacientes = Object.values(mapaPacientes);
    pacientes.sort(function(a, b) {
      if (a.isAlta && !b.isAlta) return 1;
      if (!a.isAlta && b.isAlta) return -1;
      return a.nome.localeCompare(b.nome);
    });

    return {
      sucesso: true,
      pacientes: pacientes,
      mapaStatus: mapaGuiasStatus,
      mapaObservacao: mapaGuiasObservacao
    };
  } catch (e) {
    return { erro: "Erro interno: " + e.message };
  }
}

// ==============================================================
// FUNÇÕES ADICIONAIS
// ==============================================================
function limparDuplicadosBD() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var abaDb = ss.getSheetByName(NOME_ABA_DB);
    if (!abaDb) return { sucesso: false, erro: "Aba BD_GUIAS não encontrada" };
    var dados = abaDb.getDataRange().getValues();
    if (dados.length <= 1) return { sucesso: true, mensagem: "Nenhum dado para limpar" };
    var registrosUnicos = [dados[0]];
    var chavesVistas = new Set();
    for (var i = 1; i < dados.length; i++) {
      var row = dados[i];
      var chave = String(row[1]||"") + "|" + String(row[2]||"") + "|" + normalizarTexto(row[3]||"") + "|" + normalizarTexto(row[4]||"");
      if (!chavesVistas.has(chave)) { chavesVistas.add(chave); registrosUnicos.push(row); }
    }
    abaDb.clear();
    abaDb.getRange(1, 1, registrosUnicos.length, registrosUnicos[0].length).setValues(registrosUnicos);
    return { sucesso: true, mensagem: "Limpeza concluída! Removidos " + (dados.length - registrosUnicos.length) + " registros duplicados.", original: dados.length-1, final: registrosUnicos.length-1 };
  } catch (e) {
    console.error("Erro ao limpar duplicados:", e);
    return { sucesso: false, erro: e.message };
  }
}

function buscarGlosa(psicologa, guia) {
  try {
    var id = getIdPlanilhaDaPsicologa(psicologa);
    if (!id) return null;
    var ss = SpreadsheetApp.openById(id);
    var abaAtend = ss.getSheetByName(NOME_ABA_ATENDIMENTOS);
    if (!abaAtend) return null;
    var dados = abaAtend.getDataRange().getValues();
    var guiaAlvo = String(guia).trim();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][COL_GUIA_ATENDIMENTO]).trim() === guiaAlvo) {
        var observacao = String(dados[i][COL_OBSERVACAO] || "").trim();
        if (observacao !== "") return observacao;
      }
    }
    return null;
  } catch (e) {
    console.error("Erro ao buscar glosa:", e);
    return null;
  }
}

function buscarTodasGlosas(psicologa, guias) {
  try {
    var id = getIdPlanilhaDaPsicologa(psicologa);
    if (!id) return {};
    var ss = SpreadsheetApp.openById(id);
    var abaAtend = ss.getSheetByName(NOME_ABA_ATENDIMENTOS);
    if (!abaAtend) return {};
    var dados = abaAtend.getDataRange().getValues();
    var guiasSet = new Set(guias.map(function(g) { return String(g).trim(); }));
    var resultado = {};
    for (var i = 1; i < dados.length; i++) {
      var guia = String(dados[i][COL_GUIA_ATENDIMENTO]).trim();
      if (guiasSet.has(guia)) {
        var obs = String(dados[i][COL_OBSERVACAO] || "").trim();
        if (obs && obs.toUpperCase().indexOf("GLOSA") !== -1) resultado[guia] = obs;
      }
    }
    return resultado;
  } catch (e) {
    console.error("Erro em buscarTodasGlosas:", e);
    return {};
  }
}

function verificarEAplicarGlosasPendentes(psicologa) {
  return { sucesso: true, mensagem: "Nenhuma glosa pendente encontrada." };
}

function buscarTelefonePaciente(psicologa, nomePaciente) {
  try {
    var id = getIdPlanilhaDaPsicologa(psicologa);
    if (!id) return { sucesso: false, erro: "ID da planilha não encontrado." };
    var ssExterna = SpreadsheetApp.openById(id);
    var nomeBusca = normalizarTexto(nomePaciente);
    var abaAgenda = ssExterna.getSheetByName(NOME_ABA_AGENDA_EXTERNA);
    if (abaAgenda) {
      var dados = abaAgenda.getDataRange().getValues();
      for (var i = 1; i < dados.length; i++) {
        var nomeLinha = normalizarTexto(dados[i][2] || "");
        if (nomeLinha === nomeBusca || nomeLinha.includes(nomeBusca) || nomeBusca.includes(nomeLinha)) {
          var telefone = String(dados[i][3] || "").trim();
          if (telefone && telefone !== "" && telefone !== "0") return { sucesso: true, telefone: telefone, origem: "Agenda" };
        }
      }
    }
    var abaCancelados = ssExterna.getSheetByName("Cancelados");
    if (abaCancelados) {
      var dadosCanc = abaCancelados.getDataRange().getValues();
      for (var i = 1; i < dadosCanc.length; i++) {
        var nomeLinha = normalizarTexto(dadosCanc[i][3] || "");
        if (nomeLinha === nomeBusca || nomeLinha.includes(nomeBusca) || nomeBusca.includes(nomeLinha)) {
          var telefone = String(dadosCanc[i][4] || "").trim();
          if (telefone && telefone !== "" && telefone !== "0") return { sucesso: true, telefone: telefone, origem: "Cancelados" };
        }
      }
    }
    return { sucesso: false, erro: "Telefone não encontrado para " + nomePaciente };
  } catch (e) {
    console.error("Erro ao buscar telefone:", e);
    return { sucesso: false, erro: e.message };
  }
}

function buscarDadosAgendaPaciente(psicologa, nomePaciente) {
  try {
    var id = getIdPlanilhaDaPsicologa(psicologa);
    if (!id) return { sucesso: false, erro: "ID não encontrado" };
    var ssExterna = SpreadsheetApp.openById(id);
    var nomeBusca = normalizarTexto(nomePaciente);
    var abaAgenda = ssExterna.getSheetByName(NOME_ABA_AGENDA_EXTERNA);
    if (!abaAgenda) return { sucesso: false, erro: "Aba AGENDA não encontrada" };
    var dataRange = abaAgenda.getDataRange();
    var dados = dataRange.getValues();
    var dadosDisplay = dataRange.getDisplayValues();
    for (var i = 1; i < dados.length; i++) {
      var nomeLinha = normalizarTexto(dados[i][2] || "");
      if (nomeLinha === nomeBusca || nomeLinha.includes(nomeBusca) || nomeBusca.includes(nomeLinha)) {
        var telefone = String(dados[i][3] || "").trim();
        var diaSemanaDisplay = String(dadosDisplay[i][0] || "").trim();
        var horarioDisplay = String(dadosDisplay[i][1] || "").trim();
        var diaSemana = diaSemanaDisplay;
        if (diaSemana.includes(" ")) { var p = diaSemana.split(/[\s-]/)[0]; if (p.length >= 3) diaSemana = p; }
        var horario = "";
        var timeMatch = horarioDisplay.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) horario = String(timeMatch[1]).padStart(2, '0') + ':' + timeMatch[2];
        else if (horarioDisplay) horario = horarioDisplay;
        var anexoGuia = "";
        if (dados[i].length > 23) anexoGuia = String(dados[i][23] || "").trim();
        var anexoGuiaLink = "";
        if (anexoGuia && (anexoGuia.includes("http") || anexoGuia.includes("drive.google.com"))) anexoGuiaLink = anexoGuia;
        return { sucesso: true, diaSemana: diaSemana, horario: horario, telefone: telefone, anexoGuia: anexoGuiaLink, nome: String(dados[i][2] || "").trim() };
      }
    }
    return { sucesso: false, erro: "Paciente não encontrado na agenda" };
  } catch (e) {
    console.error("Erro ao buscar dados da agenda:", e);
    return { sucesso: false, erro: e.message };
  }
}

// ==============================================================
// DIA DA SEMANA + HORÁRIO + DATA DE ALTA EM LOTE (para o PDF)
// ==============================================================

// Busca em lote o dia da semana, horário E data de alta de todos os pacientes.
// Olha TANTO a aba AGENDA quanto a aba Cancelados.
// Retorna: { "NOME NORMALIZADO": { dia, horario, diaOriginal, dataAlta } }
function buscarAgendaCompletaPorPaciente(psicologa) {
  try {
    var id = getIdPlanilhaDaPsicologa(psicologa);
    if (!id) return {};
    var ssExterna = SpreadsheetApp.openById(id);
    var psiFiltro = normalizarTexto(psicologa);
    var resultado = {};

    // ---------- 1) Aba AGENDA (pacientes ativos) ----------
    var abaAgenda = ssExterna.getSheetByName(NOME_ABA_AGENDA_EXTERNA);
    if (abaAgenda) {
      var dataRange = abaAgenda.getDataRange();
      var dados = dataRange.getValues();
      var dadosDisplay = dataRange.getDisplayValues();
      for (var i = 1; i < dados.length; i++) {
        if (dados[i].length <= COL_PSICOLOGA_AGENDA) continue;
        var rPsi = normalizarTexto(dados[i][COL_PSICOLOGA_AGENDA] || "");
        if (!rPsi.includes(psiFiltro) && !psiFiltro.includes(rPsi)) continue;
        var nomeOriginal = String(dados[i][COL_PACIENTE] || "").trim().replace(/\n/g, " ");
        if (!nomeOriginal) continue;
        if (nomeOriginal.indexOf("💚") !== -1) continue;
        if (nomeOriginal.toUpperCase().indexOf("LIVRE") !== -1) continue;
        var nomeChave = normalizarTexto(nomeOriginal);
        var diaDisplay = String(dadosDisplay[i][0] || "").trim();
        var horarioDisplay = String(dadosDisplay[i][1] || "").trim();
        var dia = extrairDiaSemana(diaDisplay);
        var horario = extrairHorario(horarioDisplay);
        if (!resultado[nomeChave] ||
            (resultado[nomeChave].dia === "SEM DIA DEFINIDO" && dia !== "SEM DIA DEFINIDO")) {
          resultado[nomeChave] = {
            dia: dia,
            horario: horario,
            diaOriginal: diaDisplay,
            dataAlta: resultado[nomeChave] ? (resultado[nomeChave].dataAlta || "") : ""
          };
        }
      }
    }

    // ---------- 2) Aba Cancelados (pacientes com ALTA) ----------
    // Estrutura: A=Data Cancelamento, B=Dia da Semana, C=Horário, D=Paciente,
    //            E=Telefone, F=Plano, G=Psicóloga
    var abaCancelados = ssExterna.getSheetByName("Cancelados");
    if (abaCancelados) {
      var dc = abaCancelados.getDataRange();
      var dadosC = dc.getValues();
      var dadosCDisplay = dc.getDisplayValues();
      for (var j = 1; j < dadosC.length; j++) {
        if (dadosC[j].length <= 6) continue;
        var psiC = normalizarTexto(dadosC[j][6] || "");
        if (psiC !== "" && !psiC.includes(psiFiltro) && !psiFiltro.includes(psiC)) continue;
        var nomeC = String(dadosC[j][3] || "").trim().replace(/\n/g, " ");
        if (!nomeC) continue;

        var nomeCChave = normalizarTexto(nomeC);
        var diaCDisplay = String(dadosCDisplay[j][1] || "").trim();
        var horarioCDisplay = String(dadosCDisplay[j][2] || "").trim();
        var dataCDisplay = String(dadosCDisplay[j][0] || "").trim();
        var diaC = extrairDiaSemana(diaCDisplay);
        var horarioC = extrairHorario(horarioCDisplay);
        var dataAltaC = extrairDataAlta(dataCDisplay || dadosC[j][0]);

        var jaTem = resultado[nomeCChave];
        if (!jaTem) {
          // Só cria entrada nova se tiver dia definido OU data de alta válida
          if (diaC !== "SEM DIA DEFINIDO" || dataAltaC) {
            resultado[nomeCChave] = {
              dia: diaC,
              horario: horarioC,
              diaOriginal: diaCDisplay,
              dataAlta: dataAltaC
            };
          }
        } else {
          // Completa informações que estiverem faltando
          if (jaTem.dia === "SEM DIA DEFINIDO" && diaC !== "SEM DIA DEFINIDO") {
            jaTem.dia = diaC;
            jaTem.diaOriginal = diaCDisplay;
          }
          if (!jaTem.horario && horarioC) jaTem.horario = horarioC;
          // Guarda a data de alta mais recente (se já tiver uma, só substitui se a nova for "maior")
          if (dataAltaC) {
            if (!jaTem.dataAlta) {
              jaTem.dataAlta = dataAltaC;
            } else {
              var partesAtual = jaTem.dataAlta.split("/");
              var partesNova = dataAltaC.split("/");
              if (partesAtual.length === 3 && partesNova.length === 3) {
                var dAtual = new Date(partesAtual[2], partesAtual[1] - 1, partesAtual[0]);
                var dNova = new Date(partesNova[2], partesNova[1] - 1, partesNova[0]);
                if (dNova > dAtual) jaTem.dataAlta = dataAltaC;
              }
            }
          }
        }
      }
    }

    return resultado;
  } catch (e) {
    console.error("Erro em buscarAgendaCompletaPorPaciente:", e);
    return {};
  }
}

// Converte o texto bruto da coluna A da AGENDA (ou B de Cancelados) em um rótulo padronizado
function extrairDiaSemana(texto) {
  if (!texto) return "SEM DIA DEFINIDO";
  var t = normalizarTexto(texto);
  if (t.indexOf("SEGUNDA") !== -1) return "SEGUNDA-FEIRA";
  if (t.indexOf("TERCA")   !== -1) return "TERÇA-FEIRA";
  if (t.indexOf("QUARTA")  !== -1) return "QUARTA-FEIRA";
  if (t.indexOf("QUINTA")  !== -1) return "QUINTA-FEIRA";
  if (t.indexOf("SEXTA")   !== -1) return "SEXTA-FEIRA";
  if (t.indexOf("SABADO")  !== -1) return "SÁBADO";
  if (t.indexOf("DOMINGO") !== -1) return "DOMINGO";
  return "SEM DIA DEFINIDO";
}

// Extrai HH:MM de textos como "08:00", "8h", "8:00:00", "08h30", "8"
function extrairHorario(texto) {
  if (!texto) return "";
  var s = String(texto).trim();
  var m = s.match(/(\d{1,2})\s*[:hH]\s*(\d{2})/);
  if (m) {
    return String(m[1]).padStart(2, "0") + ":" + m[2];
  }
  var m2 = s.match(/^(\d{1,2})$/);
  if (m2) return String(m2[1]).padStart(2, "0") + ":00";
  return s;
}

// ==============================================================
// FUNÇÃO GERAR RELATÓRIO PDF
// Organizado por dia da semana, com faixa destacada, coluna de horário,
// 18 pacientes por página e, para pacientes com ALTA, mostra em letra
// menor "Paciente com alta em DD/MM/AAAA".
// ==============================================================
function gerarRelatorioPDF(psicologa, mes, ano) {
  try {
    var resultado = buscarDadosBackend(psicologa, mes, ano, 'todos');
    if (resultado.erro) throw new Error(resultado.erro);
    var pacientes = resultado.pacientes;
    var mapaStatus = resultado.mapaStatus;

    // ---------- 1) Descobrir dia da semana + horário + data de alta ----------
    var agendaMap = buscarAgendaCompletaPorPaciente(psicologa);
    pacientes.forEach(function (p) {
      var nomeLimpo = String(p.nome).replace(/\s*-\s*ALTA.*$/i, "").trim();
      var chave = normalizarTexto(nomeLimpo);
      var info = agendaMap[chave];
      p.diaSemana = info ? info.dia : "SEM DIA DEFINIDO";
      p.horario = info ? info.horario : "";
      p.dataAlta = (info && info.dataAlta) ? info.dataAlta : "";
    });

    // ---------- 2) Todas as guias + status detalhado ----------
    var todasGuias = new Set();
    pacientes.forEach(function (p) {
      [p.semana1, p.semana2, p.semana3, p.semana4, p.semana5].forEach(function (s) {
        if (s) String(s).split(" / ").forEach(function (g) {
          var gl = g.trim();
          if (gl && isGuiaValida(gl)) todasGuias.add(gl);
        });
      });
      if (p.extras) p.extras.forEach(function (e) {
        if (e) String(e).split(" / ").forEach(function (g) {
          var gl = g.trim();
          if (gl && isGuiaValida(gl)) todasGuias.add(gl);
        });
      });
    });
    var mapaStatusDetalhado = buscarStatusDetalhadoGuias(psicologa, Array.from(todasGuias));

    // ---------- 3) Agrupar por dia da semana ----------
    var ORDEM_DIAS = [
      "SEGUNDA-FEIRA", "TERÇA-FEIRA", "QUARTA-FEIRA",
      "QUINTA-FEIRA", "SEXTA-FEIRA", "SÁBADO", "DOMINGO",
      "SEM DIA DEFINIDO"
    ];
    var grupos = {};
    ORDEM_DIAS.forEach(function (d) { grupos[d] = []; });
    pacientes.forEach(function (p) {
      var d = p.diaSemana || "SEM DIA DEFINIDO";
      if (!grupos[d]) grupos[d] = [];
      grupos[d].push(p);
    });

    // Ordenação interna: altas por último, depois por horário, depois nome
    ORDEM_DIAS.forEach(function (d) {
      grupos[d].sort(function (a, b) {
        var aAlta = a.nome.indexOf("ALTA") !== -1;
        var bAlta = b.nome.indexOf("ALTA") !== -1;
        if (aAlta && !bAlta) return 1;
        if (!aAlta && bAlta) return -1;
        if (a.horario && b.horario) return a.horario.localeCompare(b.horario);
        if (a.horario && !b.horario) return -1;
        if (!a.horario && b.horario) return 1;
        return a.nome.localeCompare(b.nome);
      });
    });

    var totalGeral = pacientes.length;
    var totalAlta = pacientes.filter(function (p) { return p.nome.indexOf("ALTA") !== -1; }).length;
    var totalAtivos = totalGeral - totalAlta;

    // ---------- 4) Paginar (18 por página) ----------
    var ITENS_POR_PAGINA = 18;
    var paginas = [];
    ORDEM_DIAS.forEach(function (dia) {
      var lista = grupos[dia];
      if (!lista || lista.length === 0) return;
      var numPag = Math.ceil(lista.length / ITENS_POR_PAGINA);
      for (var i = 0; i < numPag; i++) {
        paginas.push({
          dia: dia,
          lote: lista.slice(i * ITENS_POR_PAGINA, (i + 1) * ITENS_POR_PAGINA),
          numPagDia: i + 1,
          totalPagDia: numPag
        });
      }
    });
    var totalPaginas = paginas.length || 1;

    var limparNome = function (n) { return String(n).split(" - ")[0].trim(); };

    var obterLabelGuia = function (guiaNumero) {
      var statusDet = mapaStatusDetalhado[guiaNumero] || {};
      var statusPadrao = mapaStatus[guiaNumero] || "REGISTRADA";
      if (statusDet.temFalta) return { classeGuia: "guia-falta", label: "FALTA", corTexto: "falta-text" };
      if (statusDet.temTipoAtendimento) return { classeGuia: "guia-validar-falta", label: "Validar falta?", corTexto: "validar-text" };
      if (statusPadrao === "FATURADA") return { classeGuia: "", label: "FATURADA", corTexto: "ok" };
      if (statusPadrao === "GLOSA" || statusPadrao === "GLOSA_PENDENTE") return { classeGuia: "", label: "GLOSA", corTexto: "exc" };
      if (statusPadrao === "EXCLUIDO") return { classeGuia: "", label: "EXCLUÍDA", corTexto: "exc" };
      if (statusPadrao === "FALTA") return { classeGuia: "guia-falta", label: "FALTA", corTexto: "falta-text" };
      return { classeGuia: "", label: "REGISTRADA", corTexto: "reg" };
    };

    // ---------- 5) CSS ----------
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
      '@page{size:A4 landscape;margin:0;}' +
      'body{font-family:"Helvetica",Arial,sans-serif;margin:0;padding:0;-webkit-print-color-adjust:exact;}' +
      '.pagina{width:297mm;height:210mm;padding:7mm 8mm;box-sizing:border-box;position:relative;page-break-after:always;display:flex;flex-direction:column;background:#fff;}' +
      '.pagina:last-child{page-break-after:avoid;}' +
      '.header{border-bottom:2px solid #1e3a8a;padding-bottom:3px;margin-bottom:5px;display:flex;justify-content:space-between;align-items:flex-end;flex-shrink:0;height:24px;}' +
      '.title{font-size:15px;font-weight:bold;color:#1e3a8a;text-transform:uppercase;}' +
      '.sub-info{text-align:right;font-size:9px;color:#555;line-height:1.15;}' +
      '.dia-banner{background:linear-gradient(135deg,#1e3a8a 0%,#3b82f6 100%);color:#fff;padding:6px 14px;text-align:center;font-size:17px;font-weight:900;letter-spacing:3px;border-radius:6px;margin-bottom:5px;text-transform:uppercase;box-shadow:0 2px 6px rgba(30,58,138,0.3);flex-shrink:0;}' +
      '.dia-banner .pag-info{display:block;font-size:9px;font-weight:500;letter-spacing:1px;opacity:0.85;margin-top:1px;}' +
      '.main-card{flex-grow:1;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;padding:3px;display:flex;flex-direction:column;overflow:hidden;margin-bottom:3px;}' +
      'table{width:100%;height:100%;border-collapse:separate;border-spacing:0 2px;table-layout:fixed;}' +
      'th{height:16px;font-size:8px;padding:2px 2px;text-align:center;font-weight:bold;color:#475569;border:none;}' +
      'th.th-nome{text-align:left;padding-left:8px;}' +
      'th.th-hora{background:#dbeafe;color:#1e3a8a;}' +
      'td{height:26px;vertical-align:middle;background:#fff;border-top:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1;font-size:9px;padding:0 3px;white-space:normal;}' +
      '.td-nome{border-left:1px solid #cbd5e1;border-top-left-radius:5px;border-bottom-left-radius:5px;padding:2px 3px 2px 8px;font-weight:bold;color:#1e293b;font-size:9.5px;overflow:visible;}' +
      '.td-nome .nome-linha{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.td-nome .plano-sub{font-size:0.78em;color:#64748b;font-weight:normal;margin-left:4px;}' +
      '.td-nome .alta-info{display:block;font-size:7.5px;font-weight:700;color:#b91c1c;font-style:italic;margin-top:1px;letter-spacing:0.2px;}' +
      '.td-hora{text-align:center;font-weight:900;color:#1e3a8a;background:#eff6ff !important;font-size:10.5px;letter-spacing:0.3px;}' +
      '.td-sem{text-align:center;overflow:hidden;}' +
      '.td-fim{border-right:1px solid #cbd5e1;border-top-right-radius:5px;border-bottom-right-radius:5px;}' +
      '.guia-wrapper{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:2px;width:100%;height:100%;overflow:hidden;}' +
      '.guia-item{display:flex;flex-direction:column;align-items:center;line-height:1;position:relative;}' +
      '.guia-box{font-size:7.5px;font-weight:bold;padding:1px 2px;border:1px solid #94a3b8;background:#f1f5f9;border-radius:2px;color:#334155;min-width:48px;text-align:center;}' +
      '.guia-falta .guia-box{border-color:#dc2626 !important;color:#dc2626 !important;background:#fef2f2 !important;text-decoration:line-through !important;text-decoration-color:#dc2626 !important;text-decoration-thickness:2px !important;}' +
      '.guia-falta .st-text{color:#dc2626 !important;font-weight:900 !important;}' +
      '.guia-validar-falta .guia-box{border-color:#f97316 !important;color:#9a3412 !important;background:#ffedd5 !important;}' +
      '.guia-validar-falta .st-text{color:#f97316 !important;font-weight:900 !important;}' +
      '.st-text{font-size:4.5px;font-weight:900;text-transform:uppercase;margin-top:1px;letter-spacing:0.2px;}' +
      '.footer{border-top:2px solid #1e3a8a;padding-top:3px;display:flex;justify-content:space-between;font-size:10px;color:#1e3a8a;font-weight:bold;height:16px;flex-shrink:0;}' +
      '.row-alta td{background-color:#fee2e2 !important;border-color:#fca5a5 !important;}' +
      '.row-alta .td-nome{color:#b91c1c !important;}' +
      '.row-alta .td-nome .plano-sub{color:#dc2626;}' +
      '.row-alta .td-hora{color:#b91c1c !important;background:#fee2e2 !important;}' +
      '.row-alta .guia-box{border-color:#ef4444;color:#b91c1c;background:#fff;}' +
      '.row-alta-espacada td{padding-top:3px;padding-bottom:3px;}' +
      '.ok{color:#065f46;}.exc{color:#dc2626;}.reg{color:#d97706;}' +
      '.falta-text{color:#dc2626;font-weight:bold;}.validar-text{color:#f97316;font-weight:bold;}' +
      '</style></head><body>';

    if (paginas.length === 0) {
      html += '<div class="pagina">' +
        '<div class="header"><div class="title">RELATÓRIO - ' + psicologa.toUpperCase() + '</div>' +
        '<div class="sub-info"><b>' + mes + '/' + ano + '</b></div></div>' +
        '<div class="main-card" style="display:flex;align-items:center;justify-content:center;color:#64748b;font-size:16px;">Nenhum registro encontrado.</div></div>';
    }

    // ---------- 6) Renderizar cada página ----------
    for (var pi = 0; pi < paginas.length; pi++) {
      var pg = paginas[pi];
      var lote = pg.lote.slice();
      var maxExtrasLote = 0;
      lote.forEach(function (p) { if (p.extras && p.extras.length > maxExtrasLote) maxExtrasLote = p.extras.length; });

      var weekWidth = Math.floor((100 - 25 - 9) / (5 + maxExtrasLote));

      html += '<div class="pagina">' +
        '<div class="header">' +
          '<div class="title">RELATÓRIO - ' + psicologa.toUpperCase() + '</div>' +
          '<div class="sub-info"><b>' + mes + '/' + ano + '</b> &nbsp;|&nbsp; Página ' + (pi + 1) + ' de ' + totalPaginas +
            '<br>Emissão: ' + Utilities.formatDate(new Date(), "GMT-3", "dd/MM/yyyy HH:mm") + '</div>' +
        '</div>' +
        '<div class="dia-banner">' + pg.dia +
          '<span class="pag-info">' +
            pg.lote.length + ' paciente(s)' +
            (pg.totalPagDia > 1 ? ' • página ' + pg.numPagDia + ' de ' + pg.totalPagDia : '') +
          '</span>' +
        '</div>' +
        '<div class="main-card"><table><thead><tr>' +
          '<th class="th-nome" width="25%">PACIENTE</th>' +
          '<th class="th-hora" width="9%">HORÁRIO</th>' +
          '<th width="' + weekWidth + '%">SEM 1</th>' +
          '<th width="' + weekWidth + '%">SEM 2</th>' +
          '<th width="' + weekWidth + '%">SEM 3</th>' +
          '<th width="' + weekWidth + '%">SEM 4</th>' +
          '<th width="' + weekWidth + '%">SEM 5</th>';

      for (var ex = 0; ex < maxExtrasLote; ex++) {
        html += '<th width="' + weekWidth + '%" style="background:#6d28d9;color:#fff;">EXT ' + (ex + 1) + '</th>';
      }
      html += '</tr></thead><tbody>';

      lote.forEach(function (p) {
        var isAlta = p.nome.indexOf("ALTA") !== -1;
        var classeLinha = isAlta ? "row-alta row-alta-espacada" : "";
        html += '<tr class="' + classeLinha + '">';

        // Nome + plano + (se ALTA) aviso "Paciente com alta em DD/MM/AAAA"
        var linhaNome = '<span class="nome-linha">' + limparNome(p.nome).toUpperCase() +
                        '<span class="plano-sub">' + (p.plano || "") + '</span></span>';
        var linhaAlta = "";
        if (isAlta && p.dataAlta) {
          linhaAlta = '<span class="alta-info">Paciente com alta em ' + p.dataAlta + '</span>';
        }
        html += '<td class="td-nome">' + linhaNome + linhaAlta + '</td>';

        html += '<td class="td-hora">' + (p.horario || "—") + '</td>';

        [p.semana1, p.semana2, p.semana3, p.semana4, p.semana5].forEach(function (s, idx) {
          var clsTd = (idx === 4 && (!p.extras || p.extras.length === 0)) ? "td-sem td-fim" : "td-sem";
          html += '<td class="' + clsTd + '">';
          if (s) {
            html += '<div class="guia-wrapper">';
            String(s).split(" / ").forEach(function (g) {
              var gNum = g.trim();
              if (gNum && isGuiaValida(gNum)) {
                var info = obterLabelGuia(gNum);
                html += '<div class="guia-item ' + info.classeGuia + '">' +
                          '<span class="guia-box">' + gNum + '</span>' +
                          '<span class="st-text ' + info.corTexto + '">' + info.label + '</span>' +
                        '</div>';
              }
            });
            html += '</div>';
          }
          html += '</td>';
        });

        var extrasCount = (p.extras && p.extras.length) ? p.extras.length : 0;
        for (var ex2 = 0; ex2 < maxExtrasLote; ex2++) {
          var clsTd2 = (ex2 === maxExtrasLote - 1) ? "td-sem td-fim" : "td-sem";
          var sExt = (ex2 < extrasCount) ? p.extras[ex2] : "";
          html += '<td class="' + clsTd2 + '" style="background:#f5f3ff;">';
          if (sExt) {
            html += '<div class="guia-wrapper">';
            String(sExt).split(" / ").forEach(function (g) {
              var gNum = g.trim();
              if (gNum && isGuiaValida(gNum)) {
                var info = obterLabelGuia(gNum);
                html += '<div class="guia-item ' + info.classeGuia + '">' +
                          '<span class="guia-box">' + gNum + '</span>' +
                          '<span class="st-text ' + info.corTexto + '">' + info.label + '</span>' +
                        '</div>';
              }
            });
            html += '</div>';
          }
          html += '</td>';
        }
        html += '</tr>';
      });

      var faltam = ITENS_POR_PAGINA - lote.length;
      for (var f = 0; f < faltam; f++) {
        html += '<tr>' +
          '<td style="border:none;background:transparent;"></td>' +
          '<td style="border:none;background:transparent;"></td>' +
          '<td style="border:none;background:transparent;" colspan="' + (5 + maxExtrasLote) + '"></td>' +
        '</tr>';
      }

      html += '</tbody></table></div>' +
        '<div class="footer">' +
          '<div>ATIVOS: ' + totalAtivos + '</div>' +
          '<div style="color:' + (totalAlta > 0 ? '#dc2626' : '#1e3a8a') + '">ALTAS: ' + totalAlta + '</div>' +
          '<div>TOTAL GERAL: ' + totalGeral + '</div>' +
        '</div></div>';
    }

    html += '</body></html>';

    var blob = Utilities.newBlob(html, MimeType.HTML).getAs(MimeType.PDF);
    return { sucesso: true, base64: Utilities.base64Encode(blob.getBytes()) };
  } catch (e) {
    return { sucesso: false, erro: e.toString() };
  }
}

// ==============================================================
// FUNÇÃO DIAGNÓSTICO
// ==============================================================
function diagnosticarPlanilha(psicologa) {
  try {
    console.log("=== DIAGNÓSTICO DA PLANILHA ===");
    var id = getIdPlanilhaDaPsicologa(psicologa);
    console.log("1. ID encontrado:", id);
    if (!id) return "ID NÃO ENCONTRADO!";
    var ss = SpreadsheetApp.openById(id);
    console.log("2. Planilha aberta:", ss.getName());
    var abaAtend = ss.getSheetByName(NOME_ABA_ATENDIMENTOS);
    if (!abaAtend) {
      console.log("3. Aba ATENDIMENTOS não encontrada!");
      return "ABA ATENDIMENTOS NÃO ENCONTRADA!";
    }
    console.log("3. Aba ATENDIMENTOS encontrada");
    var cabecalho = abaAtend.getRange(1, 1, 1, 30).getValues()[0];
    console.log("4. Cabeçalho da planilha:");
    for (var i = 0; i < cabecalho.length; i++) {
      if (cabecalho[i]) {
        console.log("   Coluna " + (i+1) + " (Letra " + String.fromCharCode(65 + i) + "): '" + cabecalho[i] + "'");
      }
    }
    var ultimaLinha = abaAtend.getLastRow();
    console.log("5. Última linha com dados:", ultimaLinha);
    if (ultimaLinha > 1) {
      var amostra = abaAtend.getRange(2, 1, 3, 20).getValues();
      console.log("6. Amostra de dados (3 primeiras linhas):");
      for (var i = 0; i < amostra.length; i++) {
        var linha = amostra[i];
        console.log("   Linha " + (i+2) + ":");
        console.log("     Coluna 5 (Guia): '" + linha[4] + "'");
        console.log("     Coluna 6 (Tipo): '" + linha[5] + "'");
        console.log("     Coluna 19 (Observação/S): '" + linha[18] + "'");
        console.log("     Coluna 20 (T): '" + linha[19] + "'");
      }
    }
    var temColunaS = cabecalho.length > 18;
    console.log("7. Coluna S (19) existe? " + (temColunaS ? "SIM" : "NÃO"));
    if (temColunaS) {
      console.log("   Nome da coluna 19: '" + cabecalho[18] + "'");
    }
    return "DIAGNÓSTICO CONCLUÍDO! Verifique os logs acima.";
  } catch (e) {
    console.error("ERRO NO DIAGNÓSTICO:", e);
    return "ERRO: " + e.message;
  }
}

// ==============================================================
// FUNÇÃO RASTREAMENTO DE SALVAMENTO
// ==============================================================
function rastrearSalvamento(psicologa, numeroGuia, statusDesejado) {
  try {
    console.log("=== RASTREAMENTO DE SALVAMENTO ===");
    console.log("Parâmetros:");
    console.log("  Psicóloga:", psicologa);
    console.log("  Número da Guia:", numeroGuia);
    console.log("  Status desejado:", statusDesejado);
    console.log("-----------------------------------");

    var id = getIdPlanilhaDaPsicologa(psicologa);
    console.log("PASSO 1: ID:", id);
    if (!id) return { passo: "ID", sucesso: false, erro: "ID não encontrado" };

    var ss = SpreadsheetApp.openById(id);
    console.log("PASSO 2: Planilha aberta:", ss.getName());

    var abaAtend = ss.getSheetByName(NOME_ABA_ATENDIMENTOS);
    if (!abaAtend) return { passo: "Aba", sucesso: false, erro: "Aba não encontrada" };
    console.log("PASSO 3: Aba encontrada");

    var dados = abaAtend.getDataRange().getValues();
    console.log("PASSO 4: Total de linhas:", dados.length);

    var guiaAlvo = String(numeroGuia).trim();
    var linhasEncontradas = [];

    for (var i = 1; i < dados.length; i++) {
      var guiaLinha = String(dados[i][COL_GUIA_ATENDIMENTO] || "").trim();
      if (guiaLinha === guiaAlvo) {
        linhasEncontradas.push({
          numeroLinha: i + 1,
          obsAtual: dados[i][COL_OBSERVACAO] || ""
        });
        console.log("  Guia encontrada na linha " + (i+1) + " com obs: '" + dados[i][COL_OBSERVACAO] + "'");
      }
    }

    if (linhasEncontradas.length === 0) {
      console.log("  ❌ GUIA NÃO ENCONTRADA!");
      return { passo: "Busca", sucesso: false, erro: "Guia não encontrada" };
    }

    var valorParaSalvar = statusDesejado === "FATURADA" ? "OK" : statusDesejado;
    console.log("PASSO 5: Salvando '" + valorParaSalvar + "'...");

    var resultados = [];
    for (var j = 0; j < linhasEncontradas.length; j++) {
      var linha = linhasEncontradas[j];
      try {
        var range = abaAtend.getRange(linha.numeroLinha, COL_OBSERVACAO + 1);
        range.setValue(valorParaSalvar);
        var verificado = abaAtend.getRange(linha.numeroLinha, COL_OBSERVACAO + 1).getValue();
        var sucesso = String(verificado).trim() === valorParaSalvar;
        resultados.push({
          linha: linha.numeroLinha,
          sucesso: sucesso,
          esperado: valorParaSalvar,
          encontrado: verificado
        });
        console.log("  Linha " + linha.numeroLinha + ": " + (sucesso ? "✅ SUCESSO" : "❌ FALHA"));
      } catch (e) {
        resultados.push({ linha: linha.numeroLinha, sucesso: false, erro: e.message });
        console.log("  Linha " + linha.numeroLinha + ": ❌ ERRO - " + e.message);
      }
    }

    return {
      sucesso: resultados.some(r => r.sucesso),
      linhasEncontradas: linhasEncontradas.length,
      resultados: resultados
    };

  } catch (e) {
    console.error("ERRO:", e);
    return { sucesso: false, erro: e.message };
  }
}

function testarBackend() {
  var psi = "Samara Rapanos Pasqualotto";
  var mes = 8;
  var ano = 2026;
  var resultado = buscarDadosBackend(psi, mes, ano, "todos");
  Logger.log("mapaStatus: " + JSON.stringify(resultado.mapaStatus));
}

// =======================================================
// DIAGNÓSTICO — Estrutura da aba BD_GUIAS (planilha central)
// =======================================================
const ID_PLANILHA_CENTRAL_DIAG = "1UfPPZYnNoEPyMzqAP3TtxB9Sjyg9KxePcVRmIZk-TeA";
const NOME_ABA_DIAG = "BD_GUIAS";

function onOpen() {
  SpreadsheetApp.getUi().createMenu("🔎 Diagnóstico")
    .addItem("Gerar relatório da BD_GUIAS", "diagnosticarBDGuias")
    .addToUi();
}

function diagnosticarBDGuias() {
  try {
    const ss = SpreadsheetApp.openById(ID_PLANILHA_CENTRAL_DIAG);
    let linhas = [];

    linhas.push("========== DIAGNÓSTICO BD_GUIAS ==========");
    linhas.push("Gerado em: " + new Date().toLocaleString("pt-BR"));
    linhas.push("");

    linhas.push("--- ABAS EXISTENTES NA PLANILHA CENTRAL ---");
    ss.getSheets().forEach(function(sheet) {
      linhas.push("• " + sheet.getName() +
        " (linhas: " + sheet.getLastRow() + ", colunas: " + sheet.getLastColumn() + ")");
    });
    linhas.push("");

    const aba = ss.getSheetByName(NOME_ABA_DIAG);
    if (!aba) {
      linhas.push("⚠️ Aba '" + NOME_ABA_DIAG + "' NÃO encontrada nesta planilha!");
      mostrarRelatorio(linhas.join("\n"));
      return;
    }

    const ultimaLinha = aba.getLastRow();
    const ultimaColuna = aba.getLastColumn();

    linhas.push("--- ABA '" + NOME_ABA_DIAG + "' ---");
    linhas.push("Última linha: " + ultimaLinha + " | Última coluna: " + ultimaColuna);
    linhas.push("");

    linhas.push("--- CABEÇALHO (linha 1) ---");
    const cabecalho = aba.getRange(1, 1, 1, ultimaColuna).getValues()[0];
    cabecalho.forEach(function(valor, idx) {
      const letra = colunaParaLetra(idx + 1);
      linhas.push(letra + "1 (col " + (idx + 1) + "): " + JSON.stringify(valor));
    });
    linhas.push("");

    if (ultimaLinha >= 2) {
      linhas.push("--- LINHA 2 (para checar se também é cabeçalho/subtítulo) ---");
      const linha2 = aba.getRange(2, 1, 1, ultimaColuna).getValues()[0];
      linha2.forEach(function(valor, idx) {
        const letra = colunaParaLetra(idx + 1);
        linhas.push(letra + "2 (col " + (idx + 1) + "): " + JSON.stringify(valor));
      });
      linhas.push("");
    }

    const primeiraLinhaDados = detectarPrimeiraLinhaDados(aba, ultimaColuna);
    linhas.push("--- AMOSTRA DE DADOS (a partir da linha " + primeiraLinhaDados + ") ---");
    const qtdAmostra = Math.min(5, ultimaLinha - primeiraLinhaDados + 1);
    if (qtdAmostra > 0) {
      const amostra = aba.getRange(primeiraLinhaDados, 1, qtdAmostra, ultimaColuna).getValues();
      amostra.forEach(function(linha, i) {
        linhas.push("Linha " + (primeiraLinhaDados + i) + ":");
        linha.forEach(function(valor, idx) {
          const letra = colunaParaLetra(idx + 1);
          if (valor !== "" && valor !== null) {
            linhas.push("   " + letra + " (col " + (idx + 1) + "): " + JSON.stringify(valor));
          }
        });
      });
    } else {
      linhas.push("(Nenhuma linha de dados encontrada abaixo do cabeçalho)");
    }
    linhas.push("");

    linhas.push("--- CÉLULAS MESCLADAS (linhas 1-2, colunas 1 a " + ultimaColuna + ") ---");
    const rangeCheck = aba.getRange(1, 1, 2, ultimaColuna);
    const mescladas = rangeCheck.getMergedRanges();
    if (mescladas.length === 0) {
      linhas.push("(Nenhuma célula mesclada encontrada nessa área)");
    } else {
      mescladas.forEach(function(r) {
        linhas.push("• " + r.getA1Notation());
      });
    }

    mostrarRelatorio(linhas.join("\n"));

  } catch (e) {
    mostrarRelatorio("ERRO ao gerar diagnóstico: " + e.message + "\n" + e.stack);
  }
}

function detectarPrimeiraLinhaDados(aba, ultimaColuna) {
  const max = Math.min(aba.getLastRow(), 6);
  for (let r = 1; r <= max; r++) {
    const valCol5 = aba.getRange(r, 5).getValue();
    if (valCol5 && String(valCol5).trim() !== "" && r > 1) {
      return r;
    }
  }
  return 3;
}

function colunaParaLetra(col) {
  let letra = "";
  while (col > 0) {
    let resto = (col - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    col = Math.floor((col - 1) / 26);
  }
  return letra;
}

function mostrarRelatorio(texto) {
  const html = HtmlService.createHtmlOutput(
    '<textarea style="width:100%;height:500px;font-family:monospace;font-size:12px;" onclick="this.select()">' +
    texto.replace(/</g, "&lt;").replace(/>/g, "&gt;") +
    '</textarea>' +
    '<p style="font-family:sans-serif;font-size:12px;color:#555;">Clique na caixa acima, Ctrl+A, Ctrl+C, e cole a resposta pra mim.</p>'
  ).setWidth(700).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, "Diagnóstico BD_GUIAS");
}