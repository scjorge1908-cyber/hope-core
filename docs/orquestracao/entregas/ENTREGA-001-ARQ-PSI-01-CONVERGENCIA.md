# BLUEPRINT ARQ-PSI-01 — CONVERGÊNCIA HOPECORE + PSI GESTÃO FÁCIL

| Campo | Valor |
|---|---|
| Responde à | ORDEM-001 (ARQ-PSI-01), commit `51515d0` da branch `orquestracao`. Execução confirmada pelo Owner no chat em 2026-10-03 17:16 |
| Executor | Claude |
| Data | 2026-10-03 (America/Sao_Paulo) |
| Classificação da ordem | ANÁLISE / AUDITORIA / BLUEPRINT |
| Produção alterada? | **NÃO**. Nada mudou em código, banco, RLS, migration, deploy, Apps Script, planilha ou Firebase. Foram feitas só leituras: clone raso dos repositórios e `SELECT` de metadados/contagens no Supabase |
| Esta entrega autoriza implementação? | **NÃO** |
| Achados restritos | Registrados fora do repositório em **AUD-002 (RESTRITO)**, entregue ao Owner. Aqui aparecem só de forma sanitizada |

**Rótulos de evidência:**
- **[C] CONFIRMADO:** visto no código ou no banco.
- **[EI] EVIDÊNCIA INCOMPLETA.**
- **[H] HIPÓTESE.**

**Fontes lidas:**
- `hope-core` (este repositório) e o Supabase do HOPE CORE;
- o repositório privado `Gestaofacil-15-06-2026` (app "FacilGestão — Clínica Hope", último commit 15/06/2026);
- o repositório do site institucional (`Site-clinica-Hope`, último commit 28/09/2026).

---

## 0. Identificação do "Psi Gestão Fácil" (leia primeiro)

- O único código encontrado com esse nome é o repositório `Gestaofacil-15-06-2026`. O `metadata.json` diz "FacilGestão — Gestão de Demandas Clínicas" e o `manifest.json` diz "FacilGestão - Clínica Hope". [C]
- **Não está comprovado** que ele seja a versão atual do produto que o Orquestrador chama de "Psi Gestão Fácil". Pode haver versão mais nova no Google AI Studio que nunca foi enviada ao GitHub, ou outro nome (por exemplo, a decisão anterior de chamar o app da psicóloga de "PSISISTEMA"). [EI]
- Também **não está comprovado** se ele está em produção com dados reais. O código tem um "simulador" que cria clínica, salas e psicólogos de teste. [EI]
- Todo este blueprint vale para esse código. **Se houver outra versão, a ORDEM-001 precisa ser reexecutada sobre ela** (ver as dúvidas no fim).

## 1. Resumo executivo

1. **O Psi Gestão Fácil (PGF) é um protótipo de interface, não um backend.**
   - Stack: Next.js 15 + Firebase Auth (login Google) + Firestore, com toda a gravação feita **direto do navegador**. Não há camada de servidor com regra de negócio, exceto duas rotas do Mercado Pago.
   - Várias telas usam dados fictícios ou `localStorage` (registro de guias, RPA, anexar RPA). [C]
2. **O HOPE CORE já é o núcleo de dados correto:**
   - Postgres com RLS por tenant;
   - motor financeiro versionado e validado (setembro/2026 centavo a centavo);
   - espelho de 17 planilhas ativas (4.517 atendimentos, 269 linhas de agenda, 337 cancelados, 83 linhas do painel de salas).

   Porém as tabelas clínicas novas do HOPE CORE (`professional_profiles`, `patients`, `rooms`, `appointments`, `sessions`) estão **vazias (0 linhas)**. [C]
3. **A hipótese do Orquestrador se confirma em parte:**
   - **Confirmada:** o HOPE CORE deve ser o núcleo (fonte única), e o PGF serve como **camada de interface da psicóloga**.
   - **Não confirmada:** o PGF *como sistema* (Firestore, regras e modelo) não pode virar a camada operacional. O que se aproveita são **telas, fluxos e o desenho conceitual de identidade global + vínculo com clínica**, reescritos sobre o Supabase do HOPE CORE.
4. **Hoje existem até 6 representações da mesma agenda:**
   1. planilha da psicóloga;
   2. espelho `legado.agenda`;
   3. `public.appointments` (vazia);
   4. `agenda_psicologas` do PGF;
   5. `specialists.schedule` do site;
   6. painel de salas do Hope Painel.

   A convergência começa eliminando essa multiplicidade.
5. **Recomendação:** **INCORPORAR** o PGF como *front-end da profissional* sobre o backend único do HOPE CORE (um banco, duas interfaces: administrativa e profissional). Não manter dois backends. O Firestore do PGF é **descontinuado**.
6. **Caminho mais curto e seguro para retirar o primeiro Apps Script:** o **feed de disponibilidade do site**, gerado a partir do espelho de agenda que já está no Supabase (item J).
7. **Segurança:** foram encontrados problemas de autorização e de exposição de dados no PGF e no fluxo de disponibilidade do site, com até **SEC-P0 condicional** (se o PGF tiver dados reais). Detalhes em AUD-002 (RESTRITO).

## 2. Arquitetura real do Psi Gestão Fácil

```
Navegador (Next.js 15, client components)
  ├─ Firebase Auth (Google popup) ──► auth-provider: na 1ª entrada cria users/{uid}
  │                                    com role 'psychologist' (ou 'admin' para o e-mail padrão)
  ├─ Firestore SDK (leitura/escrita direto do cliente; regras = única barreira)
  │     clinicas, users, rooms, agenda_psicologas, sublocacoes, subleasing,
  │     sublease_payments, health_plans, agreements, private_sessions,
  │     registrations, sharing_logs, patients
  └─ /api/mercadopago/create-preference e /webhook (servidor; Admin SDK)
Hospedagem: AI Studio / Cloud Run (output standalone) [EI]
Projeto Firebase: o MESMO do site institucional, com banco Firestore nomeado diferente [C]
```

