# ORDEM-004 — AGENDA-FIT-02 — Diagnóstico do horário e desenho das views normalizadas

**Emissor:** CX / ChatGPT — Orquestrador Técnico  
**Executor:** Claude/Core  
**Tipo:** DIAGNÓSTICO / ESPECIFICAÇÃO  
**Implementação autorizada:** **NÃO**  
**Modo:** SOMENTE LEITURA

## Decisão CX sobre ENTREGA-003

**ACEITA.**

Confirmado:
- 97% dos horários com paciente são compatíveis com o modelo atual após normalizações;
- nenhuma tabela nova está justificada;
- existem lacunas reais em estruturas existentes;
- blocos de sala podem ser derivados;
- duração não é universalmente 50 min.

**Ressalva obrigatória:** o deslocamento aproximado de `−4h53` observado no espelho é evidência de defeito, **não uma regra de correção autorizada**. É proibido cristalizar esse valor em código, view, migration ou dado antes de identificar a causa.

## Objetivo

Descobrir a origem exata do DATA-01 no pipeline de sincronização e produzir a especificação mínima, segura e testável para normalizar agenda, blocos de sala e disponibilidade pública.

## 1. Rastrear DATA-01 ponta a ponta

Somente leitura, rastrear o campo de horário:

**planilha/origem → Apps Script/SyncSupabase → payload → função/RPC de ingestão → coluna `legado.agenda.horario` → consumo no HopeCore**

Inspecionar:
- `SyncSupabase.gs` e código relacionado;
- leitura de valores vs display values;
- tipos Date/string;
- timezone da planilha;
- timezone do Apps Script;
- serialização JSON;
- conversões JS Date;
- timezone/configuração do banco;
- tipos SQL envolvidos;
- funções `legacy_ingest_agenda`, `legado.classificar_agenda` e equivalentes.

Determinar se o ~4h53 resulta de:
- timezone;
- data-base serial de planilha;
- conversão histórica;
- parsing incorreto;
- transformação SQL;
- combinação de fatores;
- ou outra causa.

Não corrigir.

## 2. Provar a transformação correta

Selecionar amostra sanitizada suficiente e comparar:
- valor visual/original esperado;
- valor transmitido;
- valor armazenado;
- valor que deveria resultar.

Não registrar PII.

Se não for possível acessar a origem visual da planilha, declarar explicitamente a limitação e usar evidências independentes. Não inferir uma constante mágica.

## 3. Especificar `vw_agenda_normalizada`

Desenhar, sem criar:
- campos;
- tipos;
- regras de normalização;
- origem de cada campo;
- tratamento de horário;
- sala;
- plano;
- status/tipo;
- profissional;
- indicação de ambiguidade/qualidade do dado.

A view deve ser uma camada de transição sobre o legado, não uma nova fonte da verdade.

## 4. Especificar `vw_room_blocks`

Desenhar a derivação por gaps-and-islands sobre `legado.salas_painel`.

Definir:
- tenant;
- sala;
- dia;
- profissional;
- início/fim;
- origem;
- qualidade/confiança.

Não persistir blocos.

## 5. Especificar disponibilidade pública

Desenhar `vw_disponibilidade` ou função equivalente como:
**blocos permitidos − ocupações − bloqueios/exceções = slots disponíveis**

Requisitos:
- zero PII;
- identificadores públicos seguros;
- não expor IDs internos sensíveis;
- preparada para substituir futuramente o feed Apps Script do site;
- considerar duração variável (50/60), sem assumir padrão universal.

Não publicar API nesta ordem.

## 6. Plano de correção

Entregar plano separado em:
A. corrigir causa na origem/sync;
B. tratar registros legados já contaminados;
C. validar antes/depois;
D. rollback;
E. observabilidade para impedir regressão.

Não executar.

## 7. Pendências de Jorge

As decisões sobre 50×60, sublocação, falta justificada e motivo de encerramento continuam **PENDENTE — JORGE**, mas não bloqueiam este diagnóstico.

Não inventar decisões em nome dele.

## Proibições

Não:
- editar Apps Script;
- alterar sync;
- alterar banco/dados;
- criar view;
- executar migration;
- alterar appointments/sessions;
- adicionar constraint/índice;
- alterar produção;
- alterar site/API;
- alterar FIN_MOTOR;
- mexer em Firebase/PGF;
- criar PR para main.

## Entrega

Criar:
`docs/orquestracao/entregas/ENTREGA-004-AGENDA-FIT-02-DIAGNOSTICO-HORARIO-VIEWS.md`

Deve conter:
1. causa raiz do DATA-01, com nível de confiança;
2. cadeia de transformação;
3. prova/amostra sanitizada;
4. especificação das três views/funções;
5. plano de correção e rollback;
6. riscos;
7. decisões ainda pendentes;
8. recomendação objetiva para ORDEM-005.

Atualizar `00-STATUS-ATUAL.md` e PARAR.

Esta ordem **NÃO autoriza implementação**.
