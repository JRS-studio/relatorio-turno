/* Relatório de Turno: lógica do app.
   Cada aparelho guarda tudo localmente (funciona sem sinal) e sincroniza com o servidor da equipe
   (Supabase, funções rt_*). Quem tem o código da equipe lança no mesmo relatório. */
'use strict';

const VERSAO = '2.0.1';
const KEY = 'relatorio-turno.v2';

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const p2 = n => String(n).padStart(2, '0');
const hoje = () => { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
const agoraHM = () => { const d = new Date(); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const hmDe = ms => { const d = new Date(ms); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const fd = s => String(s || '').split('-').reverse().join('/');
const toMin = s => { const x = String(s || '').split(':').map(Number); return x.length === 2 && !isNaN(x[0]) && !isNaN(x[1]) ? x[0] * 60 + x[1] : null; };
const durMin = (a, b) => { const x = toMin(a), y = toMin(b); if (x == null || y == null) return null; const d = y - x; return d < 0 ? d + 1440 : d; };
const fmtDur = m => m == null ? '' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + p2(m % 60) + ' min';
const lista = s => String(s || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
const juntar = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1] : (a[0] || '');
const normEq = s => String(s || '').toLowerCase().replace(/[\s\-_.]/g, '');
const limpa = s => String(s == null ? '' : s).replace(/\*/g, '').trim();
const vivas = a => (a || []).filter(x => !x.excluido);
let toastT;
function toast(m, acao) {
  const t = $('#toast'), b = $('#toastBt'); $('#toastTx').textContent = m; t.hidden = false;
  b.hidden = !acao; b.onclick = null;
  if (acao) { b.textContent = acao.txt; b.onclick = () => { t.hidden = true; acao.fn(); }; }
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, acao ? 6000 : 2800);
}

const ESP = { ele: { nome: 'Elétrica', adj: 'elétrica', tit: 'OCORRÊNCIAS ELÉTRICAS' }, mec: { nome: 'Mecânica', adj: 'mecânica', tit: 'OCORRÊNCIAS MECÂNICAS' } };
const SIT = { resolvido: 'Resolvido', paliativo: 'Paliativo', pendente: 'Ficou pendente' };

/* ---------- Capacitor (quando existir) ---------- */
const Cap = window.Capacitor || null;
const Plug = (Cap && Cap.Plugins) || {};
const nativo = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

/* ---------- armazenamento ---------- */
const CFG_PADRAO = () => ({
  titulo: 'Relatório de Turno - Manutenção',
  areas: ['Área 1', 'Área 2', 'Área 3'],
  turnos: [{ nome: 'A', ini: '06:00', fim: '14:00' }, { nome: 'B', ini: '14:00', fim: '22:00' }, { nome: 'C', ini: '22:00', fim: '06:00' }],
  letras: ['A', 'B', 'C', 'D', 'E'],
  equipeEle: [], equipeMec: [],
  tiposEle: ['Motor', 'Sensor', 'Cabo/conexão', 'Inversor', 'CLP/automação', 'Contator/disjuntor', 'Iluminação', 'Outro'],
  tiposMec: ['Rolamento', 'Correia/roletes', 'Redutor', 'Hidráulico', 'Pneumático', 'Vazamento', 'Desgaste/estrutura', 'Outro'],
  emoji: false, ultimaLetra: '', ia: true
});
const SYNC_PADRAO = () => ({ url: '', key: '', codigo: '', equipeNome: '', nome: '', desde: 0, outbox: { turnos: [], occs: [], pends: [] }, ultimo: 0, erro: '' });
let DB = { cfg: CFG_PADRAO(), sync: SYNC_PADRAO(), turnos: {} };

function normalizaDB(d) {
  if (!d || typeof d !== 'object') throw new Error('formato');
  const c = Object.assign(CFG_PADRAO(), d.cfg || {});
  if (!Array.isArray(c.areas) || !c.areas.length) c.areas = CFG_PADRAO().areas;
  if (!Array.isArray(c.turnos) || !c.turnos.length) c.turnos = CFG_PADRAO().turnos;
  if (!Array.isArray(c.letras) || !c.letras.length) c.letras = CFG_PADRAO().letras;
  ['equipeEle', 'equipeMec', 'tiposEle', 'tiposMec'].forEach(k => { if (!Array.isArray(c[k])) c[k] = []; });
  const s = Object.assign(SYNC_PADRAO(), d.sync || {}); s.outbox = Object.assign({ turnos: [], occs: [], pends: [] }, s.outbox || {});
  const turnos = (d.turnos && typeof d.turnos === 'object') ? d.turnos : {};
  Object.values(turnos).forEach(t => { t.ocorrencias = t.ocorrencias || []; t.pendencias = t.pendencias || []; t.equipe = t.equipe || { ele: [], mec: [] }; t.prontos = t.prontos || []; t.at = t.at || t.criadoEm || 0; });
  return { cfg: c, sync: s, turnos };
}
function carregar() {
  try { const s = localStorage.getItem(KEY); if (s) DB = normalizaDB(JSON.parse(s)); } catch (e) { console.warn('dados locais ilegíveis', e); }
  const cf = window.RT_CONFIG || {};
  if (!DB.sync.url && cf.url) DB.sync.url = cf.url; if (!DB.sync.key && cf.key) DB.sync.key = cf.key;
}
async function restaurarNativo() {
  if (!Plug.Preferences || localStorage.getItem(KEY)) return;
  try { const r = await Plug.Preferences.get({ key: KEY }); if (r && r.value) { DB = normalizaDB(JSON.parse(r.value)); localStorage.setItem(KEY, r.value); renderTudo(); } } catch (e) { console.warn('preferences', e); }
}
let salvarT;
function salvar() {
  const s = JSON.stringify(DB);
  try { localStorage.setItem(KEY, s); } catch (e) { toast('Não foi possível gravar: memória cheia?'); }
  if (Plug.Preferences) { clearTimeout(salvarT); salvarT = setTimeout(() => Plug.Preferences.set({ key: KEY, value: s }).catch(() => {}), 250); }
}

/* ---------- sincronização ---------- */
const servidorOk = () => !!(DB.sync.url && DB.sync.key);
const equipeOk = () => servidorOk() && !!DB.sync.codigo && !!DB.sync.nome;
const meuNome = () => DB.sync.nome || '';
let online = navigator.onLine !== false;
window.addEventListener('online', () => { online = true; sincronizar(); }); window.addEventListener('offline', () => { online = false; renderStatus(); });

async function rpc(fn, args) {
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 20000);
  let r;
  try {
    r = await fetch(DB.sync.url.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, { method: 'POST', signal: ac.signal,
      headers: { 'Content-Type': 'application/json', apikey: DB.sync.key, Authorization: 'Bearer ' + DB.sync.key }, body: JSON.stringify(args || {}) });
  } catch (e) { throw { net: true, msg: 'Sem conexão com o servidor.' }; } finally { clearTimeout(tm); }
  let j = null; try { j = await r.json(); } catch (e) { j = null; }
  if (!r.ok) {
    const m = (j && (j.message || j.msg || j.error)) || ('HTTP ' + r.status);
    if (/codigo-invalido/.test(m)) throw { auth: true, msg: 'Código da equipe inválido.' };
    if (r.status === 401 || r.status === 403 || /api key|jwt/i.test(m)) throw { auth: true, msg: 'Chave do servidor inválida. Confira em Ajustes > Servidor.' };
    throw { srv: true, msg: 'Erro do servidor: ' + m };
  }
  return j;
}
function marcar(tipo, id) { const o = DB.sync.outbox[tipo]; if (!o.includes(id)) o.push(id); }
function turnoDe(id) { for (const t of Object.values(DB.turnos)) { if (t.ocorrencias.some(o => o.id === id) || t.pendencias.some(p => p.id === id)) return t; } return null; }
let syncT, sincronizando = false, syncDeNovo = false;
function agendarSync(ms) { if (!equipeOk()) return; clearTimeout(syncT); syncT = setTimeout(() => sincronizar(), ms == null ? 700 : ms); }
async function sincronizar() {
  if (!equipeOk()) return false;
  if (sincronizando) { syncDeNovo = true; return false; }
  sincronizando = true; let ok = false;
  try {
    const ob = DB.sync.outbox, snap = { turnos: [...ob.turnos], occs: [...ob.occs], pends: [...ob.pends] };
    if (snap.turnos.length || snap.occs.length || snap.pends.length) {
      const turnos = snap.turnos.map(id => DB.turnos[id]).filter(Boolean).map(t => Object.assign({}, t, { ocorrencias: undefined, pendencias: undefined }));
      const occs = snap.occs.map(id => { const t = turnoDe(id); const o = t && t.ocorrencias.find(x => x.id === id); return o ? Object.assign({ turnoId: t.id }, o) : null; }).filter(Boolean);
      const pends = snap.pends.map(id => { const t = turnoDe(id); const p = t && t.pendencias.find(x => x.id === id); return p ? Object.assign({ turnoId: t.id }, p) : null; }).filter(Boolean);
      await rpc('rt_push', { codigo: DB.sync.codigo, turnos, occs, pends });
      ob.turnos = ob.turnos.filter(id => !snap.turnos.includes(id)); ob.occs = ob.occs.filter(id => !snap.occs.includes(id)); ob.pends = ob.pends.filter(id => !snap.pends.includes(id));
    }
    const r = await rpc('rt_pull', { codigo: DB.sync.codigo, desde: DB.sync.desde || 0 });
    const mudou = aplicarPull(r);
    DB.sync.desde = r.agora || DB.sync.desde; DB.sync.ultimo = Date.now(); DB.sync.erro = ''; online = true; ok = true;
    salvar(); if (mudou) rerender(); else renderStatus();
  } catch (e) {
    DB.sync.erro = e.msg || 'Falha ao sincronizar.'; if (e.net) online = false;
    if (e.auth) { toast(e.msg); if (/Código/.test(e.msg)) { DB.sync.codigo = ''; salvar(); ir('equipe'); } }
    salvar(); renderStatus();
  } finally { sincronizando = false; if (syncDeNovo) { syncDeNovo = false; agendarSync(300); } }
  return ok;
}
function aplicarPull(r) {
  let mudou = false;
  (r.turnos || []).forEach(rt => {
    const l = DB.turnos[rt.id];
    if (!l) { DB.turnos[rt.id] = Object.assign({ ocorrencias: [], pendencias: [], equipe: { ele: [], mec: [] }, prontos: [] }, rt, { ocorrencias: [], pendencias: [] }); mudou = true; return; }
    const prontos = [...new Set([...(l.prontos || []), ...(rt.prontos || [])])];
    if ((rt.at || 0) >= (l.at || 0) && !DB.sync.outbox.turnos.includes(rt.id)) { Object.assign(l, rt, { ocorrencias: l.ocorrencias, pendencias: l.pendencias }); mudou = true; }
    if (prontos.length !== (l.prontos || []).length) { l.prontos = prontos; mudou = true; }
  });
  const aplica = (lst, campo) => (lst || []).forEach(ro => {
    const t = DB.turnos[ro.turnoId]; if (!t) return;
    const arr = t[campo], i = arr.findIndex(x => x.id === ro.id); const dado = Object.assign({}, ro); delete dado.turnoId;
    if (i < 0) { arr.push(dado); mudou = true; }
    else if ((ro.at || 0) >= (arr[i].at || 0) && !DB.sync.outbox[campo === 'ocorrencias' ? 'occs' : 'pends'].includes(ro.id)) { arr[i] = dado; mudou = true; }
  });
  aplica(r.occs, 'ocorrencias'); aplica(r.pends, 'pendencias');
  return mudou;
}
function rerender() { if (viewAtual === 'occ' || viewAtual === 'rel' || viewAtual === 'equipe') { renderStatus(); return; } ir(viewAtual, true); }
function renderStatus() {
  let tx = '';
  if (equipeOk()) {
    const n = DB.sync.outbox.turnos.length + DB.sync.outbox.occs.length + DB.sync.outbox.pends.length;
    tx = DB.sync.equipeNome + ' · ' + (DB.sync.erro ? (online ? DB.sync.erro : 'sem conexão, lançamentos guardados') : (DB.sync.ultimo ? 'sincronizado ' + hmDe(DB.sync.ultimo) : 'conectando…')) + (n ? ' · ' + n + ' aguardando envio' : '');
  } else if (servidorOk()) tx = 'Você ainda não entrou numa equipe.';
  else tx = 'Modo individual: sem servidor configurado, os dados ficam só neste aparelho.';
  $('#syncHome').textContent = tx; $('#syncLan').textContent = tx;
  const dc = !equipeOk() ? 'dot' : DB.sync.erro ? (online ? 'dot wait' : 'dot off') : (DB.sync.ultimo ? 'dot on' : 'dot wait');
  $('#syncDot').className = dc; $('#syncDot2').className = dc;
  $('#homeNota').textContent = equipeOk() ? 'Os 4 executantes lançam no mesmo relatório. O último a encerrar envia no grupo. Seus lançamentos ficam guardados mesmo sem sinal e sobem quando a conexão voltar.' : 'Sem equipe configurada o app funciona só neste aparelho. Entre na equipe em Ajustes para compartilhar o relatório.';
}
setInterval(() => { if (equipeOk() && document.visibilityState === 'visible' && ['home', 'lan', 'fechar'].includes(viewAtual)) sincronizar(); }, 15000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') agendarSync(100); });

/* ---------- navegação ---------- */
let viewAtual = 'home';
const views = { home: 'vHome', lan: 'vLan', occ: 'vOcc', fechar: 'vFechar', rel: 'vRel', hist: 'vHist', cfg: 'vCfg', equipe: 'vEquipe' };
function ir(v, silencioso) {
  if (v === 'occ-novo') { abrirOcc(null); return; }
  if ((v === 'lan' || v === 'fechar') && !turnoAtual()) { if (!silencioso) toast('Inicie um turno primeiro.'); v = 'home'; }
  Object.entries(views).forEach(([k, id]) => $('#' + id).hidden = k !== v);
  $$('nav.tabs button').forEach(b => { const t = b.dataset.tab; const on = t === v || (t === 'lan' && (v === 'occ' || v === 'fechar')) || (t === 'hist' && v === 'rel' && !relTurnoAtivo()); b.toggleAttribute('aria-current', on); if (on) b.setAttribute('aria-current', 'page'); });
  viewAtual = v;
  if (v === 'home') renderHome(); if (v === 'lan') renderLan(); if (v === 'fechar') renderFechar(); if (v === 'hist') renderHist(); if (v === 'cfg') renderCfg(); if (v === 'equipe') renderEquipe();
  renderStatus(); if (!silencioso) window.scrollTo(0, 0);
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) { ir(g.dataset.go); return; }
  const t = e.target.closest('nav.tabs button[data-tab]'); if (t) ir(t.dataset.tab);
});