- **Repositório:** 1 commit visível (clone raso), 42 arquivos, cerca de 8,8 mil linhas TSX. Não há testes, CI nem migrations (Firestore não tem schema). `eslint.ignoreDuringBuilds = true`. [C]
- **Inconsistência interna:** o `firebase-blueprint.json` desenha `psychologists` (global) + `clinic_psychologists` (vínculo), mas **o código não usa** essas coleções. Os profissionais ficam em `users` com `role/status/assignedRoomId/assignedSlots`. [C]
- O `clinicId` está fixo no código (`'hope-clinica'`) em telas centrais. [C]
- Existem duas coleções para o mesmo conceito (`sublocacoes` e `subleasing`), e o webhook grava num terceiro caminho (`clinicas/{id}/sublocacoes`). [C]

## 3. Funcionalidades e maturidade

**Escala de maturidade:**
- **0** = mock/localStorage;
- **1** = protótipo com Firestore;
- **2** = funcional sem garantias;
- **3** = produção.

| Tela/rota | Função | Persistência | Maturidade | Classificação |
|---|---|---|---|---|
| `/` (painel) | Psicólogos ativos/inativos, ativação em sala + horários, ocupação, compartilhamento, simulador de dados | Firestore | 1–2 | **REUTILIZAR** (UI) / **SUBSTITUIR** (dados) |
| `/agenda-psicologas` | Grade semanal por sala/horário; status livre/ocupado/reserva/intervalo; cadastro do paciente no slot | Firestore `agenda_psicologas` (nome e telefone do paciente gravados no slot) | 1 | **REUTILIZAR** (UI) / **SUBSTITUIR** (modelo) |
| `/cadastro-salas` | Cadastro de sala com endereço, dias e gerador de horários (intervalo 30/45/60) + aluguel avulso | Firestore `rooms`, `sublocacoes` | 2 | **AJUSTAR** (vira bloco de sala) |
| `/gestao-salas` | Ocupação de salas | Firestore | 1 | **REUTILIZAR** (UI) |
| `/cadastro-psicologo` | Cadastro público PF/PJ (CEP, especialidades, abordagens, foto) | Firestore `registrations` + `users` (id aleatório, não ligado ao login) | 2 | **INTEGRAR** com o credenciamento PF/PJ |
| `/corpo-clinico` | Vitrine pública de profissionais e horários livres | Firestore | 2 | **INTEGRAR** com a agenda pública |
| `/portal-psicologo` | Área da psicóloga: agenda, sublocações, pagamentos | Firestore | 1–2 | **REUTILIZAR** (base do app da profissional) |
| `/financeiro-psicologo` | Sublocações e pagamentos da psicóloga | Firestore + Mercado Pago | 1–2 | **AJUSTAR** |
| `/sublocacao/[clinicId]` | Reserva de sala avulsa com pagamento | Firestore + Mercado Pago | 2 | **AJUSTAR / INTEGRAR** (produto SaaS) |
| `/cadastro-plano` | Planos, convênios, sublocação, sessões particulares | Firestore | 1 | **DESCONTINUAR** (o HOPE CORE tem `insurance_plans`) |
| `/registro-guias` | Guias | **Mock** | 0 | **DESCONTINUAR** (o HOPE CORE já tem) |
| `/gestao-rpa`, `/rpa-form`, `/anexar-rpa` | Pedido e anexo de RPA | **localStorage / mock** | 0 | **DESCONTINUAR** (o motor do HOPE CORE já tem). Os campos do formulário RPA servem de referência para o credenciamento |
| `/paciente/[id]` | Ficha do paciente | Estática/exemplo | 0 | **SUBSTITUIR** |
| `public/sw.js` + `manifest.json` | PWA | — | 1 | **REUTILIZAR** (conceito mobile) |
| API Mercado Pago | Preferência + webhook com taxa de 1% de marketplace | Servidor | 1 | **AJUSTAR** (valor no servidor, assinatura, caminho do registro) |

## 4. Frontend, backend e banco

| Camada | PGF | HOPE CORE |
|---|---|---|
| Frontend | Next 15, Tailwind 4, Motion, lucide, jsPDF, xlsx | Next 16, server components + server actions |
| Backend | Nenhum (regras do Firestore) + 2 rotas Mercado Pago | Server actions/rotas com `getFinanceAccess`, RPCs SQL security definer, motor SQL |
| Banco | Firestore sem schema; dados de paciente desnormalizados no slot | Postgres 17, schema versionado (migrations), FKs, RLS, criptografia de CPF/Pix |
| Integridade | Validação só no cliente (conflito de sala checado no navegador) | FKs. **Ainda sem constraint de conflito de horário** (a extensão `btree_gist` existe, mas não há `EXCLUDE`) [C] |
| Transação | `writeBatch` no cliente; a ativação apaga e recria a agenda em lotes não atômicos | Transações SQL |

## 5. Autenticação e autorização

| Item | PGF | HOPE CORE |
|---|---|---|
| Login | Google (qualquer conta Google entra) | E-mail e senha (Supabase Auth) |
| Cadastro do usuário | Automático no primeiro login, com papel padrão de profissional | Sem auto-cadastro; 1 usuário (owner) |
| Papéis | `admin`, `psychologist` (string no documento do usuário) | `users.role` + `has_finance_access()` + `is_platform_admin()` |
| Admin | E-mail fixo no código e nas regras | `platform_admins` + `role` |
| Escopo por clínica | `clinicas_vinculadas[]` no documento do usuário | `users.tenant_id` (um único tenant por usuário) |
| Avaliação | **Insuficiente.** Ver SEC-PGF-01..03 (seção 17) | Base correta, com ajustes já apontados na AUD-001 |

## 6. SaaS e multi-tenancy

