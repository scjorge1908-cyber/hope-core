# ENTREGA-DIR-001 — Mapa de convergência Psi Gestão Fácil × HopeCore

| Campo | Valor |
|---|---|
| Responde à | Diretriz do Owner (Jorge), chat de 2026-10-03: "convergência PGF → HopeCore; primeira tarefa: mapa de convergência". Sem número de ORDEM do CX: numerada `DIR-001` para não colidir com a numeração de ordens |
| Executor | Claude/Core |
| Data | 2026-10-03 (America/Sao_Paulo) |
| Classificação | ANÁLISE — somente leitura |
| Produção alterada? | **NÃO**. Leitura do `hope-core` (`main` e `orquestracao`), metadados e contagens no Supabase e entregas 001–004 |
| Esta entrega autoriza implementação? | **NÃO** |
| Base | ENTREGA-001 (inventário de telas do PGF, lido no código), ENTREGA-002 (identidade), ENTREGA-003 (fit-gap da agenda), ENTREGA-004 (causa do horário). **Não reinicia análise** |

**Limitação:** o repositório privado do PGF não está acessível nesta sessão. O inventário de telas e coleções do PGF vem da ENTREGA-001 (lido no código em 03/10/2026, [C]). Detalhes de componente não reconferidos estão marcados [EI].

**Classes de convergência** (uma por linha):
- **C1** JÁ EXISTE NO CORE — conectar/reutilizar
- **C2** EXISTE PARCIALMENTE — ajustar
- **C3** EXISTE NO PGF E DEVE SER REAPROVEITADO (UI/UX/fluxo)
- **C4** PRECISA SER INTEGRADO
- **C5** REALMENTE NÃO EXISTE — propor antes de criar
- **C6** LEGADO A SER DESCONTINUADO

---

## 1. Princípio aplicado

```
HOPECORE / SUPABASE   = dados, regras, segurança (RLS, RPC, motor financeiro)
        ↑ escreve só por RPC/rota servidor
PSI GESTÃO FÁCIL (UI) = telas e fluxos da psicóloga, reescritos para ler/escrever no Core
        ↓ futuro
SaaS                  = mesmo Core, outros tenants
```

No PGF se reaprovita a **camada de apresentação** (telas, componentes, fluxos, PWA). **Nada** de Firestore, regras ou modelo de dados do PGF vira fonte (decisão da ENTREGA-001, aceita pelo CX).

## 2. Inventário do Core usado no mapa (estado real, hoje)

| Domínio | Estrutura no Core | Linhas hoje | Interface existente |
|---|---|---|---|
| Auth | Supabase Auth + `users` (`role`: owner, manager, admin_staff, **professional**) + `current_tenant_id()`, `has_finance_access()`, `is_platform_admin()` | 1 usuário | `/login` (e-mail/senha) |
| Tenant | `tenants` (`is_internal`, `plan`, `billing_status`) | 1 | — |
| Profissional | `professional_profiles` (CPF/RG/Pix criptografados), `professional_credentials`, `legado.planilhas` | 0 · 0 · 24 | `/bi/psicologas` |
| Salas | `rooms`, `legado.salas_painel` | 0 · 83 | `/bi/salas` |
| Agenda | `appointments`, `professional_availability_blocks`, `waitlist_entries`, `legado.agenda`, `legado.cancelados` | 0 · 0 · 0 · 269 · 337 | `/bi/agenda-paciente`, `/bi/faltas`, `/financeiro/agenda` |
| Pacientes | `patients` (CPF criptografado + blind index), RPC `create_patient` | 0 | — |
| Atendimentos | `sessions`, `legado.atendimentos_raw` | 0 · 4.517 | (via motor) |
| Guias | `guides`, `guide_status_overrides`, `legado.bd_guias`, RPCs `conferencia_guias`, `guia_divergencias`, `bi_gerar_guias_base`, `guias_adm_sem_sessao` | 0 · — · 1.795 | `/bi/gerar-guias`, `/financeiro/conferencia`, `/financeiro/nao-lancadas` |
| Faturamento | `insurance_plans` (9), `claim_statements`, `insurance_claim_returns` (~4.000), `claim_return_glosses`, `gloss_appeals`, `operator_invoices` | — | `/financeiro/importar`, `/financeiro/divergencias`, `/financeiro/notas` |
| Repasse | Motor `fin_*` (regras versionadas, fechamentos/fotos), `payouts`, `payout_rules`, `repasse_pagamentos`, `fiscal_documents`, `inss_ceilings` | 2 fechamentos | `/financeiro/repasse`, `/financeiro/pagamentos` |
| Financeiro | Cora, Bradesco, conciliação, DRE, projeção | — | `/financeiro/*` |
| Sistema | `audit_log`, `db_alteracoes`, catálogo | — | `/sistema/banco` |
| Documentos | `document_declarations`, `notifications` | 0 | — |

