# ENTREGA-002 — Validação de identidade e ambiente do Psi Gestão Fácil

| Campo | Valor |
|---|---|
| Responde à | ORDEM-002 (commit `4dc1afe`, branch `orquestracao`) |
| Executor | Claude/Core |
| Data | 2026-10-03 (America/Sao_Paulo) |
| Classificação da ordem | ANÁLISE / AUDITORIA / VALIDAÇÃO — somente leitura |
| Produção alterada? | **NÃO**. Nada mudou em código, banco, migration, RLS, regras Firebase, deploy, Apps Script, Sheets, Drive ou `FIN_MOTOR`. Não há PR para `main` |
| O que foi lido | Metadados de repositório (API REST com escopo de repositório), clones rasos, `SELECT` de metadados no Supabase, páginas públicas e uma tentativa de leitura com máscara de campos (sem PII) na API pública do Firestore — resultado inconclusivo, ver seção 3 |
| Esta entrega autoriza implementação? | **NÃO** |
| Achados restritos | Complemento **AUD-002-A1 (RESTRITO)**, entregue fora do repositório |

**Níveis de confiança:**
- **[C] CONFIRMADO;**
- **[EI] EVIDÊNCIA INCOMPLETA;**
- **[H] HIPÓTESE;**
- **[NC] NÃO COMPROVADO** (procurado e não encontrado).

---

## 1. Cadeia de identidade comprovada

```
produto publicado ──✗── projeto/deploy ──✓── repositório ──✓── branch/commit ──✓── backend/banco ──✓── ambiente ──✓── natureza dos dados ──?
     [NC]                 [C]/[NC]            [C]               [C]                  [C]              [C]               [EI]
```

| Elo | Resultado | Evidência | Conf. |
|---|---|---|---|
| Nome "Psi Gestão Fácil" | **Não aparece** em nenhum código, repositório ou histórico verificado. O nome mais próximo é **"FacilGestão"** (`metadata.json`: "Gestão de Demandas Clínicas"; `manifest.json`: "FacilGestão - Clínica Hope") | Busca em 7 repositórios (hope-core, Gestaofacil, site, Hope-App, clinica-hope, Gestao-Hope--Jorge-, SandraPsicopedagoga2026) e no histórico de conversas | [H] |
| Projeto de origem | App do **Google AI Studio**. O README do repositório aponta para um app AI Studio específico, e o ID desse app é o mesmo que nomeia o banco Firestore do PGF | `README.md` + `firebase-applet-config.json` | [C] |
| Deploy da aplicação | **Nenhum deploy da aplicação encontrado.** O GitHub Pages do repositório (1 execução, 15/06/2026) publica só o README, não o app. O app usa rotas de servidor (Mercado Pago) e `output: standalone`, que não rodam no Pages | Página do Pages (HTTP 200, conteúdo = README); `actions/runs` = 1 execução "pages build and deployment" | [C] para o Pages; [NC] para Cloud Run/AI Studio "Deploy" |
| Repositório | `scjorge1908-cyber/Gestaofacil-15-06-2026`, privado, 316 KB | API do repositório | [C] |
| Branch/commit | Só `main`. **2 commits**, ambos em 15/06/2026 com 15 s de diferença (`340fd8f` "Initial commit" → `ed8c56a`). Criado e enviado no mesmo minuto, sem alteração desde então. É o padrão de **exportação única do AI Studio para o GitHub** | `commits`, `created_at = pushed_at` | [C] |
| Backend | Firebase Auth + Firestore. **Nenhum** Supabase ou outro backend | Código | [C] |
| Ambiente | **Mesmo projeto Firebase e mesmo app web Firebase** (mesmo `projectId` **e** mesmo `appId`) do site da Clínica Hope. Banco Firestore **nomeado e separado** (um banco por app AI Studio). Não há homologação nem produção separadas | Comparação das duas configs (sem expor valores) | [C] |
| Natureza dos dados | Indeterminada. Há um "simulador" que cria dados de teste; não há evidência de uso real | Ver seção 3 | [EI] |

### Classificação do repositório `Gestaofacil-15-06-2026`