/* ---------- chips ---------- */
function montaChips(el, itens, sel) {
  const s = Array.isArray(sel) ? sel : (sel ? [sel] : []);
  el.innerHTML = itens.map(v => '<button type="button" class="chip" data-v="' + esc(v) + '" aria-pressed="' + (s.includes(v) ? 'true' : 'false') + '">' + esc(v) + '</button>').join('');
}
function chipSel(el) { return $$('.chip[aria-pressed="true"],[data-esp][aria-pressed="true"]', el).map(b => b.dataset.v || b.dataset.esp); }
function setChips(el, vals) { const s = Array.isArray(vals) ? vals : (vals ? [vals] : []); $$('[aria-pressed]', el).forEach(b => b.setAttribute('aria-pressed', s.includes(b.dataset.v || b.dataset.esp) ? 'true' : 'false')); }
function chips(el, multi, onChange) {
  el.addEventListener('click', e => {
    const b = e.target.closest('[aria-pressed]'); if (!b || !el.contains(b)) return;
    const on = b.getAttribute('aria-pressed') === 'true';
    if (!multi) $$('[aria-pressed]', el).forEach(x => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', (multi ? !on : true) ? 'true' : 'false');
    if (onChange) onChange(chipSel(el));
  });
}

/* ---------- turnos ---------- */
const todosTurnos = () => Object.values(DB.turnos).sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
function turnoAtual() { const ab = todosTurnos().filter(t => !t.encerradoEm); return ab.length ? ab[ab.length - 1] : null; }
const tituloTurno = t => fd(t.data) + ' · Turno ' + t.turno + ' · Letra ' + t.letra;
function turnoCfg(nome) { return DB.cfg.turnos.find(x => x.nome === nome); }
function turnoSugerido() {
  const n = toMin(agoraHM());
  for (const t of DB.cfg.turnos) {
    const a = toMin(t.ini), b = toMin(t.fim); if (a == null || b == null) continue;
    if (a < b ? (n >= a && n < b) : (n >= a || n < b)) return t.nome;
  }
  return DB.cfg.turnos[0].nome;
}
function ultimoEncerrado(excetoId) { const l = todosTurnos().filter(t => t.encerradoEm && t.id !== excetoId); return l.length ? l[l.length - 1] : null; }
function tocaTurno(t) { t.at = Date.now(); marcar('turnos', t.id); salvar(); agendarSync(); }

/* ---------- Início ---------- */
function renderHome() {
  const t = turnoAtual();
  $('#homeIni').hidden = !!t; $('#homeAtual').hidden = !t;
  if (!t) {
    const c = DB.cfg;
    $('#iData').value = $('#iData').value || hoje();
    $('#iTurno').innerHTML = c.turnos.map(x => '<option>' + esc(x.nome) + '</option>').join('');
    $('#iTurno').value = turnoSugerido();
    $('#iLetra').innerHTML = c.letras.map(x => '<option>' + esc(x) + '</option>').join('');
    if (c.ultimaLetra && c.letras.includes(c.ultimaLetra)) $('#iLetra').value = c.ultimaLetra;
    const ele = [...new Set([...c.equipeEle])], mec = [...new Set([...c.equipeMec])];
    montaChips($('#iEle'), ele, chipSel($('#iEle'))); montaChips($('#iMec'), mec, chipSel($('#iMec')));
    if (!ele.length) $('#iEle').innerHTML = '<span class="hint">Nenhum nome cadastrado. Cadastre em Ajustes ou informe no fechamento.</span>';
    if (!mec.length) $('#iMec').innerHTML = '<span class="hint">Nenhum nome cadastrado.</span>';
    resumoIni();
  } else {
    $('#haTit').textContent = 'Turno ' + t.turno + ' · Letra ' + t.letra;
    const tc = turnoCfg(t.turno);
    $('#haSub').textContent = fd(t.data) + (tc && tc.ini ? ' · ' + tc.ini + ' às ' + tc.fim : '') + ' · aberto às ' + t.iniciadoEm + (t.abertoPor ? ' por ' + t.abertoPor : '');
    const o = vivas(t.ocorrencias), r = o.filter(x => x.rascunho).length, par = o.filter(x => !x.rascunho && x.parou === 'sim').reduce((s, x) => s + (Number(x.tm) || 0), 0);
    $('#haStats').innerHTML = '<div class="e"><b>' + o.filter(x => x.esp === 'ele').length + '</b><span>Elétrica</span></div><div class="m"><b>' + o.filter(x => x.esp === 'mec').length + '</b><span>Mecânica</span></div><div><b>' + (par >= 60 ? Math.floor(par / 60) + 'h' + p2(par % 60) : par + '′') + '</b><span>Parado</span></div><div><b' + (r ? ' style="color:var(--warn)"' : '') + '>' + r + '</b><span>Rascunho</span></div>';
    $('#haLanN').textContent = o.length ? 'Lançamentos (' + o.length + ')' : 'Lançamentos';
    const ult = o.slice().sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0)).slice(0, 3);
    $('#haUlt').innerHTML = ult.length ? '<h3 style="margin:4px 0 0">Últimos lançamentos</h3>' + ult.map(cardOcc).join('') : '';
  }
  const rec = todosTurnos().filter(x => x.encerradoEm).reverse().slice(0, 3);
  $('#homeRec').hidden = !rec.length;
  $('#homeRecList').innerHTML = rec.map(linhaHist).join('');
}
function resumoIni() {
  const tc = turnoCfg($('#iTurno').value), d = $('#iData').value;
  $('#iniResumo').textContent = 'Turno ' + $('#iTurno').value + ' · Letra ' + $('#iLetra').value;
  const eq = [...chipSel($('#iEle')), ...chipSel($('#iMec'))];
  $('#iniSub').textContent = fd(d) + (tc && tc.ini ? ' · ' + tc.ini + ' às ' + tc.fim : '') + (eq.length ? ' · ' + juntar(eq) : '') + (equipeOk() ? ' · ' + DB.sync.equipeNome : '');
}
['iData', 'iTurno', 'iLetra'].forEach(id => $('#' + id).addEventListener('change', resumoIni));
['iEle', 'iMec'].forEach(id => $('#' + id).addEventListener('click', () => setTimeout(resumoIni, 0)));
function linhaHist(t) {
  const n = vivas(t.ocorrencias).length;
  return '<button type="button" class="hist" data-rel="' + t.id + '"><span><b>' + esc(tituloTurno(t)) + '</b><br><span class="mut sm">' + n + ' ocorrência' + (n === 1 ? '' : 's') + (t.encerradoEm ? ' · encerrado às ' + esc(t.encerradoEm) + (t.encerradoPor ? ' por ' + esc(t.encerradoPor) : '') : ' · em andamento') + '</span></span><span class="mut">›</span></button>';
}
document.addEventListener('click', e => { const b = e.target.closest('[data-rel]'); if (b) mostrarRel(b.dataset.rel); });
chips($('#iEle'), true); chips($('#iMec'), true);
$('#fIni').addEventListener('submit', async e => {
  e.preventDefault();
  const data = $('#iData').value; if (!data) { $('#iniErr').textContent = 'Informe a data.'; return; }
  const bt = $('#fIni button[type=submit]'); bt.disabled = true; $('#iniErr').textContent = '';
  try {
    const ant = ultimoEncerrado(), agora = Date.now();
    const t = { id: uid(), data, turno: $('#iTurno').value, letra: $('#iLetra').value, iniciadoEm: agoraHM(), abertoPor: meuNome(), criadoEm: agora, at: agora, encerradoEm: null,
      equipe: { ele: chipSel($('#iEle')), mec: chipSel($('#iMec')) }, prontos: [], ocorrencias: [], pendencias: [], obs: '' };
    if (equipeOk()) {
      /* no servidor: se um colega já abriu o turno da equipe, entramos nele em vez de criar outro */
      let r; try { r = await rpc('rt_iniciar_turno', { codigo: DB.sync.codigo, turno: Object.assign({}, t, { ocorrencias: undefined, pendencias: undefined }) }); }
      catch (err) { $('#iniErr').textContent = (err.msg || 'Falha ao falar com o servidor.') + ' Para abrir o turno é preciso conexão, assim todos lançam no mesmo relatório.'; return; }
      if (r && r.existente) { aplicarPull({ turnos: [r.turno] }); salvar(); await sincronizar(); toast('A equipe já tinha este turno aberto. Você entrou nele.'); ir('lan'); return; }
    }
    if (ant) ant.pendencias.filter(p => !p.excluido && p.status !== 'concluida').forEach(p => t.pendencias.push({ id: uid(), esp: p.esp, texto: p.texto, origem: 'recebida', de: tituloTurno(ant), status: 'aberta', at: agora }));
    DB.turnos[t.id] = t; DB.cfg.ultimaLetra = t.letra;
    t.pendencias.forEach(p => marcar('pends', p.id)); if (equipeOk()) agendarSync(100); salvar();
    $('#iData').value = ''; toast('Turno iniciado.'); ir('lan');
  } finally { bt.disabled = false; }
});

