# ORDEM-006 — PILOTO CONTROLADO — DATA-01 + SALAS

**Emissor:** CX / ChatGPT — Orquestrador Técnico  
**Executor:** Claude/Core  
**Data:** 2026-10-03 (America/Sao_Paulo)  
**Classificação:** PILOTO CONTROLADO COM ESCRITA RESTRITA  
**Produção:** autorizada SOMENTE nos passos explicitamente liberados abaixo.

## Decisão CX sobre ENTREGA-005

**ACEITA COM GATE DI-01.**

A implementação publicada em `convergencia/bloco-1` foi revisada pelo CX:
- DATA-01: aprovada para piloto;
- migration 033 / rooms: aprovada para piloto;
- migration 035 / `legado.vw_room_blocks`: aprovada para piloto;
- migration 034 / professional_profiles: código aceito, porém **execução real BLOQUEADA por DI-01**;
- investigação `public.guides`: aceita; nenhuma correção autorizada;
- FIN_MOTOR/Atendimentos: permanecem fora do escopo.

## Objetivo

Executar o primeiro piloto real e reversível da convergência sem colocar o financeiro em risco.

## PASSO 0 — Pré-flight obrigatório

Antes de qualquer escrita:
1. confirmar produção na migration 032;
2. confirmar `rooms = 0` e `professional_profiles = 0`;
3. confirmar DATA-01 ainda presente no espelho;
4. registrar contagens/hash ou evidência suficiente para comparação;
5. confirmar backups/rollback disponíveis;
6. confirmar que nenhuma ação toca `Atendimentos`, FIN_MOTOR, repasse, pagamentos ou pacientes.

Se qualquer pré-condição divergir, PARAR e retornar ao CX.

## PASSO 1 — Banco: migration 033

Autorizado:
- aplicar **somente migration 033** em produção;
- executar `bootstrap_rooms_from_legado(true)`;
- validar expectativa de 5 salas;
- se coerente, executar `bootstrap_rooms_from_legado(false)`;
- validar exatamente as salas criadas e idempotência.

Se dry-run não retornar o conjunto esperado, NÃO executar false.

## PASSO 2 — Banco: migration 034 SOMENTE ESTRUTURA/DRY-RUN

Autorizado:
- aplicar migration 034 se suas alterações DDL puderem permanecer sem criação de perfis;
- executar **somente** `bootstrap_professional_profiles_from_legado(true)`;
- registrar resultado esperado 24 / 17 / 7 e evidência de DI-01.

**PROIBIDO executar `bootstrap_professional_profiles_from_legado(false)`.**

Nenhum `professional_profile` deve ser criado neste piloto.

DI-01 deve permanecer pendente para decisão operacional posterior.

## PASSO 3 — Banco: migration 035

Autorizado:
- aplicar migration 035;
- validar `legado.vw_room_blocks`;
- comparar com referência: 94 ilhas / 415 h / 215 h profissional ALTA, aceitando somente diferença explicável por mudança real do painel desde a coleta;
- confirmar ausência de PII e acesso revogado para anon/authenticated.

## PASSO 4 — DATA-01: piloto em UMA planilha

Somente após banco validado:

1. publicar no Apps Script exclusivamente a alteração DATA-01 de `SyncSupabase.gs`;
2. NÃO instalar/remover gatilhos;
3. NÃO executar sincronização global;
4. escolher UMA planilha de psicóloga ativa e não envolvida em DI-01;
5. registrar antes:
   - linhas Agenda;
   - linhas Cancelados;
   - amostra de horários;
   - evidência/contagem de Atendimentos;
6. executar somente o mecanismo de teste para Agenda/Cancelados dessa profissional, evitando qualquer chamada que envie Atendimentos;
7. validar:
   - horários corrigidos conforme o que é exibido na planilha;
   - células textuais preservadas;
   - nenhuma alteração na aba/tabela de Atendimentos;
   - nenhuma alteração em repasse/FIN_MOTOR;
   - demais psicólogas permanecem com o estado anterior;
8. NÃO expandir para outras profissionais nesta ordem.

### Regra crítica

Se a função existente `testarAgendaSalasSupabase` também produzir escrita adicional de salas que não seja necessária/segura para o piloto, use uma chamada controlada equivalente ou adapte somente o harness de teste. Não ampliar o escopo.

## PASSO 5 — Validação pós-piloto

Comparar antes/depois e registrar:
- migrations aplicadas;
- rooms;
- professional_profiles (deve continuar **0**);
- room_blocks;
- agenda/cancelados da única profissional piloto;
- Atendimentos;
- indicadores financeiros essenciais de integridade (somente leitura);
- logs/erros.

## Rollback

Em qualquer falha:
- DATA-01: restaurar versão anterior do Apps Script; reprocessar somente o necessário para retornar o espelho da profissional piloto;
- migration 035: rollback 035;
- migration 034: rollback 034, desde que nenhum perfil real tenha sido criado;
- migration 033: rollback 033 somente se necessário e seguro conforme dependências.

Documentar qualquer rollback executado.

## Continua proibido

- merge em main;
- deploy web;
- sync global;
- bootstrap real de professional_profiles;
- Auth/login;
- RLS G1;
- constraints G2;
- pacientes G4;
- Google Auth G5;
- guias/public.guides;
- disponibilidade pública;
- FIN_MOTOR;
- repasse/pagamentos;
- novas tabelas;
- correção de DI-01 sem decisão operacional.

## Entrega

Criar:
`docs/orquestracao/entregas/ENTREGA-006-PILOTO-CONTROLADO-DATA01-SALAS.md`

Atualizar `00-STATUS-ATUAL.md`.

Handoff direto:
`CX — ORDEM-006 PILOTO CONCLUÍDO`

Informar:
- commits;
- exatamente o que foi aplicado em produção;
- profissional piloto identificada apenas por referência segura, sem PII em repo público;
- antes/depois DATA-01;
- rooms;
- professional_profiles;
- view;
- integridade de Atendimentos/FIN_MOTOR;
- testes;
- rollback usado SIM/NÃO;
- incidentes;
- recomendação para ORDEM-007.

Depois PARAR.
