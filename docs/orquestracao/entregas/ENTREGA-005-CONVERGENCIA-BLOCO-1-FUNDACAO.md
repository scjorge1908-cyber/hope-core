# ENTREGA-005 — Convergência Bloco 1 — Fundação técnica (sem deploy)

| Campo | Valor |
|---|---|
| Responde à | ORDEM-005 (commit `adb9bf3`, status `15928e4`) |
| Executor | Claude/Core |
| Data | 2026-10-03/04 (America/Sao_Paulo) |
| Classificação | IMPLEMENTAÇÃO EM BRANCH / SEM DEPLOY |
| Branch do código | **`convergencia/bloco-1`** (criada pelo CX a partir de `main` `f5f9996`). Código **publicado** nos commits `22061dc` → `b83dcc0`. **Não mesclada em `main`** |
| Produção alterada? | **NÃO** (conferido no banco depois do trabalho; ver §7) |
| Apps Script publicado? | **NÃO** |
| Sync executado? | **NÃO** |
| Esta entrega autoriza implementação? | **NÃO** |

## 1. Resumo

| Item | Entregue | Resultado dos testes |
|---|---|---|
| A. DATA-01 no SyncSupabase | Agenda/Cancelados passam a formatar data/hora **no fuso da própria planilha**; nenhuma constante | 9/9 testes Node: o código **atual** reproduz exatamente o "11:53:32"; o novo devolve "07:00:00"; texto, número, booleano e vazio não mudam |
| B. Bootstrap de salas | `migration_033` (função **dry-run por padrão**, idempotente, rastreável) | 5 salas; 3 execuções = 5 salas; grafia diferente não duplica |
| C. Bootstrap de psicólogas | `migration_034` (função **dry-run por padrão**, idempotente, sem Auth) | 24 perfis = 17 ativos + 7 inativos; 0 com user_id/CPF/Pix/RG; vínculo 1:1; deduplicação por nome curto |
| D. `legado.vw_room_blocks` | `migration_035` (view, somente leitura, sem PII) | **94 ilhas** = cálculo independente em Python; 415 h cobertas; 0 sobreposições; funciona com `rooms` vazia |
| E. `public.guides = 0` | Investigação (seção 6) | **Nunca teve escritor.** A fonte operacional é `legado.bd_guias`. Não há gravação dupla quebrada |
| Rollbacks | 3 scripts (035 → 034 → 033) | Rollback testado: limpa tudo, preserva legado e sala cadastrada à mão; **recusa** apagar perfil em uso |

## 2. Commits e arquivos

**Branch `convergencia/bloco-1`** (código):

| Arquivo | Tipo |
|---|---|
| `sync/apps-script/SyncSupabase.gs` | Alterado: +22 linhas, **1 linha trocada**, nenhuma removida |
| `sync/apps-script/__tests__/sync_fuso.test.mjs` | Novo: teste Node (`node --test`), sem dependências |
| `supabase/migrations/20261004100000_migration_033_bootstrap_rooms.sql` | Novo (**não aplicado**) |
| `supabase/migrations/20261004100100_migration_034_bootstrap_professional_profiles.sql` | Novo (**não aplicado**) |
| `supabase/migrations/20261004100200_migration_035_vw_room_blocks.sql` | Novo (**não aplicado**) |
| `supabase/rollbacks/rollback_033_*.sql`, `rollback_034_*.sql`, `rollback_035_*.sql` | Novos |
| `supabase/tests/convergencia_bloco1/` (`00_stub_schema.sql`, `01_fixture_anonimizada.sql`, `02_testes.sql`, `03_ilhas_independente.py`, `04_rollback.sql`, `run.sh`) | Novos: suíte local em Postgres descartável |

**Commits publicados em `convergencia/bloco-1`** (via GitHub web, conteúdo idêntico ao commit validado `9088e5e` do PATCH):