- **PGF:** a intenção multi-clínica existe (`clinicId`, `clinicas_vinculadas`, taxa de marketplace de 1%), mas o `clinicId` é fixo, não há assinatura/plano e o isolamento depende de regras com falhas. Para SaaS, a maturidade é **0–1**. [C]
- **HOPE CORE:** já tem `tenants` (`is_internal`, `plan`, `billing_status`) e RLS por `current_tenant_id()` em todas as tabelas `public`. Lacunas [C]:
  - `users.id = auth.users.id` com **um único `tenant_id`**: uma pessoa não pode pertencer a duas clínicas, nem ter conta própria e vínculo com a Hope ao mesmo tempo;
  - não há tabela de vínculo (membership) com estados;
  - as tabelas `legado.*` não têm `tenant_id`.

## 7. Profissionais, pacientes e agenda

| Domínio | PGF | HOPE CORE (novo) | HOPE CORE (espelho legado) | Planilhas / Apps Script |
|---|---|---|---|---|
| Profissional | `users` (role psychologist) + `registrations` | `professional_profiles` (por tenant; CPF/RG/Pix criptografados) — 0 linhas | `legado.planilhas` (24; 17 ativas) | aba ID do Mestre RPA; DadosPsi de cada planilha; Corpo Clínico; specialists do site |
| Paciente | nome/telefone dentro do slot + `patients` (quase não usado) | `patients` (CPF criptografado + blind index) — 0 linhas | nome dentro de `legado.agenda` / `atendimentos_raw` | aba Agenda de cada psicóloga |
| Sala | `rooms` (dias + lista de horários) | `rooms` (só nome) — 0 linhas | `legado.salas_painel` (83 linhas) | Gestão de Salas / Hope Painel |
| Agenda recorrente | profissional com `assignedSlots` (dia + hora) → gera 30 dias de `agenda_psicologas` | `appointments` (`weekday`, `start_time`, `scheduled_date`, sem duração/fim) — 0 linhas | `legado.agenda` (269) | aba Agenda (linha = dia + horário + paciente) |
| Sessão realizada | inexistente | `sessions` — 0 linhas | `legado.atendimentos_raw` (4.517) | aba Atendimentos |
| Bloqueio/férias | inexistente | `professional_availability_blocks` | — | — |
| Fila de espera | inexistente | `waitlist_entries` | — | Hope Painel |

## 8. Comparação HopeCore × Psi Gestão Fácil

| DOMÍNIO | HOPECORE | PSI GESTÃO FÁCIL | DUPLICAÇÃO | MATURIDADE (HC / PGF) | SOURCE OF TRUTH PROPOSTA | AÇÃO |
|---|---|---|---|---|---|---|
| Auth | Supabase Auth (e-mail/senha) | Firebase Auth (Google) | Sim | 2 / 1 | Supabase Auth (Google como provedor opcional) | SUBSTITUIR no PGF |
| Users | `public.users` (1 tenant por usuário) | `users` (perfil + papel + vínculo + sala) | Sim | 2 / 1 | identidade global + vínculo (seção 13) | AJUSTAR (HC) / MIGRAR (PGF) |
| Tenants | `tenants` com plano e status de cobrança | `clinicas` (id fixo) | Sim | 2 / 0 | `tenants` | MANTER (HC) |
| Professionals | `professional_profiles` por tenant | `users` + `registrations` (+ `psychologists` desenhado, não usado) | Sim (×5 com legado) | 1 / 1 | `professional_profiles` ligado ao vínculo | MANTER + AJUSTAR |
| Professional_profiles | CPF/RG/Pix criptografados | campos em claro no doc | Sim | 2 / 1 | HC | MANTER |
| CPF | criptografado + blind index | texto no formulário | Sim | 2 / 0 | HC (blind index único global para ativação) | MANTER |
| Rooms | só nome | nome, endereço, dias, horários, valor de sublocação | Sim (×4 com legado/Apps Script) | 1 / 2 | HC `rooms` + `room_blocks` (novo) | AJUSTAR (HC), reaproveitar o desenho do PGF |
| Room availability | inexistente | dias + horários da sala | — | 0 / 1 | HC `room_blocks` | INTEGRAR o conceito |
| Agenda | `appointments` (vazia) | `agenda_psicologas` (slots materializados) | Sim (×6) | 1 / 1 | HC (série + ocorrências) | SUBSTITUIR o PGF |
| Recurring schedules | `weekday` + `start_time` em `appointments` | `assignedSlots` + geração de 30 dias | Sim | 1 / 1 | HC `appointment_series` (novo) | AJUSTAR |
| Appointments | `appointments` | slot com paciente embutido | Sim | 1 / 1 | HC | MANTER/AJUSTAR |
| Sessions | `sessions` + espelho legado | inexistente | Não | 2 (legado) / 0 | HC (`sessions`, alimentando o motor) | MANTER |
| Patients | `patients` (criptografado) | nome/telefone no slot | Sim | 2 / 0 | HC | MANTER |
| Documents | `document_declarations`, `fiscal_documents`, credenciais | upload/RPA mock | Sim | 2 / 0 | HC + Supabase Storage | MANTER |
| Guides | `guides` + Registro de Guias (ponte) | mock | Sim | 2 / 0 | HC (após virada do Registro de Guias) | DESCONTINUAR no PGF |
| Billing (convênios) | `insurance_plans`, TISS, demonstrativos | `health_plans`, `agreements` | Sim | 2 / 1 | HC | DESCONTINUAR no PGF |
| Payouts | motor `fin_*` versionado | RPA mock | Sim | 3 / 0 | HC motor | MANTER |
| Finance | Cora, Bradesco, DRE, conciliação | sublocação via Mercado Pago | Parcial | 2 / 1 | HC (sublocação entra como receita) | INTEGRAR o Mercado Pago depois |
| Audit | `audit_log` + `db_alteracoes` | `sharing_logs` | Parcial | 2 / 0 | HC | MANTER |
| Permissions | RLS + papéis | regras Firestore + `role` | Sim | 2 / 0 | HC (RLS por vínculo) | AJUSTAR |
| Notifications | `notifications` | inexistente | Não | 1 / 0 | HC | MANTER |
| Public availability | inexistente (site lê Apps Script) | `/corpo-clinico` lê `agenda_psicologas` livres | Sim (×3 com o site) | 0 / 1 | HC Availability Engine + API pública | SUBSTITUIR |

