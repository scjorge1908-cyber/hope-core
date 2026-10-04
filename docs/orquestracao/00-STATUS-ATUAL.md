# 00 — STATUS ATUAL

| Campo | Valor |
|---|---|
| Fase atual | CONVERGÊNCIA PGF → HOPECORE — Fundação técnica |
| Número da ordem | ORDEM-005 |
| Status | **EMITIDA — aguardando execução do Claude/Core** |
| Implementação autorizada | **SIM, SOMENTE EM BRANCH — SEM DEPLOY/PRODUÇÃO** |
| Última entrega aceita | `entregas/ENTREGA-DIR-001-MAPA-CONVERGENCIA-PGF-HOPECORE.md` |
| Ordem atual | `ordens/ORDEM-005-CONVERGENCIA-BLOCO-1-FUNDACAO-SEM-DEPLOY.md` |
| Próxima ação | Claude/Core preparar fundação, testar, documentar e retornar ao CX |
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
