# ORDEM-003 — AGENDA-FIT-01 — Fit-gap do modelo de agenda HopeCore × dados reais

**Emissor:** CX / ChatGPT — Orquestrador Técnico  
**Executor:** Claude/Core  
**Tipo:** ANÁLISE / AUDITORIA / MODELAGEM  
**Implementação autorizada:** **NÃO**  
**Modo:** SOMENTE LEITURA

## Decisão do CX sobre a ENTREGA-002

A ENTREGA-002 está **ACEITA COM GATES PENDENTES**.

Decisões:
1. Não criar agora `tenant_memberships`, `room_blocks`, `appointment_series` ou equivalentes.
2. O modelo existente deve ser testado contra os dados reais antes de qualquer migration.
3. O gate de identidade/segurança do Psi Gestão Fácil permanece pendente das respostas do Owner, mas **não bloqueia esta frente independente**.
4. Nenhuma alteração de produção está autorizada nesta ordem.

## Objetivo

Medir, com evidência quantitativa, quanto da operação real de agenda da Clínica Hope cabe no modelo clínico atual do HopeCore e quais lacunas são reais.

## Fontes obrigatórias

Mapear, somente leitura, conforme disponibilidade:
- `legado.agenda`;
- `legado.cancelados`;
- `legado.salas_painel`;
- `atendimentos_raw` ou estrutura equivalente existente;
- `rooms`;
- `appointments`;
- `sessions`;
- `professional_availability_blocks`;
- constraints, índices, funções e views relacionadas.

Não expor PII na entrega.

## Trabalho

### 1. Modelo real atual
Documentar:
- como paciente, profissional, sala, dia, horário e plano aparecem no legado;
- como recorrência semanal é representada;
- como alta, transferência, falta, cancelamento e reagendamento aparecem;
- como os blocos/períodos de sala são representados;
- duração real dos atendimentos quando inferível com segurança;
- inconsistências relevantes dos dados.

### 2. Fit no modelo HopeCore
Para cada conceito real, indicar:
- CABE DIRETAMENTE;
- CABE COM AJUSTE;
- NÃO CABE;
- INDETERMINADO.

### 3. Simulação sem escrita
Simular por SELECT/CTE/processamento local, sem INSERT/UPDATE/DELETE, a transformação do legado para:
- rooms;
- appointments;
- sessions;
- professional_availability_blocks.

Quantificar:
- total analisado;
- percentual que cabe sem ajuste;
- percentual que exige ajuste;
- registros ambíguos/inválidos;
- conflitos que o modelo atual detectaria;
- conflitos/sobreposições que escapariam.

### 4. Recorrência
Validar especificamente:
- appointment recorrente → múltiplas sessions;
- impacto de `idx_sessions_unique_appointment`;
- cancelamento pontual;
- reagendamento pontual;
- alta/encerramento;
- transferência;
- exceção por data;
- duração/start/end;
- cruzamento recorrente × appointment datado.

### 5. Salas
Mapear `legado.salas_painel` e responder:
- existe informação suficiente para derivar blocos de sala?
- pode ser resolvido inicialmente por view/função?
- há necessidade comprovada de persistência própria?
- como impedir duas profissionais na mesma sala/período?
- como impedir uma profissional em duas salas simultaneamente?

### 6. Regra de 50 minutos
Não assumir 50 minutos como verdade universal sem evidência.

Separar:
- regra operacional conhecida;
- evidência encontrada nos dados;
- exceções.

### 7. Resultado arquitetural
Para cada lacuna, escolher apenas uma recomendação:
- reutilizar estrutura atual;
- ajustar constraint/índice/campo existente;
- criar view/função;
- estrutura nova realmente necessária;
- decisão de negócio necessária.

Qualquer estrutura nova deve vir acompanhada de prova de que as alternativas existentes são insuficientes.

## Proibições

Não:
- criar/alterar tabela;
- executar migration;
- alterar constraint/índice;
- alterar RLS;
- alterar dados;
- alterar Apps Script/Sheets/Drive;
- alterar produção;
- alterar FIN_MOTOR;
- mexer em Bradesco;
- corrigir Firebase;
- iniciar migração da agenda;
- criar PR para main.

## Entrega

Criar:

`docs/orquestracao/entregas/ENTREGA-003-AGENDA-FIT-01-FIT-GAP-MODELO-AGENDA.md`

Incluir:
1. resumo executivo;
2. mapa do legado;
3. matriz fit-gap;
4. números da simulação;
5. análise de recorrência;
6. análise de salas;
7. conflitos e integridade;
8. arquitetura mínima recomendada;
9. itens que dependem de Jorge;
10. recomendação para ORDEM-004.

Atualizar `00-STATUS-ATUAL.md` para ENTREGA-003 disponível e PARAR.

## Governança

CX autoriza tecnicamente. Claude/Core executa. Jorge entra somente em decisões de negócio, risco material, credenciais ou ação humana inevitável.

Esta ordem **NÃO autoriza implementação**.