/* ---------- Lançamentos ---------- */
function cardOcc(o) {
  const d = durMin(o.hi, o.hf);
  const linhas = [];
  if (o.rascunho) linhas.push('<span class="pill warn">Rascunho: completar</span>');
  if (o.falha) linhas.push('<div><b>Falha:</b> ' + esc(o.falha) + '</div>');
  if (o.acao) linhas.push('<div><b>Ação:</b> ' + esc(o.acao) + '</div>');
  const meta = [];
  if (o.hi) meta.push(o.hi + (o.hf ? ' às ' + o.hf : ' (em aberto)') + (d != null ? ' · ' + fmtDur(d) : ''));
  if (o.parou === 'sim') meta.push('parado ' + fmtDur(Number(o.tm) || 0));
  if (o.sit) meta.push(SIT[o.sit]);
  if (o.quem && o.quem.length) meta.push(juntar(o.quem));
  return '<section class="card occ ' + o.esp + (o.rascunho ? ' draft' : '') + '"><div class="h"><span class="t">' + esc(o.eq || '(sem equipamento)') + '</span><span class="pill ' + o.esp + '">' + ESP[o.esp].nome + (o.area ? ' · ' + esc(o.area) : '') + '</span></div>'
    + '<div class="meta num">' + esc(meta.join(' · ')) + '</div>' + linhas.join('') + (o.autor ? '<div class="hint">lançado por ' + esc(o.autor) + '</div>' : '')
    + '<div class="act"><button type="button" class="btn" data-ed="' + o.id + '">' + (o.rascunho ? 'Completar' : 'Editar') + '</button><button type="button" class="btn" data-dup="' + o.id + '">Duplicar</button></div></section>';
}
function renderLan() {
  const t = turnoAtual(); if (!t) return;
  $('#lanSub').textContent = tituloTurno(t);
  const o = vivas(t.ocorrencias).sort((a, b) => (b.rascunho - a.rascunho) || (toMin(a.hi) || 0) - (toMin(b.hi) || 0));
  $('#lanLista').innerHTML = o.length ? '<h3>' + o.length + ' lançamento' + (o.length === 1 ? '' : 's') + '</h3>' + o.map(cardOcc).join('') : '<p class="note info sm">Nenhuma ocorrência lançada ainda. Se o turno terminar assim, o relatório sai como "sem ocorrências".</p>';
  $('#prontoCard').hidden = !equipeOk();
  if (equipeOk()) {
    const eu = (t.prontos || []).includes(meuNome());
    $('#bPronto').textContent = eu ? 'Desfazer: ainda tenho lançamentos' : 'Meus lançamentos estão completos';
    $('#bPronto').className = 'btn' + (eu ? '' : ' pri');
    $('#prontoInfo').textContent = textoProntos(t);
  }
  montaDatalist();
}
function textoProntos(t) {
  const todos = [...new Set([...(t.equipe.ele || []), ...(t.equipe.mec || [])])], pr = t.prontos || [];
  const faltam = todos.filter(n => !pr.includes(n));
  return (pr.length ? 'Já confirmaram: ' + juntar(pr) + '.' : 'Ninguém confirmou ainda.') + (faltam.length ? ' Faltam: ' + juntar(faltam) + '.' : (todos.length ? ' Todos confirmaram.' : ''));
}
$('#bPronto').addEventListener('click', () => {
  const t = turnoAtual(); if (!t || !meuNome()) return;
  const eu = meuNome(); t.prontos = (t.prontos || []).includes(eu) ? t.prontos.filter(n => n !== eu) : [...t.prontos, eu];
  tocaTurno(t); renderLan(); toast(t.prontos.includes(eu) ? 'Confirmado. Avise o colega que vai encerrar.' : 'Confirmação desfeita.');
});
$('#haUlt').addEventListener('click', e => { const ed = e.target.closest('[data-ed]'); if (ed) abrirOcc(ed.dataset.ed); const dp = e.target.closest('[data-dup]'); if (dp) { const o = turnoAtual().ocorrencias.find(x => x.id === dp.dataset.dup); if (o) abrirOcc(null, Object.assign({}, o, { id: null, hi: '', hf: '', tm: '', rascunho: false, autor: undefined })); } });
$('#lanLista').addEventListener('click', e => {
  const ed = e.target.closest('[data-ed]'); if (ed) { abrirOcc(ed.dataset.ed); return; }
  const dp = e.target.closest('[data-dup]');
  if (dp) { const o = turnoAtual().ocorrencias.find(x => x.id === dp.dataset.dup); if (!o) return; abrirOcc(null, Object.assign({}, o, { id: null, hi: '', hf: '', tm: '', rascunho: false, autor: undefined })); }
});
chips($('#qEsp'), false);
$('#fQuick').addEventListener('submit', e => {
  e.preventDefault();
  const eq = $('#qEq').value.trim(); if (!eq) { $('#qEq').focus(); return; }
  const t = turnoAtual(), id = uid();
  t.ocorrencias.push({ id, esp: chipSel($('#qEsp'))[0] || 'ele', area: '', eq, tipo: '', falha: '', acao: '', hi: agoraHM(), hf: '', parou: '', tm: '', sit: '', obs: '', pend: false, quem: meuNome() ? [meuNome()] : [], rascunho: true, autor: meuNome(), criadoEm: Date.now(), at: Date.now() });
  marcar('occs', id); salvar(); agendarSync(); $('#qEq').value = ''; toast('Rascunho aberto às ' + agoraHM() + '. Complete depois.'); renderLan();
});
function todasOcc() { return todosTurnos().flatMap(t => vivas(t.ocorrencias).map(o => Object.assign({ _t: t }, o))); }
function montaDatalist() {
  const vistos = new Set(), eqs = [];
  todasOcc().sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0)).forEach(o => { const k = normEq(o.eq); if (o.eq && !vistos.has(k)) { vistos.add(k); eqs.push(o.eq); } });
  $('#dlEq').innerHTML = eqs.slice(0, 200).map(v => '<option value="' + esc(v) + '">').join('');
}