## 9. Duplicidades

| ID | Duplicidade | Cópias | Evid. |
|---|---|---|---|
| DUP-PSI-01 | Agenda | planilha da psicóloga, `legado.agenda`, `public.appointments`, `agenda_psicologas` (PGF), `specialists.schedule` (site), painel de salas | [C] |
| DUP-PSI-02 | Profissional | aba ID do Mestre RPA, `legado.planilhas`, `professional_profiles`, `users` do PGF, `registrations` do PGF, `specialists` do site, Corpo Clínico | [C] |
| DUP-PSI-03 | Sala | `rooms` (HC), `rooms` (PGF), `legado.salas_painel`, Gestão de Salas, salas do site/sublocação (Apps Script de slots) | [C] |
| DUP-PSI-04 | Paciente | `patients` (HC), nome no slot (PGF), nome em `legado.agenda` e `atendimentos_raw`, aba Agenda | [C] |
| DUP-PSI-05 | Planos de saúde | `insurance_plans` (HC), `health_plans` e `agreements` (PGF), planos no site | [C] |
| DUP-PSI-06 | Sublocação | PGF (`sublocacoes` e `subleasing`), site (módulo sublocação + Mercado Pago), repositórios SublocaHope | [C] |
| DUP-PSI-07 | Identidade | Firebase Auth (PGF e site, mesmo projeto) × Supabase Auth (HC) | [C] |
| DUP-PSI-08 | Dentro do PGF | `users` criado no cadastro (id aleatório) × `users/{uid}` criado no login, sem ligação entre eles | [C] |

## 10. Source of Truth por domínio

| Domínio | Fonte da verdade (destino) | Hoje (transição) |
|---|---|---|
| Identidade/usuário | Supabase Auth (`auth.users`) + perfil global (novo) | Supabase Auth (só owner) |
| Tenant | `public.tenants` | `public.tenants` |
| Profissional (pessoa) | perfil global da pessoa (novo), com CPF criptografado e blind index único | `legado.planilhas` + aba ID do RPA |
| Vínculo profissional–clínica | `tenant_memberships` (novo) | `legado.planilhas.ativo/desligada` |
| Perfil profissional na clínica | `professional_profiles` (por tenant, ligado ao vínculo) | aba DadosPsi + ID do RPA |
| Paciente | `public.patients` (por tenant) | aba Agenda (via `legado.agenda`) |
| Sala | `public.rooms` | Gestão de Salas → `legado.salas_painel` |
| Bloco de sala | `room_blocks` (novo) | painel de salas |
| Agenda / recorrência | `appointment_series` + exceções (novo) | aba Agenda de cada psicóloga |
| Appointment (ocorrência) | `public.appointments` | aba Agenda |
| Session | `public.sessions` | aba Atendimentos → `legado.atendimentos_raw` |
| Guia | `public.guides` | planilha Registro de Guias (BD_GUIAS), gravação dupla via ponte |
| Faturamento | HC (TISS, demonstrativos, `insurance_plans`) | HC + Painel de Faturamento |
| Repasse | motor `fin_*` + fotos de fechamento | RPA legado (até `FIN_MOTOR=central`) |
| Financeiro | HC (Cora, Bradesco, DRE) | HC |
| Disponibilidade pública | Availability Engine do HC (calculado, nunca digitado) | Apps Script de cada psicóloga, CSV e `specialists.schedule` do site |

**Regra:** cada domínio tem **um** dono de escrita. Planilha, Firestore e cache do site passam a ser **cópias geradas**, nunca editadas como fonte.

## 11. Arquitetura de convergência

```
                    ┌──────────────── HOPE CORE (Supabase · fonte única) ────────────────┐
                    │ Auth · tenants · memberships · professional_profiles · patients     │
                    │ rooms · room_blocks · assignments · series · appointments · sessions│
                    │ guides · motor fin_* · banco · audit · Availability Engine (SQL)    │
                    │ API: RPCs com RLS por vínculo + rotas servidor (Next) + API pública │
                    └──────▲──────────────────▲───────────────────────▲──────────────────┘
                           │                  │                       │ só leitura, sem PII
             HOPE WEB (admin/gestão)   App da Profissional       Site Clínica Hope
             apps/web (atual)          (telas do PGF reescritas   (consome disponibilidade)
                                       para Supabase; PWA → mobile)
     Transição: planilhas ⇄ (SyncSupabase / gravação dupla por psicóloga, com flag) ⇄ HOPE CORE
```

**Decisões estruturais propostas** (todas dependem de ordem/DEC):
1. **Um backend.** O PGF perde o Firestore e passa a usar o Supabase do HOPE CORE.
2. **Duas interfaces:**
   - administrativa: o HOPE WEB atual;
   - da profissional: o PGF reescrito como `apps/psi` no mesmo monorepo **ou** em repositório separado consumindo o mesmo backend. A escolha é decisão do Owner, e **não se juntam repositórios nesta ordem**.
3. **Escritas críticas** (agendar, remarcar, encerrar série, registrar sessão) passam por **RPC transacional**, nunca por gravação solta do cliente.
4. **A disponibilidade pública é calculada** a partir das tabelas e exposta por uma API pública mínima, sem dado pessoal.

## 12. Salas, blocos e slots

**Modelo proposto** (conceitual; nenhuma migration nesta ordem):