## 3. Mapa de convergência — na ordem de prioridade do Owner

### 3.1 Autenticação individual

| Item PGF | Situação no Core | Classe | Ação de convergência |
|---|---|---|---|
| Login Google (Firebase Auth) | Supabase Auth com e-mail/senha; Google pode ser habilitado como provedor no Supabase | **C2** | Habilitar o provedor Google no Supabase Auth (configuração, não código); manter e-mail/senha |
| Auto-cadastro no 1º login com papel "psychologist" | Sem auto-cadastro, de propósito (o Core só cria usuário por convite) | **C6** (o comportamento) | **Não** reproduzir: qualquer conta Google viraria usuário (SEC-PGF-05). Substituir por **convite** |
| Papéis `admin` / `psychologist` (string no documento) | `user_role` enum já tem `professional`, `admin_staff`, `manager`, `owner` | **C1** | Usar `users.role = professional` |
| Admin por e-mail fixo no código/regras | `platform_admins` + `role` | **C1** / **C6** | Descartar o e-mail fixo |
| Tela de login PWA (visual) | `/login` simples | **C3** | Reaproveitar o visual do PGF na interface da psicóloga |
| Ligação usuário ↔ profissional | `professional_profiles.user_id` já existe | **C1** | Preencher `user_id` na ativação |
| Convite / ativação da psicóloga | Não existe fluxo | **C5** | **Propor** (sem tabela nova): convite = `auth.admin.inviteUserByEmail` + `users` (role professional) + vínculo `professional_profiles.user_id`. Casar com CPF (blind index já existe) só como verificação, nunca como senha |
| RLS para a psicóloga ver só os próprios dados | RLS atual é por **tenant** + `has_finance_access()`; não há filtro "só meus registros" | **C2** ⚠ **GATE** | Políticas por `professional_id = perfil do auth.uid()` nas tabelas clínicas. **Altera RLS: exige decisão do CX** |

### 3.2 Vínculo profissional

| Item PGF | Situação no Core | Classe | Ação |
|---|---|---|---|
| `clinicas_vinculadas[]` / `clinicId` fixo `'hope-clinica'` | `users.tenant_id` (1 tenant) + `tenants` | **C1** para a Hope; **C6** para o modelo PGF | A Hope é o tenant interno; o array do PGF é descartado |
| Ativo/inativo da psicóloga | `professional_profiles.active`, `deleted_at`; `legado.planilhas.ativo/desligada/desligada_em` | **C1** | Usar `active` + `deleted_at`; importar status de `legado.planilhas` |
| Multi-clínica / ex-parceira como cliente SaaS | Não suportado (1 tenant por usuário) | **C5** — **adiado** | Decisão CX/ENTREGA-002: **não** criar `tenant_memberships` agora; só quando houver 2º tenant real |
| `firebase-blueprint` (`psychologists` + `clinic_psychologists`) | Mesmo conceito do item acima | **C6** | Só referência conceitual |

### 3.3 Salas