/* ---------- Formulário de ocorrência ---------- */
let occId = null, occVoltarPara = 'lan';
const vazio = () => ({ esp: 'ele', area: '', eq: '', tipo: '', falha: '', acao: '', hi: '', hf: '', parou: '', tm: '', sit: '', obs: '', pend: false, quem: meuNome() ? [meuNome()] : [], rascunho: false });
function abrirOcc(id, modelo) {
  const t = turnoAtual(); if (!t) { toast('Inicie um turno primeiro.'); ir('home'); return; }
  occVoltarPara = viewAtual === 'home' ? 'home' : 'lan';
  occId = id; const o = id ? t.ocorrencias.find(x => x.id === id) : Object.assign(vazio(), modelo || {});
  if (!o) return;
  $('#occTit').textContent = id ? (o.rascunho ? 'Completar rascunho' : 'Editar ocorrência') : 'Nova ocorrência';
  $('#oExcluir').hidden = !id; $('#oRascunho').hidden = !!(id && !o.rascunho);
  setChips($('#oEsp'), o.esp); montaChips($('#oArea'), DB.cfg.areas, o.area);
  $('#oEq').value = o.eq || ''; $('#oFalha').value = o.falha || ''; $('#oAcao').value = o.acao || '';
  $('#oHi').value = o.hi || ''; $('#oHf').value = o.hf || '';
  setChips($('#oParou'), o.parou); $('#oTm').value = o.tm || ''; setChips($('#oSit'), o.sit);
  $('#oObs').value = o.obs || ''; $('#oPend').checked = !!o.pend;
  $('#oQuemX').value = ''; $('#oErr').textContent = '';
  montaTipos(o.esp, o.tipo); montaQuem(o.esp, o.quem || []);
  atualizaForm(); historicoEq(); montaDatalist();
  Object.entries(views).forEach(([k, v]) => $('#' + v).hidden = k !== 'occ'); viewAtual = 'occ'; window.scrollTo(0, 0);
  if (!id && !o.eq) setTimeout(() => $('#oEq').focus(), 50);
}
function montaTipos(esp, sel) { const l = esp === 'mec' ? DB.cfg.tiposMec : DB.cfg.tiposEle; montaChips($('#oTipo'), l, sel); $('#oTipo').parentElement.hidden = !l.length; }
function montaQuem(esp, sel) {
  const t = turnoAtual(); const base = [...new Set([...((esp === 'mec' ? t.equipe.mec : t.equipe.ele) || []), ...(meuNome() ? [meuNome()] : [])])];
  const extra = sel.filter(n => !base.includes(n)); montaChips($('#oQuem'), [...base, ...extra], sel);
  if (!base.length && !extra.length) $('#oQuem').innerHTML = '<span class="hint">Equipe não informada ao iniciar o turno. Digite o nome abaixo.</span>';
}
chips($('#oEsp'), false, v => { montaTipos(v[0], ''); montaQuem(v[0], meuNome() ? [meuNome()] : []); historicoEq(); });
chips($('#oArea'), false); chips($('#oTipo'), false); chips($('#oQuem'), true);
chips($('#oParou'), false, atualizaForm); chips($('#oSit'), false, atualizaForm);
$$('[data-now]').forEach(b => b.addEventListener('click', () => { $('#' + b.dataset.now).value = agoraHM(); atualizaForm(); }));
['oHi', 'oHf'].forEach(id => $('#' + id).addEventListener('change', atualizaForm));
function atualizaForm() {
  const d = durMin($('#oHi').value, $('#oHf').value);
  $('#oDur').textContent = d != null ? 'Duração: ' + fmtDur(d) : '';
  const parou = chipSel($('#oParou'))[0]; $('#oTmW').hidden = parou !== 'sim';
  if (parou === 'sim' && !$('#oTm').value && d) $('#oTm').value = d;
  const sit = chipSel($('#oSit'))[0];
  $('#oObsW').hidden = !(sit === 'paliativo' || sit === 'pendente'); $('#oPendW').hidden = sit !== 'paliativo';
  $('#oObsL').textContent = sit === 'pendente' ? 'O que falta fazer (vai para as pendências do próximo turno)' : 'Observação para o próximo turno / inspetor';
}
let histT;
$('#oEq').addEventListener('input', () => { clearTimeout(histT); histT = setTimeout(historicoEq, 300); });
function historicoEq() {
  const k = normEq($('#oEq').value), box = $('#oHist');
  if (k.length < 2) { box.hidden = true; return; }
  const h = todasOcc().filter(o => o.id !== occId && !o.rascunho && normEq(o.eq) === k).sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0)).slice(0, 3);
  if (!h.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<b>Últimos atendimentos neste equipamento</b>' + h.map(o => '<div class="it"><span class="mut">' + esc(fd(o._t.data)) + ' · ' + ESP[o.esp].nome + (o.tipo ? ' · ' + esc(o.tipo) : '') + '</span><br>' + esc(o.falha) + (o.acao ? '<br><i>' + esc(o.acao) + '</i>' : '') + (o.acao ? ' <button type="button" class="lnk" style="min-height:0;padding:2px 6px" data-usar="' + o.id + '">usar esta ação</button>' : '') + '</div>').join('');
}
$('#oHist').addEventListener('click', e => {
  const b = e.target.closest('[data-usar]'); if (!b) return;
  const o = todasOcc().find(x => x.id === b.dataset.usar); if (!o) return;
  if (!$('#oAcao').value.trim() || confirm('Substituir o texto de "O que foi feito"?')) { $('#oAcao').value = o.acao; if (o.tipo && !chipSel($('#oTipo')).length) setChips($('#oTipo'), o.tipo); toast('Ação copiada. Ajuste se precisar.'); }
});
function lerForm() {
  return { esp: chipSel($('#oEsp'))[0] || 'ele', area: chipSel($('#oArea'))[0] || '', eq: $('#oEq').value.trim(), tipo: chipSel($('#oTipo'))[0] || '',
    falha: $('#oFalha').value.trim(), acao: $('#oAcao').value.trim(), hi: $('#oHi').value, hf: $('#oHf').value,
    parou: chipSel($('#oParou'))[0] || '', tm: $('#oTm').value.trim(), sit: chipSel($('#oSit'))[0] || '', obs: $('#oObs').value.trim(), pend: $('#oPend').checked,
    quem: [...new Set([...chipSel($('#oQuem')), ...lista($('#oQuemX').value)])] };
}
function gravarOcc(o, rascunho) {
  const t = turnoAtual(); o.rascunho = rascunho; o.at = Date.now();
  /* mesma grafia para o mesmo equipamento: "vt 03" vira "VT-03" se já existe assim */
  const k = normEq(o.eq), ant = k && todasOcc().find(x => x.id !== occId && normEq(x.eq) === k); if (ant) o.eq = ant.eq;
  if (occId) { const i = t.ocorrencias.findIndex(x => x.id === occId); Object.assign(t.ocorrencias[i], o); o = t.ocorrencias[i]; }
  else { o.id = uid(); o.criadoEm = Date.now(); o.autor = meuNome(); t.ocorrencias.push(o); }
  if (!o.autor && meuNome()) o.autor = meuNome();
  marcar('occs', o.id);
  /* pendência ligada à ocorrência: criada quando ficou pendente, ou paliativo com a caixa marcada */
  const quer = !rascunho && (o.sit === 'pendente' || (o.sit === 'paliativo' && o.pend));
  const p = t.pendencias.find(x => x.occId === o.id && !x.excluido);
  const txt = (o.eq ? o.eq + ': ' : '') + (o.obs || (o.sit === 'pendente' ? 'atendimento não concluído' : 'paliativo, precisa de serviço definitivo'));
  if (quer && !p) { const np = { id: uid(), esp: o.esp, texto: txt, origem: 'turno', occId: o.id, status: 'aberta', at: Date.now() }; t.pendencias.push(np); marcar('pends', np.id); }
  else if (quer) { p.texto = txt; p.esp = o.esp; p.at = Date.now(); marcar('pends', p.id); }
  else if (p) { p.excluido = true; p.at = Date.now(); marcar('pends', p.id); }
  salvar(); agendarSync();
}
$('#fOcc').addEventListener('submit', e => {
  e.preventDefault();
  const o = lerForm(), err = [];
  if (!o.area) err.push('a área'); if (!o.eq) err.push('o equipamento'); if (!o.falha) err.push('o que aconteceu'); if (!o.acao) err.push('o que foi feito');
  if (!o.hi) err.push('a hora de início'); if (!o.hf && o.sit !== 'pendente') err.push('a hora de fim');
  if (!o.parou) err.push('se o equipamento parou'); if (o.parou === 'sim' && !(Number(o.tm) > 0)) err.push('o tempo parado');
  if (!o.sit) err.push('a situação ao final');
  if (err.length) { $('#oErr').textContent = 'Falta informar ' + juntar(err) + '.'; $('#oErr').scrollIntoView({ block: 'center' }); return; }
  if (o.parou !== 'sim') o.tm = '';
  gravarOcc(o, false); toast(occId ? 'Ocorrência atualizada.' : 'Ocorrência lançada.'); ir(occVoltarPara === 'home' ? 'lan' : occVoltarPara);
});
$('#oRascunho').addEventListener('click', () => {
  const o = lerForm(); if (!o.eq) { $('#oErr').textContent = 'Para salvar o rascunho, informe pelo menos o equipamento.'; return; }
  if (!o.hi) o.hi = agoraHM(); gravarOcc(o, true); toast('Rascunho salvo.'); ir('lan');
});
$('#oExcluir').addEventListener('click', () => {
  if (!occId || !confirm('Excluir esta ocorrência?')) return;
  const t = turnoAtual(), o = t.ocorrencias.find(x => x.id === occId); if (!o) return;
  o.excluido = true; o.at = Date.now(); marcar('occs', o.id);
  t.pendencias.filter(p => p.occId === occId && !p.excluido).forEach(p => { p.excluido = true; p.at = Date.now(); marcar('pends', p.id); });
  salvar(); agendarSync(); ir('lan');
});
$('#occVoltar').addEventListener('click', () => ir(occVoltarPara));