**Protótipo exportado do AI Studio (snapshot de 15/06/2026).** [C]

- Se é a **versão vigente** ou uma **versão anterior** não dá para determinar sem acesso ao AI Studio: o app de origem continua existindo lá e pode ter evoluído depois da exportação. [EI]
- Se é o **mesmo produto** chamado "Psi Gestão Fácil" é hipótese, só por semelhança de nome. [H]

### Versão mais recente fora do repositório (item 7)

- **Não encontrada** nos repositórios acessíveis. [NC]
- Não foi possível verificar os repositórios privados não anexados a esta sessão (`hope-agenda`, `APPHOPE`, `App_SUBLOCA-O`, `Subloca-o-Hope-`, `jorge18-05` e outros). O conector que anexa repositórios falhou nesta sessão, e a API de listagem da conta não é permitida.
- Também não foi possível verificar o próprio AI Studio (exige o login do Owner).
- Os projetos da Vercel não puderam ser listados: o conector não oferece essa operação. [EI]

## 2. Evidências e nível de confiança (resumo)

| Afirmação | Conf. |
|---|---|
| O código auditado na ENTREGA-001 é um snapshot de 15/06/2026 exportado do AI Studio | [C] |
| PGF e site compartilham projeto **e** app Firebase | [C] |
| O PGF não está publicado como aplicação no GitHub Pages | [C] |
| O PGF está publicado em outro lugar (Cloud Run/AI Studio) | [NC] |
| Existe versão mais nova no AI Studio | [EI] |
| "Psi Gestão Fácil" = "FacilGestão" | [H] |
| O banco do PGF existe e tem dados reais | [EI] |

## 3. Dados reais × teste

- **Não determinado.**
- Foi feita uma única tentativa sanitizada de verificação, **só de contagem**, pedindo apenas campos de status/data e excluindo os campos de pessoa, contra a API pública do Firestore. Resultado: HTTP 403.
- **O controle negativo também deu 403:** uma coleção do site, sabidamente pública, falhou do mesmo jeito. Portanto o 403 **não prova** que as regras publicadas sejam mais restritas do que as do repositório; prova apenas que este ambiente não consegue fazer a verificação. [EI]
- **Sinais de protótipo:**
  - simulador de dados (`handleSeedSimulator`);
  - telas com dados fictícios e `localStorage`;
  - `clinicId` fixo no código;
  - ícones placeholder (`picsum.photos`);
  - nenhum commit em 3,5 meses.
- **Sinais de uso real:** nenhum encontrado.
- **Nenhum PII foi copiado para esta entrega.**

## 4. Reclassificação de segurança (sanitizada)

| ID | Antes (ENTREGA-001) | Agora | Justificativa |
|---|---|---|---|
| SEC-PGF-01 (autorização / elevação de privilégio) | SEC-P0 condicional | **SEC-P1 provisório — gate pendente** | Não há prova de app publicado nem de dados reais, o que afasta P0 imediato. **Porém o risco não depende de o app estar publicado:** depende de o *banco* existir com as regras do repositório. O banco fica no mesmo projeto Firebase do site público. Sem confirmar a existência e o conteúdo do banco, não pode cair para P2/P3 |
| SEC-PGF-02 (exposição de dados de pacientes na agenda) | SEC-P0 condicional | **SEC-P1 provisório — gate pendente** | Mesma lógica |
| SEC-PGF-03/04/05 | P1/P1/P2 | Mantidos | Inalterados |
| SEC-SITE-01/02 | P2/P1 | Mantidos | Não dependem do PGF: o site está publicado e em uso [C] |

**Regras de saída do gate:**

| Resposta do Owner (seção 7) | Classificação |
|---|---|
| Banco com dados reais | SEC-P0 imediato |
| Banco vazio ou só de teste | SEC-P3, com descarte do banco recomendado |
| Banco inexistente | Encerrado |

Detalhes técnicos da tentativa de verificação estão em AUD-002-A1 (RESTRITO).

## 5. Impacto sobre a ENTREGA-001