| Entidade | Campos principais | Observação |
|---|---|---|
| `rooms` | tenant, nome, endereço/unidade, ativa | Já existe (expandir) |
| `room_blocks` | room, dia da semana (ou data), início, fim, vigência de/até | **Sem horário fixo no código.** Os períodos 07–13 / 13–18 / 18–fim viram dados |
| `professional_room_assignments` | block, profissional (vínculo), vigência, status | Quem ocupa o bloco |
| `professional_schedules` | assignment, duração do slot (padrão do tenant = 50 min), intervalo | Duração configurável e canônica por tenant |
| Slot | **Calculado**, não gravado | Dentro do bloco, sem ultrapassar o fim |
| `appointment_series` | paciente, profissional, sala, dia, hora, início, fim/encerramento + motivo | Recorrência semanal (padrão Hope) |
| `appointments` | série (opcional), data/hora início–fim, status | Ocorrência concreta |
| Exceções | falta, cancelamento pontual, reagendamento, bloqueio, férias | Ver seção 14 |
| `sessions` | appointment, data, tipo, plano, valor, status de faturamento | Alimenta o motor financeiro |

**Conflitos a validar no banco**, não no navegador:

| Conflito | Mecanismo proposto |
|---|---|
| Duas profissionais no mesmo bloco/horário da sala | `EXCLUDE USING gist (room_id WITH =, periodo WITH &&)` sobre as atribuições vigentes (o `btree_gist` já existe) |
| Profissional em dois lugares ao mesmo tempo | `EXCLUDE (professional_id WITH =, periodo WITH &&)` nas ocorrências |
| Atendimento fora do bloco | Checagem na RPC de agendamento + trigger |
| Slot ultrapassando o fim do bloco | Cálculo de slots só gera os que cabem; trigger rejeita |
| Sobreposição de pacientes | `EXCLUDE` por profissional/sala nas ocorrências ativas |
| Alteração de bloco com pacientes | Bloquear se existirem séries ativas afetadas; exigir realocação explícita (lista de afetados + confirmação) |

**Dado de produção relevante:** hoje o PGF só checa conflito no cliente, e o HOPE CORE não tem nenhuma constraint de conflito. [C]

## 13. Identidade, CPF e vínculos

```
auth.users (identidade global: login)
  └─ perfil global da pessoa (nome, CPF criptografado + blind index ÚNICO global, contato)
       └─ tenant_memberships (pessoa × tenant: papel, status, desde/até, motivo)
            ├─ professional_profiles (dados da profissional NAQUELE tenant: CRP, sala, regras de repasse)
            └─ permissões (papel do vínculo → RLS)
  └─ product_access / assinatura (conta da pessoa ou do tenant: plano, patrocinador, validade)
```

- **Estados do vínculo:** `PENDENTE → ATIVA ↔ SUSPENSA → ENCERRADA`.
  - Só `ATIVA` dá acesso ao tenant.
  - `ENCERRADA` é definitivo, com data e motivo, e **não apaga** o histórico.
- **CPF:**
  - serve para casar a pessoa com o cadastro existente e participar da ativação (ex.: convite + CPF + login próprio);
  - **nunca é senha** e nunca sozinho concede acesso;
  - fica criptografado e com busca só pelo blind index, como já é feito no HOPE CORE.
- **Mudança necessária no HOPE CORE:** hoje `users` amarra uma pessoa a um único tenant. Será preciso separar identidade (global) e vínculo (por tenant). Exige migration futura e revisão de RLS (`current_tenant_id()` passa a vir do vínculo ativo escolhido).
- **Profissional que sai da Hope:**
  - o vínculo vira ENCERRADA e ela perde o acesso ao tenant Hope na hora (a RLS se baseia no vínculo ativo);
  - o histórico da Hope (sessões, repasses, fotos de fechamento) permanece no tenant Hope;
  - a identidade global e a conta dela continuam;
  - ela pode assinar o produto como cliente independente (tenant individual).
- **Questão legal em aberto [H]:** a guarda do prontuário (resolução do CFP) e a titularidade dos dados de pacientes atendidos dentro da Hope precisam de parecer jurídico **antes** de definir o que a profissional leva ao sair. Por padrão, nada do tenant Hope é copiado.

## 14. Agenda pública e site

**Fluxo atual** [C no código do site; EI no Apps Script da psicóloga, que não está em repositório]:
1. Cada profissional no Firestore do site guarda o endereço do web app Apps Script **da planilha dela** (Sistema Unificado PSI) e/ou o ID da planilha.
2. O **navegador do visitante** chama esse web app por JSONP (`action=getDadosDaAgenda`). Se falhar, baixa a aba Agenda em CSV pela exportação do Google Sheets.
3. Uma linha é "vaga" quando o status/paciente contém 💚 ou "livre". O turno sai da hora: 7–13 manhã, 13–18 tarde, 18+ noite (fixo no código do site).
4. O resultado é gravado em `specialists.schedule` e fica em cache por 2 h. A **gravação parte do navegador do visitante** (lazy sync), e o admin também pode forçar.
5. A vaga **aparece** quando a célula da agenda é marcada como livre/💚 e **desaparece** quando um paciente é escrito na linha, só após a próxima sincronização (até 2 h).
6. Sublocação: o site consulta outro Apps Script por um proxy de servidor (`getSlots` por sala e data).

**Problemas:**
- a disponibilidade depende de formatação manual (💚);
- não distingue falta, cancelamento pontual ou alta;
- expõe endpoints e dados (SEC-SITE-01/02, sanitizados na seção 17);
- não há trava de reserva (o site só leva ao WhatsApp/Telegram).

**Destino:**

```
SOURCE OF TRUTH (séries + exceções + blocos)
  → AVAILABILITY ENGINE (função SQL: slots do bloco − ocupados − exceções estruturais)
  → API PÚBLICA CONTROLADA (RPC/rota só leitura: profissional_publico_id, dia, hora, turno — sem nome de paciente)
  → SITE (busca no servidor, cache curto; sem escrita do visitante)
```

