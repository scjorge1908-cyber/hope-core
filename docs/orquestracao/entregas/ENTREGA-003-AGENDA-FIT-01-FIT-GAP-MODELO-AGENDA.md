# ENTREGA-003 — AGENDA-FIT-01 — Fit-gap do modelo de agenda HopeCore × dados reais

| Campo | Valor |
|---|---|
| Responde à | ORDEM-003 (commit `bd4f5dc`, status `8237680`, branch `orquestracao`) |
| Executor | Claude/Core |
| Data | 2026-10-03 (America/Sao_Paulo) |
| Classificação da ordem | ANÁLISE / AUDITORIA / MODELAGEM — somente leitura |
| Produção alterada? | **NÃO**. Apenas `SELECT`/CTE no Supabase do HOPE CORE. Nenhum INSERT/UPDATE/DELETE, DDL, RLS, migration, Apps Script ou planilha |
| Esta entrega autoriza implementação? | **NÃO** |
| PII | Nenhuma. Só contagens, formatos e nomes de estruturas |

**Rótulos:** [C] CONFIRMADO · [EI] EVIDÊNCIA INCOMPLETA · [H] HIPÓTESE

---

## 1. Resumo executivo

1. **O modelo atual do HopeCore comporta a agenda real sem tabela nova.** Depois de transformações determinísticas (normalizar nome de sala, corrigir o deslocamento de horário, de-para de plano), **192 de 198 horários com paciente (97%)** viram `appointments` recorrentes válidos. Os 6 restantes (3%) são casos de negócio ou de dado (seção 4). [C]
2. **Nenhum registro cabe "sem nenhum ajuste"**: o campo `horario` do espelho tem **deslocamento sistemático** (minutos terminando em 3; horas de 00h a 02h e de 12h a 23h, fora do expediente). O melhor alinhamento com o painel de salas é **−4h53** (92% de concordância). Esse é o achado mais importante: **é defeito do espelho/sync, não do modelo**. [C] deslocamento / [EI] causa
3. **Três lacunas reais, todas resolvíveis com ajuste em estrutura existente:**
   - `idx_sessions_unique_appointment` permite **uma única sessão por appointment**. Um horário recorrente não consegue ligar suas várias sessões. → **ajustar índice**;
   - não há **fim/duração** do atendimento (`start_time` sem fim). Isso impede detectar sobreposição e double booking de profissional. → **ajustar campo + constraint**;
   - não há como registrar **exceção por data de uma recorrência** (cancelamento ou reagendamento pontual ligado à série). → **ajustar campo** (referência ao appointment de origem em `appointments`).
4. **Salas:** o painel tem informação suficiente para derivar blocos por **view**. Não há necessidade comprovada de persistência própria nesta fase. [C]
5. **50 minutos:** é a regra dominante (17 de 19 agendas), mas **não é universal** (2 agendas usam 60 min e 1 mistura). Decisão de negócio. [C]
6. **Arquitetura mínima recomendada:** 0 tabelas novas, 1 índice ajustado, 2–3 colunas em `appointments`, 1 constraint `EXCLUDE`, 2 views. Tudo dependente de ORDEM de implementação.

## 2. Mapa do legado

| Fonte | Linhas | Conteúdo | Observação |
|---|---|---|---|
| `legado.agenda` | 269 (19 planilhas) | Grade **recorrente semanal** de cada psicóloga: dia, horário, tipo, paciente, plano, valor, sala, nascimento, cidade, bairro, início | `tipo`: PACIENTE 198 · LIVRE 69 · BLOQUEADO 2 |
| `legado.cancelados` | 337 (21 planilhas) | Recorrências **encerradas**: data de cancelamento + mesmos campos da agenda | **Sem motivo** (alta × desistência × transferência) |
| `legado.atendimentos_raw` | 4.517 | Sessões **realizadas/faltas** (JSON por linha): paciente, data, tipo, guia, plano, valor | **Sem horário** da sessão; cabeçalho varia entre 10 versões |
| `legado.salas_painel` (+ `salas_meta`) | 83 linhas × 5 consultórios | Grade **hora a hora** (07h–21h; sábado 8 horas) × dia (seg–sáb) | Células: psicóloga ou "livre" |
| `public.rooms`, `appointments`, `sessions`, `professional_availability_blocks`, `patients`, `professional_profiles` | **0** | Modelo novo vazio | — |