| Commit | Conteúdo |
|---|---|
| `22061dc` | `SyncSupabase.gs` (DATA-01) |
| `e858cff` | `__tests__/sync_fuso.test.mjs` |
| `5dd0808` | migrations 033–035 |
| `69c63ec` | rollbacks 033–035 |
| `b83dcc0` | suíte `supabase/tests/convergencia_bloco1/` |

Conferência: `git diff 9088e5e origin/convergencia/bloco-1` = **nenhuma diferença de conteúdo**. A única diferença é o bit de execução de `run.sh`, perdido no upload web; rode com `bash run.sh`. Os testes foram **reexecutados sobre a branch publicada**: Node 9/9 ✔ e suíte SQL 100% ✔.

**Branch `orquestracao`:** esta entrega + `00-STATUS-ATUAL.md`.

## 3. A — DATA-01 (SyncSupabase.gs)

**Diff (essência):**

```js
// syncEnviarAgendaCancelados_
const planilha = ss || SpreadsheetApp.openById(psi.id);
+ const fusoPlanilha = planilha.getSpreadsheetTimeZone() || SYNC_FUSO;
...
- const c = cols.map(k => syncNormalizarCelula_(k < r.length ? r[k] : ''));
+ const c = cols.map(k => syncNormalizarCelulaNoFuso_(k < r.length ? r[k] : '', fusoPlanilha));

+ function syncNormalizarCelulaNoFuso_(v, fuso) {
+   if (v instanceof Date) {
+     if (isNaN(v.getTime())) return '';
+     return { $date: Utilities.formatDate(v, fuso || SYNC_FUSO, "yyyy-MM-dd'T'HH:mm:ss") };
+   }
+   return syncNormalizarCelula_(v);
+ }
```

Decisões:
- **Função nova em vez de mudar a assinatura** de `syncNormalizarCelula_`. Ela é usada via `.map(syncNormalizarCelula_)`, que passa o índice como 2º argumento; um parâmetro novo de fuso receberia o índice e quebraria a aba Atendimentos.
- **Escopo restrito a Agenda/Cancelados.** A aba Atendimentos (base do repasse) e a ExencaoCNPJ continuam **idênticas**. O motor lê só a data, que já chega certa (ENTREGA-004).
- **Texto preservado:** células não-Date seguem o caminho antigo, byte a byte (testado).
- **Nenhuma constante:** um teste falha se aparecer 4h53 ou equivalente no código.

**Testes (`node --test sync/apps-script/__tests__/sync_fuso.test.mjs`): 9/9 ✔**

1. O código atual, com célula 07:00 de planilha no Pacífico, gera `1899-12-30T11:53:32` → `celula_hora` = **11:53** (reproduz o DATA-01).
2. O código novo com o fuso da planilha gera `07:00:00`.
3. Planilha em São Paulo: antes = depois = 07:00 (sem regressão).
4. Grade inteira 07:00 / 08:00 / 08:50 / 09:40 / 13:10 / 19:00 / 21:30 volta exata.
5. Texto ("07:00", "livre 💚"), número, booleano, nulo, vazio e data inválida ficam inalterados.
6. Datas de início/cancelamento: mesmo dia (antes 04:00 SP; depois 00:00).
7. Fuso vazio cai no padrão do script.
8. Nenhuma constante de deslocamento no código.
9. A aba Atendimentos continua em `syncNormalizarCelula_`.

**Efeito esperado quando for publicado (não feito):** o próximo ciclo do sync reescreve `legado.agenda`/`cancelados` (delete+insert por planilha) com a hora certa. Hoje continuam **269/269** horários deslocados em produção, porque nada foi publicado.

**Rollback A:** restaurar a versão anterior do `.gs` (a de `main`) no projeto Apps Script e rodar um ciclo de sync.

## 4. B/C/D — Migrations preparadas

### B. `migration_033` — `public.bootstrap_rooms_from_legado(p_dry_run default true)`

