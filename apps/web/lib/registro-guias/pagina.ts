// ================================================================
// Página "Registro de Guias" do HOPE CORE = Index.html ORIGINAL do
// ADM Registro de Guia (mesmo layout, mesmas telas, mesmo JavaScript),
// com dois acréscimos injetados — nenhuma linha do original é removida:
//
//  1) SHIM: recria "google.script.run" do Apps Script. Cada chamada do
//     Index.html vai para /financeiro/guias/api, que confere o login do
//     financeiro e repassa ao Code.gs original (PonteRegistroGuias.gs).
//  2) EXTENSÃO: mostra ao lado de cada guia o que a Unimed fez com ela
//     (XMLs importados), destaca divergências, links de volta ao
//     financeiro e abertura direta por ?planilha=ID&mes=M&ano=A&guia=G.
// ================================================================
import { API_REGISTRO } from './funcoes'

export const SHIM_SCRIPT = String.raw`<script>
/* HOPE CORE — substitui google.script.run (Apps Script) por chamadas à API do HOPE CORE */
(function () {
  var API = '__HOPE_API__';
  function executar(nome, args, ok, falha) {
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ fn: nome, args: args })
    })
      .then(function (r) {
        return r.json().catch(function () { return { erro: 'Resposta inválida do servidor (' + r.status + ')' }; });
      })
      .then(function (j) {
        if (j && j.aviso && typeof window.mostrarMensagem === 'function') window.mostrarMensagem('⚠️ ' + j.aviso, 'warning');
        if (j && Object.prototype.hasOwnProperty.call(j, 'resultado')) {
          if (ok) ok(j.resultado);
        } else {
          var msg = (j && j.erro) || 'Erro desconhecido';
          if (falha) falha(msg);
          else {
            console.error('[HOPE] ' + nome + ': ' + msg);
            if (typeof window.mostrarMensagem === 'function') window.mostrarMensagem('❌ ' + msg, 'error');
          }
        }
      })
      .catch(function (e) {
        var msg = (e && e.message) || String(e);
        if (falha) falha(msg);
        else console.error('[HOPE] ' + nome + ': ' + msg);
      });
  }
  function runner(ok, falha) {
    return new Proxy({}, {
      get: function (_alvo, nome) {
        if (nome === 'withSuccessHandler') return function (h) { return runner(h, falha); };
        if (nome === 'withFailureHandler') return function (h) { return runner(ok, h); };
        if (nome === 'withUserObject') return function () { return runner(ok, falha); };
        if (typeof nome !== 'string') return undefined;
        return function () { executar(nome, Array.prototype.slice.call(arguments), ok, falha); };
      }
    });
  }
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = runner(null, null);
})();
</script>`.replace('__HOPE_API__', API_REGISTRO)

