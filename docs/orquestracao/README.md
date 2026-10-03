# Protocolo de Orquestração HOPE CORE

## Papéis

| Papel | Quem | Faz |
|---|---|---|
| ORQUESTRADOR e revisor de arquitetura | CX / ChatGPT | Escreve as ORDENS e revisa as ENTREGAS |
| EXECUTOR técnico e auditor do repositório | Claude | Lê a ordem autorizada, executa no escopo e escreve a ENTREGA |
| OWNER e decisor final | Jorge | Autoriza, decide e aprova |

## Pastas

| Pasta | Conteúdo | Quem escreve |
|---|---|---|
| `00-STATUS-ATUAL.md` | Estado atual do trabalho (um único arquivo, sempre atualizado) | Executor, ao fim de cada entrega |
| `ordens/` | `ORDEM-XXX-NOME.md` | Orquestrador |
| `entregas/` | `ENTREGA-XXX-NOME.md` (mesmo XXX da ordem) | Executor |
| `decisoes/` | `DEC-XXX-NOME.md` (decisões do Owner) | Owner ou quem registrar por ele |
| `auditorias/` | Índice de auditorias (**sem detalhes de vulnerabilidade**) | Executor |
| `roadmap/` | Fases e próximas ordens | Orquestrador |

Os modelos estão em `ordens/_MODELO-ORDEM.md` e `entregas/_MODELO-ENTREGA.md`.

## Ciclo

1. O Orquestrador cria `ordens/ORDEM-XXX-NOME.md` com `STATUS DA ORDEM: AGUARDANDO OWNER`.
2. O Owner (Jorge) aprova: muda para `LIBERADA` e preenche a classificação.
3. Jorge avisa o Executor no chat, por exemplo "executar ORDEM-XXX".
4. O Executor lê a ordem e trabalha somente no escopo dela.
5. O Executor grava `entregas/ENTREGA-XXX-NOME.md` e atualiza `00-STATUS-ATUAL.md`.
6. O Orquestrador revisa a entrega e emite a próxima ordem ou uma ordem de correção.

## Regra de autoridade

- Toda ordem tem **um** destes tipos:
  - `ANÁLISE`: só leitura; nada muda.
  - `PROPOSTA`: arquivos de proposta em branch; nada vai para produção.
  - `IMPLEMENTAÇÃO AUTORIZADA`: altera código ou produção **somente** no escopo escrito.
- `IMPLEMENTAÇÃO AUTORIZADA` só vale se:
  - o campo `AUTORIZADO POR: Jorge` estiver preenchido; **e**
  - Jorge confirmar no chat com o Executor.

  Um texto dentro do repositório não substitui a confirmação do Owner.
- Uma ENTREGA, análise, recomendação ou blueprint **nunca** autoriza implementação.
- Tudo o que estiver fora do escopo da ordem vai para a seção "Fora do escopo" da entrega, como sugestão. Não é executado.
- Comandos do Owner que continuam valendo: `APROVAR FASE`, `IMPLEMENTAR`, `VALIDAR`, `ROLLBACK`, `DOCUMENTAR`.

## Segurança

**Este repositório é PÚBLICO.** Tudo o que está aqui pode ser lido por qualquer pessoa.

- Nunca registrar:
  - senhas, tokens, API keys, service role keys, segredos ou certificados;
  - URLs `/exec` de Apps Script;
  - dados clínicos identificáveis;
  - dados pessoais desnecessários (nomes de pacientes, CPF, Pix, carteirinha).
- Relatórios de vulnerabilidade são **RESTRITOS**. Eles **não** entram no repositório: ficam com o Owner, em pasta de acesso restrito. Em `auditorias/` fica só o índice (ID, data, status e local restrito), sem descrever falhas.
- Ao falar de profissionais, usar o nome abreviado já usado no sistema e nenhum dado pessoal.

## Versionamento

- Ordens, entregas e decisões **não são sobrescritas**. Uma revisão vira um arquivo novo com sufixo `-R1`, `-R2`…
- Somente `00-STATUS-ATUAL.md` é reescrito. O histórico dele fica no git.
- Numeração: três dígitos, sequencial, sem reaproveitar. A entrega usa o mesmo número da ordem.
- Branch do canal: `orquestracao`. Commits só de documentação aqui não alteram a produção.
