/**
 * =============================================================================
 * HOPE — GERADOR GENÉRICO DE INVENTÁRIO DE PROJETO (para entregar à Claude)
 * =============================================================================
 *
 * COMO USAR:
 * 1) Em cada projeto Apps Script (Hope Painel, Sistema Unificado PSI, RPA,
 *    Financeiro, etc.), crie um NOVO arquivo de script chamado, por exemplo,
 *    "Inventario_IA.gs" e cole todo este conteúdo nele.
 *    -> Não cole dentro do Code.gs existente. Arquivo separado evita qualquer
 *       risco de conflito com funções que já existem no seu sistema.
 * 2) Na barra de funções do editor, selecione "hopeInvGerar" e clique em
 *    Executar. Na primeira vez ele vai pedir autorização — são as MESMAS
 *    permissões que o projeto já usa (Planilhas), então não deve gerar
 *    nenhuma tela de escopo nova/assustadora.
 * 3) Além da aba "INVENTARIO_IA" na planilha, o script cria um GOOGLE DOC
 *    (e um PDF, salvos na sua pasta "Meu Drive") com o mesmo conteúdo já
 *    formatado — muito mais fácil de ler do que uma célula de planilha.
 *    Os links de ambos aparecem no Registro de Execução (Ver > Registros)
 *    ao final da execução.
 *
 * O QUE ESTE SCRIPT NUNCA FAZ:
 * - Nunca lê, copia ou expõe dados de pacientes (linhas de conteúdo).
 *   Só lê nomes de abas, cabeçalhos (linha 1) e contagem de linhas.
 * - Nunca lê senhas, tokens, chaves de API ou variáveis de PropertiesService.
 * - Nunca altera nada no seu sistema — é 100% somente leitura.
 *
 * Todas as funções usam o prefixo "hopeInv" para não colidir com nomes que
 * já existam nos seus mais de 20 projetos.
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// FUNÇÃO PRINCIPAL — rode esta
// -----------------------------------------------------------------------------
function hopeInvGerar() {
  var linhas = [];
  var agora = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT-3', 'dd/MM/yyyy HH:mm:ss');

  linhas.push('# INVENTÁRIO DE PROJETO — HOPE');
  linhas.push('Gerado em: ' + agora);
  linhas.push('');

  linhas.push('## IDENTIFICAÇÃO');
  linhas.push.apply(linhas, hopeInv_identificacao_());
  linhas.push('');

  linhas.push('## PLANILHA VINCULADA');
  linhas.push.apply(linhas, hopeInv_planilha_());
  linhas.push('');

  linhas.push('## GATILHOS (TRIGGERS) DESTE PROJETO');
  linhas.push.apply(linhas, hopeInv_triggers_());
  linhas.push('');

  linhas.push('## OBSERVAÇÕES (preencher manualmente antes de enviar à Claude)');
  linhas.push('- Finalidade do sistema:');
  linhas.push('- Integrações externas (WhatsApp, e-mail, Calendar, Bling, etc.):');
  linhas.push('- Regras de negócio especiais:');
  linhas.push('- Este sistema é usado por: (ex: todas as psicólogas / só administrativo)');
  linhas.push('');

  var relatorio = linhas.join('\n');

  hopeInv_salvarNaPlanilha_(relatorio);

  var linksDoc = hopeInv_salvarComoDoc_(relatorio);
  if (linksDoc) {
    Logger.log('DOC: ' + linksDoc.docUrl);
    if (linksDoc.pdfUrl) {
      Logger.log('PDF: ' + linksDoc.pdfUrl);
    }
  }

  Logger.log(relatorio);

  // Aviso não-bloqueante (toast some sozinho) — nunca trava a execução esperando clique.
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Inventário pronto. Veja o link do Doc/PDF em Ver > Registros de execução.',
      'HOPE — Inventário', 10
    );
  } catch (e) {
    // Sem contexto de planilha visível — tudo bem, ignora.
  }
}

// -----------------------------------------------------------------------------
// IDENTIFICAÇÃO DO PROJETO
// -----------------------------------------------------------------------------
function hopeInv_identificacao_() {
  var out = [];

  try {
    out.push('- ID do Script: ' + ScriptApp.getScriptId());
    out.push('- URL do Editor: https://script.google.com/d/' + ScriptApp.getScriptId() + '/edit');
  } catch (e) {
    out.push('- ID do Script: N/D (' + e.message + ')');
  }

  try {
    var url = ScriptApp.getService().getUrl();
    out.push('- URL Web App publicado: ' + (url || 'não publicado como Web App, ou não disponível neste contexto'));
  } catch (e) {
    out.push('- URL Web App publicado: N/D');
  }

  try {
    out.push('- Fuso horário do script: ' + Session.getScriptTimeZone());
  } catch (e) {
    out.push('- Fuso horário do script: N/D');
  }

  try {
    out.push('- Usuário que executou o inventário: ' + Session.getEffectiveUser().getEmail());
  } catch (e) {
    out.push('- Usuário que executou o inventário: N/D (sem permissão)');
  }

  return out;
}

// -----------------------------------------------------------------------------
// ESTRUTURA DA PLANILHA VINCULADA (sem dados de pacientes — só estrutura)
// -----------------------------------------------------------------------------
function hopeInv_planilha_() {
  var out = [];
  var ss;

  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    out.push('- Este projeto não está vinculado a uma planilha, ou não foi possível acessá-la.');
    return out;
  }

  if (!ss) {
    out.push('- Este projeto não está vinculado a uma planilha.');
    return out;
  }

  try {
    out.push('- Nome: ' + ss.getName());
    out.push('- ID: ' + ss.getId());
    out.push('- URL: ' + ss.getUrl());
  } catch (e) {
    out.push('- Dados básicos da planilha: N/D (' + e.message + ')');
  }

  var abas = ss.getSheets();
  out.push('- Total de abas: ' + abas.length);
  out.push('');

  abas.forEach(function (aba) {
    try {
      var nome = aba.getName();
      var linhas = aba.getLastRow();
      var colunas = aba.getLastColumn();
      var cabecalhos = [];

      if (linhas > 0 && colunas > 0) {
        var valoresCabecalho = aba.getRange(1, 1, 1, colunas).getValues()[0];
        cabecalhos = valoresCabecalho.filter(function (v) { return v !== ''; });
      }

      out.push('### Aba: ' + nome);
      out.push('- Linhas com dados: ' + Math.max(linhas - 1, 0) + ' (excluindo cabeçalho)');
      out.push('- Colunas: ' + colunas);
      out.push('- Cabeçalhos: ' + (cabecalhos.length ? cabecalhos.join(' | ') : 'N/D'));
      out.push('- Linhas congeladas: ' + aba.getFrozenRows());
      out.push('');
    } catch (e) {
      out.push('### Aba: (erro ao ler — ' + e.message + ')');
      out.push('');
    }
  });

  try {
    var nomeados = ss.getNamedRanges();
    if (nomeados.length) {
      out.push('- Intervalos nomeados: ' + nomeados.map(function (n) { return n.getName(); }).join(', '));
    }
  } catch (e) {
    // opcional, ignora se falhar
  }

  return out;
}

// -----------------------------------------------------------------------------
// GATILHOS (TRIGGERS) CONFIGURADOS NESTE PROJETO
// -----------------------------------------------------------------------------
function hopeInv_triggers_() {
  var out = [];

  try {
    var triggers = ScriptApp.getProjectTriggers();

    if (!triggers.length) {
      out.push('- Nenhum trigger configurado neste projeto.');
      return out;
    }

    triggers.forEach(function (t) {
      var linha = '- Função: ' + t.getHandlerFunction() +
        ' | Tipo de evento: ' + t.getEventType() +
        ' | Origem: ' + t.getTriggerSource();
      out.push(linha);
    });
  } catch (e) {
    out.push('- Não foi possível listar triggers (' + e.message + ')');
  }

  return out;
}

// -----------------------------------------------------------------------------
// SALVAR O RELATÓRIO NUMA ABA DA PRÓPRIA PLANILHA
// -----------------------------------------------------------------------------
function hopeInv_salvarNaPlanilha_(relatorio) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return;

    var aba = ss.getSheetByName('INVENTARIO_IA');
    if (!aba) {
      aba = ss.insertSheet('INVENTARIO_IA');
    } else {
      aba.clear();
    }

    aba.getRange('A1').setValue(relatorio);
    aba.setColumnWidth(1, 900);
    aba.getRange('A1').setWrap(true);
  } catch (e) {
    Logger.log('Não foi possível salvar na planilha: ' + e.message);
  }
}


// -----------------------------------------------------------------------------
// SALVAR O RELATÓRIO COMO GOOGLE DOC (e exportar PDF) — mais fácil de ler
// -----------------------------------------------------------------------------
// Na primeira execução isso vai pedir uma autorização extra (Documentos e
// Drive), pois é serviço novo que o script passa a usar. É só clicar em
// permitir — o Apps Script detecta e pede sozinho, sem precisar mexer em
// nenhum arquivo de manifesto.
function hopeInv_salvarComoDoc_(relatorio) {
  try {
    var nomeProjeto = 'Sem nome';
    try {
      nomeProjeto = SpreadsheetApp.getActiveSpreadsheet().getName();
    } catch (e) {
      // segue com o nome padrão
    }

    var pasta = hopeInv_pastaDestino_();
    var nomeDoc = 'HOPE_INVENTARIO_IA — ' + nomeProjeto;

    // Se já existe um Doc com esse nome nessa pasta, reaproveita (evita acumular cópias a cada execução).
    var existentes = pasta.getFilesByName(nomeDoc);
    var doc;
    if (existentes.hasNext()) {
      var arquivoExistente = existentes.next();
      DriveApp.getFileById(arquivoExistente.getId()).setTrashed(true);
    }

    doc = DocumentApp.create(nomeDoc);
    var body = doc.getBody();
    body.clear();

    relatorio.split('\n').forEach(function (linha) {
      if (linha.indexOf('### ') === 0) {
        body.appendParagraph(linha.replace('### ', '')).setHeading(DocumentApp.ParagraphHeading.HEADING3);
      } else if (linha.indexOf('## ') === 0) {
        body.appendParagraph(linha.replace('## ', '')).setHeading(DocumentApp.ParagraphHeading.HEADING2);
      } else if (linha.indexOf('# ') === 0) {
        body.appendParagraph(linha.replace('# ', '')).setHeading(DocumentApp.ParagraphHeading.HEADING1);
      } else {
        body.appendParagraph(linha);
      }
    });

    doc.saveAndClose();

    // Move o Doc gerado para a pasta de destino (por padrão ele nasce na raiz do Drive).
    var arquivoDoc = DriveApp.getFileById(doc.getId());
    pasta.addFile(arquivoDoc);
    DriveApp.getRootFolder().removeFile(arquivoDoc);

    var pdfUrl = null;
    try {
      var blobPdf = arquivoDoc.getAs('application/pdf');
      var nomePdf = nomeDoc + '.pdf';

      var pdfsExistentes = pasta.getFilesByName(nomePdf);
      if (pdfsExistentes.hasNext()) {
        pdfsExistentes.next().setTrashed(true);
      }

      var arquivoPdf = pasta.createFile(blobPdf).setName(nomePdf);
      pdfUrl = arquivoPdf.getUrl();
    } catch (e) {
      Logger.log('Não foi possível gerar o PDF (o Doc foi criado normalmente): ' + e.message);
    }

    return { docUrl: arquivoDoc.getUrl(), pdfUrl: pdfUrl };
  } catch (e) {
    Logger.log('Não foi possível criar o Doc/PDF do inventário: ' + e.message);
    return null;
  }
}

// Pasta única no Drive para juntar todos os inventários dos 20+ projetos num só lugar.
function hopeInv_pastaDestino_() {
  var nomePasta = 'HOPE - Inventarios IA';
  var pastas = DriveApp.getFoldersByName(nomePasta);
  if (pastas.hasNext()) {
    return pastas.next();
  }
  return DriveApp.createFolder(nomePasta);
}


/**
 * =============================================================================
 * NÍVEL AVANÇADO (OPCIONAL) — lista de arquivos e nomes de funções do projeto
 * =============================================================================
 * NÃO execute isto direto nos seus sistemas em produção sem ler o aviso abaixo.
 *
 * Para listar automaticamente os arquivos (.gs/.html) e as funções de dentro
 * deles, é preciso chamar a Apps Script API (script.projects.getContent),
 * o que exige um escopo OAuth extra: script.projects.readonly.
 *
 * O problema: assim que você adiciona QUALQUER escopo explícito no arquivo de
 * manifesto (appsscript.json), o Apps Script exige que TODOS os escopos que o
 * projeto usa (Planilhas, Drive, Gmail, Calendar, etc.) sejam listados à mão.
 * Se esquecer um, os serviços que dependem dele param de funcionar.
 *
 * RECOMENDAÇÃO: antes de tentar isso num sistema em produção, faça uma cópia
 * do projeto (Arquivo > Fazer uma cópia) e teste só na cópia. Só migre para
 * o projeto real depois de confirmar que nada quebrou.
 *
 * Passos, se quiser usar:
 * 1) No editor, vá em "Serviços" (ícone +) e ative a "Apps Script API".
 * 2) No Google Cloud Console do projeto, habilite a "Apps Script API".
 * 3) No appsscript.json, adicione (mantendo os escopos que já existem):
 *      "oauthScopes": [
 *        "https://www.googleapis.com/auth/script.projects.readonly",
 *        ...aqui vão TODOS os outros escopos que o projeto já usa...
 *      ]
 * 4) Execute a função hopeInvAvancado() abaixo.
 * =============================================================================
 */
