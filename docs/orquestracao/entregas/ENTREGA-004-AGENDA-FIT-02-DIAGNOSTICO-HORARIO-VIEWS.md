# ENTREGA-004 — AGENDA-FIT-02 — Diagnóstico do horário e desenho das views normalizadas

| Campo | Valor |
|---|---|
| Responde à | ORDEM-004 (commit `0c3982c`, status `9bfdfc0`, branch `orquestracao`) |
| Executor | Claude/Core |
| Data | 2026-10-03 (America/Sao_Paulo) |
| Classificação da ordem | DIAGNÓSTICO / ESPECIFICAÇÃO — somente leitura |
| Produção alterada? | **NÃO**. Leitura de `sync/apps-script/SyncSupabase.gs` (branch `main`), de definições de funções e de `SELECT`s agregados no Supabase. Nenhuma view, migration, dado ou Apps Script alterado |
| Esta entrega autoriza implementação? | **NÃO** |
| PII | Nenhuma. Só horários, contagens e índices anônimos de planilha |

**Rótulos:** [C] CONFIRMADO · [EI] EVIDÊNCIA INCOMPLETA · [H] HIPÓTESE

---

## 1. Causa raiz do DATA-01

**Causa:** conflito de fuso horário entre as **planilhas das psicólogas** e o **SyncSupabase.gs**. O efeito é ampliado pela data-base das células de hora (30/12/1899).

1. As planilhas das psicólogas estão (quase todas) no fuso do **Pacífico dos EUA** (`America/Los_Angeles` ou equivalente).
2. Uma célula só de hora (ex.: 07:00) é, internamente, **30/12/1899 07:00 no fuso da planilha**. O `getValues()` a entrega ao Apps Script como um instante (`Date`) calculado nesse fuso.
3. O `syncNormalizarCelula_` formata o `Date` com `Utilities.formatDate(v, 'America/Sao_Paulo', …)`, um fuso **diferente** do da planilha.
4. Em 1899 os deslocamentos eram:
   - São Paulo: hora média local de **−3h06min28s**;
   - Los Angeles: **−8h00** (sem horário de verão).

   Diferença: **+4h53min32s**.
5. `legado.celula_hora` guarda só `HH:MM` (`substr(…, 12, 5)`) e descarta os 32 s. Resultado: **07:00 vira 11:53** e 08:00 vira 12:53.

**Confiança: ALTA.** Duas provas independentes, ambas [C]:
- **Prova A (hora):** a correção exata de −4h53min32s leva **269 de 269** horários para minutos redondos de 10 em 10 (00, 10, 20, 30, 40, 50) e para a faixa 07:10–21:30 (exceto 2 linhas que viram 00:30, dado suspeito na origem). Concordância com o painel de salas: **92%**.
- **Prova B (datas, outro conjunto):** nas datas da aba Atendimentos (mesmo serializador), a meia-noite chega como **04:00** nos meses de horário de verão dos EUA e como **05:00** nos meses de inverno dos EUA. São exatamente as diferenças Los Angeles × São Paulo atuais (−7 e −8 contra −3). Em todas as planilhas com hora 05:00, **100% dessas linhas** caem nos meses de inverno dos EUA.

**O que NÃO é a causa:**
- O banco: `TimeZone = UTC`, mas a coluna é `text` e não há conversão.
- O parsing SQL: `celula_hora` só recorta o texto.
- O painel de salas: usa `getDisplayValues()` e chega correto ("07:00").

**Limitação declarada:** não abri as configurações das planilhas (Arquivo → Configurações → Fuso horário). O fuso do Pacífico é deduzido pelas provas A e B, não visto. [EI quanto ao nome exato do fuso; C quanto ao efeito]

**Por que −4h53 NÃO pode virar constante:**
- O deslocamento depende do fuso **de cada planilha**. Uma planilha em `America/Sao_Paulo` teria deslocamento zero.
- Ele só existe quando a célula é **Date**. Em `legado.cancelados`, **13 de 325** horários não terminam em 3: foram digitados como texto e já estão **corretos**. Uma constante os estragaria.
- Depois que o horário vira texto, o banco **não sabe mais** se a célula era Date ou texto.