/* ---------- Fechamento ---------- */
function avisos(t) {
  const a = [], occ = vivas(t.ocorrencias);
  const r = occ.filter(o => o.rascunho).length;
  if (r) a.push({ tipo: 'err', tx: r + ' rascunho' + (r > 1 ? 's' : '') + ' sem completar. Complete ou exclua antes de encerrar.' });
  occ.filter(o => !o.rascunho).forEach(o => {
    const d = durMin(o.hi, o.hf);
    if (o.parou === 'sim' && d != null && Number(o.tm) > d) a.push({ tipo: 'warn', tx: o.eq + ': tempo parado (' + fmtDur(Number(o.tm)) + ') maior que a duração do atendimento (' + fmtDur(d) + ').' });
    if (d != null && d > 600) a.push({ tipo: 'warn', tx: o.eq + ': atendimento com ' + fmtDur(d) + '. Confira as horas.' });
    if (!o.quem.length) a.push({ tipo: 'warn', tx: o.eq + ': sem nome de quem atendeu.' });
  });
  if (!occ.length) a.push({ tipo: 'info', tx: 'Nenhuma ocorrência lançada: o relatório sairá como "sem ocorrências".' });
  return a;
}
function renderFechar() {
  const t = turnoAtual(); if (!t) return;
  $('#fAvisos').innerHTML = avisos(t).map(x => '<div class="note ' + x.tipo + '">' + esc(x.tx) + '</div>').join('');
  $('#fProntos').hidden = !equipeOk();
  if (equipeOk()) $('#fProntos').innerHTML = '<h2>Confirmação da equipe</h2><p class="sm">' + esc(textoProntos(t)) + '</p><p class="hint">Quem ainda não confirmou pode ter lançamentos por fazer. Ao encerrar, o app busca os lançamentos mais recentes de todos antes de gerar o texto.</p>';
  renderPend(t);
  $('#fEqEle').value = equipeDe(t, 'ele').join(', '); $('#fEqMec').value = equipeDe(t, 'mec').join(', '); $('#fObs').value = t.obs || '';
  $('#fConf').checked = false; $('#fErr').textContent = '';
}
function renderPend(t) {
  const el = $('#pendLista'), ps = vivas(t.pendencias);
  if (!ps.length) { el.innerHTML = '<p class="hint">Nenhuma pendência registrada.</p>'; return; }
  el.innerHTML = ps.map(p => '<div class="pend' + (p.status === 'concluida' ? ' done' : '') + '"><div class="tx"><span class="pill ' + p.esp + '">' + ESP[p.esp].nome + '</span> ' + esc(p.texto)
    + (p.origem === 'recebida' ? '<br><span class="hint">recebida de ' + esc(p.de) + '</span>' : (p.occId ? '<br><span class="hint">gerada por uma ocorrência deste turno</span>' : '')) + '</div>'
    + (p.status === 'concluida' ? '<button type="button" class="btn" data-pre="' + p.id + '">Reabrir</button>' : '<button type="button" class="btn ok" data-pok="' + p.id + '">Concluída</button>')
    + (p.occId ? '' : '<button type="button" class="btn danger" data-pdel="' + p.id + '" aria-label="Remover">✕</button>') + '</div>').join('');
}
$('#pendLista').addEventListener('click', e => {
  const t = turnoAtual(); const b = e.target.closest('[data-pok],[data-pre],[data-pdel]'); if (!b) return;
  const id = b.dataset.pok || b.dataset.pre || b.dataset.pdel, p = t.pendencias.find(x => x.id === id); if (!p) return;
  if (b.dataset.pok) p.status = 'concluida'; if (b.dataset.pre) p.status = 'aberta';
  if (b.dataset.pdel) { if (!confirm('Remover esta pendência?')) return; p.excluido = true; }
  p.at = Date.now(); marcar('pends', p.id); salvar(); agendarSync(); renderPend(t);
});
chips($('#pEsp'), false);
$('#fPend').addEventListener('submit', e => {
  e.preventDefault(); const tx = $('#pTx').value.trim(); if (!tx) return;
  const t = turnoAtual(), p = { id: uid(), esp: chipSel($('#pEsp'))[0] || 'ele', texto: tx, origem: 'turno', status: 'aberta', at: Date.now() };
  t.pendencias.push(p); marcar('pends', p.id); salvar(); agendarSync(); $('#pTx').value = ''; renderPend(t);
});
['fEqEle', 'fEqMec', 'fObs'].forEach(id => $('#' + id).addEventListener('change', () => { const t = turnoAtual(); if (!t) return; t.equipe.ele = lista($('#fEqEle').value); t.equipe.mec = lista($('#fEqMec').value); t.obs = $('#fObs').value.trim(); tocaTurno(t); }));
$('#bEncerrar').addEventListener('click', async () => {
  const t = turnoAtual(); if (!t) return;
  t.equipe.ele = lista($('#fEqEle').value); t.equipe.mec = lista($('#fEqMec').value); t.obs = $('#fObs').value.trim();
  if (vivas(t.ocorrencias).some(o => o.rascunho)) { $('#fErr').textContent = 'Há rascunhos sem completar. Volte aos lançamentos e complete ou exclua.'; return; }
  if (!$('#fConf').checked) { $('#fErr').textContent = 'Confirme com a equipe que tudo foi lançado.'; return; }
  const bt = $('#bEncerrar'); bt.disabled = true; $('#fErr').textContent = '';
  try {
    if (equipeOk()) {
      /* busca os lançamentos mais recentes dos colegas antes de fechar; sem conexão não encerra */
      tocaTurno(t); const ok = await sincronizar();
      if (!ok) { $('#fErr').textContent = (DB.sync.erro || 'Sem conexão.') + ' Para encerrar é preciso conexão, para que o relatório saia com os lançamentos de todos.'; return; }
      if (turnoAtual() !== t) { $('#fErr').textContent = 'Este turno já foi encerrado por outro colega.'; ir('home'); return; }
      if (vivas(t.ocorrencias).some(o => o.rascunho)) { $('#fErr').textContent = 'Chegaram rascunhos de colegas sem completar. Confira os lançamentos.'; renderFechar(); return; }
    }
    t.encerradoEm = agoraHM(); t.encerradoTs = Date.now(); t.encerradoPor = meuNome(); t.texto = textoRelatorio(t); t.at = Date.now(); marcar('turnos', t.id); salvar();
    if (equipeOk()) { const ok = await sincronizar(); if (!ok) { t.encerradoEm = null; t.texto = ''; t.at = Date.now(); marcar('turnos', t.id); salvar(); $('#fErr').textContent = 'Não consegui gravar o encerramento no servidor. Tente de novo.'; return; } }
    toast('Turno encerrado. Relatório pronto.'); mostrarRel(t.id);
  } finally { bt.disabled = false; }
});

