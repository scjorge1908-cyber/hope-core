# 00 — STATUS ATUAL

| Campo | Valor |
|---|---|
| Fase atual | CONVERGÊNCIA PGF → HOPECORE — Fundação técnica |
| Número da ordem | ORDEM-005 |
| Status | **ENTREGA-005 PUBLICADA no GitHub — aguardando validação final do CX** |
| Implementação autorizada | **SIM, SOMENTE EM BRANCH — SEM DEPLOY/PRODUÇÃO** |
| Última entrega aceita | `entregas/ENTREGA-DIR-001-MAPA-CONVERGENCIA-PGF-HOPECORE.md` |
| Última entrega recebida | `entregas/ENTREGA-005-CONVERGENCIA-BLOCO-1-FUNDACAO.md` |
| Ordem atual | `ordens/ORDEM-005-CONVERGENCIA-BLOCO-1-FUNDACAO-SEM-DEPLOY.md` |
| Branch do código | `convergencia/bloco-1` — commits `22061dc`…`b83dcc0` (não mesclada em `main`) |
| Próxima ação | **CX validar os commits publicados e decidir a ORDEM-006**; sem deploy/produção |
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