## 2. Cadeia de transformação

```
Célula da aba Agenda (hora 07:00, tipo Date; fuso da planilha = Pacífico)
  → getValues(): Date = 1899-12-30 07:00 PST = 1899-12-30 15:00 UTC
  → syncNormalizarCelula_: formatDate(…, 'America/Sao_Paulo') = "1899-12-30T11:53:32"   ← ERRO (fuso diferente + LMT 1899)
  → JSON {"$date": "1899-12-30T11:53:32"}
  → legacy_ingest_agenda → legado.celula_hora: substr(12,5) = "11:53"               ← perde os segundos
  → legado.agenda.horario = '11:53' (text)
  → consumo: BI (migration 024), ENTREGA-003, futuro feed do site
```

Mesma cadeia para `legado.cancelados.horario` (coluna C).

Datas da aba Atendimentos: o deslocamento afeta só a **hora** do `$date` (04:00/05:00). A **data** continua certa, porque a meia-noite do Pacífico ainda é o mesmo dia em São Paulo, e `celula_data` usa só os 10 primeiros caracteres. **O motor financeiro não é afetado pelo DATA-01.** [C] Ressalva: colunas de data **com hora** (ex.: `Timestamp`) ficariam deslocadas 4–5 h; hoje não são usadas como data de sessão. [EI]

## 3. Amostra sanitizada

| Armazenado | + 32 s − 4h53min32s | Esperado (grade 50 min) | Ocorrências |
|---|---|---|---|
| 11:53 | 07:00 | 07:00 | 0 (nenhuma agenda começa às 07:00 neste espelho) |
| 12:03 | 07:10 | — | 2 |
| 12:53 | 08:00 | 08:00 | 17 |
| 13:43 | 08:50 | 08:00 + 50 min | 16 |
| 14:33 | 09:40 | 08:50 + 50 min | 17 |
| 23:53 | 19:00 | — | 5 |
| 02:23 | 21:30 | último horário do dia | 1 |
| 05:23 | 00:30 | **inválido** (fora do expediente) | 2 → dado de origem a verificar |

| Distribuição após a correção | Valor |
|---|---|
| Minutos | :00 76 · :10 25 · :20 38 · :30 46 · :40 42 · :50 42 (100% em múltiplos de 10) |
| Faixa | 07:10–21:30 (267 linhas) + 2 inválidas |
| Painel de salas (getDisplayValues) | "07:00"…"21:00": já correto, nenhum ajuste |

**Prova B, por planilha** (índices anônimos; contagem da hora da data de sessão):

| Planilha | 04:00 (verão EUA) | 05:00 (inverno EUA) | 00:00 | Leitura |
|---|---|---|---|---|
| 2 | 192 | 49 | 28 | Pacífico (04/05) + datas gravadas por script (00:00) |
| 3 | 139 | 128 | 0 | Pacífico |
| 6 | 246 | 78 | 0 | Pacífico |
| 14 | 597 | 517 | 110 | Pacífico |
| 16, 19 | 0 | 0 | 14 / 11 | Inconclusivo para datas; **agenda dessas planilhas também deslocada** → Pacífico |

As linhas 00:00 são datas gravadas por script (o instante é preservado, então o resultado sai certo). As linhas 04:00/05:00 são datas digitadas, interpretadas no fuso da planilha. [H coerente com C]

## 4. Especificação das views (desenho; nada criado)

### 4.1 `legado.vw_agenda_normalizada` (camada de transição, não é fonte da verdade)

**Pré-requisito obrigatório:** correção A (seção 5) aplicada e um ciclo de sync completo. **Sem constante de fuso dentro da view.**

