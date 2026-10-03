# ENTREGA-000 — Protocolo de orquestração

| Campo | Valor |
|---|---|
| Responde à | ORDEM-000: "Protocolo de Orquestração HOPECORE", recebida do Owner pelo chat em 2026-10-03 |
| Executor | Claude |
| Data | 2026-10-03 17:20 (America/Sao_Paulo) |
| Classificação da ordem | PROPOSTA (preparar o protocolo; não implementar ARQ-PSI-01) |
| Produção alterada? | **NÃO**. Só documentação, na branch `orquestracao` (não é a `main`; a Vercel não faz deploy de produção) |
| Esta entrega autoriza implementação? | **NÃO** |

## O que foi feito

Foi criada a estrutura `docs/orquestracao/`:
- `README.md`: o protocolo (papéis, ciclo, autoridade, segurança e versionamento);
- `00-STATUS-ATUAL.md`;
- `ordens/_MODELO-ORDEM.md` e `entregas/_MODELO-ENTREGA.md`;
- `decisoes/README.md`, `auditorias/README.md` (só índice) e `roadmap/README.md`.

## Respostas às 7 perguntas do protocolo

1. **Acesso ao repositório:** suficiente para ler, criar branch, commitar e fazer push. O push na `main` já funcionou antes. O push de **tags** é bloqueado (403), e a leitura da proteção de branch também. CONFIRMADO.
2. **Repositório e branch:** `scjorge1908-cyber/hope-core`. A `main` é a de produção (deploy automático na Vercel). O canal de orquestração é a branch `orquestracao`. CONFIRMADO.
3. **Ler ordens em `ordens/`:** sim, depois de `git fetch`, em qualquer branch.
4. **Registrar entregas em `entregas/`:** sim.
5. **Atualizar `00-STATUS-ATUAL.md`:** sim.
6. **Limitações:**
   - O Executor **não é acionado sozinho** por um commit novo. Jorge precisa avisar no chat (por exemplo "executar ORDEM-001"). Uma alternativa é uma tarefa agendada que verifica a pasta de ordens.
   - Por segurança, um texto no repositório não basta como autorização. `IMPLEMENTAÇÃO AUTORIZADA` exige também a confirmação de Jorge no chat.
   - **O repositório é PÚBLICO.** Relatórios RESTRITOS não podem ficar nele. Recomendação ao Owner: torná-lo privado (decisão dele).
   - O ambiente do Executor é temporário: a cada sessão o repositório é clonado de novo, então o que vale é o que está no GitHub.
   - O conector do Supabase bloqueia SQL com `DELETE`. Migrations assim são rodadas pelo Owner no SQL Editor.
   - O Orquestrador precisa de acesso de escrita ao GitHub para gravar as ordens. Sem isso, Jorge cola a ordem no arquivo ou no chat.
   - Quando o mesmo arquivo for editado em paralelo, vale o histórico do git; o Executor faz merge e não sobrescreve.
7. **Pronto para a primeira ordem:** sim. ARQ-PSI-01 **não** foi iniciada.

## Fora do escopo (sugestões, não executadas)

- Levar `docs/orquestracao/` para a `main`. Só documentação; isso dispararia um novo deploy do mesmo código. Fica a critério do Owner.
- Tornar o repositório privado.