/* equipe do turno: a informada; se ficou vazia (turno começado com um toque), quem atendeu/lançou */
function equipeDe(t, esp) {
  const inf = (esp === 'mec' ? t.equipe.mec : t.equipe.ele) || [];
  if (inf.length) return inf;
  return [...new Set(vivas(t.ocorrencias).filter(o => o.esp === esp && !o.rascunho).flatMap(o => (o.quem && o.quem.length ? o.quem : (o.autor ? [o.autor] : []))))];
}

/* ---------- Texto do relatório (formato WhatsApp) ---------- */
function textoRelatorio(t) {
  const c = DB.cfg, E = c.emoji, L = [];
  const H = (tx, em) => L.push('*' + (E && em ? em + ' ' : '') + tx + '*');
  const tc = turnoCfg(t.turno);
  H(limpa(c.titulo).toUpperCase(), '📋');
  L.push('Data: ' + fd(t.data) + ' | Turno ' + t.turno + (tc ? ' (' + tc.ini + ' às ' + tc.fim + ')' : '') + ' | Letra ' + t.letra);
  const occ = vivas(t.ocorrencias).filter(o => !o.rascunho);
  ['ele', 'mec'].forEach(e => {
    L.push(''); H(ESP[e].tit, e === 'ele' ? '⚡' : '🔧');
    const lst = occ.filter(o => o.esp === e).sort((a, b) => (toMin(a.hi) || 0) - (toMin(b.hi) || 0));
    if (!lst.length) { L.push('Sem ocorrências.'); return; }
    const areas = [...c.areas.filter(a => lst.some(o => o.area === a)), ...[...new Set(lst.map(o => o.area))].filter(a => !c.areas.includes(a))];
    let n = 0;
    areas.forEach(a => {
      L.push('_' + (a || 'Sem área') + '_');
      lst.filter(o => o.area === a).forEach(o => {
        const d = durMin(o.hi, o.hf);
        L.push(++n + '. *' + limpa(o.eq) + '* | ' + (o.hi || '--:--') + (o.hf ? ' às ' + o.hf : ' (não concluído)') + (d != null ? ' (' + fmtDur(d) + ')' : ''));
        if (o.tipo) L.push('   Tipo: ' + limpa(o.tipo));
        L.push('   Falha: ' + limpa(o.falha));
        L.push('   Ação: ' + limpa(o.acao));
        L.push('   Parada: ' + (o.parou === 'sim' ? fmtDur(Number(o.tm) || 0) : 'não parou'));
        L.push('   Situação: ' + SIT[o.sit] + (o.obs ? (o.sit === 'pendente' ? '. Falta: ' : '. ') + limpa(o.obs) : ''));
        if (o.quem.length) L.push('   Atendeu: ' + juntar(o.quem.map(limpa)));
      });
    });
    const tot = lst.filter(o => o.parou === 'sim').reduce((s, o) => s + (Number(o.tm) || 0), 0);
    L.push('Total ' + ESP[e].adj + ': ' + lst.length + ' ocorrência' + (lst.length === 1 ? '' : 's') + ' | ' + (tot ? 'equipamento parado ' + fmtDur(tot) : 'sem parada de equipamento'));
  });
  const at = occ.filter(o => o.sit === 'paliativo');
  if (at.length) { L.push(''); H('PONTOS DE ATENÇÃO', '⚠️'); at.forEach(o => L.push('- [' + ESP[o.esp].nome + '] ' + limpa(o.eq) + ': paliativo' + (o.obs ? '. ' + limpa(o.obs) : '') + '.')); }
  const ps = vivas(t.pendencias), pa = ps.filter(p => p.status !== 'concluida'), pc = ps.filter(p => p.status === 'concluida');
  L.push(''); H('PENDÊNCIAS PARA O PRÓXIMO TURNO', '⏭️');
  if (pa.length) pa.forEach(p => L.push('- [' + ESP[p.esp].nome + '] ' + limpa(p.texto) + (p.origem === 'recebida' ? ' (vem de turno anterior)' : ''))); else L.push('Nenhuma.');
  if (pc.length) L.push('Concluídas neste turno: ' + pc.map(p => limpa(p.texto)).join('; ') + '.');
  if (t.obs) { L.push(''); H('OBSERVAÇÕES', '📝'); L.push(limpa(t.obs)); }
  L.push(''); H('EQUIPE', '👷');
  const ee = equipeDe(t, 'ele'), em = equipeDe(t, 'mec');
  L.push('Elétrica: ' + (ee.length ? juntar(ee.map(limpa)) : 'não informada'));
  L.push('Mecânica: ' + (em.length ? juntar(em.map(limpa)) : 'não informada'));
  L.push('Turno encerrado às ' + (t.encerradoEm || agoraHM()) + (t.encerradoPor ? ' por ' + limpa(t.encerradoPor) : '') + '.');
  return L.join('\n');
}

