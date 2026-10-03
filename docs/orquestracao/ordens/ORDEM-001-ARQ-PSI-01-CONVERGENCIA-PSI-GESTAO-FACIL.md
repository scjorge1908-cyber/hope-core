# ORDEM-001 — ARQ-PSI-01 — CONVERGÊNCIA HOPECORE + PSI GESTÃO FÁCIL

**EMITIDA POR:** CX / ChatGPT — Orquestrador Técnico  
**EXECUTOR:** Claude/Core  
**TIPO:** ANÁLISE / AUDITORIA / BLUEPRINT  
**IMPLEMENTAÇÃO AUTORIZADA:** NÃO  
**AMBIENTE:** somente leitura; nenhuma alteração de produção  
**PRIORIDADE:** ALTA

## 1. Missão

Antes de construir o novo módulo de agenda do HopeCore, auditar o projeto **Psi Gestão Fácil** e confrontá-lo com o **HopeCore** para determinar o máximo reaproveitamento possível, evitando duplicação de agenda, pacientes, profissionais, autenticação, regras e banco.

A hipótese estratégica a validar é:

- **HopeCore** tende a ser o núcleo administrativo/empresarial da clínica e da plataforma.
- **Psi Gestão Fácil** pode tornar-se a camada operacional usada pela psicóloga e, futuramente, um produto SaaS.
- **Clínica Hope** será o primeiro ambiente/tenant real para testar, amadurecer e validar o produto.
- Psicólogas parceiras da Hope poderão receber a ferramenta como benefício da parceria.
- Futuramente, uma profissional independente ou outra clínica poderá contratar o produto.

Essa hipótese NÃO deve ser aceita sem evidência. Validar pelo código, banco e arquitetura reais.

## 2. Restrições absolutas desta ordem

NÃO:
- alterar código;
- alterar banco;
- criar/executar migrations;
- alterar RLS/policies;
- fazer deploy;
- alterar Apps Script ou Sheets;
- alterar produção;
- juntar repositórios;
- copiar código entre projetos;
- iniciar mobile;
- iniciar AGENDA-01;
- ligar FIN_MOTOR=central;
- iniciar a fase geral de correção da auditoria.

Achados críticos devem ser registrados e classificados, mas não corrigidos sem nova ordem do Orquestrador.

Como o repositório atual é público, NÃO registrar em GitHub detalhes exploráveis de vulnerabilidades, secrets, tokens, credenciais, dados clínicos ou dados pessoais desnecessários. Achados restritos devem ser apenas referenciados de forma sanitizada.

## 3. Auditoria do Psi Gestão Fácil

Mapear com evidência:
- arquitetura e repositório;
- frontend/backend;
- banco/Supabase;
- autenticação e usuários;
- tenants/multi-tenancy;
- profissionais;
- pacientes;
- agenda/disponibilidade;
- recorrência;
- atendimentos/sessões;
- documentos;
- financeiro;
- permissões/RBAC/RLS;
- APIs e integrações;
- deploy;
- segurança;
- funcionalidades já prontas e grau de maturidade;
- dependências legadas.

Classificar componentes como:
**MANTER | REUTILIZAR | AJUSTAR | INTEGRAR | MIGRAR | DESCONTINUAR | SUBSTITUIR**.

## 4. Comparação obrigatória HopeCore × Psi Gestão Fácil

Criar matriz:

| DOMÍNIO | HOPECORE | PSI GESTÃO FÁCIL | DUPLICAÇÃO | MATURIDADE | SOURCE OF TRUTH PROPOSTA | AÇÃO |
|---|---|---|---|---|---|---|

Cobrir no mínimo:
Auth, users, tenants, professionals, professional_profiles, CPF, rooms, room availability, agenda, recurring schedules, appointments, sessions, patients, documents, guides, billing, payouts, finance, audit, permissions, notifications e public availability.

## 5. Regra central — uma fonte da verdade

Não aceitar duas agendas, dois pacientes ou dois profissionais independentes.

Determinar **Source of Truth** para:
- identidade/usuário;
- tenant;
- profissional;
- vínculo profissional-clínica;
- paciente;
- sala;
- agenda;
- recorrência;
- appointment;
- session;
- guia;
- faturamento;
- repasse;
- financeiro;
- disponibilidade pública.

## 6. Modelo de identidade e SaaS

Separar conceitualmente:

**IDENTIDADE GLOBAL DO USUÁRIO**
→ **TENANT MEMBERSHIP / VÍNCULO COM CLÍNICA**
→ **PROFESSIONAL PROFILE**
→ **PERMISSÕES**
→ **ACESSO AO PRODUTO**
→ **ASSINATURA/PLANO SAAS**

CPF poderá ser identificador administrativo e participar de ativação, mas **CPF NÃO É SENHA** e não pode sozinho conceder acesso.

Estados de vínculo a considerar:
**PENDENTE | ATIVA | SUSPENSA | ENCERRADA**.

Se a profissional sair da Hope:
- perde acesso ao tenant Hope;
- histórico da Hope permanece;
- identidade global não deve ser automaticamente destruída;
- arquitetura deve permitir futura assinatura independente do Psi Gestão Fácil.