| Campo | Tipo | Origem / regra |
|---|---|---|
| `tenant_id` | uuid | `legado.planilhas.tenant_id` |
| `planilha_ref` | text | `spreadsheet_id` (**interno**, nunca exposto ao público) |
| `profissional_curto` | text | `planilhas.nome_abreviado` |
| `profissional_ativo` | bool | `planilhas.ativo and not desligada` |
| `linha_origem` | int | `agenda.linha` |
| `weekday` | int2 | `dia` → 1=segunda…6=sábado (0=domingo), por tabela fixa PT-BR; desconhecido → nulo + flag |
| `start_time` | time | `horario::time` **já corrigido na origem** |
| `duration_min` | int2 | Duração **inferida**: cadência modal da própria agenda (30–90 min). Se não houver, nulo + flag (**sem assumir 50**) |
| `end_time` | time | `start_time + duration_min` |
| `tipo` | text | `PACIENTE` / `LIVRE` / `BLOQUEADO` / `INDETERMINADO` (já calculado na ingestão) |
| `sala_norm` | text | `upper(regexp_replace(trim(sala), '\s+', ' ', 'g'))`; `ONLINE` à parte |
| `room_ref` | uuid | Casamento `sala_norm` → `public.rooms` (nulo enquanto `rooms` vazia) |
| `plano_norm` | text | De-para de rótulo (unimed, bradesco, select, celos, geap, saúdesc → plano; particular → `PARTICULAR`; sublocação → `SUBLOCACAO`) |
| `insurance_plan_id` | uuid | De-para → `public.insurance_plans` (tabela de-para pequena ou `CASE`; **decisão de implementação**) |
| `inicio` | date | `agenda.inicio` |
| `paciente_presente` | bool | `paciente is not null` (**o nome do paciente não sai da view pública**; a view interna pode tê-lo, protegida por RLS do dono) |
| `qualidade` | text[] | Flags: `HORA_FORA_EXPEDIENTE`, `DUPLICADO_PROF_HORARIO`, `SALA_DESCONHECIDA`, `PLANO_DESCONHECIDO`, `SEM_INICIO`, `DURACAO_INFERIDA`, `SUBLOCACAO` |
| `sincronizado_em` | timestamptz | `agenda.sincronizado_em` |

Regras:
- Somente leitura.
- `security_invoker = on`; acesso só para `has_finance_access()` ou para o dono.
- Nenhuma escrita, nenhum `INSERT … SELECT` a partir dela.

### 4.2 `legado.vw_room_blocks` (derivada do painel, não persistida)

Gaps-and-islands sobre `legado.salas_painel` × `legado.salas_meta.cabecalho`:

1. Explodir `celulas[2..]` em (dia, hora, coluna → nome da sala, ocupante).
2. Normalizar o ocupante: casa com `planilhas.nome_abreviado` → profissional; contém "livre"/💚 → `LIVRE`; senão → `DESCONHECIDO`.
3. `grupo = row_number() over (sala, dia order by hora) − row_number() over (sala, dia, ocupante order by hora)`.
4. Bloco = `min(hora)` até `max(hora) + 1 h` por (sala, dia, ocupante, grupo).

| Campo | Tipo | Regra |
|---|---|---|
| `tenant_id` | uuid | Tenant interno (o painel não tem tenant: constante do tenant Hope, documentada) |
| `sala_norm` | text | Cabeçalho normalizado |
| `room_ref` | uuid | → `public.rooms` (nulo enquanto vazia) |
| `weekday` | int2 | Como em 4.1 |
| `ocupante_tipo` | text | `PROFISSIONAL` / `LIVRE` / `DESCONHECIDO` |
| `planilha_ref` | text | Interno; nulo se não for profissional |
| `bloco_inicio` / `bloco_fim` | time | Fim **exclusivo** |
| `origem` | text | `'salas_painel'` |
| `confianca` | text | `ALTA` (casou com nome exato), `MEDIA` (casou por "contém"), `BAIXA` (desconhecido) |
| `sincronizado_em` | timestamptz | `salas_meta.sincronizado_em` |

Validação esperada:
- 415 células → ≈ 94 ilhas (contagem da ENTREGA-003);
- 215 células de profissional com `confianca = ALTA`;
- nenhuma ilha sobreposta na mesma sala e dia (por construção).

### 4.3 `public.fn_disponibilidade_publica(p_de date, p_ate date)` (função, não view)

Função em vez de view: recebe o período, aplica as exceções por data e devolve só colunas públicas.