**Distinção obrigatória** (só o que é estrutural libera vaga pública permanente):

| Evento | Libera a vaga recorrente? |
|---|---|
| Falta | Não |
| Cancelamento pontual | Não (no máximo vaga avulsa naquela data, se o Owner quiser) |
| Reagendamento | Não (move a ocorrência) |
| Bloqueio | Não (tira do ar no período) |
| Férias | Não (tira do ar no período) |
| Alta | **Sim** (encerra a série) |
| Troca definitiva de horário | **Sim** no antigo / ocupa o novo |
| Encerramento de recorrência | **Sim** |

**Double booking:** garantido pelas constraints `EXCLUDE` (seção 12) dentro da transação da RPC de agendamento, e não pela interface.

## 15. Estratégia mobile futura (sem escolher tecnologia)

- **O que dá para aproveitar do PGF:**
  - as telas pensadas para o celular da psicóloga (portal, agenda semanal, financeiro, sublocação);
  - o manifesto e o service worker PWA;
  - os padrões de UI.

  A camada de dados não é reaproveitável (Firestore).
- **Condicionantes antes de qualquer app nativo:**
  1. API estável e versionada (RPCs) para as escritas críticas;
  2. auth Supabase com vínculo/tenant;
  3. RLS por vínculo testada;
  4. política offline definida (o que pode ser feito sem rede: apenas consulta, ou fila de registros);
  5. push de notificações;
  6. Storage para anexos (substituir o Drive).
- **Ordem natural:** PWA do app da profissional → avaliar empacotamento nativo depois de a API estar estável.

## 16. Eliminação gradual de Apps Script, Sheets e Drive

| Dependência | Quem usa | Função | Substituto | Pré-requisito para desligar | Validação | Rollback |
|---|---|---|---|---|---|---|
| Feed de disponibilidade do site (JSONP/CSV da planilha) | Visitantes do site | Mostrar vagas | Availability Engine + API pública | Espelho `legado.agenda` estável; regra 💚/livre replicada | Comparar vagas site atual × API por 2 semanas | Flag no site volta ao modo atual |
| Sistema Unificado PSI (uma por psicóloga) | Psicólogas | Agenda, registro de sessão, alta, anexos, valor a receber | App da Profissional (telas PGF) sobre HOPE CORE | Séries/appointments/sessions no HC; gravação dupla por psicóloga | Piloto com 1 psicóloga; diferencial de atendimentos × motor | Flag por psicóloga (`fonte_agenda = planilha`) |
| Planilha da psicóloga (Agenda/Atendimentos) | RPA, BI, site, Painel | Fonte de agenda e atendimentos | Tabelas HC | Item acima + SyncSupabase invertido (HC → planilha só leitura) | Motor fecha o mês igual pelas duas fontes | Reativar a planilha como fonte (sync normal) |
| Hope Painel (agenda, salas, fila) | Administração | Gestão de salas, fila de espera | HOPE WEB (rooms/blocks/waitlist) | Modelo de salas da seção 12 | Ocupação igual ao painel | Manter o painel em paralelo |
| Registro de Guias (BD_GUIAS) | ADM, apps das psicólogas | Guias e status | `public.guides` (já com gravação dupla) | Apps das psicólogas lendo do HC | Contagem de guias por status igual | Ponte volta a gravar na planilha primeiro |
| Mestre RPA | Financeiro | Repasse e PDF | Motor `fin_*` + PDF do HC | Validação de setembro + `FIN_MOTOR=central` | Fechamentos idênticos | Remover a flag |
| SyncSupabase.gs | Sistema | Espelho de hora em hora | Deixa de existir quando as planilhas deixam de ser fonte | Todas as psicólogas migradas | Nenhuma escrita nova em planilha | Reativar o gatilho |
| Painel de Faturamento | Financeiro | Relatórios | Telas HC | — | Totais iguais | Manter em paralelo |
| Corpo Clínico / Credenciamento (Apps Script) | ADM | Cadastro e documentos | Credenciamento HC + `professional_credentials` | Identidade/vínculo (seção 13) | Cadastro completo de 1 profissional | Manter o Apps Script |
| Drive (anexos de guia, atestados, NF/RPA, PDF RPA) | Psicólogas, ADM | Armazenar arquivos | Supabase Storage (privado, URL assinada) | Bucket + RLS + migração de links (`legacy_drive_url` já existe) | Amostragem de arquivos abertos pelo HC | Links antigos continuam válidos |
| Apps Script de slots da sublocação (site) | Site | Horários de sala avulsa | Engine (room_blocks livres) | Modelo de salas | Mesmos horários | Proxy antigo |

## 17. Riscos

**Segurança** (sanitizado; detalhes exploráveis só em AUD-002 RESTRITO):

| ID | Prior. | Área | Descrição sanitizada | Evid. |
|---|---|---|---|---|
| SEC-PGF-01 | **SEC-P0 se o PGF tiver dados reais**; senão SEC-P2 | PGF / autorização | As regras do banco do PGF permitem que um usuário comum obtenha privilégios administrativos | [C] código / [EI] uso real |
| SEC-PGF-02 | SEC-P0 condicional | PGF / dados pessoais | Dados de pacientes ficam em coleção com leitura ampla demais e escrita por qualquer usuário logado | [C] / [EI] |
| SEC-PGF-03 | SEC-P1 | PGF / dados pessoais | Cadastros e perfis de profissionais legíveis por qualquer usuário logado; cadastro público sem limite | [C] |
| SEC-PGF-04 | SEC-P1 | PGF / pagamentos | O valor de pagamento é aceito do cliente; o webhook não confere a origem e grava em caminho errado | [C] |
| SEC-PGF-05 | SEC-P2 | PGF / plataforma | Mesmo projeto Firebase do site público (raio de impacto compartilhado); qualquer conta Google vira usuário | [C] |
| SEC-SITE-01 | SEC-P2 | Site / integridade | A disponibilidade exibida pode ser alterada sem autenticação | [C] |
| SEC-SITE-02 | SEC-P1 | Site / exposição | O fluxo de disponibilidade expõe publicamente endpoints das planilhas das psicólogas e pode trafegar dados de pacientes até o navegador | [C] site / [EI] Apps Script |
| SEC-PSI-01 | SEC-P1 | Repositórios | `hope-core` e o site são públicos; o desenho de banco e as regras ficam visíveis | [C] |