/* ---------- Relatório: ver, enviar, reabrir ---------- */
let relId = null;
const relTurnoAtivo = () => { const a = turnoAtual(); return !!(relId && a && a.id === relId); };
function mostrarRel(id) {
  const t = DB.turnos[id]; if (!t) return; relId = id;
  const tx = t.encerradoEm ? (t.texto || textoRelatorio(t)) : textoRelatorio(t);
  $('#relPrev').textContent = tx; $('#taCopy').value = tx;
  $('#relSub').textContent = tituloTurno(t) + (t.encerradoEm ? ' · encerrado às ' + t.encerradoEm : ' · prévia (turno em andamento)');
  $('#bReabrir').hidden = !t.encerradoEm;
  Object.entries(views).forEach(([k, v]) => $('#' + v).hidden = k !== 'rel'); viewAtual = 'rel'; window.scrollTo(0, 0);
}
async function copiar(tx) {
  try { await navigator.clipboard.writeText(tx); toast('Texto copiado. Cole no grupo do WhatsApp.'); return; } catch (e) { /* segue para o modo antigo */ }
  const ta = $('#taCopy'); ta.hidden = false; ta.value = tx; ta.select(); ta.setSelectionRange(0, tx.length);
  const ok = document.execCommand && document.execCommand('copy'); ta.hidden = true; toast(ok ? 'Texto copiado.' : 'Não consegui copiar. Selecione o texto e copie manualmente.');
}
async function compartilhar(tx, titulo) {
  if (Plug.Share) { try { await Plug.Share.share({ title: titulo, text: tx, dialogTitle: 'Enviar relatório' }); return true; } catch (e) { if (!/cancel/i.test(String(e && e.message))) console.warn(e); return false; } }
  if (navigator.share) { try { await navigator.share({ title: titulo, text: tx }); return true; } catch (e) { return false; } }
  return null;
}
async function abrirWhatsApp(tx) {
  const enc = encodeURIComponent(tx);
  if (nativo && Plug.App && Plug.App.openUrl) {
    try { const r = await Plug.App.openUrl({ url: 'whatsapp://send?text=' + enc }); if (r && r.completed !== false) return true; } catch (e) { /* tenta o link web */ }
  }
  const w = window.open('https://wa.me/?text=' + enc, '_blank'); return !!w;
}
$('#bWa').addEventListener('click', async () => {
  const tx = $('#taCopy').value, t = DB.turnos[relId];
  const ok = await compartilhar(tx, tituloTurno(t));
  if (ok === null) { if (!(await abrirWhatsApp(tx))) copiar(tx); }
});
$('#bShare').addEventListener('click', async () => { const tx = $('#taCopy').value; const ok = await compartilhar(tx, 'Relatório de turno'); if (ok === null) copiar(tx); });
$('#bCopy').addEventListener('click', () => copiar($('#taCopy').value));
$('#bReabrir').addEventListener('click', async () => {
  const t = DB.turnos[relId]; if (!t) return;
  if (turnoAtual()) { toast('Encerre o turno em andamento antes de reabrir outro.'); return; }
  if (!confirm('Reabrir o turno ' + tituloTurno(t) + '? Será preciso encerrar de novo para gerar o relatório.')) return;
  t.encerradoEm = null; t.texto = ''; t.encerradoPor = ''; t.at = Date.now(); marcar('turnos', t.id); salvar();
  if (equipeOk()) { const ok = await sincronizar(); if (!ok) toast('Sem conexão: a reabertura sobe quando a conexão voltar.'); }
  ir('lan');
});

/* ---------- Histórico ---------- */
function renderHist() {
  const ts = todosTurnos().reverse();
  $('#histLista').innerHTML = ts.length ? ts.map(linhaHist).join('') : '<p class="hint" style="padding:10px 0">Nenhum turno registrado ainda.</p>';
}

/* ---------- Equipe ---------- */
function renderEquipe() {
  $('#eNome').value = DB.sync.nome || ''; $('#eErr').textContent = '';
  if (!servidorOk()) $('#eErr').textContent = 'Servidor não configurado. Configure em Ajustes > Servidor.';
}
chips($('#eModo'), false, v => { const criar = v[0] === 'criar'; $('#eCodW').hidden = criar; $('#eEqW').hidden = !criar; $('#eOk').textContent = criar ? 'Criar equipe' : 'Entrar'; $('#eHint').textContent = criar ? 'Você recebe um código para passar aos colegas. Crie só uma equipe por turno.' : 'Peça o código a quem criou a equipe. Ele aparece em Ajustes no celular dessa pessoa.'; });
$('#eCod').addEventListener('input', () => { const v = $('#eCod').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); $('#eCod').value = v.length > 4 ? v.slice(0, 4) + '-' + v.slice(4) : v; });
$('#fEquipe').addEventListener('submit', async e => {
  e.preventDefault();
  const nome = $('#eNome').value.trim(), criar = chipSel($('#eModo'))[0] === 'criar';
  if (!nome) { $('#eErr').textContent = 'Informe seu nome.'; return; }
  if (!servidorOk()) { $('#eErr').textContent = 'Servidor não configurado. Configure em Ajustes > Servidor.'; return; }
  const bt = $('#eOk'); bt.disabled = true; $('#eErr').textContent = '';
  try {
    DB.sync.nome = nome;
    if (criar) {
      const eq = $('#eEq').value.trim(); if (!eq) { $('#eErr').textContent = 'Informe o nome da equipe.'; return; }
      const r = await rpc('rt_criar_equipe', { nome: eq }); DB.sync.codigo = r.codigo; DB.sync.equipeNome = r.nome;
    } else {
      const cod = $('#eCod').value.replace(/[^A-Z0-9]/g, ''); if (cod.length !== 8) { $('#eErr').textContent = 'O código tem 8 letras/números.'; return; }
      const r = await rpc('rt_entrar', { codigo: cod }); DB.sync.codigo = cod.slice(0, 4) + '-' + cod.slice(4); DB.sync.equipeNome = r.nome;
    }
    DB.sync.desde = 0; DB.sync.erro = ''; salvar();
    /* o que já existia neste aparelho sobe para a equipe */
    todosTurnos().forEach(t => { marcar('turnos', t.id); t.ocorrencias.forEach(o => marcar('occs', o.id)); t.pendencias.forEach(p => marcar('pends', p.id)); });
    await sincronizar();
    toast(criar ? 'Equipe criada. O código está em Ajustes: passe aos colegas.' : 'Você entrou na equipe ' + DB.sync.equipeNome + '.');
    if (criar) ir('cfg'); else ir(turnoAtual() ? 'lan' : 'home');
  } catch (err) { $('#eErr').textContent = err.msg || 'Falha ao falar com o servidor.'; }
  finally { bt.disabled = false; }
});

