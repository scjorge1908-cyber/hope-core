# ORDEM-005 — CONVERGÊNCIA BLOCO 1 — Fundação técnica sem deploy

**Emissor:** CX / ChatGPT — Orquestrador Técnico  
**Executor:** Claude/Core  
**Classificação:** IMPLEMENTAÇÃO EM BRANCH / SEM DEPLOY  
**Produção autorizada:** **NÃO**

## Decisão CX

A `ENTREGA-DIR-001-MAPA-CONVERGENCIA-PGF-HOPECORE.md` está **ACEITA**.

Direção confirmada:
- HopeCore/Supabase = núcleo e fonte de verdade;
- Psi Gestão Fácil = interface operacional reaproveitável;
- Firestore/modelo paralelo do PGF = não convergir;
- zero tabelas novas nesta fase;
- reutilizar e ajustar estruturas existentes.

A sugestão de popular imediatamente `rooms` e `professional_profiles` em produção **NÃO está autorizada ainda**.

## Objetivo deste bloco

Preparar em código, de forma revisável e reversível, a fundação necessária para a primeira integração real, sem alterar produção.

## Trabalho autorizado

### A. DATA-01 — preparar correção no SyncSupabase

Implementar NO REPOSITÓRIO/BRANCH, sem publicar no Apps Script:
- remover timezone fixo na normalização de Date onde ele causa DATA-01;
- usar o timezone da própria planilha ou abordagem equivalente comprovada na ENTREGA-004;
- preservar células originalmente textuais;
- não usar constante −4h53;
- adicionar testes/validações possíveis no repositório;
- documentar diff e rollback.

Não executar sync real.

### B. Rooms — preparar bootstrap idempotente

Preparar migration/RPC/SQL revisável para:
- criar/popular somente as 5 salas reais derivadas do legado;
- tenant correto;
- normalização determinística;
- idempotência;
- não duplicar em reexecução;
- rollback identificável;
- sem PII.

Não aplicar no banco de produção.

### C. Professional profiles — preparar bootstrap, NÃO executar

Preparar proposta executável para mapear `legado.planilhas` → `professional_profiles`, mas antes provar:
- chave estável de origem;
- regra de deduplicação;
- 24 registros / 17 ativos;
- tratamento dos 7 desligados;
- campos obrigatórios;
- quais campos ficam nulos;
- como evitar criar identidade/auth prematuramente;
- como vincular futuramente `user_id`;
- rollback.

Não criar usuários Auth.
Não ativar login.
Não inserir em produção.

### D. `vw_room_blocks`

Preparar a migration da view conforme ENTREGA-004:
- gaps-and-islands;
- sem PII;
- somente leitura;
- tenant/sala/dia/profissional/início/fim/confiança/origem;
- comportamento seguro enquanto `rooms` ainda estiver vazia;
- testes esperados contra o legado.

Não aplicar em produção.

### E. Verificação de `public.guides = 0`

Somente leitura:
- determinar por que `public.guides` está vazia;
- identificar qual fluxo deveria alimentá-la;
- confirmar se `legado.bd_guias` é atualmente a fonte operacional;
- verificar se existe gravação dupla planejada, incompleta ou abandonada;
- NÃO corrigir neste bloco.

## Gates mantidos

Não implementar ainda:
- G1 RLS por profissional;
- G2 constraints/índices de agenda/sessions;
- G4 importação de pacientes;
- G5 Google Auth;
- disponibilidade pública;
- alterações FIN_MOTOR;
- migração de guias;
- SaaS/multi-tenant membership.

G3/DATA-01 está autorizado **somente como código em branch, sem publicação**.

## Testes obrigatórios

Entregar evidência de:
1. diff DATA-01 não usa constante de offset;
2. comportamento esperado para Date e texto;
3. bootstrap rooms idempotente;
4. bootstrap professional_profiles idempotente e sem Auth;
5. view room_blocks reproduz as ilhas esperadas do legado;
6. nenhuma migration aplicada em produção;
7. nenhum sync executado;
8. nenhum dado de produção alterado.

## Proibições

- deploy;
- push para main;
- publicação Apps Script;
- executar migration em produção;
- INSERT/UPDATE/DELETE em produção;
- criar usuário Auth;
- alterar RLS;
- alterar FIN_MOTOR;
- criar tabela nova;
- importar paciente;
- expor PII em documentação.

## Entrega

Criar:
`docs/orquestracao/entregas/ENTREGA-005-CONVERGENCIA-BLOCO-1-FUNDACAO.md`

Informar:
- commits;
- arquivos de código criados/alterados;
- migrations preparadas;
- testes;
- resultado da investigação de guides;
- rollback;
- riscos;
- exatamente o que estará pronto para um piloto;
- recomendação para ORDEM-006.

Atualizar `00-STATUS-ATUAL.md`.

Depois **PARAR e fazer handoff diretamente ao CX nesta conversa**.

Formato:
`CX — BLOCO ORDEM-005 CONCLUÍDO`
+ commits
+ testes
+ produção alterada SIM/NÃO
+ pronto para piloto SIM/NÃO
+ blockers.