| Conclusão da ENTREGA-001 | Status | Observação |
|---|---|---|
| O PGF é protótipo de interface, não backend | **CONFIRMADA** | Reforçada (snapshot único, simulador, telas fictícias) |
| O repositório Gestaofacil **é** o Psi Gestão Fácil | **PRECISA SER REVISADA** | Rebaixada a hipótese de nome; vigência não comprovada |
| Mesmo projeto Firebase do site | **CONFIRMADA** | Também o mesmo app Firebase |
| Incorporar o PGF como front da profissional sobre o HC; descontinuar o Firestore | **CONFIRMADA** (condicional) | Vale para o snapshot. Reavaliar se a versão do AI Studio for materialmente diferente |
| "O HC não tem nenhuma constraint de conflito de horário" | **PRECISA SER REVISADA** | **Erro da ENTREGA-001.** Existem índices únicos parciais `idx_appt_unique_recurring` (sala + dia + hora, recorrentes) e `idx_appt_unique_dated` (sala + data + hora, datados) [C]. A lacuna real é mais estreita (seção 6) |
| Tabelas clínicas do HC vazias | **CONFIRMADA** | 0 linhas em `professional_profiles`, `patients`, `rooms`, `appointments` e `sessions` |
| "Até 6 cópias da agenda" | **PRECISA SER REVISADA** | São **5 cópias comprovadas**. A do PGF só conta se o banco tiver dados |
| Fonte da verdade = HC em todos os domínios | **CONFIRMADA** | Independe do PGF |
| Novas tabelas `tenant_memberships`, `room_blocks`, `appointment_series` | **PRECISA SER REVISADA** | Rebaixadas a necessidades funcionais (seção 6). `appointment_series` provavelmente é absorvível pela própria `appointments` |
| Primeiro Apps Script a retirar = feed de disponibilidade do site | **CONFIRMADA** | Independe do PGF |
| Roadmap PSI-F6 (app da profissional a partir das telas do PGF) | **PRECISA SER REVISADA** | Depende de identificar a versão vigente no AI Studio |
| Marketplace de sublocação via Mercado Pago como receita SaaS | **NÃO SE APLICA** (agora) | Fora do núcleo; reavaliar no SaaS |
| SEC-PGF-01/02 SEC-P0 condicional | **PRECISA SER REVISADA** | Ver seção 4 |

## 6. Estruturas existentes × lacunas (sem propor migration)

| Necessidade funcional | Estruturas existentes no HC que podem absorver | Lacuna comprovada | Decisão futura necessária |
|---|---|---|---|
| **Vínculo pessoa × clínica com estados** (antes `tenant_memberships`) | `users` (`tenant_id`, `role` = owner/manager/admin_staff/professional, `active`); `professional_profiles` (`tenant_id`, `user_id`, `active`, CPF blind index único **por tenant**); `legado.planilhas` (`ativo`, `desligada`, `desligada_em`); `platform_admins` | `users.id` = id do Auth (chave primária) com **um** `tenant_id` → uma pessoa não pode ter dois tenants [C]. O estado é só booleano: não há PENDENTE/SUSPENSA nem datas, exceto no legado [C]. **Para a fase só-Hope (1 tenant) isso não bloqueia nada** | Só decidir quando houver um caso real de 2º tenant ou de ex-parceira como cliente (PSI-F9). Até lá, `active` + `desligada_em` atendem |
| **Período de sala** (antes `room_blocks`) | `rooms` (só nome); `appointments.room_id/weekday/start_time`; `admin_block`/`admin_block_until`; `legado.salas_painel` (83 linhas, células cruas: **é onde o dado real está hoje**) | Não há estrutura para a janela de tempo de uma sala nem para atribuir profissional a um período; não é possível validar "atendimento fora do bloco" [C] | Antes de criar qualquer coisa: **mapear o formato real de `legado.salas_painel`** e verificar se blocos podem ser derivados (view) em vez de tabela nova |
| **Recorrência** (antes `appointment_series`) | `appointments` **já modela** a recorrência: `scheduled_date` nulo = "horário fixo recorrente" (comentário da migration 001); `status` inclui `discharged` (alta) e `transferred` (troca) = encerramento [C]. `sessions` = ocorrência realizada, com `billing_status` incluindo `missed` (falta) [C] | (a) **`idx_sessions_unique_appointment` permite só 1 sessão por appointment**, o que é incompatível com o appointment recorrente gerando sessões semanais [C]. (b) Não há forma de registrar cancelamento pontual ou reagendamento de **uma data** da série além de criar outro appointment datado [C]. (c) Não há duração nem hora de fim [C] | Decidir entre **ajustar o existente** (índice e duração) e uma estrutura nova, **só depois** de um fit-gap com `legado.agenda` / `atendimentos_raw` reais |
| **Conflito de horário** | Índices únicos parciais por sala + hora exata (recorrente e datado) [C] | Não detecta **sobreposição** (só hora de início igual); não impede a **mesma profissional** em duas salas; recorrente × datado não se cruzam [C] | Definir a regra de conflito com base nas durações reais (50 min) antes de escolher o mecanismo |
| **Férias, bloqueio, indisponibilidade** | `professional_availability_blocks` (profissional, de/até, motivo); `appointments.admin_block` | Nenhuma relevante para a fase atual | Nenhuma por ora |
| **Fila de espera** | `waitlist_entries` (dia e período preferidos, idade mínima, vínculo com o appointment) | — | — |
| **Disponibilidade pública** | Nenhuma tabela necessária: pode ser **função/view** sobre `legado.agenda` agora (69 vagas marcadas em 269 linhas) e sobre `appointments` depois | Não há identificador público de profissional sem PII; o site usa o próprio cadastro no Firestore | Desenhar a API pública mínima (ordem própria) |
| **Perfil global da pessoa** | `professional_profiles` (CPF criptografado + blind index) | Só é lacuna em cenário multi-tenant (mesma causa do vínculo) | Junto com o vínculo (PSI-F9) |

