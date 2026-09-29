// =======================================================
// SISTEMA MESTRE - CÁLCULO RPA (Com pendências de faturamento)
// =======================================================

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Painel Mestre - Gerador RPA')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// =======================================================
// FUNÇÕES PARA GERENCIAR ISENÇÃO POR CNPJ
// =======================================================

function getExencaoSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('ExencaoCNPJ');
  if (!sheet) {
    sheet = ss.insertSheet('ExencaoCNPJ');
    sheet.getRange('A1:C1').setValues([['psicologaId', 'cnpj', 'percentual']]);
    sheet.setFrozenRows(1);
  } else {
    // Garante que planilhas criadas antes desta atualização ganhem a coluna 'percentual'
    const lastCol = Math.max(sheet.getLastColumn(), 3);
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (headers[2] !== 'percentual') {
      sheet.getRange(1, 3).setValue('percentual');
    }
  }
  return sheet;
}

function listarExencoes() {
  const sheet = getExencaoSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const psicologas = getListaPsicologasCompleta();
  const mapNome = {};
  psicologas.forEach(p => mapNome[p.id] = p.nomeCompleto);

  return data.slice(1).map(row => {
    const percentualBruto = row[2];
    const percentual = (percentualBruto === '' || percentualBruto === undefined || percentualBruto === null)
      ? 45
      : Number(percentualBruto);
    return {
      id: row[0],
      nome: mapNome[row[0]] || 'Desconhecida',
      cnpj: row[1],
      percentual: percentual
    };
  }).filter(item => item.id && item.cnpj);
}

function adicionarExencao(psicologaId, cnpj, percentual) {
  const sheet = getExencaoSheet();
  const data = sheet.getDataRange().getValues();
  let percentualFinal = Number(percentual);
  if (!percentual && percentual !== 0) percentualFinal = 45;
  if (isNaN(percentualFinal) || percentualFinal <= 0 || percentualFinal > 100) {
    throw new Error("Percentual inválido. Informe um valor entre 1 e 100.");
  }

  let linhaExistente = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === psicologaId) {
      linhaExistente = i + 1;
      break;
    }
  }
  if (linhaExistente !== -1) {
    sheet.getRange(linhaExistente, 2, 1, 2).setValues([[cnpj, percentualFinal]]);
  } else {
    sheet.appendRow([psicologaId, cnpj, percentualFinal]);
  }
  return true;
}

function removerExencao(psicologaId) {
  const sheet = getExencaoSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === psicologaId) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return true;
}

function getListaPsicologasCompleta() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetIds = ss.getSheetByName('ID');
  const lastRow = sheetIds.getLastRow();
  if (lastRow < 2) return [];
  const idsData = sheetIds.getRange(2, 1, lastRow - 1, 2).getValues();
  const psicologas = [];

  for (let i = 0; i < idsData.length; i++) {
    const nomeAbreviado = idsData[i][0];
    const idPlanilha = idsData[i][1];
    if (!idPlanilha) continue;

    try {
      const ssPsi = SpreadsheetApp.openById(idPlanilha);
      const sheetDados = ssPsi.getSheetByName('DadosPsi');
      let nomeCompleto = nomeAbreviado;
      let pixKey = '';

      if (sheetDados) {
        const nomeCell = sheetDados.getRange('B2').getValue();
        if (nomeCell) nomeCompleto = nomeCell;
        const pixCell = sheetDados.getRange('O2').getValue();
        if (pixCell) pixKey = pixCell;
      }

      psicologas.push({
        id: idPlanilha,
        nomeCompleto: nomeCompleto,
        nomeAbreviado: nomeAbreviado,
        pixKey: pixKey
      });
    } catch (e) {
      psicologas.push({
        id: idPlanilha,
        nomeCompleto: nomeAbreviado,
        nomeAbreviado: nomeAbreviado,
        pixKey: ''
      });
    }
  }
  return psicologas;
}

// =======================================================
// 2. PROCESSADOR PRINCIPAL
// =======================================================