- Origem: cabeçalho do painel (`legado.salas_meta`, colunas a partir da 3ª). Nome normalizado por `legado.sala_chave()` (trim, espaços colapsados, maiúsculas).
- Tenant: exige **exatamente 1** tenant interno, senão aborta.
- Idempotente: insere só a chave inexistente no tenant; advisory lock.
- Rastreável: a execução real grava os IDs criados em `legado.registro_log`, uma tabela de log **já existente** (`funcao = 'bootstrap_rooms_from_legado'`).
- Sem PII. `revoke` de anon/authenticated.
- **Rollback 033:** apaga **só os IDs registrados no log**, nunca uma sala cadastrada à mão com o mesmo nome. Aborta se alguma estiver em `appointments`.

### C. `migration_034` — `public.bootstrap_professional_profiles_from_legado(p_dry_run default true)`

| Prova pedida | Resposta |
|---|---|
| Chave estável de origem | `legado.planilhas.spreadsheet_id` (PK; mesmo ID usado pelo Mestre RPA e pelo sync) |
| Onde fica o vínculo | **Coluna nova, opcional, na tabela de TRANSIÇÃO** `legado.planilhas.professional_profile_id` (FK `on delete set null`, índice único parcial). `professional_profiles` **não muda**. Nenhuma tabela nova. Morre com o schema `legado` |
| O sync apaga o vínculo? | **Não.** Todas as 5 funções que escrevem em `legado.planilhas` fazem UPSERT/UPDATE com colunas explícitas; nenhuma faz DELETE (conferido no banco) |
| Deduplicação | Já vinculada → ignora. Existe **1** perfil livre com o mesmo `short_name` (sem caixa/espaços) → **vincula**. Mais de 1 → aborta |
| 24 / 17 / 7 | 24 perfis; `active = ativo AND NOT desligada` → 17 ativas; 7 inativas = **4** marcadas inativas na aba ID + **3** desligadas |
| Desligadas | `active = false`, `deleted_at` **nulo** (desligamento ≠ exclusão de registro); a data segue em `legado.planilhas.desligada_em` |
| Campos obrigatórios | `tenant_id` (da planilha), `full_name` (`nome_completo`; 0 vazios hoje; fallback para o nome curto), `short_name`, `active` |
| Campos nulos | `user_id`, `crp`, `cpf*`, `rg*`, `birth_date`, `approach`, `pix_key*`, `min_patient_age`. **O Pix cifrado do legado não é copiado** |
| Sem identidade prematura | Não cria usuário Auth, não preenche `user_id`, não ativa login |
| Vínculo futuro de login | Fluxo de convite (bloco próprio, gates G1/G5) preenche `professional_profiles.user_id` |
| Rollback 034 | Apaga **só os perfis CRIADOS** (IDs no `registro_log`); os só VINCULADOS ficam. Aborta se algum tiver `user_id`, appointment, session ou guide. Depois remove coluna, índice e função |

**INCONSISTÊNCIA DE DADOS DI-01 (registrada, NÃO corrigida — instrução do CX):** 2 profissionais **inativas na aba ID** (não desligadas) ainda ocupam blocos no painel de salas (sexta 13–22 h e terça 07–09 h / sexta 18 h). O bootstrap as criaria com `active = false`, como o legado manda. **Tratar DI-01 ANTES de executar o bootstrap de `professional_profiles`** (decidir se são ativas ou se o painel está desatualizado). Nada foi excluído e nenhum status foi alterado.

### D. `migration_035` — `legado.vw_room_blocks`