**Como cada conceito aparece no legado:**

| Conceito | Representação real | Evid. |
|---|---|---|
| Paciente | Texto livre na linha da agenda (+ nascimento, cidade, bairro). Sem CPF na agenda. 195 nomes distintos; nenhum paciente em duas agendas | [C] |
| Profissional | A **planilha** é a profissional (`spreadsheet_id` → `legado.planilhas`) | [C] |
| Sala | Texto: 5 consultórios + "Online". 33 linhas diferem só em maiúsculas/espaços | [C] |
| Dia / horário | `dia` em português (100% válido); `horario` HH:MM (100% parseável, **100% deslocado**) | [C] |
| Recorrência semanal | **Implícita**: cada linha da agenda é um horário fixo semanal. `inicio` informado em 182/198 | [C] |
| Plano | Texto curto (`unimed` 163, `bradesco` 18, `select` 6, `particular` 3, `sublocação` 3, outros 4) | [C] |
| Alta / encerramento | A linha sai da agenda e vai para `cancelados` com data. Sem motivo | [C] |
| Transferência | **Implícita**: 42 encerramentos têm o mesmo paciente ativo na agenda de **outra** psicóloga | [EI] (casamento por nome) |
| Falta | `atendimentos_raw`: "falta" 70, "sem comparecimento (justificado)" 93, "sessão realizada" 4.337 | [C] |
| Cancelamento / reagendamento pontual | **Não existe registro.** A planilha só tem o horário fixo e o que aconteceu (sessão/falta) | [C] |
| Bloqueio | `tipo = BLOQUEADO` (2 horários) | [C] |
| Duração | Não registrada. Inferida pela cadência entre horários consecutivos (seção 6) | [C] |

**Inconsistências relevantes:**

| ID | Inconsistência | Volume |
|---|---|---|
| DATA-01 | `agenda.horario` deslocado por valor fixo (≈ +4h53) | 269/269 |
| DATA-02 | `cancelados`: data de cancelamento anterior à de início | 41/337 |
| DATA-03 | `cancelados`: cancelamento nulo / início nulo | 24 / 83 |
| DATA-04 | `atendimentos_raw`: data malformada ("undefined/…") / vazia | 189 / 6 |
| DATA-05 | `atendimentos_raw`: data anterior a 2020 (época zero) / futura | 91 / 19 |
| DATA-06 | `atendimentos_raw`: mesmo paciente 2+ vezes na mesma data e planilha | 214 grupos |
| DATA-07 | Mesma psicóloga com 2 linhas no mesmo dia/horário | 3 grupos (1 com dois pacientes) |
| DATA-08 | Cabeçalho da aba Atendimentos com 10 variações (colunas renomeadas ou deslocadas) | 24 planilhas |

## 3. Matriz fit-gap

| Conceito real | Estrutura HopeCore | Fit | Observação |
|---|---|---|---|
| Sala física | `rooms` (`name`) | **CABE DIRETAMENTE** | 5 salas após normalização |
| Atendimento online | `appointments.room_id` nulo | **CABE DIRETAMENTE** | 3 linhas |
| Profissional | `professional_profiles` | **CABE COM AJUSTE** (dado) | Criar perfis a partir de `legado.planilhas` (19 de 19 mapeáveis) |
| Paciente | `patients` (`full_name` obrigatório, CPF opcional) | **CABE DIRETAMENTE** | Nome, nascimento, cidade e bairro já existem |
| Horário fixo semanal | `appointments` (`weekday`, `start_time`, `scheduled_date` nulo) | **CABE COM AJUSTE** | Corrigir DATA-01 antes |
| Início da recorrência | — (`created_at` não serve) | **CABE COM AJUSTE** | Falta campo de data de início (`inicio` existe em 92%) |
| Plano | `insurance_plan_id` (9 planos) | **CABE COM AJUSTE** | De-para texto → plano (7 de 8 rótulos casam); particular → nulo |
| Sublocação | — | **INDETERMINADO** | Não é atendimento da clínica: decisão de negócio |
| Alta | `appointment_status = discharged` | **CABE COM AJUSTE** | Falta data/motivo de encerramento |
| Transferência | `appointment_status = transferred` | **CABE COM AJUSTE** | Mesmo ajuste; o legado não diz o motivo |
| Cancelamento definitivo | `status = cancelled` | **CABE COM AJUSTE** | Idem |
| Falta / sem comparecimento | `sessions.billing_status = missed` | **CABE COM AJUSTE** | Mistura presença com faturamento; "justificado" não tem valor próprio |
| Sessão realizada | `sessions` | **CABE COM AJUSTE** | Bloqueada pelo índice único por appointment (seção 5) |
| Cancelamento/reagendamento pontual | `appointments` com `scheduled_date` | **NÃO CABE** como exceção da série | Sem ligação com a recorrência de origem |
| Bloqueio de horário | `appointments.admin_block` / `professional_availability_blocks` | **CABE DIRETAMENTE** | 2 linhas |
| Férias/bloqueio por período | `professional_availability_blocks` | **CABE DIRETAMENTE** | Sem uso no legado |
| Duração / fim | — | **NÃO CABE** | Sem fim nem duração |
| Bloco de sala (turno) | — | **CABE COM AJUSTE** via view | Derivável do painel |
| Horário livre (vitrine) | Ausência de appointment | **CABE COM AJUSTE** | O LIVRE da planilha vira cálculo, sem registro |