```
slots_candidatos  = para cada bloco PROFISSIONAL (4.2) e cada data do período com o mesmo weekday:
                    gerar slots de duration_min(profissional), alinhados à grade da própria agenda (4.1),
                    que caibam inteiros no bloco (slot_fim ≤ bloco_fim)
ocupados          = linhas de 4.1 com tipo PACIENTE/BLOQUEADO do mesmo profissional e weekday
                    cuja faixa [start,end) sobrepõe o slot
                    + (futuro) appointments datados/exceções
bloqueios         = professional_availability_blocks cobrindo a data
                    + profissional inativo/desligado
disponível        = slots_candidatos − ocupados − bloqueios
```

| Coluna de saída | Regra |
|---|---|
| `profissional_publico` | Identificador público estável e **opaco** (ex.: slug ou id público do especialista no site), **nunca** `spreadsheet_id` nem uuid interno |
| `data` | date |
| `inicio` / `fim` | time (fim = início + duração variável 50/60) |
| `turno` | Manhã (< 12h) / tarde (12–18h) / noite (≥ 18h) — limites **parametrizados**, não fixos no código |
| `modalidade` | presencial / online |
| `atualizado_em` | Último `sincronizado_em` usado |

Requisitos:
- zero PII: nada de paciente, plano, valor ou sala exata (só a modalidade);
- `SECURITY DEFINER` com `search_path` fixo e colunas mínimas;
- concedida a `anon` **só quando** uma ordem publicar a API;
- conferência com o legado: os slots devolvidos devem bater com as linhas `LIVRE` da agenda. Toda divergência é listada, e nada é corrigido automaticamente.

## 5. Plano de correção (não executado)

| Etapa | Ação | Detalhe |
|---|---|---|
| **A. Causa na origem** | Corrigir o `SyncSupabase.gs` | Preferido: formatar `Date` no **fuso da própria planilha**: `Utilities.formatDate(v, planilha.getSpreadsheetTimeZone(), …)`, passando o fuso para `syncNormalizarCelula_`. Isso reproduz o que a psicóloga vê, em qualquer fuso. Alternativa local: `getDisplayValues()` só para a coluna de horário (como já faz o painel). **Não** mudar o fuso das planilhas (efeito colateral em datas com hora e fórmulas `NOW()`) |
| **B. Legado contaminado** | Reprocessar pelo próprio sync | `legacy_ingest_agenda` **apaga e regrava** agenda e cancelados de cada planilha a cada execução. Após A, **um ciclo de sync** substitui todos os horários. **Nenhum UPDATE em SQL, nenhuma constante.** `atendimentos_raw` não precisa de reprocesso para a data. Colunas data+hora: avaliar à parte |
| **C. Validação antes/depois** | Consultas de aceite | Antes (registrar): % de horários com minuto final 3 (agenda 100%; cancelados 312/325). Depois: **0%** com minuto final 3 vindo de célula Date; 100% dos minutos em múltiplos de 5; faixa 07:00–22:00; concordância agenda × painel ≥ 90% no horário exato; os 13 horários-texto de cancelados **inalterados**; contagens por planilha iguais às de antes |
| **D. Rollback** | Reverter o `.gs` | Restaurar a versão anterior do `SyncSupabase.gs` (está versionado em `sync/apps-script/`) e rodar um ciclo de sync. Nenhum dado fica perdido: a origem é a planilha |
| **E. Observabilidade** | Alerta de regressão | 1) No `legacy_ingest_agenda`, contar `$date` de hora cujo segundo ≠ 00 (o "32 s" denuncia fuso divergente) e devolver no JSON de resposta; 2) gravar em `legado.sync_log` um aviso por planilha quando isso ocorrer; 3) teste SQL no padrão dos testes do motor: falha se algum `horario` terminar fora de múltiplos de 5 |

Ordem segura: A → um ciclo manual com `testarAgendaSalasSupabase` em **uma** planilha → C nessa planilha → ciclo geral → C completo → E.