function processarRelatorioWeb(mesNome, anoAlvo, tipoRelatorio) {
  tipoRelatorio = tipoRelatorio || "COMPLETO";

  try {
    const psicologas = getListaPsicologasCompleta();
    if (psicologas.length === 0) throw new Error("Nenhuma psicóloga válida encontrada.");

    const exencoes = listarExencoes();
    const isencaoMap = {};
    exencoes.forEach(e => isencaoMap[e.id] = e.percentual);

    let relatorioFinal = [];
    let logs = [];

    for (const psi of psicologas) {
      const idPlanilha = psi.id;
      try {
        const resultado = calcularIndividual(
          idPlanilha, mesNome, anoAlvo, psi.nomeCompleto, isencaoMap
        );
        relatorioFinal.push({
          id: idPlanilha,
          nome: psi.nomeCompleto,
          pixKey: psi.pixKey,
          ...resultado,
          erro: false
        });
        logs.push(`✅ ${psi.nomeCompleto}: Sucesso`);
      } catch (e) {
        relatorioFinal.push({
          id: idPlanilha,
          nome: psi.nomeCompleto,
          pixKey: psi.pixKey,
          erro: true,
          msg: e.message
        });
        logs.push(`❌ ${psi.nomeCompleto}: Erro - ${e.message}`);
      }
    }

    const urlPdf = gerarPDFNoDrive(relatorioFinal, mesNome, anoAlvo, tipoRelatorio);
    return { sucesso: true, url: urlPdf, logs: logs.join('\n') };

  } catch (e) {
    return { sucesso: false, erro: e.message };
  }
}

// =======================================================
// FUNÇÃO QUE LÊ QUALQUER FORMATO DE VALOR MONETÁRIO
// Trata: número puro, "R$ 45,00", "R$45.00", "$45,00", "US$ 45.00",
// "45,00", "45.00", "45", "R$ 1.000,50", texto vazio, etc.
// Usada em calcularIndividual() no lugar do antigo parseFloat(row[13]),
// que falhava sempre que a psicóloga salvava o valor como texto
// formatado (ex: "R$ 45,00") em vez de número puro na planilha.
// =======================================================
function extrairValorMonetario(valor) {
    // Se já for número, retorna direto
    if (typeof valor === 'number' && !isNaN(valor)) {
        return valor;
    }

    // Se for null, undefined ou vazio
    if (!valor) return 0;

    // Converte para string
    let texto = String(valor).trim();

    // Se estiver vazio após trim
    if (texto === '') return 0;

    // ============ TRATA TODOS OS FORMATOS ============

    // 1. Remove qualquer símbolo de moeda (R$, $, US$, €, etc)
    texto = texto.replace(/[Rr][Ss]\$\s*/g, '')  // R$ 45,00
                 .replace(/US\$\s*/g, '')        // US$ 45.00
                 .replace(/\$\s*/g, '')          // $45.00
                 .replace(/[€£¥]/g, '')          // €, £, ¥
                 .replace(/[A-Za-z]\s*/g, '');   // Remove letras soltas

    // 2. Remove espaços extras
    texto = texto.trim();

    // 3. Se estiver vazio depois de limpar
    if (texto === '') return 0;

    // 4. Trata formato com vírgula como separador decimal (BR)
    //    Ex: "45,00" → "45.00"
    //    Ex: "1.000,50" → "1000.50"
    if (texto.includes(',')) {
        // Remove pontos de milhar (ex: 1.000,50 → 1000,50)
        // Só remove pontos se tiver vírgula (formato BR)
        let partes = texto.split(',');
        let parteInteira = partes[0].replace(/\./g, ''); // Remove pontos de milhar
        let parteDecimal = partes[1] || '00';

        // Se a parte decimal tiver mais de 2 dígitos, corta
        if (parteDecimal.length > 2) {
            parteDecimal = parteDecimal.substring(0, 2);
        }

        texto = parteInteira + '.' + parteDecimal;
    } else if (texto.includes('.')) {
        // Formato sem vírgula, mas com ponto(s). Para decidir se o ponto é
        // separador DECIMAL ou separador de MILHAR, olhamos para quantos
        // dígitos aparecem depois do ÚLTIMO ponto — e não para "quantos
        // pontos existem no texto" (essa regra antiga deixava "1.234" cair
        // direto no parseFloat, virando 1.234 em vez de 1234, um erro
        // silencioso e sem log, o pior tipo de erro nesse contexto).
        //
        //   "45.00"        -> 2 dígitos após o ponto -> DECIMAL  -> 45.00
        //   "45.5"         -> 1 dígito após o ponto  -> DECIMAL  -> 45.5
        //   "1.234"        -> 3 dígitos após o ponto -> MILHAR   -> 1234
        //   "1.234.567"    -> mais de um ponto       -> MILHAR   -> 1234567
        var partesPonto = texto.split('.');
        var ultimaParte = partesPonto[partesPonto.length - 1];
        if (partesPonto.length === 2 && (ultimaParte.length === 1 || ultimaParte.length === 2)) {
            // Ponto único com 1 ou 2 casas -> separador decimal, mantém como está
        } else {
            // Um ponto com 3+ casas, ou múltiplos pontos -> separador de milhar
            texto = partesPonto.join('');
        }
    }

    // 5. Tenta converter para número
    let numero = parseFloat(texto);

    // 6. Se ainda deu NaN, tenta extrair qualquer número
    if (isNaN(numero)) {
        let numerosEncontrados = texto.match(/\d+[,.]?\d*/g);
        if (numerosEncontrados && numerosEncontrados.length > 0) {
            let ultimoNumero = numerosEncontrados[numerosEncontrados.length - 1];
            // Se tiver vírgula, trata como decimal
            if (ultimoNumero.includes(',')) {
                ultimoNumero = ultimoNumero.replace(/,/g, '.');
            }
            numero = parseFloat(ultimoNumero);
        }
    }

    // 7. Se ainda for NaN, retorna 0
    return isNaN(numero) ? 0 : numero;
}