## 4. Números da simulação (sem escrita)

Simulação por CTE sobre `legado.agenda` → `appointments` recorrentes (`scheduled_date` nulo, `status = scheduled`).

| Métrica | Valor |
|---|---|
| Linhas analisadas | 269 (198 PACIENTE, 69 LIVRE, 2 BLOQUEADO) |
| LIVRE (não viram appointment; viram disponibilidade calculada) | 69 |
| BLOQUEADO → `admin_block` | 2 |
| PACIENTE que cabem **sem nenhum ajuste** | **0 (0%)**, por causa do DATA-01 |
| PACIENTE que cabem **com ajuste determinístico** (deslocamento + normalização de sala + de-para de plano + perfil a partir da planilha) | **192 (97%)** |
| PACIENTE ambíguos/inválidos | **6 (3%)**: 3 sublocação, 1 sem plano, 2 em conflito de mesma sala/dia/horário |
| Sem data de início | 16 (8%): cabem, mas sem início conhecido |
| `room_id` resolvido | 195 em sala física + 3 online (100%) |
| `insurance_plan_id` resolvido | 191 por de-para; 3 particular → nulo; 1 sem plano; 3 sublocação |
| **Conflitos que o modelo atual detectaria** (`idx_appt_unique_recurring`: mesma sala, dia e início) | **1 par** (DATA-07) |
| **Sobreposições que escapariam** (mesma sala, inícios diferentes, intervalos sobrepostos) | **0 hoje**. O modelo **não detectaria** nenhuma, porque não tem fim |
| Profissional em duas salas ao mesmo tempo | **0 hoje**. **Nenhuma constraint** impede |
| Recorrente × datado na mesma sala/horário | Não detectável: os dois índices únicos são separados |

`atendimentos_raw` → `sessions`:

| Métrica | Valor |
|---|---|
| Linhas | 4.517 |
| Data utilizável | 4.211 (93%) = 4.321 em formato de data − 91 pré-2020 − 19 futuras |
| Inválidas | 306 (7%): 189 malformadas, 6 vazias, 91 época zero, 19 futuras, 1 outro formato |
| Tipo → `billing_status` | realizada 4.337 → `not_billed`/…; falta 70 + justificado 93 → `missed` (perde a distinção) |
| Ligáveis a um appointment recorrente com o índice atual | **Só 1 sessão por appointment.** As demais ficariam com `appointment_id` nulo |
| Horário da sessão | **Inexistente** no legado; só a data |

## 5. Recorrência

| Cenário | Situação no modelo atual | Lacuna | Recomendação |
|---|---|---|---|
| Appointment recorrente → várias sessions | **Bloqueado** por `idx_sessions_unique_appointment (appointment_id)` | Real (o índice impede o caso principal) | **Ajustar índice:** único em `(appointment_id, session_date)` |
| Cancelamento pontual | Não há como marcar "não ocorre em DD/MM" | Real | **Ajustar campo:** appointment datado com referência à recorrência de origem (`parent_appointment_id`) e status `cancelled` |
| Reagendamento pontual | Datado novo, sem ligação | Real | Mesmo campo: o datado com `parent_appointment_id` substitui a ocorrência |
| Alta / encerramento | `status = discharged`, sem data | Parcial | **Ajustar campo:** `ended_on` (e motivo opcional). `updated_at` não serve |
| Transferência | `status = transferred` + novo appointment | Parcial | Mesmo `ended_on`. O vínculo entre o antigo e o novo é opcional |
| Exceção por data | Idem cancelamento pontual | Real | Idem |
| Duração/início/fim | Só `start_time` | Real | **Ajustar campo:** `duration_minutes` (padrão do tenant). Fim calculado |
| Recorrente × datado | Índices separados, sem cruzamento | Real | Resolvido pela constraint de sobreposição (seção 7) |
| Início da recorrência | Ausente | Real (o legado tem) | **Ajustar campo:** `starts_on` |