## 6. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R1 | Aplicar −4h53 em SQL estragaria os horários digitados como texto (13 em cancelados) e qualquer planilha em fuso de SP | Proibido; corrigir só na origem (A) |
| R2 | Outra planilha com fuso diferente do Pacífico (ex.: −5) daria outro deslocamento | A correção pelo fuso da própria planilha cobre qualquer fuso |
| R3 | BI (migration 024) e relatórios já leram horários deslocados | Após B, os relatórios passam a ler o correto automaticamente; avisar quem usou os números de turno |
| R4 | Corrigir o sync afeta outras colunas Date com hora (ex.: Timestamp) | O efeito é corrigi-las também; validar em C que só datas puras são usadas pelo motor (`celula_data` usa só a data) |
| R5 | 2 linhas viram 00:30 após a correção | Dado inválido na origem: listar para revisão humana, sem tratamento automático |
| R6 | Duração inferida errada para agendas com cadência mista (1 planilha) | Flag `DURACAO_INFERIDA` + decisão 50×60 |
| R7 | Exposição de identificador interno no feed | Só `profissional_publico` opaco na função pública |

## 7. Decisões pendentes — `PENDENTE — DECISÃO DE JORGE` (não bloqueiam)

1. Duração 50 × 60 min (padrão por profissional ou universal).
2. Sublocação na agenda da psicóloga: atendimento, bloqueio de sala ou fora da agenda clínica?
3. Falta × "sem comparecimento justificado": precisam ficar distintos?
4. Motivo de encerramento (alta, desistência, transferência): passar a registrar?
5. (Novo, técnico-operacional) Pode-se conferir em **uma** planilha de psicóloga, em Arquivo → Configurações, se o fuso é "(GMT-08:00) Pacific Time"? Isso fecha o único [EI] da causa raiz. Não é obrigatório para seguir.

## 8. Recomendação para a ORDEM-005

**ORDEM-005 (sugestão): AGENDA-FIX-01 — Correção do fuso no SyncSupabase. Classificação: IMPLEMENTAÇÃO AUTORIZADA restrita, com confirmação de Jorge.**

Escopo mínimo:
1. Alterar só `syncNormalizarCelula_`/`syncEnviarAgendaCancelados_` para formatar no fuso da planilha (etapa A).
2. Ciclo piloto em 1 planilha → validação C → ciclo geral → validação C completa.
3. Observabilidade E (contador de segundos ≠ 00 na resposta da RPC).

Fora do escopo:
- views 4.1–4.3 (ordem seguinte, de PROPOSTA/IMPLEMENTAÇÃO, depois da correção);
- `appointments`/`sessions`;
- FIN_MOTOR;
- site/API.

Se o CX preferir não implementar ainda: uma ORDEM-005 de **PROPOSTA** com o diff do `.gs` em branch, sem publicar no Apps Script.

## Testes executados

| Teste | Resultado |
|---|---|
| Leitura do `SyncSupabase.gs` (`main`) | `getValues()` + `formatDate(…, 'America/Sao_Paulo')` para a Agenda; `getDisplayValues()` para o painel |
| Definições `legacy_ingest_agenda`, `celula_hora`, `celula_data`, `classificar_agenda` | Nenhuma conversão de fuso no banco; `celula_hora` recorta HH:MM |
| `TimeZone` do banco | UTC (irrelevante: a coluna é texto) |
| Offset SP em 1899 (Postgres tzdata) | −03:06:28 |
| Correção exata −4h53min32s | 269/269 em múltiplos de 10 min; 267 na faixa 07:10–21:30 |
| Datas de Atendimentos × horário de verão dos EUA | 04:00 ↔ verão EUA; 05:00 ↔ inverno EUA (100% das linhas 05:00) |
| Cancelados: horário digitado como texto | 13/325 sem deslocamento |

## Rollback

Não aplicável: só este arquivo e o `00-STATUS-ATUAL.md`.

## Critérios de aceite

- [x] 1. Causa raiz com nível de confiança (ALTA; 1 ponto EI declarado)
- [x] 2. Cadeia de transformação ponta a ponta
- [x] 3. Amostra sanitizada + prova independente
- [x] 4. Especificação de `vw_agenda_normalizada`, `vw_room_blocks` e da função de disponibilidade
- [x] 5. Plano A–E com rollback
- [x] 6. Riscos
- [x] 7. Pendências de Jorge sem decidir por ele
- [x] 8. Recomendação para a ORDEM-005
- [x] Nenhuma constante mágica cristalizada

## Próxima ação

**ENTREGA-004 disponível — aguardando revisão do Orquestrador CX.**