function hopeInvAvancado() {
  try {
    var scriptId = ScriptApp.getScriptId();
    var url = 'https://script.googleapis.com/v1/projects/' + scriptId + '/content';
    var resposta = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });

    var codigo = resposta.getResponseCode();
    if (codigo !== 200) {
      Logger.log('Falhou (HTTP ' + codigo + '). Confira se a Apps Script API está ativada e se o escopo script.projects.readonly foi adicionado ao manifesto. Resposta: ' + resposta.getContentText());
      return;
    }

    var dados = JSON.parse(resposta.getContentText());
    var out = ['## ARQUIVOS E FUNÇÕES DO PROJETO'];

    dados.files.forEach(function (arquivo) {
      out.push('### ' + arquivo.name + ' (' + arquivo.type + ')');

      if (arquivo.type === 'SERVER_JS' && arquivo.source) {
        var nomesFuncoes = arquivo.source.match(/function\s+([a-zA-Z0-9_]+)\s*\(/g) || [];
        var limpos = nomesFuncoes.map(function (f) {
          return f.replace('function', '').replace('(', '').trim();
        });
        out.push('- Funções: ' + (limpos.length ? limpos.join(', ') : 'nenhuma encontrada'));
      }
      out.push('');
    });

    var relatorio = out.join('\n');
    Logger.log(relatorio);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) {
      var aba = ss.getSheetByName('INVENTARIO_IA_AVANCADO');
      if (!aba) aba = ss.insertSheet('INVENTARIO_IA_AVANCADO');
      else aba.clear();
      aba.getRange('A1').setValue(relatorio);
      aba.getRange('A1').setWrap(true);
      aba.setColumnWidth(1, 900);
    }
  } catch (e) {
    Logger.log('Erro no inventário avançado: ' + e.message);
  }
}