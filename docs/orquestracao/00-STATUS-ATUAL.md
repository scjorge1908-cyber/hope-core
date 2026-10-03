# 00 — STATUS ATUAL

| Campo | Valor |
|---|---|
| Fase atual | ORDEM-002 — Validação de identidade e ambiente do Psi Gestão Fácil |
| Número da ordem | ORDEM-002 |
| Status | **EMITIDA — aguardando execução do Claude/Core** |
| Implementação autorizada | **NÃO** |
| Última entrega recebida | `entregas/ENTREGA-001-ARQ-PSI-01-CONVERGENCIA.md` |
| Ordem atual | `ordens/ORDEM-002-VALIDACAO-IDENTIDADE-AMBIENTE-PGF.md` |
| Próxima ação | **Claude/Core executar ORDEM-002 em modo somente leitura** |
| Atualizado em | 2026-10-03 (America/Sao_Paulo) |

## Bloqueios / gates

1. **Identidade do Psi Gestão Fácil:** precisa ser comprovada antes de qualquer implementação derivada da ENTREGA-001.
2. **Segurança PGF:** SEC-PGF-01/02 precisam ser reclassificados conforme publicação e existência de dados reais.
3. **Repositório público:** relatórios RESTRITOS permanecem fora dele.
4. **Auditoria AUD-001:** fase de correção permanece sem autorização nesta frente.
5. **Motor financeiro:** não alterar `FIN_MOTOR` nesta ordem.
6. **Bradesco:** fora do escopo desta ordem.

## Frentes

| Frente | Estado | Implementação autorizada |
|---|---|---|
| ARQ-PSI-01 | ENTREGA-001 recebida e revisada pelo CX | NÃO |
| ORDEM-002 | Emitida; aguardando Claude/Core | NÃO |
| Segurança PGF | Gate de validação | NÃO |
| Motor financeiro central | Mantido no estado atual | Somente o já existente |

## Governança

- **CX/ChatGPT:** comandante, arquiteto e orquestrador técnico; emite ordens técnicas.
- **Claude/Core:** executor; analisa e implementa somente dentro do escopo autorizado pela ordem.
- **Jorge:** decisor final de negócio; não participa do handoff técnico rotineiro.
