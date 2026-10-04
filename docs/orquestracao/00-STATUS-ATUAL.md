# 00 — STATUS ATUAL

| Campo | Valor |
|---|---|
| Fase atual | CONVERGÊNCIA PGF → HOPECORE — Fundação técnica |
| Número da ordem | ORDEM-005 |
| Status | **ENTREGA-005 recebida em PATCH e revisada pelo CX — publicação do código pendente** |
| Implementação autorizada | **SIM, SOMENTE EM BRANCH — SEM DEPLOY/PRODUÇÃO** |
| Última entrega aceita | `entregas/ENTREGA-DIR-001-MAPA-CONVERGENCIA-PGF-HOPECORE.md` |
| Ordem atual | `ordens/ORDEM-005-CONVERGENCIA-BLOCO-1-FUNDACAO-SEM-DEPLOY.md` |
| Próxima ação | Publicar o conteúdo validado da ENTREGA-005 na branch `convergencia/bloco-1`; **sem deploy/produção** |
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