- Gaps-and-islands por (sala, dia, ocupante) sobre a hora: horas consecutivas formam 1 bloco `[inicio, fim)`.
- Colunas: `tenant_id`, `sala_norm`, `room_ref`, `weekday` (0 = domingo … 6 = sábado, convenção de `appointments`), `ocupante_tipo` (PROFISSIONAL / LIVRE / DESCONHECIDO), `planilha_ref`, `professional_profile_id`, `bloco_inicio`, `bloco_fim`, `horas`, `confianca` (a pior do bloco), `origem`, `sincronizado_em`.
- **Sem PII:** nenhuma coluna de nome; a profissional sai só como referência interna. Teste automático garante que não haja coluna de nome.
- `security_invoker`; schema `legado` fechado; `revoke` de anon/authenticated (testado).
- Com `rooms` vazia: funciona, e `room_ref` fica nulo (testado).
- Painel por `getDisplayValues()` → **não depende do DATA-01**.
- **Rollback 035:** `drop view`.

## 5. Testes do banco (Postgres 16 local, descartável)

`supabase/tests/convergencia_bloco1/run.sh`:
- **Esqueleto:** as mesmas colunas, tipos e defaults de produção (lidos do `information_schema`).
- **Fixture anonimizada:** P01…P24 no lugar dos nomes. É a ocupação real do painel e o status real das 24 planilhas.

| # | Teste | Resultado |
|---|---|---|
| — | Aplicar 033→034→035 **duas vezes** (DDL idempotente) | ✔ |
| B0–B7 | Dry-run não grava; 5 candidatas; 5 inseridas; 2ª/3ª execução 0 novas; só tenant interno; grafia diferente não duplica | ✔ |
| C1–C9 | Dry-run 24/17/7 sem gravar; real 24/17/7; 0 user_id/CPF/Pix/RG/deleted_at; vínculo 1:1; `active` e `short_name` = legado; reexecução 0 novas | ✔ |
| C10 | Perfil pré-existente " p25 " é **vinculado**, não duplicado | ✔ |
| D1–D6 | 415 h cobertas; 0 sobreposições; 215 h de profissional com confiança ALTA; `room_ref` e perfil resolvidos; nenhuma coluna de nome | ✔ |
| D7 | `rooms` vazia → view funciona com `room_ref` nulo (94 blocos) | ✔ |
| D8 | anon/authenticated sem acesso à view e às funções | ✔ |
| E1 | View = cálculo **independente em Python** (94 ilhas, diferença 0 nos dois sentidos) | ✔ |
| R0 | Rollback 034 **aborta** com perfil em uso e não apaga nada | ✔ |
| R1–R5 | Rollback 035→034→033: 0 salas do bootstrap (a manual fica), 0 perfis, coluna/funções removidas, 24 planilhas intactas | ✔ |

Distribuição: PROFISSIONAL/ALTA 42 blocos (215 h) · LIVRE 50 (198 h) · DESCONHECIDO 2 (2 h). Bate com ENTREGA-003/004 (215 + 198 + 2 = 415; 94 ilhas).

## 6. E — Por que `public.guides` está vazia

| Pergunta | Resposta | Evid. |
|---|---|---|
| Quem escreve em `public.guides`? | **Ninguém.** Nenhuma função do banco, rota do `apps/web` ou Apps Script faz INSERT/UPDATE/SELECT nela. A única função que "cita" `guides` (`claim_duplicate_billing`) usa o nome só como coluna de saída | [C] |
| De onde veio a tabela? | `migration_001_schema` (modelo do "sistema novo", criado em 19/09) | [C] |
| Qual fluxo deveria alimentá-la? | O registro de guias do sistema novo, que **não foi construído**. A decisão de 29/09 (migration 010) foi "grava nos dois" = **planilha BD_GUIAS + espelho `legado.bd_guias`**, e não `public.guides` | [C] |
| Fonte operacional atual | Planilha **BD_GUIAS** (Apps Script "ADM Registro de Guia"). Espelho: `legado.bd_guias` (1.795 linhas), por `legacy_ingest_bd_guias` (de hora em hora) e `legacy_registro_espelhar` (na hora, pela página nova via `PonteRegistroGuias.gs`) | [C] |
| Gravação dupla quebrada/abandonada? | **Não.** Está funcionando como projetada (planilha + espelho legado). `public.guides` simplesmente nunca entrou no fluxo | [C] |
| Correção na documentação | A ENTREGA-001 dizia "`public.guides` (já com gravação dupla)". **Impreciso:** a gravação dupla é para `legado.bd_guias`. A migração de guias para `public.guides` é trabalho futuro (fora deste bloco) | — |