**Arquitetura e operação:**

| ID | Prior. | Risco |
|---|---|---|
| ARQ-PSI-R1 | P1 | Seguir construindo no Firestore cria uma 7ª cópia da agenda |
| ARQ-PSI-R2 | P1 | A ativação de profissional no PGF apaga a agenda anterior inteira da profissional (perda de dados em uso real) [C] |
| ARQ-PSI-R3 | P1 | O modelo `users` 1 tenant do HC impede o cenário parceira + cliente independente sem migration |
| ARQ-PSI-R4 | P1 | Sem constraint de conflito no HC: o primeiro agendamento real já nasce sem proteção de double booking |
| ARQ-PSI-R5 | P2 | Recorrência mal modelada (cancelamento pontual liberando vaga permanente) gera overbooking no site |
| ARQ-PSI-R6 | P2 | Questão legal da guarda de prontuário ao encerrar vínculo |
| ARQ-PSI-R7 | P2 | Divergência entre a planilha e o HC durante a gravação dupla (mesmos riscos de sync R1–R14 da AUD-001) |

## 18. Testes (para as fases futuras)

1. **Isolamento de tenant:** suíte SQL/pgTAP com usuários de vínculos diferentes (ATIVA, SUSPENSA, ENCERRADA) tentando ler e escrever entre tenants. Precisa estar 100% verde antes de qualquer segundo tenant.
2. **Conflitos:** testes das constraints `EXCLUDE` (sala, profissional, fora do bloco, ultrapassa o fim, alteração de bloco com pacientes).
3. **Availability Engine:** diferencial contra o site atual (mesmas vagas) e contra `legado.agenda`, no padrão do teste diferencial do motor financeiro.
4. **Recorrência:** os 8 eventos da seção 14 com o resultado esperado na vaga pública.
5. **Gravação dupla:** contagens e somas planilha × HC por psicóloga e por mês; motor fechando igual pelas duas fontes.
6. **Segurança:** testes de IDOR/BOLA nas RPCs (trocar ids de paciente, sessão ou profissional) e checagem de que a API pública nunca devolve PII.
7. **E2E:** fluxo da psicóloga piloto (agendar → realizar → registrar → aparecer no repasse).

## 19. Migração (ordem proposta)

1. Importar o cadastro mestre a partir do que já está no Supabase: `legado.planilhas` → perfis globais + vínculos + `professional_profiles`; `legado.salas_painel` → `rooms` + `room_blocks`. Só inserção, reconciliação lado a lado, nada é apagado.
2. Gerar `appointment_series` a partir de `legado.agenda` em **modo sombra** (só leitura para relatórios e engine).
3. Ligar a API pública e virar o site (primeira retirada).
4. Piloto do App da Profissional com 1 psicóloga, com gravação dupla (padrão já usado no Registro de Guias).
5. Virar a fonte da verdade por psicóloga (flag). A planilha vira cópia gerada.
6. Guias e anexos (Drive → Storage).
7. Identidade multi-tenant + assinatura (SaaS).

**Dados do Firestore do PGF:** só migrar se o Owner confirmar que há dados reais lá. Caso contrário, descartar após o export de segurança.

## 20. Rollback

- Toda migration futura é **aditiva** (novas tabelas e colunas; nada removido) até a virada de cada domínio.
- Flags por domínio e por psicóloga: `fonte_agenda = planilha | core`, `site_disponibilidade = legado | core`, `FIN_MOTOR`.
- A planilha só deixa de ser fonte depois de 1 mês fechado igual pelas duas fontes. Até lá, o rollback é desligar a flag.
- O site mantém o caminho antigo atrás da flag até a validação de 2 semanas.
- O Firestore do PGF fica intocado (só leitura) até a decisão de descarte.

## 21. Roadmap por fases (cada fase exige ORDEM própria)

| Fase | Nome | Entregas | Depende de |
|---|---|---|---|
| PSI-F0 | Decisões | DECs: identificação do PGF, fonte da verdade (seção 10), estratégia de repositório, repositórios privados, parecer sobre prontuário | Owner |
| PSI-F1 | Segurança mínima | Correções AUD-001 SEC-P0/P1 + contenção SEC-PGF / SEC-SITE | `APROVAR FASE DE CORREÇÃO` |
| PSI-F2 | Identidade e vínculos | Perfil global, `tenant_memberships`, RLS por vínculo, testes de isolamento | F1 |
| PSI-F3 | Cadastro mestre | Profissionais e salas importados do espelho; blocos de sala | F2 |
| PSI-F4 | Agenda núcleo (sombra) | Séries, ocorrências, exceções, constraints, Availability Engine sobre o espelho | F3 |
| PSI-F5 | Site | API pública + virada do site (1º Apps Script retirado) | F4 |
| PSI-F6 | App da Profissional (piloto) | Telas do PGF sobre Supabase, 1 psicóloga, gravação dupla | F4 |
| PSI-F7 | Virada por psicóloga | Planilha vira cópia; motor lê `sessions` | F6 + 1 mês validado |
| PSI-F8 | Guias + Storage | BD_GUIAS e Drive aposentados | F7 |
| PSI-F9 | SaaS | Tenant individual, plano parceira (benefício), assinatura, onboarding de clínica | F2 + F7 |
| PSI-F10 | Mobile | Empacotamento do app da profissional | F6 estável |

---

## Respostas expressas

