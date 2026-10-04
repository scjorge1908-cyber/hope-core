#!/usr/bin/env python3
"""Cálculo INDEPENDENTE (Python, sem SQL) das ilhas do painel da fixture.
Emite SQL que compara o resultado com legado.vw_room_blocks (diferença nos 2 sentidos = 0)."""
import json, re
DIAS = {'Domingo': 0, 'Segunda': 1, 'Terça': 2, 'Quarta': 3, 'Quinta': 4, 'Sexta': 5, 'Sábado': 6}
fix = open('01_fixture_anonimizada.sql', encoding='utf-8').read()
meta = json.loads(re.search(r"salas_meta \(id, cabecalho\) values \(true, '(.*?)'::jsonb", fix).group(1))
linhas = [json.loads(m) for m in re.findall(r"salas_painel \(linha, celulas\) values \(\d+, '(.*?)'::jsonb", fix)]
toks = set(re.findall(r"'(P\d\d)', 'Profissional", fix))
grade = {}
for c in linhas:
    dia, hora = DIAS[c[0]], int(c[1][:2])
    for j, v in enumerate(c[2:], start=2):
        sala = ' '.join(meta[j].split()).upper()
        occ = v if v in toks else ('#LIVRE' if 'livre' in v.lower() else '#?' + v.lower())
        grade.setdefault((sala, dia), []).append((hora, occ))
ilhas = []
for (sala, dia), cel in grade.items():
    cel.sort()
    ini, prev, occ0 = None, None, None
    for h, o in cel + [(None, None)]:
        if ini is not None and (o != occ0 or h != prev + 1):
            ilhas.append((sala, dia, ini, prev + 1, occ0))
            ini = None
        if h is not None and ini is None:
            ini, occ0 = h, o
        prev = h
def ref(o): return "'TESTE_PLANILHA_%s_xxxxxxxx'" % o if o.startswith('P') else 'null'
vals = ",\n".join("(%s, %d, '%02d:00'::time, '%02d:00'::time, %s)" % ("'" + s + "'", d, a, b, ref(o)) for s, d, a, b, o in ilhas)
print(f"""create temporary table _esperado (sala_norm text, weekday int, ini time, fim time, planilha_ref text);
insert into _esperado values
{vals};
do $$
declare a int; b int; t int;
begin
  select count(*) into t from _esperado;
  select count(*) into a from (select sala_norm, weekday, ini, fim, planilha_ref from _esperado
                               except select sala_norm, weekday, bloco_inicio, bloco_fim, planilha_ref from legado.vw_room_blocks) x;
  select count(*) into b from (select sala_norm, weekday, bloco_inicio, bloco_fim, planilha_ref from legado.vw_room_blocks
                               except select sala_norm, weekday, ini, fim, planilha_ref from _esperado) x;
  if a <> 0 or b <> 0 then raise exception 'E1: view difere do cálculo independente (faltam %, sobram %)', a, b; end if;
  raise notice 'E1 OK: view = cálculo independente em Python (% ilhas)', t;
end $$;""")
