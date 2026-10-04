# 00 — STATUS ATUAL

| Campo | Valor |
|---|---|
| Fase atual | CONVERGÊNCIA PGF → HOPECORE — Fundação técnica |
| Número da ordem | ORDEM-006 |
| Status | **ORDEM-006 EMITIDA — piloto controlado DATA-01 + salas** |
| Implementação autorizada | **SIM — produção restrita aos passos explícitos da ORDEM-006** |
| Última entrega aceita | `entregas/ENTREGA-005-CONVERGENCIA-BLOCO-1-FUNDACAO.md` — ACEITA COM GATE DI-01 |
| Última entrega recebida | `entregas/ENTREGA-005-CONVERGENCIA-BLOCO-1-FUNDACAO.md` |
| Ordem atual | `ordens/ORDEM-006-PILOTO-CONTROLADO-DATA01-SALAS.md` |
| Branch do código | `convergencia/bloco-1` — commits `22061dc`…`b83dcc0` (não mesclada em `main`) |
| Próxima ação | Claude/Core executar piloto estritamente conforme ORDEM-006 e retornar ao CX |
| Atualizado em | 2026-10-03 (America/Sao_Paulo) |

## Decisão CX

ENTREGA-DIR-001 **ACEITA**.

HopeCore permanece núcleo único. PGF converge como interface, não como backend concorrente.

Não foi autorizada escrita em produção.

## Escopo ORDEM-005

- preparar correção DATA-01 no código, sem publicar;
- preparar bootstrap idempotente de rooms, sem executar;
- preparar bootstrap idempotente de professional_profiles, sem executar/Auth;
- preparar vw_room_blocks, sem aplicar;
- investigar public.guides=0 em somente leitura.

## Gates ainda fechados

G1 RLS profissional · G2 agenda/sessions · G4 pacientes · G5 Google Auth · FIN_MOTOR · deploy.

## Pendências de Jorge — segundo plano

Duração 50×60 · sublocação · falta justificada · motivo de encerramento · estratégia futura de SaaS/multi-tenant.

Nenhuma bloqueia ORDEM-005.


## Registro CX — PATCH ORDEM-005 recebido

- PATCH de código e PATCH de documentação recebidos em 2026-10-03.
- CX revisou o escopo: DATA-01 usa timezone da própria planilha; Atendimentos/FIN_MOTOR permanecem fora; bootstraps com dry-run; rollbacks e testes incluídos; produção declarada intacta.
- Branch `convergencia/bloco-1` criada pelo CX a partir de `main`.
- O conteúdo do PATCH ainda não foi aplicado à branch por limitação de transporte entre o anexo da conversa e o conector GitHub. **Não considerar o código publicado ainda.**
- Nenhum deploy ou migration autorizado.

## Registro Claude — publicação da ORDEM-005 (após o registro CX acima)

- Código **publicado** em `convergencia/bloco-1`: `22061dc` (Sync DATA-01), `e858cff` (teste Node), `5dd0808` (migrations 033–035), `69c63ec` (rollbacks), `b83dcc0` (suíte de testes). Conteúdo idêntico ao PATCH revisado (`9088e5e`); só o bit de execução de `run.sh` não foi preservado.
- Testes reexecutados sobre a branch publicada: Node 9/9 ✔; suíte SQL local 100% ✔ (94 ilhas; rollback validado).
- Produção **intacta**: nenhuma migration aplicada (última = 032), nenhum sync executado, nenhum deploy, nenhum INSERT/UPDATE/DELETE.
- **DI-01 (inconsistência de dados, não corrigida):** 2 profissionais inativas na aba ID ainda ocupam salas no painel. Tratar **antes** de executar o bootstrap de `professional_profiles`.
- Transporte: o git da sessão Claude segue sem credencial para `hope-core` (HTTP 403 no proxy); a publicação foi feita pelo upload web do GitHub.


## Decisão CX — ENTREGA-005

**ACEITA COM GATE DI-01.**

ORDEM-006 autorizada para piloto restrito: migration 033 + rooms; migration 034 apenas DDL/dry-run, sem criar perfis; migration 035 + view; DATA-01 em uma única planilha ativa fora de DI-01. FIN_MOTOR, Atendimentos, Auth, RLS, pacientes e sync global permanecem bloqueados.