## 7. Agenda e salas — requisitos Hope

Preservar a distinção:

**SALA = BLOCO DE TEMPO**
Ex.: 07:00–13:00 / 13:00–18:00 / 18:00–fim, sem hardcode desses períodos.

**PROFISSIONAL = SLOTS DE ATENDIMENTO**, atualmente 50 minutos, preferencialmente configurável/canônico.

Fluxo futuro a suportar:

TENANT
→ ROOM
→ ROOM BLOCK
→ PROFESSIONAL ASSIGNMENT
→ PROFESSIONAL SCHEDULE
→ SLOT
→ APPOINTMENT
→ SESSION

Validar conflitos:
- duas profissionais na mesma sala;
- profissional simultaneamente em locais incompatíveis;
- atendimento fora do bloco;
- slot ultrapassando fim do bloco;
- sobreposição;
- alteração de bloco com pacientes existentes.

Não implementar ainda. Verificar primeiro o que já existe nos dois sistemas.

## 8. Agenda pública da Clínica Hope

Hoje o site `clinicahopebrasil.com.br` recebe disponibilidade por fluxo baseado em Apps Script.

Mapear exatamente:
- Apps Script/endpoint atual;
- origem dos dados;
- cálculo de disponibilidade;
- identificação da profissional;
- atualização;
- autenticação/segurança;
- como vaga aparece/desaparece;
- dependências.

Destino arquitetural a avaliar:

SOURCE OF TRUTH DA AGENDA
→ AVAILABILITY ENGINE
→ API PÚBLICA CONTROLADA
→ SITE CLÍNICA HOPE

Não criar uma segunda agenda para o site.

Distinguir:
- falta;
- cancelamento pontual;
- reagendamento;
- bloqueio;
- férias;
- alta;
- troca definitiva;
- encerramento de recorrência.

Cancelamento isolado não deve ser presumido como liberação estrutural permanente.

Avaliar prevenção de double booking no banco/transação, não apenas frontend.

## 9. Apps Script / Sheets / Drive

Objetivo estratégico: retirar progressivamente da operação:
- Apps Script;
- Sheets como banco/fonte operacional;
- Drive como dependência operacional.

Mapear cada dependência com:
**dependência | quem usa | função | substituto | pré-requisito para desligar | validação | rollback**.

Não desligar nada nesta ordem.

## 10. Mobile

Não escolher nem implementar tecnologia mobile ainda.

Somente avaliar quanto do Psi Gestão Fácil pode ser reaproveitado posteriormente para Android/iOS e quais condicionantes arquiteturais precisam existir antes.

## 11. Segurança

Auditar autenticação, autorização, RLS, RBAC, tenant isolation, IDOR/BOLA, XSS, exposição de APIs/dados, secrets, CPF/dados pessoais, uploads e auditabilidade.

Classificar SEC-P0 a SEC-P4.

Por o repositório ser público, detalhes exploráveis de achados RESTRITOS não devem ser gravados nele. No documento público, usar descrição sanitizada e indicar que existe achado restrito fora do repositório quando necessário.

## 12. Entregável

Gerar:

`docs/orquestracao/entregas/ENTREGA-001-ARQ-PSI-01-CONVERGENCIA.md`

Título:

# BLUEPRINT ARQ-PSI-01 — CONVERGÊNCIA HOPECORE + PSI GESTÃO FÁCIL

Incluir:
1. resumo executivo;
2. arquitetura real do Psi Gestão Fácil;
3. funcionalidades e maturidade;
4. frontend/backend/banco;
5. auth/autorização;
6. SaaS/multi-tenancy;
7. profissionais/pacientes/agenda;
8. comparação com HopeCore;
9. duplicidades;
10. Source of Truth por domínio;
11. arquitetura de convergência;
12. salas/blocos/slots;
13. identidade/CPF/vínculos;
14. agenda pública e site;
15. estratégia mobile futura;
16. eliminação gradual Apps Script/Sheets/Drive;
17. riscos;
18. testes;
19. migração;
20. rollback;
21. roadmap por fases.

Responder expressamente ao final:
A. O que aproveitar do Psi Gestão Fácil?
B. O que deve permanecer central no HopeCore?
C. O que está duplicado?
D. Qual a Source of Truth de cada domínio?
E. Integrar, incorporar ou manter projetos separados?
F. Como Hope vira primeiro tenant?
G. Como parceira Hope recebe a ferramenta como benefício?
H. Como ex-parceira pode futuramente continuar como cliente SaaS sem acesso à Hope?
I. Como outras clínicas entram futuramente?
J. Qual o caminho mais curto e seguro para retirar a primeira planilha/Apps Script?

## 13. Encerramento obrigatório

Ao terminar:
- atualizar `docs/orquestracao/00-STATUS-ATUAL.md`;
- apontar `ENTREGA-001` como última entrega;
- marcar **IMPLEMENTAÇÃO AUTORIZADA: NÃO**;
- definir próxima ação como **AGUARDAR REVISÃO DO ORQUESTRADOR CX**;
- PARAR.

Não implementar nenhuma recomendação até nova ORDEM.