function calcularIndividual(idPlanilha, mesNome, anoAlvo, nomeCompleto, isencaoMap) {
  const ssExterna = SpreadsheetApp.openById(idPlanilha);
  const abaRegistro = ssExterna.getSheetByName("Atendimentos");
  if (!abaRegistro) throw new Error("Aba 'Atendimentos' não encontrada.");

  const dados = abaRegistro.getDataRange().getValues();
  const mapaMeses = {
    "JANEIRO": 0, "FEVEREIRO": 1, "MARCO": 2, "ABRIL": 3, "MAIO": 4, "JUNHO": 5,
    "JULHO": 6, "AGOSTO": 7, "SETEMBRO": 8, "OUTUBRO": 9, "NOVEMBRO": 10, "DEZEMBRO": 11
  };
  const mesIndex = mapaMeses[mesNome.toUpperCase()];

  let totalProducao100 = 0;
  let contagemPacientes = 0;
  let contagemPendencias = 0;

  const isIsenta = Object.prototype.hasOwnProperty.call(isencaoMap, idPlanilha);
  const percentualIsenta = isIsenta ? Number(isencaoMap[idPlanilha]) : 0;

  for (let i = 1; i < dados.length; i++) {
    const row = dados[i];
    const dataRegistro = row[0];
    // ============ USA A FUNÇÃO ROBUSTA (antes: parseFloat(row[13]) || 0) ============
    const valorCheio = extrairValorMonetario(row[13]);
    // ==================================================================================
    const status = String(row[18] || "").trim(); // Pega o status da coluna S

    if (!dataRegistro) continue;

    let registroValido = false;
    if (dataRegistro instanceof Date) {
      const strData = Utilities.formatDate(dataRegistro, "GMT-3", "MM/yyyy");
      const [mesStr, anoStr] = strData.split('/');
      if ((parseInt(mesStr) - 1) === mesIndex && anoStr === String(anoAlvo)) registroValido = true;
    } else if (typeof dataRegistro === 'string') {
      try {
        const p = dataRegistro.split(' ')[0].split('/');
        if (p.length === 3 && (parseInt(p[1]) - 1 === mesIndex) && (p[2] === String(anoAlvo))) registroValido = true;
      } catch (e) { }
    }

    if (registroValido) {
      // REGRA PRINCIPAL: Só considera se for "OK" (em qualquer variação de maiúscula/minúscula) ou vazio
      const statusNormalizado = status.toUpperCase();
      if (statusNormalizado === "OK") {
        // Sessão confirmada - conta para faturamento
        totalProducao100 += valorCheio;
        contagemPacientes++;
      } else if (status === "") {
        // Campo vazio - é pendência
        contagemPendencias++;
      }
      // Qualquer outro texto (como "falta", "cancelado", etc.) é IGNORADO completamente
    }
  }

  let repasseBruto = 0;
  let baseCalculoRPA = 0;
  let retencaoInss = 0;
  let valorLiquido = 0;

  if (isIsenta) {
    // Para CNPJ: percentual individual definido por psicóloga, SEM INSS
    valorLiquido = Number((totalProducao100 * (percentualIsenta / 100)).toFixed(2));
    repasseBruto = totalProducao100;
    baseCalculoRPA = 0;
    retencaoInss = 0;
  } else {
    // Para PF: 40% com desconto de INSS
    const comissao40 = Number((totalProducao100 * 0.40).toFixed(2));
    baseCalculoRPA = comissao40;
    repasseBruto = comissao40;
    
    const TETO_INSS = 7786.02;
    if (baseCalculoRPA > TETO_INSS) baseCalculoRPA = TETO_INSS;
    
    retencaoInss = Number((baseCalculoRPA * 0.11).toFixed(2));
    const tetoImposto = Number((TETO_INSS * 0.11).toFixed(2));
    if (retencaoInss > tetoImposto) retencaoInss = tetoImposto;
    
    valorLiquido = Number((baseCalculoRPA - retencaoInss).toFixed(2));
  }

  return {
    repasseBruto: repasseBruto,
    baseCalculoInss: baseCalculoRPA,
    retencaoInss: retencaoInss,
    valorLiquido: valorLiquido,
    isIsenta: isIsenta,
    percentualIsenta: percentualIsenta,
    qtdPacientes: contagemPacientes,
    qtdPendencias: contagemPendencias,
    totalFaturamento: totalProducao100
  };
}