## 7. Prova de produção intacta (consulta após o trabalho)

| Verificação em produção | Valor |
|---|---|
| Migrations aplicadas (`list_migrations`) | Última = `migration_032_motor_resumo_ano`. **033–035 ausentes** |
| `public.rooms` / `public.professional_profiles` | 0 / 0 |
| Funções `bootstrap_*` e `sala_chave` | 0 |
| Coluna `legado.planilhas.professional_profile_id` | Não existe |
| `legado.vw_room_blocks` | Não existe |
| `legado.agenda` com minuto final 3 (DATA-01 ativo) | **269/269**: o sync não foi alterado nem executado por mim |

Nenhum INSERT/UPDATE/DELETE/DDL foi executado em produção nesta ordem; só `SELECT`.

## 8. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R1 | Publicar o `.gs` sem piloto | ORDEM-006: piloto em 1 planilha (`testarAgendaSalasSupabase`) e conferência |
| R2 | Planilha com fuso diferente de SP/Pacífico | A correção usa o fuso de cada planilha; teste de grade cobre o caso |
| R3 | `active` do perfil "congela" no bootstrap enquanto a aba ID muda | Bootstrap é único; a sincronia contínua de status vira item de bloco futuro |
| R4 | Inativas que ainda ocupam sala no painel (achado §4C) | Confirmar com a operação antes do piloto |
| R5 | Push da branch pode gerar *preview* na Vercel (se a integração Git estiver ativa) | O preview **não** é produção e não há mudança em `apps/web`; desligar o preview da branch se o CX preferir |
| R6 | Fixture anonimizada ≠ produção em tudo | Os bootstraps têm dry-run: o piloto começa por `select …(true)` em produção e confere 5 / 24 / 17 antes de gravar |

## 9. O que fica pronto para o piloto (ORDEM-006)

1. **Sync:** publicar o `.gs` da branch e rodar o sync de **1** planilha. Esperado: os horários dela deixam de terminar em 3, as demais ficam iguais, e Atendimentos não muda.
2. **Banco:** aplicar 033→034→035; rodar `bootstrap_rooms_from_legado()` e `bootstrap_professional_profiles_from_legado()` em **dry-run** e conferir 5 / 24 (17/7). Só então executar com `false`.
3. **View:** conferir em produção 94 ilhas / 415 h / 215 h ALTA (ou a diferença explicada pela ocupação do dia).
4. **Rollback** pronto para cada passo.

## 10. Recomendação para a ORDEM-006

**ORDEM-006 — PILOTO CONTROLADO (IMPLEMENTAÇÃO AUTORIZADA restrita, com confirmação de Jorge).**

Ordem dos passos:
1. Revisão do CX deste código.
2. **Banco primeiro** (não depende do sync): 033, 034 e 035 + bootstraps (dry-run → real) + validação.
3. **Sync em 1 planilha** (piloto) → validação → expansão em outra ordem.

Fora do escopo:
- RLS (G1);
- constraints de agenda (G2);
- pacientes (G4);
- Google Auth (G5);
- disponibilidade pública;
- guias;
- FIN_MOTOR.

## Pendências de Jorge (inalteradas)

50 × 60 min · sublocação · falta × justificado · motivo de encerramento · repositório da interface da psicóloga · gates do PGF. **Nova (operacional, não bloqueia):** conferir as 2 profissionais inativas na aba ID que ainda aparecem no painel de salas.

## Próxima ação

**ENTREGA-005 disponível — aguardando revisão do CX.**