/* ---------- Configurações ---------- */
function renderCfg() {
  const c = DB.cfg;
  $('#cTitulo').value = c.titulo; $('#cAreas').value = c.areas.join('\n');
  $('#cTurnos').value = c.turnos.map(t => t.nome + ', ' + t.ini + ', ' + t.fim).join('\n');
  $('#cLetras').value = c.letras.join(', '); $('#cEle').value = c.equipeEle.join(', '); $('#cMec').value = c.equipeMec.join(', ');
  $('#cTipEle').value = c.tiposEle.join(', '); $('#cTipMec').value = c.tiposMec.join(', '); $('#cEmoji').checked = !!c.emoji;
  $('#cNome').value = DB.sync.nome || ''; $('#sUrl').value = DB.sync.url || ''; $('#sKey').value = DB.sync.key || ''; $('#sErr').textContent = '';
  $('#bSairEq').hidden = !DB.sync.codigo;
  $('#cfgEqInfo').innerHTML = DB.sync.codigo
    ? '<p>Equipe: <b>' + esc(DB.sync.equipeNome) + '</b></p><p>Código da equipe: <b style="font-size:22px;letter-spacing:.12em">' + esc(DB.sync.codigo) + '</b></p><p class="hint">Passe este código aos colegas do turno (por exemplo no grupo do WhatsApp). Quem tem o código vê e lança no mesmo relatório, então não espalhe fora da equipe.</p><button type="button" class="btn" id="bCodCopy">Copiar código</button>'
    : (servidorOk() ? '<p class="hint">Você ainda não entrou numa equipe.</p><button type="button" class="btn pri" data-go="equipe">Entrar na equipe</button>' : '<p class="hint">Configure o servidor abaixo para usar o relatório compartilhado.</p>');
  const bc = $('#bCodCopy'); if (bc) bc.addEventListener('click', () => copiar('Código da equipe do Relatório de Turno: ' + DB.sync.codigo));
  $('#cIa').checked = DB.cfg.ia !== false;
  $('#cfgIa').textContent = equipeOk() ? 'Toque no microfone, fale a ocorrência do jeito que contaria a um colega e o app preenche os campos. Você só confere e lança.' : 'Sem equipe, a fala é organizada no próprio celular.';
  $('#cfgVer').textContent = 'Versão ' + VERSAO + (nativo ? ' · app' : ' · navegador');
}
$('#bNomeOk').addEventListener('click', () => { const n = $('#cNome').value.trim(); if (!n) { toast('Informe seu nome.'); return; } DB.sync.nome = n; salvar(); toast('Nome salvo.'); renderStatus(); });
$('#bSairEq').addEventListener('click', () => {
  if (!confirm('Sair da equipe apaga os turnos deste aparelho (eles continuam no servidor). Continuar?')) return;
  DB.sync.codigo = ''; DB.sync.equipeNome = ''; DB.sync.desde = 0; DB.sync.outbox = { turnos: [], occs: [], pends: [] }; DB.sync.erro = ''; DB.turnos = {}; salvar(); toast('Você saiu da equipe.'); ir('equipe');
});
$('#fSrv').addEventListener('submit', async e => {
  e.preventDefault();
  const url = $('#sUrl').value.trim().replace(/\/+$/, ''), key = $('#sKey').value.trim();
  if ((url && !/^https:\/\/[^\s/]+|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) || (url && !key) || (!url && key)) { $('#sErr').textContent = 'Informe a URL (https://…) e a chave, ou deixe os dois em branco para o modo individual.'; return; }
  const mudou = url !== DB.sync.url || key !== DB.sync.key;
  DB.sync.url = url; DB.sync.key = key; if (mudou) { DB.sync.desde = 0; }
  salvar(); toast(url ? 'Servidor salvo.' : 'Modo individual.'); renderCfg(); renderStatus();
  if (url && !DB.sync.codigo) ir('equipe'); else if (url) sincronizar();
});
$('#fCfg').addEventListener('submit', e => {
  e.preventDefault(); const c = DB.cfg;
  c.titulo = $('#cTitulo').value.trim() || CFG_PADRAO().titulo;
  c.areas = [...new Set($('#cAreas').value.split('\n').map(x => x.trim()).filter(Boolean))]; if (!c.areas.length) c.areas = CFG_PADRAO().areas;
  const turnos = $('#cTurnos').value.split('\n').map(l => l.split(/[,;]/).map(x => x.trim())).filter(p => p[0]).map(p => ({ nome: p[0], ini: toMin(p[1]) != null ? p[1] : '', fim: toMin(p[2]) != null ? p[2] : '' }));
  c.turnos = turnos.length ? turnos : CFG_PADRAO().turnos;
  c.letras = lista($('#cLetras').value); if (!c.letras.length) c.letras = CFG_PADRAO().letras;
  c.equipeEle = lista($('#cEle').value); c.equipeMec = lista($('#cMec').value); c.tiposEle = lista($('#cTipEle').value); c.tiposMec = lista($('#cTipMec').value);
  c.emoji = $('#cEmoji').checked; c.ia = $('#cIa').checked; salvar(); toast('Configurações salvas.'); ir('home');
});
$('#bExport').addEventListener('click', async () => {
  const tx = JSON.stringify(DB); const ok = await compartilhar(tx, 'Backup do Relatório de Turno');
  if (ok === null) { const ta = $('#taBackup'); ta.hidden = false; ta.value = tx; copiar(tx); }
});
$('#bImport').addEventListener('click', () => {
  const ta = $('#taBackup'); if (ta.hidden || !ta.value.trim()) { ta.hidden = false; ta.value = ''; ta.placeholder = 'Cole aqui o texto do backup e toque em Importar de novo'; ta.focus(); return; }
  try { const d = normalizaDB(JSON.parse(ta.value)); if (!confirm('Importar substitui todos os dados deste aparelho. Continuar?')) return; DB = d; salvar(); ta.hidden = true; ta.value = ''; $('#bkErr').textContent = ''; toast('Backup importado.'); renderTudo(); }
  catch (e) { $('#bkErr').textContent = 'Texto de backup inválido.'; }
});
$('#bApagar').addEventListener('click', () => {
  if (!confirm('Apagar os turnos, relatórios e configurações deste aparelho? (O que já subiu para a equipe continua no servidor.)')) return;
  if (!confirm('Tem certeza? Não dá para desfazer.')) return;
  const s = DB.sync; DB = { cfg: CFG_PADRAO(), sync: Object.assign(SYNC_PADRAO(), { url: s.url, key: s.key }), turnos: {} }; salvar(); if (Plug.Preferences) Plug.Preferences.remove({ key: KEY }).catch(() => {});
  toast('Dados apagados.'); renderTudo();
});

/* ---------- inicialização ---------- */
function renderTudo() {
  if (servidorOk() && !equipeOk()) { ir('equipe'); return; }
  ir(turnoAtual() ? 'lan' : 'home'); if (equipeOk()) sincronizar();
}
carregar(); renderTudo(); restaurarNativo();
if (nativo && Plug.App && Plug.App.addListener) {
  Plug.App.addListener('backButton', () => {
    if (window.Voz && Voz.aberta()) Voz.fechar(); else if (viewAtual === 'occ') ir(occVoltarPara); else if (viewAtual !== 'home') ir('home'); else Plug.App.exitApp();
  });
  Plug.App.addListener('appStateChange', s => { if (s && s.isActive) agendarSync(100); });
}
$('#cIa').addEventListener('change', () => { DB.cfg.ia = $('#cIa').checked; salvar(); toast(DB.cfg.ia ? 'IA ligada para a voz.' : 'Voz organizada só no celular.'); });