**Conclusão:** nenhuma tabela nova se justifica **agora**. A próxima evidência necessária é um fit-gap com os dados reais do espelho, para decidir entre ajustar `appointments`/`sessions` e criar estruturas.

## 7. Dúvidas que dependem do Owner

Só as que exigem acesso pessoal ou credencial dele (sem compartilhar senhas):

1. **AI Studio:** o app de origem do FacilGestão tem algum **deploy ou link compartilhado ativo** (Cloud Run / "Share")? Desde quando, e alguém além do Owner usa? Resposta sim/não + data.
2. **Firebase (projeto do site):** o banco Firestore do FacilGestão **existe**? Se existir, as coleções de agenda, usuários e cadastros têm **dados reais** ou só de teste? Basta "vazio / teste / real" e a ordem de grandeza.
3. **Nome:** "Psi Gestão Fácil" é este FacilGestão do AI Studio, ou outro app/URL?

## 8. Recomendação técnica para a próxima ORDEM (não executada)

1. **Gate de segurança:**
   - Com as respostas 1–2 do Owner, emitir uma ordem curta de **IMPLEMENTAÇÃO AUTORIZADA mínima** apenas se houver dados reais: contenção (travar as regras ou desativar o banco do PGF).
   - Se não houver dados reais: uma DEC registrando o **descarte do banco do PGF**, sem migração.
2. **Em paralelo e sem depender do Owner, ORDEM-003 sugerida: "AGENDA-FIT-01 — fit-gap do modelo de agenda do HC com dados reais" (somente leitura):**
   1. mapear o formato real de `legado.agenda`, `legado.cancelados`, `legado.salas_painel` e `atendimentos_raw`;
   2. simular, em consulta, a carga desses dados nas estruturas existentes (`appointments`, `sessions`, `rooms`, `professional_availability_blocks`);
   3. quantificar o que não cabe (sessões por appointment recorrente, duração, cancelamento pontual, blocos de sala);
   4. só então indicar se há lacuna que exige estrutura nova.
3. **Depois:** ordem de especificação, sem implementar, da **API pública de disponibilidade** sobre o espelho (primeira retirada de Apps Script, já confirmada).

## Fora do escopo (não executado)

- Correção de qualquer vulnerabilidade, regra do Firebase, RLS ou índice.
- PSI-F1/F2, `FIN_MOTOR`, Bradesco, PR para `main`.
