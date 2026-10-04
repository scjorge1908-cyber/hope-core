# 00 — STATUS ATUAL

| Campo | Valor |
|---|---|
| Fase atual | CONVERGÊNCIA PGF → HOPECORE (diretriz do Owner, 2026-10-03) |
| Número da ordem | ORDEM-004 |
| Status | **ENTREGA-DIR-001 (mapa de convergência) disponível — aguardando validação do CX** |
| Implementação autorizada | **NÃO** |
| Última entrega aceita | `entregas/ENTREGA-003-AGENDA-FIT-01-FIT-GAP-MODELO-AGENDA.md` |
| Última entrega recebida | `entregas/ENTREGA-DIR-001-MAPA-CONVERGENCIA-PGF-HOPECORE.md` (antes: ENTREGA-004, revisada pelo CX no chat) |
| Ordem atual | `ordens/ORDEM-004-AGENDA-FIT-02-DIAGNOSTICO-HORARIO-VIEWS.md` (executada) |
| Próxima ação | **CX validar o mapa e definir o BLOCO 1** |
| Atualizado em | 2026-10-03 (America/Sao_Paulo) |

## Diretriz do Owner (2026-10-03)

- HopeCore = núcleo único (dados, regras, segurança). Psi Gestão Fácil = interface operacional da psicóloga (UI/UX/fluxos), futuramente SaaS. Sem backend paralelo.
- Prioridade: auth individual → vínculo → salas → agenda → pacientes → atendimentos → guias → faturamento → repasse → disponibilidade pública → extras.
- Trabalho em blocos pequenos e reversíveis, cada um validado pelo CX antes do próximo bloco de risco.
- **ORDEM-005 proposta (correção direta do Sync) SUPERADA pela nova direção até decisão do CX.**

## Resultado resumido da ENTREGA-DIR-001

- 50 itens do PGF mapeados: C1 17 · C2 11 · C3 13 · C4 6 · C5 4 · C6 13. **0 tabelas novas.**
- Gates para o CX: G1 RLS por profissional · G2 índice/constraint agenda-sessões · G3 correção DATA-01 · G4 importação de pacientes · G5 Google no Supabase Auth.
- BLOCO 1 sugerido: popular `rooms` (5) e `professional_profiles` (24; 17 ativas) do espelho por RPC idempotente + `vw_room_blocks` — **aguarda validação do CX**.

## Resultado resumido da ENTREGA-004

- Causa raiz do DATA-01 (confiança ALTA): planilhas das psicólogas no fuso do Pacífico × SyncSupabase formatando em America/Sao_Paulo; células de hora usam a data-base 1899 (LMT SP −3:06:28 × PST −8:00 = +4:53:32), e `celula_hora` corta os segundos.
- Prova independente: datas de Atendimentos chegam 04:00 no verão dos EUA e 05:00 no inverno.
- −4h53 **não** é constante válida (13 horários digitados como texto estão corretos; depende do fuso de cada planilha).
- Correção recomendada na origem (formatar no fuso da própria planilha) + reprocessamento natural pelo sync; views especificadas, nada criado.

## Decisão CX sobre ENTREGA-003

**ACEITA COM RESSALVA TÉCNICA.**

- 97% compatíveis após normalizações determinísticas.
- 0 tabelas novas justificadas.
- Blocos de sala deriváveis.
- Duração variável confirmada nos dados.
- O deslocamento ~4h53 é tratado como **sintoma a diagnosticar**, não como constante de correção.

## Segundo plano — decisões de Jorge

- duração 50×60;
- sublocação na agenda;
- falta × justificado;
- motivo de encerramento;
- gates do Psi Gestão Fácil registrados anteriormente.

Nenhum desses itens bloqueia ORDEM-004.

## Governança

CX/ChatGPT = orquestrador técnico. Claude/Core = executor. Jorge = decisão de negócio e exceções.