| Item PGF | Situação no Core | Classe | Ação |
|---|---|---|---|
| `/cadastro-salas`: cadastro de sala (nome, endereço, dias) | `rooms` (nome) — 0 linhas | **C2** | Popular `rooms` com as 5 salas do painel (normalizadas, ENTREGA-003). Endereço/unidade: **C5** (campo), só se houver 2ª unidade |
| Gerador de horários da sala (intervalo 30/45/60) | Blocos deriváveis por view do painel (ENTREGA-004 §4.2) | **C3** (UI) + **C2** (dado) | Reaproveitar o **componente** gerador; os blocos vêm de `vw_room_blocks` (sem tabela) |
| `/gestao-salas`: ocupação | `/bi/salas` (BI de salas, migration 024) | **C1** + **C3** | Unir: o dado vem do Core, e o visual do PGF entra onde for melhor que o BI |
| Ativação da psicóloga em sala + horários (`assignedRoomId`, `assignedSlots`) | Painel de salas (`legado.salas_painel`) | **C4** | Ler do painel via view; edição continua no Hope Painel até haver ordem |
| Apaga e recria a agenda inteira ao ativar (ARQ-PSI-R2) | — | **C6** | Comportamento descartado (perda de dados) |
| Aluguel avulso de sala (`sublocacoes`/`subleasing` + Mercado Pago) | Não existe no Core; existe no site (`sublease_*` no Firestore do site) | **C4** | Pendência de Jorge (sublocação). Não migrar agora |

### 3.4 Agenda

| Item PGF | Situação no Core | Classe | Ação |
|---|---|---|---|
| `/agenda-psicologas`: grade semanal sala × horário (livre/ocupado/reserva/intervalo) | `appointments` (`weekday`, `start_time`, `status`, `admin_block`) + `legado.agenda` | **C3** (UI) + **C2** (dado) | A grade do PGF vira a tela da psicóloga; o dado vem de `legado.agenda` normalizada → depois `appointments` |
| Paciente gravado dentro do slot (nome/telefone) | `appointments.patient_id` → `patients` | **C1** (modelo) / **C6** (forma PGF) | Nunca guardar paciente no slot |
| Geração de 30 dias de slots materializados | Recorrência implícita em `appointments` (`scheduled_date` nulo) | **C6** | Não materializar slots |
| Conflito de horário checado no navegador | Índices únicos; falta `EXCLUDE` (ENTREGA-003) | **C2** ⚠ **GATE** | Ajustes já mapeados: duração, `EXCLUDE` sala/profissional, índice de sessões, exceção por data. **Constraint/índice: exige ordem do CX** |
| Horário espelhado deslocado (DATA-01) | Causa conhecida (ENTREGA-004) | **C2** | Correção do Sync **suspensa** pela nova direção, até decisão do CX. **Pré-requisito** de qualquer tela que mostre horário a partir do espelho |
| Bloqueios/férias | `professional_availability_blocks`, `admin_block` | **C1** | Conectar |
| Lista de espera | `waitlist_entries` | **C1** | Conectar (o PGF não tem a tela) |

### 3.5 Pacientes

| Item PGF | Situação no Core | Classe | Ação |
|---|---|---|---|
| Coleção `patients` (quase sem uso) + nome no slot | `patients` (CPF criptografado, blind index, responsável) + RPC `create_patient` | **C1** | Conectar; a RPC já existe |
| `/paciente/[id]` (ficha estática/exemplo) | Sem tela | **C3** (layout) + **C1** (dado) | Reaproveitar o layout; dados reais do Core |
| Importação inicial | `legado.agenda`/`cancelados` têm nome, nascimento, cidade e bairro | **C4** | Importar por RPC transacional (ordem própria; envolve PII → gate de pacientes) |
| Prontuário | Não existe em nenhum dos dois | **C5** | Fora do escopo; exige parecer (guarda CFP), pendência da ENTREGA-001 |

### 3.6 Atendimentos (sessões)

| Item PGF | Situação no Core | Classe | Ação |
|---|---|---|---|
| Registro de sessão | **Inexistente no PGF**; no legado, o PWA individual (Sistema Unificado) grava na aba Atendimentos → `legado.atendimentos_raw` (4.517) | **C1** (Core) | O Core é a fonte; a tela de registro da psicóloga é **C5 de UI** (o PGF não tem); o modelo de dados existe (`sessions`) |
| Falta / justificado | `billing_status = missed` (sem distinção) | **C2** | Pendência de Jorge (falta × justificado) |
| Várias sessões por recorrência | Bloqueado por `idx_sessions_unique_appointment` | **C2** ⚠ **GATE** | Ajuste de índice (ENTREGA-003) |