**A. O que aproveitar do Psi Gestão Fácil?**
- **Aproveitar:**
  - as telas e fluxos: portal da psicóloga, grade semanal, gerador de horários de sala, ativação em sala, cadastro PF/PJ com CEP, vitrine do corpo clínico, sublocação com pagamento;
  - o PWA;
  - o conceito de pessoa global + vínculo com clínica, presente no blueprint dele;
  - a ideia de marketplace (taxa de sublocação) como receita SaaS.
- **Não aproveitar:** o Firestore, as regras, o modelo de dados implementado e as telas mock de guias e RPA.

**B. O que deve permanecer central no HOPE CORE?**
Tudo o que é dado e regra:
- identidade, tenants e vínculos;
- profissionais, pacientes, salas e agenda;
- sessões, guias, faturamento, motor de repasse, financeiro e bancos;
- auditoria e o Availability Engine.

As interfaces são clientes desse núcleo.

**C. O que está duplicado?**
Agenda (6 cópias), profissional (7), sala (5), paciente (4), planos, sublocação, identidade/auth e cadastro interno do PGF (seção 9).

**D. Qual a fonte da verdade de cada domínio?**
É o HOPE CORE (Supabase) em todos, conforme a tabela da seção 10. As planilhas são fonte só na transição, sob flag.

**E. Integrar, incorporar ou manter projetos separados?**
**Incorporar** o PGF como interface da profissional sobre o backend único. Não manter dois backends, nem integrar Firestore com Supabase por sincronização, o que criaria mais uma cópia. Manter o código em monorepo (`apps/psi`) ou em repositório separado é decisão do Owner; os dois funcionam com backend único.

**F. Como a Hope vira o primeiro tenant?**
Ela **já é** o tenant interno (`tenants.is_internal`). Falta popular o tenant a partir do espelho (F3), modelar a agenda (F4) e virar as fontes por psicóloga (F7). A Hope é o ambiente de validação de cada fase antes de qualquer outro cliente.

**G. Como a parceira da Hope recebe a ferramenta como benefício?**
1. A Hope convida a profissional.
2. O vínculo é criado como PENDENTE e ela ativa com convite + CPF + login próprio.
3. O vínculo passa a ATIVA.
4. O acesso ao produto é concedido com plano "benefício parceria", **patrocinado pelo tenant Hope** e válido enquanto o vínculo estiver ATIVO.

Ela usa o App da Profissional dentro do tenant Hope, sem cobrança.

**H. Como a ex-parceira pode continuar como cliente SaaS sem acesso à Hope?**
1. O vínculo Hope vira ENCERRADA e o acesso ao tenant Hope é cortado na hora pela RLS.
2. O benefício patrocinado acaba.
3. A identidade global continua, e ela pode assinar um plano individual.
4. Com isso é criado um tenant individual dela, que começa vazio.

O histórico da Hope fica na Hope. Se pacientes migrarem com ela, isso só acontece por processo formal, com consentimento e parecer jurídico (item [H] da seção 13).

**I. Como outras clínicas entram futuramente?**
1. A clínica é criada como novo tenant (`is_internal = false`), com plano e cobrança.
2. Há onboarding das salas, blocos e duração de slot do tenant.
3. A clínica convida as profissionais por vínculo. Uma pessoa pode ter vínculos com várias clínicas e uma conta individual.

**Pré-requisitos:** isolamento testado (F2), repositórios privados e pendências SEC-P0/P1 fechadas.

**J. Qual o caminho mais curto e seguro para retirar a primeira planilha/Apps Script?**
- **Primeiro Apps Script: o feed de disponibilidade do site.**
  - É só leitura.
  - Os dados já estão no Supabase (`legado.agenda`, sincronizada de hora em hora, com a mesma informação de dia, horário e status que o site lê hoje. Conferido em 03/10/2026: 269 linhas de 19 planilhas, das quais 69 estão marcadas como livre/💚 [C]).
  - Elimina a dependência do site em relação aos web apps de cada psicóloga, a exportação CSV das planilhas e a escrita anônima no Firestore do site.
  - Tem rollback por flag.
  - Não muda nada no dia a dia das psicólogas.
- **Primeira planilha a deixar de ser fonte:** o **Registro de Guias (BD_GUIAS)**, porque o HOPE CORE já grava nos dois. Pré-requisito: os apps das psicólogas lerem as guias do HOPE CORE. A agenda das psicólogas vem depois, por piloto (F6–F7).

---

## Dúvidas para o Orquestrador e o Owner

1. O repositório `Gestaofacil-15-06-2026` (FacilGestão) **é** o Psi Gestão Fácil? Existe versão mais nova no AI Studio, ou o nome definitivo é "PSISISTEMA"?
2. O PGF está publicado e com **dados reais** de pacientes ou profissionais? Isso define se SEC-PGF-01/02 são SEC-P0 imediatos.
3. Monorepo (`apps/psi`) ou repositório separado para o App da Profissional?
4. Duração canônica do slot: 50 min para todos, ou por profissional/plano?
5. Vaga avulsa por cancelamento pontual deve aparecer no site, ou nunca?
6. Quem fará o parecer jurídico sobre a guarda de prontuário e os dados de pacientes ao encerrar um vínculo?
7. O código do Sistema Unificado PSI (`getDadosDaAgenda`) pode ser enviado, para confirmar SEC-SITE-02?

## Fora do escopo (sugestões, não executadas)

- Tornar privados os repositórios `hope-core` e `Site-clinica-Hope`.
- Conter imediatamente SEC-PGF-01/02 caso o PGF tenha dados reais. A ação depende de nova ordem e do Owner, pois exige mexer no Firebase.

## Próxima ação

**AGUARDAR REVISÃO DO ORQUESTRADOR CX.** Nada desta entrega deve ser implementado sem nova ORDEM classificada como IMPLEMENTAÇÃO AUTORIZADA e confirmada pelo Owner.