export const EXTENSAO_SCRIPT = String.raw`<style>
.hope-nav { color: #fff; text-decoration: none; font-weight: 700; font-size: 0.82rem; padding: 7px 12px; border-radius: 8px; background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.25); white-space: nowrap; }
.hope-nav:hover { background: rgba(255,255,255,0.25); }
.hope-unimed { font-size: 0.6rem; font-weight: 800; display: block; margin-top: 2px; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; padding: 2px 4px; border-radius: 4px; letter-spacing: 0.3px; text-transform: uppercase; cursor: help; }
.hope-pago { color: #065f46; background: #ecfdf5; border: 1px solid #10b981; }
.hope-parcial { color: #92400e; background: #fef3c7; border: 1px solid #f59e0b; }
.hope-glosa { color: #fff; background: #dc2626; border: 1px solid #b91c1c; }
.hope-aguardando { color: #64748b; background: #f1f5f9; border: 1px dashed #94a3b8; }
.hope-diverg .input-guia { box-shadow: 0 0 0 3px #dc2626 !important; }
.hope-diverg .hope-unimed::before { content: '⚠ '; }
.hope-destaque .input-guia { outline: 3px solid #7c3aed; outline-offset: 2px; }
.hope-legenda { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 0.7rem; font-weight: 700; text-transform: none; letter-spacing: 0; }
.hope-legenda .hope-unimed { display: inline-block; width: auto; margin: 0; cursor: default; }
.hope-unimed-modal { margin-bottom: 12px; padding: 12px 14px; border-radius: 10px; font-size: 0.85rem; line-height: 1.45; border: 1.5px solid #cbd5e1; background: #fff; }
.hope-unimed-modal b { color: #1e3a8a; }
</style>
<script>
/* HOPE CORE — cruzamento com os demonstrativos da Unimed (XML TISS importados) */
(function () {
  var HOPE_UNIMED = {};
  var HOPE_CONSULTADAS = {};
  var HOPE_DESTACAR = '';
  var timer = null;

  function fmt(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','); }

  function classificar(info) {
    if (!info) return { cls: 'aguardando', txt: 'Aguardando' };
    var lib = Number(info.liberado || 0), glo = Number(info.glosado || 0);
    if (glo > 0 && lib <= 0) return { cls: 'glosa', txt: 'Glosa ' + (info.codigos_glosa || '') };
    if (glo > 0) return { cls: 'parcial', txt: 'Parcial ' + fmt(lib) };
    return { cls: 'pago', txt: '✓ Pago ' + fmt(lib) };
  }

  // Mesmas regras de public.guia_divergencias() no banco
  function divergencia(status, info) {
    if (!info) return '';
    var lib = Number(info.liberado || 0), glo = Number(info.glosado || 0);
    if (status === 'FALTA') return 'FALTA na planilha, mas a guia foi faturada';
    if (status === 'FATURADA' && glo > 0) return 'OK na planilha, mas a Unimed glosou ' + fmt(glo);
    if (status !== 'FATURADA' && lib > 0) return 'A Unimed pagou ' + fmt(lib) + ', mas a planilha não tem OK';
    return '';
  }

  function detalhe(info) {
    if (!info) return 'Ainda não apareceu em nenhum demonstrativo importado.';
    return 'Demonstrativo(s): ' + (info.demonstrativos || '-') +
      '\nSessões (data): ' + (info.datas_sessao || '-') +
      '\nInformado ' + fmt(info.informado) + ' | Liberado ' + fmt(info.liberado) + ' | Glosado ' + fmt(info.glosado) +
      (info.codigos_glosa ? '\nCódigo(s) de glosa: ' + info.codigos_glosa : '');
  }

  function pintar() {
    var destacado = null;
    document.querySelectorAll('.input-guia').forEach(function (input) {
      var cont = input.closest('.input-group');
      if (!cont) return;
      var velho = cont.querySelector('.hope-unimed');
      if (velho) velho.remove();
      cont.classList.remove('hope-diverg');
      cont.classList.remove('hope-destaque');
      var val = input.value.trim();
      if (!val || val.length < 5 || !HOPE_CONSULTADAS[val]) return;
      var info = HOPE_UNIMED[val];
      var c = classificar(info);
      var status = (window.CACHE_STATUS || {})[val] || 'REGISTRADA';
      var dv = divergencia(status, info);
      var tag = document.createElement('span');
      tag.className = 'hope-unimed hope-' + c.cls;
      tag.textContent = c.txt;
      tag.title = (dv ? '⚠ DIVERGÊNCIA: ' + dv + '\n\n' : '') + detalhe(info);
      var ind = cont.querySelector('.saving-indicator');
      if (ind) cont.insertBefore(tag, ind); else cont.appendChild(tag);
      if (dv) cont.classList.add('hope-diverg');
      if (HOPE_DESTACAR && val === HOPE_DESTACAR) { cont.classList.add('hope-destaque'); destacado = destacado || input; }
    });
    if (destacado) { destacado.scrollIntoView({ block: 'center', behavior: 'smooth' }); HOPE_DESTACAR = ''; }
  }

  function atualizar() {
    var guias = {};
    document.querySelectorAll('.input-guia').forEach(function (input) {
      var v = input.value.trim();
      if (v && v.length >= 5) guias[v] = true;
    });
    var lista = Object.keys(guias);
    if (!lista.length) { pintar(); return; }
    google.script.run
      .withSuccessHandler(function (linhas) {
        (linhas || []).forEach(function (r) { HOPE_UNIMED[r.guia] = r; });
        lista.forEach(function (g) { HOPE_CONSULTADAS[g] = true; });
        pintar();
      })
      .withFailureHandler(function (e) { console.warn('[HOPE] Unimed: ' + e); })
      .hopeUnimedStatus(lista);
  }
  window.hopeUnimedAtualizar = atualizar;

  // --- ganchos nas funções do Index.html original (sem alterá-las) ---
  var renderOriginal = window.renderizarTabela;
  renderizarTabela = function (pacientes) { renderOriginal(pacientes); atualizar(); };

  var cacheOriginal = window.atualizarCacheEVisual;
  atualizarCacheEVisual = function (guia, res) { var r = cacheOriginal(guia, res); pintar(); quadroModal(); return r; };

  // Quadro "Unimed" no topo da janela da guia (duplo clique)
  function quadroModal() {
    var guia = window.guiaGlobalAtual;
    var list = document.getElementById('sessoesList');
    var aberto = document.getElementById('modalContainer');
    if (!guia || !list || !aberto || aberto.style.display === 'none') return;
    var montar = function (info) {
      if (window.guiaGlobalAtual !== guia) return;
      var velho = list.querySelector('.hope-unimed-modal');
      if (velho) velho.remove();
      var box = document.createElement('div');
      box.className = 'hope-unimed-modal';
      var c = classificar(info);
      var dv = divergencia((window.CACHE_STATUS || {})[guia] || 'REGISTRADA', info);
      box.innerHTML = '<b>Unimed:</b> <span class="hope-unimed hope-' + c.cls + '" style="display:inline-block;width:auto;">' + c.txt + '</span>' +
        (dv ? '<div style="color:#dc2626;font-weight:800;margin-top:6px;">⚠ ' + dv + '</div>' : '') +
        '<div style="white-space:pre-line;color:#475569;margin-top:6px;font-size:0.8rem;"></div>';
      box.lastChild.textContent = detalhe(info);
      list.insertBefore(box, list.firstChild);
    };
    if (HOPE_CONSULTADAS[guia]) { montar(HOPE_UNIMED[guia]); return; }
    google.script.run.withSuccessHandler(function (linhas) {
      (linhas || []).forEach(function (r) { HOPE_UNIMED[r.guia] = r; });
      HOPE_CONSULTADAS[guia] = true;
      montar(HOPE_UNIMED[guia]);
    }).hopeUnimedStatus([guia]);
  }

  var detalhesOriginal = window.renderizarDetalhesModal;
  renderizarDetalhesModal = function (detalhes) {
    detalhesOriginal(detalhes);
    quadroModal();
  };

  // guia digitada/alterada → consulta de novo
  document.addEventListener('change', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('input-guia')) {
      clearTimeout(timer);
      timer = setTimeout(atualizar, 800);
    }
  });

  // --- navegação e legenda ---
  var topo = document.querySelector('.topbar-right');
  if (topo) {
    var nav = document.createElement('div');
    nav.style.display = 'flex';
    nav.style.gap = '8px';
    nav.innerHTML = '<a class="hope-nav" href="/financeiro">← Financeiro</a><a class="hope-nav" href="/financeiro/divergencias">Divergências</a>';
    topo.insertBefore(nav, topo.firstChild);
  }
  var cab = document.querySelector('#cardDados .card-header');
  if (cab) {
    var leg = document.createElement('div');
    leg.className = 'hope-legenda';
    leg.innerHTML = '<span style="color:#fff;">Unimed:</span><span class="hope-unimed hope-pago">✓ pago</span><span class="hope-unimed hope-parcial">parcial</span>' +
      '<span class="hope-unimed hope-glosa">glosa</span><span class="hope-unimed hope-aguardando">aguardando</span>' +
      '<span style="border:3px solid #dc2626;border-radius:6px;padding:0 6px;">divergência</span>';
    cab.appendChild(leg);
  }

  // --- abrir direto: ?planilha=ID&mes=9&ano=2026&guia=123 ---
  function esperar(cond, fazer, tentativas) {
    if (cond()) { fazer(); return; }
    if ((tentativas || 0) > 150) return;
    setTimeout(function () { esperar(cond, fazer, (tentativas || 0) + 1); }, 200);
  }
  var q = new URLSearchParams(location.search);
  var planilha = q.get('planilha');
  if (planilha) {
    HOPE_DESTACAR = q.get('guia') || '';
    var selPsi = document.getElementById('selectPsicologa');
    esperar(function () { return selPsi.options.length > 1; }, function () {
      google.script.run.withSuccessHandler(function (mapa) {
        var alvo = (mapa || []).filter(function (m) { return m.id === planilha; })[0];
        var existe = alvo && Array.prototype.some.call(selPsi.options, function (o) { return o.value === alvo.nome; });
        if (!existe) { mostrarMensagem('Psicóloga desta guia não está na aba ID do Registro de Guia.', 'warning'); return; }
        selPsi.value = alvo.nome;
        if (q.get('mes')) document.getElementById('selectMes').value = String(Number(q.get('mes')));
        if (q.get('ano')) document.getElementById('selectAno').value = q.get('ano');
        atualizarListaPacientes();
        var selPac = document.getElementById('selectPaciente');
        esperar(function () { return selPac.options.length > 0 && selPac.options[0].value === 'todos'; }, function () { buscarDados(); });
      }).hopeMapaPsicologas();
    });
  }
})();
</script>`

/** Monta a página: original + shim (antes de tudo) + extensão (depois do script original). */
export function montarPagina(original: string): string {
  const iHead = original.search(/<head[^>]*>/i)
  if (iHead < 0) throw new Error('Index.html original sem <head>')
  const fimHead = original.indexOf('>', iHead) + 1
  const iBody = original.toLowerCase().lastIndexOf('</body>')
  if (iBody < 0) throw new Error('Index.html original sem </body>')
  return (
    original.slice(0, fimHead) +
    '\n' + SHIM_SCRIPT + '\n' +
    original.slice(fimHead, iBody) +
    EXTENSAO_SCRIPT + '\n' +
    original.slice(iBody)
  )
}