### 3.7 Guias

| Item PGF | Situação no Core | Classe | Ação |
|---|---|---|---|
| `/registro-guias` (mock) | `guides` + RPCs de conferência + `legado.bd_guias` (1.795) + `/bi/gerar-guias`, `/financeiro/conferencia` | **C6** (tela PGF) / **C1** (Core) | Descartar o mock; a psicóloga consome guias do Core |
| Anexo de guia/atestado (Drive) | `appointments.attachment_*_path`; links legados | **C2** | Storage é ordem futura (ENTREGA-001 §16) |
| Observação: `public.guides` tem **0 linhas**; a fonte operacional ainda é `legado.bd_guias` | — | — | Reconferir a "gravação dupla" citada na ENTREGA-001 antes de qualquer tela de guias [EI] |

### 3.8 Faturamento

| Item PGF | Situação no Core | Classe | Ação |
|---|---|---|---|
| `/cadastro-plano` (planos, convênios, sessões particulares — `health_plans`, `agreements`, `private_sessions`) | `insurance_plans` (9) + TISS, demonstrativos, glosas, recursos, NF para operadoras | **C6** (PGF) / **C1** (Core) | Descartar; o Core é muito mais completo |
| De-para do rótulo de plano da agenda → plano | Inexistente | **C2** | Previsto em `vw_agenda_normalizada` (ENTREGA-004), sem tabela nova |

### 3.9 Demonstrativo / repasse

| Item PGF | Situação no Core | Classe | Ação |
|---|---|---|---|
| `/gestao-rpa`, `/rpa-form`, `/anexar-rpa` (localStorage/mock) | Motor `fin_*` versionado e validado, fechamentos-foto, `fiscal_documents`, `repasse_pagamentos`, `/financeiro/repasse` | **C6** (PGF) / **C1** (Core) | Descartar o mock. **Não tocar no motor** |
| Campos do formulário RPA do PGF | `professional_profiles` (CPF/RG/Pix criptografados) | **C3** (referência) | Usar só como referência de campos na tela da psicóloga |
| `/financeiro-psicologo` (sublocações e pagamentos da psicóloga) | Repasse por profissional existe no Core (visão admin) | **C3** (UI) + **C4** | Tela "meu demonstrativo" da psicóloga lendo do motor **em modo leitura**, com RLS por profissional (gate 3.1) |

### 3.10 Disponibilidade pública

| Item PGF | Situação no Core | Classe | Ação |
|---|---|---|---|
| `/corpo-clinico` (vitrine + horários livres de `agenda_psicologas`) | Sem API pública; desenho de `fn_disponibilidade_publica` pronto (ENTREGA-004 §4.3) | **C3** (UI) + **C5** (função) | Função só de leitura, zero PII. **Depende da correção do DATA-01** |
| Site atual (JSONP/CSV do Apps Script da psicóloga, `specialists.schedule`) | — | **C6** (após validação) | Substituir pelo feed do Core com flag e 2 semanas em paralelo (ENTREGA-001 §16) |
| `/cadastro-psicologo` (cadastro público PF/PJ, CEP, especialidades, foto) | `professional_profiles` + `professional_credentials`; credenciamento ainda em Apps Script | **C3** (UI) + **C4** | Integrar ao credenciamento; o cadastro público sem limite (SEC-PGF-03) **não** é reproduzido |

### 3.11 Recursos adicionais do PGF

| Item PGF | Situação no Core | Classe | Ação |
|---|---|---|---|
| PWA (`manifest.json`, `sw.js`) | — | **C3** | Reaproveitar no app da psicóloga |
| Painel `/`: contadores (ativos/inativos, ocupação) | BI | **C3** + **C1** | UI do PGF, números do Core |
| Simulador de dados de teste | — | **C6** | Contraria a regra "dados reais desde o início" |
| `sharing_logs` (compartilhamento) | `audit_log` | **C6** / **C1** | Auditoria fica no Core |
| Mercado Pago (preferência + webhook, 1% marketplace) | — | **C4** — **adiado** | Só com o produto SaaS/sublocação; corrigir SEC-PGF-04 antes |
| Exportação PDF/XLSX (jsPDF, xlsx) | O Core gera relatórios | **C3** | Reaproveitar componentes |
| Componentes visuais (Tailwind 4, Motion, lucide) | Core em Next 16 | **C3** | Portar componentes; o PGF está no Next 15 (ajuste de versão) |