// =======================================================
// 4. GERADOR DE PDF (com pendências)
// =======================================================

function gerarPDFNoDrive(listaDados, mes, ano, tipoRelatorio) {
  let conteudoHTML = "";

  // --- Bloco RPA (exclui isentos) ---
  let htmlRPA = "";
  if (tipoRelatorio === "RPA" || tipoRelatorio === "COMPLETO") {
    const dadosRPA = listaDados.filter(d => !d.erro && !d.isIsenta);
    let linhasRPA = "";
    let totalBaseRPA = 0;

    dadosRPA.forEach(d => {
      totalBaseRPA += d.repasseBruto || 0;
      linhasRPA += `
        <tr>
          <td class="nome-col">
            ${d.nome}
            <div style="font-weight:normal; font-size:10px; color:#555;">Pacientes: ${d.qtdPacientes || 0} (ok)</div>
            <div style="font-weight:normal; font-size:10px; color:#dc3545;">Pendências: ${d.qtdPendencias || 0}</div>
           </td>
          <td class="valor-col">R$ ${(d.repasseBruto || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
         `;
    });

    htmlRPA = `
      <h1>Relatório RPA - ${mes}/${ano}</h1>
      <p style="font-size:12px;">Bases para cálculo do INSS</p>
      <table>
        <thead>
          <tr><th class="nome-col">Nome</th><th class="valor-col">Base RPA</th></tr>
        </thead>
        <tbody>
          ${linhasRPA}
        </tbody>
      </table>
      <div class="total-row">
        <span>TOTAL BASES RPA:</span>
        <span>R$ ${totalBaseRPA.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
      </div>
      ${listaDados.some(d => d.isIsenta) ? '<p style="font-size:11px; color:#666; margin-top:10px;">(*): Profissionais isentas não aparecem nesta lista.</p>' : ''}`;
  }

// --- Bloco Pagar (inclui isentos e adiciona chave Pix e pendências) ---
let htmlPagar = "";
if (tipoRelatorio === "PAGAR" || tipoRelatorio === "COMPLETO") {
  let linhasPagamento = "";
  let totalLiquido = 0;

  listaDados.forEach(d => {
    if (!d.erro) {
      totalLiquido += d.valorLiquido;
      const pixDisplay = d.pixKey ? d.pixKey : "não informada";
      const pendenciaText = d.qtdPendencias > 0 ? `<span style="color:#dc3545;">⚠️ Pendência: ${d.qtdPendencias} sessão${d.qtdPendencias !== 1 ? 's' : ''} sem status</span>` : "";
      
      let textoRepasse = "";
      if (d.isIsenta) {
        // Para CNPJ: mostra faturamento total e repasse do percentual individual
        textoRepasse = `<span style="color:#004d40; font-weight:bold;">CNPJ - Repasse de ${d.percentualIsenta}% (sem INSS)</span><br>
                        Faturamento bruto: R$ ${(d.totalFaturamento || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}<br>
                        <span style="color:#2e7d32;">Valor a receber (${d.percentualIsenta}%): R$ ${d.valorLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>`;
      } else {
        // Para PF: mostra base RPA e desconto
        textoRepasse = `Base RPA (40%): R$ ${(d.repasseBruto || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}<br>
                        INSS (11%): R$ ${(d.retencaoInss || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}<br>
                        <span style="color:#2e7d32;">Valor líquido: R$ ${d.valorLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>`;
      }
      
      linhasPagamento += `
        <tr>
          <td class="nome-col">
            <strong>${d.nome}</strong>
            <div style="font-weight:normal; font-size:10px; color:#555; margin-top: 5px;">
              ✅ Pacientes OK: ${d.qtdPacientes || 0}<br>
              ${textoRepasse}<br>
              🔑 Chave Pix: ${pixDisplay}<br>
              ${pendenciaText}
            </div>
           </td>
          <td class="valor-col">R$ ${d.valorLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>`;
    }
  });

  htmlPagar = `
    <h1>Relatório de Pagamento - ${mes}/${ano}</h1>
    <p style="font-size:12px; margin-bottom:5px;">📋 <strong>Legenda:</strong></p>
    <p style="font-size:11px; color:#666; margin-top:0;">
      • <strong>Pessoa Física (PF):</strong> Repasse de 40% do faturamento com desconto de INSS (11%)<br>
      • <strong>Pessoa Jurídica (CNPJ):</strong> Repasse do percentual individual cadastrado por psicóloga, <strong>SEM desconto de INSS</strong><br>
      • ⚠️ Pendências: sessões sem status definido (em branco)
    </p>
    <table>
      <thead>
        <tr><th class="nome-col">Profissional</th><th class="valor-col">Valor Líquido</th></tr>
      </thead>
      <tbody>
        ${linhasPagamento}
      </tbody>
    </table>
    <div class="total-row">
      <span>TOTAL GERAL A PAGAR:</span>
      <span>R$ ${totalLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
    </div>`;
}
  // Juntar os blocos
  if (tipoRelatorio === "COMPLETO") {
    conteudoHTML = htmlRPA + '<div class="page-break"></div>' + htmlPagar;
  } else if (tipoRelatorio === "RPA") {
    conteudoHTML = htmlRPA;
  } else {
    conteudoHTML = htmlPagar;
  }

  const html = `
    <html>
      <head>
        <style>
          body {
            font-family: 'Courier New', Courier, monospace;
            padding: 40px;
            font-size: 12px;
          }
          h1 {
            font-size: 18px;
            border-bottom: 2px solid #000;
            padding-bottom: 8px;
            margin-bottom: 20px;
            text-transform: uppercase;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
          }
          th {
            text-align: left;
            border-bottom: 2px solid #000;
            padding-bottom: 8px;
            font-weight: bold;
          }
          td {
            padding: 10px 0;
            border-bottom: 1px dashed #ccc;
            vertical-align: top;
          }
          .nome-col {
            text-align: left;
            font-weight: bold;
            width: 60%;
          }
          .valor-col {
            text-align: right;
            width: 40%;
            font-weight: bold;
          }
          .total-row {
            margin-top: 20px;
            border-top: 2px solid #000;
            padding-top: 10px;
            font-weight: bold;
            font-size: 14px;
            display: flex;
            justify-content: space-between;
          }
          .page-break {
            page-break-before: always;
          }
          @media print {
            body { padding: 20px; }
          }
        </style>
      </head>
      <body>
        ${conteudoHTML}
      </body>
    </html>`;

  const blob = Utilities.newBlob(html, MimeType.HTML).getAs(MimeType.PDF);
  blob.setName(`Relatorio_${tipoRelatorio}_${mes}_${ano}_${new Date().getTime()}.pdf`);
  const arquivo = DriveApp.createFile(blob);
  arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return arquivo.getUrl();
}

