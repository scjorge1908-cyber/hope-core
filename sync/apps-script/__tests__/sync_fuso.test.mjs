// Teste do DATA-01 (ORDEM-005 A) — roda com: node --test sync/apps-script/__tests__/
// Carrega o SyncSupabase.gs real num sandbox com um Utilities.formatDate
// equivalente ao do Apps Script (Intl + tzdata, que inclui o LMT de 1899).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fonte = readFileSync(new URL('../SyncSupabase.gs', import.meta.url), 'utf8');

function formatDate(d, tz, padrao) {
  assert.equal(padrao, "yyyy-MM-dd'T'HH:mm:ss");
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
const ctx = { Utilities: { formatDate }, console };
vm.createContext(ctx);
vm.runInContext(fonte, ctx);
// Datas criadas DENTRO do sandbox (o "instanceof Date" do .gs usa o Date do sandbox)
const utc = (...a) => vm.runInContext(`new Date(Date.UTC(${a.join(',')}))`, ctx);
const invalida = () => vm.runInContext('new Date(NaN)', ctx);
const antigo = v => ctx.syncNormalizarCelula_(v);
const novo = (v, fuso) => ctx.syncNormalizarCelulaNoFuso_(v, fuso);
const celulaHora = j => (j && j.$date ? j.$date.substr(11, 5) : j); // = legado.celula_hora

// Célula "07:00" numa planilha em America/Los_Angeles = 1899-12-30 07:00 PST = 15:00 UTC
const horaLA = utc(1899, 11, 30, 15, 0, 0);
// Mesma célula numa planilha em America/Sao_Paulo = 07:00 LMT (−3:06:28) = 10:06:28 UTC
const horaSP = utc(1899, 11, 30, 10, 6, 28);

test('reproduz o defeito DATA-01 no código atual (fuso fixo)', () => {
  assert.equal(antigo(horaLA).$date, '1899-12-30T11:53:32');
  assert.equal(celulaHora(antigo(horaLA)), '11:53');
});

test('corrige usando o fuso da própria planilha (Pacífico)', () => {
  assert.equal(novo(horaLA, 'America/Los_Angeles').$date, '1899-12-30T07:00:00');
  assert.equal(celulaHora(novo(horaLA, 'America/Los_Angeles')), '07:00');
});

test('planilha já em São Paulo: antes e depois iguais (sem regressão)', () => {
  assert.equal(antigo(horaSP).$date, '1899-12-30T07:00:00');
  assert.equal(novo(horaSP, 'America/Sao_Paulo').$date, '1899-12-30T07:00:00');
});

test('grade de 50 min inteira volta exata (sem constante)', () => {
  for (const [h, m] of [[7, 0], [8, 0], [8, 50], [9, 40], [13, 10], [19, 0], [21, 30]]) {
    const d = utc(1899, 11, 30, h + 8, m, 0); // PST = UTC−8
    const esperado = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    assert.equal(celulaHora(novo(d, 'America/Los_Angeles')), esperado);
  }
});

test('texto, número, booleano e vazio passam inalterados', () => {
  for (const v of ['07:00', ' 08:50 ', 'livre 💚', 42, 0, true, false]) {
    assert.deepEqual(novo(v, 'America/Los_Angeles'), antigo(v));
  }
  assert.equal(novo(null, 'America/Los_Angeles'), '');
  assert.equal(novo(undefined, 'America/Los_Angeles'), '');
  assert.equal(novo(invalida(), 'America/Los_Angeles'), '');
});

test('datas (início/cancelamento) mantêm o mesmo dia', () => {
  // meia-noite de 10/03/2026 numa planilha no Pacífico (PDT, UTC−7)
  const d = utc(2026, 2, 10, 7, 0, 0);
  assert.equal(antigo(d).$date.slice(0, 10), '2026-03-10');                       // antes: 04:00 SP
  assert.equal(novo(d, 'America/Los_Angeles').$date, '2026-03-10T00:00:00');      // depois: meia-noite
});

test('sem fuso informado cai no fuso padrão do script', () => {
  assert.deepEqual(novo(horaSP, ''), antigo(horaSP));
});

test('nenhuma constante de deslocamento no código (comentários ignorados)', () => {
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(codigo, /4\s*h\s*53|04:53|17612|293\.?5?\s*min|4\s*\*\s*3600/i);
});

test('Atendimentos continuam usando syncNormalizarCelula_ (repasse inalterado)', () => {
  assert.match(fonte, /valores\[i\]\.map\(syncNormalizarCelula_\)/);
  assert.match(fonte, /syncNormalizarCelulaNoFuso_\(k < r\.length \? r\[k\] : '', fusoPlanilha\)/);
});