## 4. Resumo quantitativo

| Classe | Itens | Leitura |
|---|---|---|
| C1 Já existe no Core | 17 | O Core já tem modelo e regra para quase todo dado |
| C2 Existe parcialmente — ajustar | 11 | Todos por coluna/índice/constraint/view/config; **0 tabelas novas** |
| C3 Reaproveitar do PGF (UI/fluxo) | 13 | O valor do PGF é a experiência da psicóloga |
| C4 Integrar | 6 | Painel de salas, importação de pacientes, credenciamento, Mercado Pago, sublocação |
| C5 Não existe — propor | 4 (+2 citados como adiados/fora do escopo) | Convite/ativação, tela de registro de sessão, função de disponibilidade, endereço de sala (se houver unidade 2), prontuário, membership (adiado) |
| C6 Descontinuar | 13 | Firestore, regras, auto-cadastro, mocks de guia/RPA/planos, simulador, materialização de slots |

(50 linhas mapeadas; uma linha pode ter duas classes, UI × dado.)

## 5. Gates encontrados (PARAR e pedir decisão ao CX)

| Gate | Por quê | Bloqueia |
|---|---|---|
| G1 RLS por profissional | Altera autenticação/RLS | Qualquer tela da psicóloga com dados reais |
| G2 Índice/constraint de agenda e sessões | Altera estrutura em uso pelo motor? (`sessions` está vazia; o motor lê o legado) [EI] | Registro de sessão no Core |
| G3 Correção do DATA-01 no Sync | ORDEM-005 suspensa pela nova direção | Toda tela que mostre horário a partir do espelho |
| G4 Importação de pacientes (PII) | Afeta pacientes | Ficha de paciente com dado real |
| G5 Provedor Google no Supabase Auth | Altera autenticação | Login Google |

## 6. Primeiro bloco recomendado (não executado)

**BLOCO 1 — "Somente leitura, sem risco": base da interface da psicóloga.**

1. Popular `rooms` (5 salas) e `professional_profiles` (24 planilhas: 17 ativas + 7 desligadas, com status preservado) a partir de `legado.salas_meta` e `legado.planilhas`, por RPC idempotente com rollback (apagar o que foi inserido por `created_at`/marcador de origem).
   - Sem PII nova, porque o nome abreviado já está no Core.
   - **Mesmo assim é escrita em produção: exige validação do CX.**
2. Criar `vw_room_blocks` (ENTREGA-004 §4.2). É leitura e não depende do DATA-01, porque o painel já está correto.
3. Nenhuma tela publicada; testes SQL antes/depois (contagens e 94 ilhas).

Em seguida (blocos 2+): G3 → `vw_agenda_normalizada` → G1 (RLS) → convite/login → primeira tela do PGF (agenda da psicóloga, só leitura) em `apps/psi` ou repositório separado (decisão de repositório pendente, ENTREGA-001).

## 7. Pendências de Jorge (inalteradas; não bloqueiam o mapa)

1. Duração 50 × 60 min.
2. Sublocação na agenda.
3. Falta × justificado.
4. Motivo de encerramento.
5. Monorepo `apps/psi` × repositório separado para a interface da psicóloga.
6. Gates de identidade/dados do PGF (ENTREGA-002).

## Testes executados

- Rotas do `apps/web` (`main`) e lista de migrations 001–032.
- Catálogo de tabelas `public` com área e título (`db_catalogo_tabelas`).
- Enums `user_role`, `appointment_status`, `billing_status`, `guide_status`.
- Contagens: `guides` 0, `insurance_plans` 9, `fin_fechamentos` 2, `professional_credentials` 0, `waitlist_entries` 0, `payout_rules` 0, `fiscal_documents` 0.

## Próxima ação

**Mapa disponível — aguardando validação do CX e definição do primeiro bloco.**
