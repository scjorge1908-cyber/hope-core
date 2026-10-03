# ORDEM-002 — Validação de identidade e ambiente do Psi Gestão Fácil

**Emissor:** CX / ChatGPT — Orquestrador Técnico  
**Executor:** Claude/Core  
**Classificação:** ANÁLISE / AUDITORIA / VALIDAÇÃO  
**Implementação autorizada:** **NÃO**  
**Modo:** SOMENTE LEITURA

## Contexto

A ENTREGA-001 (ARQ-PSI-01) produziu um blueprint útil, porém identificou como Psi Gestão Fácil o repositório `Gestaofacil-15-06-2026` e registrou evidência incompleta sobre ele ser a versão vigente/publicada.

Antes de qualquer implementação, migration, convergência de banco ou adoção das estruturas propostas na ENTREGA-001, é obrigatório comprovar a identidade do produto atualmente publicado e o ambiente que ele utiliza.

## Missão

Estabelecer uma cadeia de evidência verificável:

**produto publicado → projeto/deploy → repositório → branch/commit → backend/banco → ambiente → natureza dos dados**

## Validar

1. Identificar o deployment atual do Psi Gestão Fácil e sua origem.
2. Confirmar qual repositório, branch e commit correspondem ao produto publicado.
3. Determinar se `Gestaofacil-15-06-2026` é:
   - a versão vigente;
   - uma versão anterior;
   - um protótipo;
   - ou projeto diferente.
4. Confirmar, sem expor segredos:
   - Firebase/Supabase/backend utilizado;
   - projeto/ambiente correspondente;
   - se compartilha infraestrutura com o site da Clínica Hope;
   - se há produção, homologação ou apenas protótipo.
5. Determinar se existem **dados reais** de pacientes/profissionais no ambiente analisado. Não copiar PII para a entrega; registrar apenas evidência sanitizada e contagens/classificação quando possível.
6. Reclassificar SEC-PGF-01 e SEC-PGF-02:
   - SEC-P0 imediato se o ambiente vulnerável estiver publicado/com dados reais;
   - prioridade inferior/contida se for apenas protótipo sem dados reais e não exposto operacionalmente.
7. Verificar se existe versão mais recente fora do repositório auditado (por exemplo deployment ligado a outro repo/projeto). Não alterar nem importar nada.
8. Comparar a identidade comprovada com as premissas da ENTREGA-001 e classificar cada conclusão estrutural relevante como:
   - CONFIRMADA;
   - PRECISA SER REVISADA;
   - NÃO SE APLICA.

## Regra contra criação desnecessária

Não propor migration/tabela nova como decisão fechada nesta ordem.

Para cada estrutura sugerida anteriormente (`tenant_memberships`, `room_blocks`, `appointment_series` e equivalentes), apenas registrar:
- necessidade funcional;
- estruturas existentes no HopeCore que poderiam absorver a função;
- lacuna comprovada;
- decisão futura necessária.

Objetivo: evitar novas tabelas/regras antes de comprovar que o modelo atual não atende.

## Segurança

O relatório AUD-002 é RESTRITO. Não publicar detalhes exploráveis, PII, chaves, tokens, URLs sensíveis ou instruções de exploração no repositório público.

Se encontrar risco crítico adicional, criar apenas referência sanitizada na entrega e fornecer o detalhe pelo canal restrito apropriado.

## Proibições

Não:
- alterar código;
- alterar banco;
- executar migration;
- alterar RLS/regras Firebase;
- fazer deploy;
- alterar Apps Script/Sheets/Drive;
- alterar produção;
- corrigir vulnerabilidade;
- iniciar PSI-F1/F2;
- alterar FIN_MOTOR;
- criar/mesclar PR em main.

## Entrega obrigatória

Criar:

`docs/orquestracao/entregas/ENTREGA-002-VALIDACAO-IDENTIDADE-AMBIENTE-PGF.md`

A entrega deve conter:
1. cadeia de identidade comprovada;
2. evidências e nível de confiança;
3. dados reais vs teste;
4. reclassificação de segurança sanitizada;
5. impacto sobre ENTREGA-001;
6. estruturas existentes vs lacunas;
7. dúvidas realmente dependentes de Jorge, se houver;
8. recomendação técnica para a próxima ORDEM — sem executá-la.

Depois, atualizar `docs/orquestracao/00-STATUS-ATUAL.md` para **ENTREGA-002 disponível — aguardando revisão do Orquestrador CX** e PARAR.

## Autoridade

Ordens técnicas são emitidas pelo **CX/Orquestrador Técnico**. Jorge é o decisor final de negócio e será acionado apenas quando houver decisão empresarial, risco material a aceitar, custo/contrato, credencial ou ação humana inevitável.

Esta ordem **não autoriza implementação**.