// =======================================================
// FUNÇÕES AUXILIARES
// =======================================================

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function testarConexao() {
  return { status: "OK", mensagem: "Sistema Mestre RPA está funcionando." };
}
function testarGabriella() {
  // 1. ID da Gabriella conforme está na aba ID da planilha mestra
  const id = "1LUytaan5CC1QqPQlzIFviJzekdEOd5kskNdSTzXtf2I"; // ATUALIZE com o valor exato da célula B2

  console.log("=== TESTE GABRIELLA ===");
  console.log("ID usado:", id);

  // 2. Tentar abrir a planilha
  let ss;
  try {
    ss = SpreadsheetApp.openById(id);
    console.log("✅ Planilha aberta com sucesso!");
  } catch (e) {
    console.log("❌ ERRO ao abrir planilha:", e.message);
    return;
  }

  // 3. Verificar aba Atendimentos
  const abaAtend = ss.getSheetByName("Atendimentos");
  if (!abaAtend) {
    console.log("❌ Aba 'Atendimentos' não encontrada!");
    console.log("Abas existentes:", ss.getSheets().map(s => s.getName()).join(", "));
    return;
  }
  console.log("✅ Aba 'Atendimentos' encontrada.");

  // 4. Obter dados
  const dados = abaAtend.getDataRange().getValues();
  if (dados.length < 2) {
    console.log("⚠️ A aba 'Atendimentos' tem apenas cabeçalho ou está vazia.");
  } else {
    console.log("✅ Total de linhas de dados (incluindo cabeçalho):", dados.length);
    console.log("Cabeçalhos:", dados[0]);
    console.log("Número de colunas:", dados[0].length);
  }

  // 5. Verificar coluna S (status) – índice 18
  if (dados[0].length < 19) {
    console.log("❌ A aba 'Atendimentos' tem menos de 19 colunas. A coluna S (status) não existe.");
  } else {
    console.log("✅ Coluna S (status) presente. Exemplo da primeira linha de dados (linha 2):", dados[1]?.[18]);
  }

  // 6. Verificar aba DadosPsi
  const abaDadosPsi = ss.getSheetByName("DadosPsi");
  if (!abaDadosPsi) {
    console.log("⚠️ Aba 'DadosPsi' não encontrada. Isso não impede o cálculo, mas afeta nome e Pix.");
    console.log("Abas existentes:", ss.getSheets().map(s => s.getName()).join(", "));
  } else {
    console.log("✅ Aba 'DadosPsi' encontrada.");
    const nome = abaDadosPsi.getRange("B2").getValue();
    const pix = abaDadosPsi.getRange("O2").getValue();
    console.log("Nome (B2):", nome);
    console.log("Chave Pix (O2):", pix);
  }

  // 7. Testar filtro por mês (exemplo: Março 2026)
  const mesTeste = "MARCO";
  const anoTeste = 2026;
  const mapaMeses = {
    "JANEIRO":0,"FEVEREIRO":1,"MARCO":2,"ABRIL":3,"MAIO":4,"JUNHO":5,
    "JULHO":6,"AGOSTO":7,"SETEMBRO":8,"OUTUBRO":9,"NOVEMBRO":10,"DEZEMBRO":11
  };
  const mesIndex = mapaMeses[mesTeste];
  let registrosEncontrados = 0;

  for (let i = 1; i < dados.length; i++) {
    const row = dados[i];
    const dataRegistro = row[0];
    if (!dataRegistro) continue;

    let registroValido = false;
    if (dataRegistro instanceof Date) {
      const strData = Utilities.formatDate(dataRegistro, "GMT-3", "MM/yyyy");
      const [mesStr, anoStr] = strData.split('/');
      if ((parseInt(mesStr)-1) === mesIndex && anoStr === String(anoTeste)) registroValido = true;
    } else if (typeof dataRegistro === 'string') {
      const partes = dataRegistro.split(' ')[0].split('/');
      if (partes.length === 3) {
        const mes = parseInt(partes[1]);
        const ano = partes[2];
        if ((mes-1) === mesIndex && ano === String(anoTeste)) registroValido = true;
      }
    }

    if (registroValido) {
      registrosEncontrados++;
      const status = String(row[18] || "").trim();
      console.log(`   Registro ${registrosEncontrados}: data=${dataRegistro}, status="${status}", valor=${row[13]}`);
    }
  }

  console.log(`Total de registros para ${mesTeste}/${anoTeste}: ${registrosEncontrados}`);

  console.log("=== FIM DO TESTE ===");
}
function verificarIDs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetIds = ss.getSheetByName('ID');
  const lastRow = sheetIds.getLastRow();
  const idsData = sheetIds.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < idsData.length; i++) {
    const nome = idsData[i][0];
    const id = idsData[i][1];
    if (!id) continue;
    try {
      SpreadsheetApp.openById(id);
      console.log(`✅ ${nome}: ID válido`);
    } catch(e) {
      console.log(`❌ ${nome}: ID inválido ou sem acesso - ${e.message}`);
    }
  }
}
function testarPDF() {
  const resultado = processarRelatorioWeb("MARCO", 2026, "COMPLETO");
  console.log(resultado);
}