**Nenhum cenário exige tabela nova (`appointment_series`).** A recorrência cabe em `appointments` com 3–4 colunas (`starts_on`, `ended_on`, `duration_minutes`, `parent_appointment_id`) e um índice ajustado. Uma tabela de série só se justificaria com recorrência não semanal (quinzenal ou mensal), que **não aparece** nos dados.

## 6. Regra de 50 minutos

| Camada | Achado |
|---|---|
| Regra operacional conhecida | 50 min (premissa da ENTREGA-001 e da operação) [EI] |
| Evidência nos dados | Intervalo entre horários consecutivos da mesma agenda: **50 min em 180 casos**, 60 min em 25, 100 min (um horário pulado) em 4 |
| Por agenda | **17 de 19 agendas com cadência modal de 50 min**; 2 com 60 min; 1 mistura 50 e 60 |
| Painel de salas | Grade **de hora em hora** (granularidade diferente da agenda) |
| Exceções | Agendas de 60 min; um horário a ~00:30 corrigido (fora do expediente) [EI] |

Conclusão: **50 min é o padrão, não a regra universal.** O modelo precisa de duração **por appointment, com padrão por tenant/profissional**. Decisão de negócio: aceitar 60 min por profissional ou padronizar.

## 7. Salas, conflitos e integridade

**Painel (`legado.salas_painel`):**
- 415 células = 5 consultórios × (5 dias × 15 h + sábado × 8 h). 215 com nome de psicóloga (casa exatamente com `planilhas.nome_abreviado`), 198 livres, 2 outros. [C]
- 94 transições entre ocupantes ao longo do dia (≈ 3 blocos por consultório por dia), coerente com turnos. [C]
- Agenda × painel: com a correção de −4h53, **180 de 195 atendimentos presenciais (92%)** caem numa célula do painel atribuída à mesma psicóloga. [C]

| Pergunta | Resposta |
|---|---|
| Há informação suficiente para derivar blocos de sala? | **Sim**: ilhas contínuas de mesma psicóloga por sala/dia (*gaps-and-islands*) |
| Pode começar por view/função? | **Sim**: `vw_room_blocks` sobre o espelho, somente leitura |
| Há necessidade comprovada de persistência própria? | **Não nesta fase.** Só quando o HopeCore virar fonte da distribuição de salas (substituir o Hope Painel) |
| Como impedir duas profissionais na mesma sala/período? | `EXCLUDE USING gist (tenant_id WITH =, room_id WITH =, weekday WITH =, faixa_horária WITH &&)` nas recorrências ativas (`btree_gist` já instalado). **Exige duração** |
| Como impedir uma profissional em duas salas ao mesmo tempo? | Mesmo `EXCLUDE` por `professional_id`. Hoje não há nenhuma proteção |

Os índices únicos atuais (`idx_appt_unique_recurring`, `idx_appt_unique_dated`) só pegam **início idêntico na mesma sala**. Não pegam sobreposição parcial, profissional duplicada nem o cruzamento recorrente × datado.

## 8. Arquitetura mínima recomendada (não executada)

| # | Lacuna | Recomendação (uma só) | Por que não estrutura nova |
|---|---|---|---|
| 1 | Horário deslocado no espelho (DATA-01) | **Decisão/correção no sync**: corrigir a serialização de hora no SyncSupabase (ou view de correção provisória) | É defeito de dado |
| 2 | Várias sessões por recorrência | **Ajustar índice** `idx_sessions_unique_appointment` → `(appointment_id, session_date)` | A tabela já tem o vínculo |
| 3 | Duração/fim | **Ajustar campo**: `appointments.duration_minutes` + padrão por tenant | 1 coluna resolve |
| 4 | Início/fim da recorrência | **Ajustar campo**: `starts_on`, `ended_on` (+ motivo opcional) | O status já existe |
| 5 | Exceção por data | **Ajustar campo**: `appointments.parent_appointment_id` | O datado já existe |
| 6 | Double booking (sala e profissional) | **Ajustar constraint**: 2 `EXCLUDE` com `btree_gist` | A extensão já existe |
| 7 | Blocos de sala | **Criar view** `vw_room_blocks` | Painel suficiente |
| 8 | Disponibilidade (vitrine) | **Criar view/função** de slots livres = blocos − appointments − exceções | Calculado, nunca digitado |
| 9 | Falta × justificado | **Decisão de negócio**: basta `missed` ou é preciso distinguir? Se precisar, campo em `sessions` | — |
| 10 | Sublocação na agenda | **Decisão de negócio** | — |
| 11 | Duração 50 × 60 | **Decisão de negócio** | — |

**Estruturas novas realmente necessárias: nenhuma.** `tenant_memberships`, `room_blocks` e `appointment_series` continuam **não justificadas** pelos dados.

## 9. Itens que dependem de Jorge — `PENDENTE — DECISÃO DE JORGE`

1. Duração: 50 min para todas ou aceitar 60 min por profissional?
2. Sublocação aparece na agenda de psicóloga (3 horários): deve virar atendimento, bloqueio de sala ou ficar fora da agenda clínica?
3. Falta × "sem comparecimento justificado": a diferença importa para faturamento ou repasse?
4. Encerramento: vale passar a registrar o motivo (alta, desistência, transferência)? O legado não registra.

Nenhum desses itens bloqueia a ORDEM-004 sugerida.

## 10. Recomendação para a ORDEM-004 (não executada)

**ORDEM-004 (sugestão): AGENDA-FIT-02 — Correção do deslocamento de horário no espelho + views de leitura (PROPOSTA).**
1. Diagnosticar no `SyncSupabase.gs` a origem do DATA-01 e propor a correção (leitura do código; alteração só com autorização).
2. Propor, em branch, as views `vw_agenda_normalizada` (horário corrigido, sala normalizada, plano por de-para), `vw_room_blocks` e `vw_disponibilidade`. **Somente leitura e sem PII**: base direta do feed do site.
3. Deixar os ajustes de `appointments`/`sessions` (itens 2–6 da seção 8) para uma ordem de implementação posterior, depois das decisões da seção 9.

## Testes executados

| Verificação | Resultado |
|---|---|
| Inventário de `legado.*` e colunas | 11 tabelas; mapeadas na seção 2 |
| Constraints e índices de `appointments`, `sessions`, `rooms`, `professional_availability_blocks` | Só PK + 2 índices únicos de agenda + 1 de sessão; nenhuma FK de conflito |
| Enums | `appointment_status`: scheduled, cancelled, discharged, transferred · `billing_status`: not_billed, billed, awaiting_operator, paid, glossed, missed |
| Funções relacionadas | `legacy_ingest_agenda`, `legacy_ingest_salas`, `legado.classificar_agenda` |
| Teste de deslocamento horário × painel | −4h53: 92% · −3h00: 73% · −5h53: 68% · sem deslocamento: 30% |
| Simulações de conflito | Seção 4 |

## Rollback

Não aplicável: nenhuma alteração além deste arquivo e do `00-STATUS-ATUAL.md`.

## Critérios de aceite da ordem

- [x] 1. Modelo real atual (paciente, profissional, sala, dia/horário, plano, recorrência, eventos, blocos, duração, inconsistências)
- [x] 2. Fit por conceito (CABE / COM AJUSTE / NÃO CABE / INDETERMINADO)
- [x] 3. Simulação sem escrita com percentuais e conflitos
- [x] 4. Recorrência, incluindo o `idx_sessions_unique_appointment`
- [x] 5. Salas (derivação, view, persistência, os dois conflitos)
- [x] 6. Regra de 50 min separada em regra × evidência × exceções
- [x] 7. Uma recomendação por lacuna, sem estrutura nova não comprovada

## Fora do escopo (sugestões, não executadas)

- Higienizar DATA-02..08 nas planilhas de origem.
- Um cabeçalho de aba Atendimentos contém um número de identificação no lugar do título da coluna: revisar na planilha (o valor não é reproduzido aqui).

## Próxima ação

**ENTREGA-003 disponível — aguardando revisão do Orquestrador CX.**
