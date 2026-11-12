/* Relatório de Turno: lógica do app.
   Tudo roda no aparelho. Não há servidor, login nem internet: os dados ficam no armazenamento local
   (localStorage, com cópia nas Preferences nativas quando o app roda dentro do Capacitor). */
'use strict';

const VERSAO = '1.0.0';
const KEY = 'relatorio-turno.v1';

/* ---------- utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const p2 = n => String(n).padStart(2, '0');
const hoje = () => { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
const agoraHM = () => { const d = new Date(); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const fd = s => String(s || '').split('-').reverse().join('/');
const toMin = s => { const x = String(s || '').split(':').map(Number); return x.length === 2 && !isNaN(x[0]) && !isNaN(x[1]) ? x[0] * 60 + x[1] : null; };
const durMin = (a, b) => { const x = toMin(a), y = toMin(b); if (x == null || y == null) return null; const d = y - x; return d < 0 ? d + 1440 : d; };
const fmtDur = m => m == null ? '' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + p2(m % 60) + ' min';
const lista = s => String(s || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
const juntar = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' e ' + a[a.length - 1] : (a[0] || '');
const normEq = s => String(s || '').toLowerCase().replace(/[\s\-_.]/g, '');
const limpa = s => String(s == null ? '' : s).replace(/\*/g, '').trim();
let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }

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
  emoji: false, ultimaLetra: ''
});
let DB = { cfg: CFG_PADRAO(), atual: null, turnos: {}, ordem: [] };

function normalizaDB(d) {
  if (!d || typeof d !== 'object') throw new Error('formato');
  const c = Object.assign(CFG_PADRAO(), d.cfg || {});
  if (!Array.isArray(c.areas) || !c.areas.length) c.areas = CFG_PADRAO().areas;
  if (!Array.isArray(c.turnos) || !c.turnos.length) c.turnos = CFG_PADRAO().turnos;
  if (!Array.isArray(c.letras) || !c.letras.length) c.letras = CFG_PADRAO().letras;
  ['equipeEle', 'equipeMec', 'tiposEle', 'tiposMec'].forEach(k => { if (!Array.isArray(c[k])) c[k] = []; });
  const turnos = (d.turnos && typeof d.turnos === 'object') ? d.turnos : {};
  Object.values(turnos).forEach(t => { t.ocorrencias = t.ocorrencias || []; t.pendencias = t.pendencias || []; t.equipe = t.equipe || { ele: [], mec: [] }; });
  const ordem = Array.isArray(d.ordem) ? d.ordem.filter(id => turnos[id]) : Object.keys(turnos);
  Object.keys(turnos).forEach(id => { if (!ordem.includes(id)) ordem.push(id); });
  return { cfg: c, atual: d.atual && turnos[d.atual] ? d.atual : null, turnos, ordem };
}
function carregar() {
  try { const s = localStorage.getItem(KEY); if (s) DB = normalizaDB(JSON.parse(s)); } catch (e) { console.warn('dados locais ilegíveis', e); }
}
async function restaurarNativo() {
  if (!Plug.Preferences || localStorage.getItem(KEY)) return;
  try {
    const r = await Plug.Preferences.get({ key: KEY });
    if (r && r.value) { DB = normalizaDB(JSON.parse(r.value)); localStorage.setItem(KEY, r.value); renderTudo(); }
  } catch (e) { console.warn('preferences', e); }
}
let salvarT;
function salvar() {
  const s = JSON.stringify(DB);
  try { localStorage.setItem(KEY, s); } catch (e) { toast('Não foi possível gravar: memória cheia?'); }
  if (Plug.Preferences) { clearTimeout(salvarT); salvarT = setTimeout(() => Plug.Preferences.set({ key: KEY, value: s }).catch(() => {}), 250); }
}

/* ---------- navegação ---------- */
let viewAtual = 'home';
const views = { home: 'vHome', lan: 'vLan', occ: 'vOcc', fechar: 'vFechar', rel: 'vRel', hist: 'vHist', cfg: 'vCfg' };
function ir(v) {
  if (v === 'occ-novo') { abrirOcc(null); return; }
  if ((v === 'lan' || v === 'fechar') && !DB.atual) { toast('Inicie um turno primeiro.'); v = 'home'; }
  Object.entries(views).forEach(([k, id]) => $('#' + id).hidden = k !== v);
  $$('nav.tabs button').forEach(b => { const t = b.dataset.tab; const on = t === v || (t === 'lan' && (v === 'occ' || v === 'fechar')) || (t === 'hist' && v === 'rel' && !relTurnoAtivo()); b.toggleAttribute('aria-current', on); if (on) b.setAttribute('aria-current', 'page'); });
  viewAtual = v;
  if (v === 'home') renderHome(); if (v === 'lan') renderLan(); if (v === 'fechar') renderFechar(); if (v === 'hist') renderHist(); if (v === 'cfg') renderCfg();
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) { ir(g.dataset.go); return; }
  const t = e.target.closest('nav.tabs button'); if (t) ir(t.dataset.tab);
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

/* ---------- turno atual ---------- */
const turnoAtual = () => DB.atual ? DB.turnos[DB.atual] : null;
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
function ultimoEncerrado(excetoId) {
  const ids = [...DB.ordem].reverse();
  for (const id of ids) { const t = DB.turnos[id]; if (t && t.encerradoEm && id !== excetoId) return t; }
  return null;
}

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
    montaChips($('#iEle'), c.equipeEle, chipSel($('#iEle'))); montaChips($('#iMec'), c.equipeMec, chipSel($('#iMec')));
    if (!c.equipeEle.length) $('#iEle').innerHTML = '<span class="hint">Nenhum nome cadastrado. Cadastre em Ajustes ou informe no fechamento.</span>';
    if (!c.equipeMec.length) $('#iMec').innerHTML = '<span class="hint">Nenhum nome cadastrado.</span>';
  } else {
    $('#haTit').textContent = tituloTurno(t);
    const tc = turnoCfg(t.turno);
    $('#haSub').textContent = (tc ? tc.ini + ' às ' + tc.fim + ' · ' : '') + 'iniciado às ' + t.iniciadoEm;
    const o = t.ocorrencias, r = o.filter(x => x.rascunho).length;
    $('#haStats').innerHTML = '<div><b>' + o.filter(x => x.esp === 'ele').length + '</b><span>elétrica</span></div><div><b>' + o.filter(x => x.esp === 'mec').length + '</b><span>mecânica</span></div><div><b>' + r + '</b><span>rascunho' + (r === 1 ? '' : 's') + '</span></div>';
  }
  const rec = DB.ordem.filter(id => DB.turnos[id].encerradoEm).reverse().slice(0, 3);
  $('#homeRec').hidden = !rec.length;
  $('#homeRecList').innerHTML = rec.map(id => linhaHist(DB.turnos[id])).join('');
}
function linhaHist(t) {
  const n = t.ocorrencias.length;
  return '<button type="button" class="hist" data-rel="' + t.id + '"><span><b>' + esc(tituloTurno(t)) + '</b><br><span class="mut sm">' + n + ' ocorrência' + (n === 1 ? '' : 's') + (t.encerradoEm ? ' · encerrado às ' + esc(t.encerradoEm) : ' · em andamento') + '</span></span><span class="mut">›</span></button>';
}
document.addEventListener('click', e => { const b = e.target.closest('[data-rel]'); if (b) mostrarRel(b.dataset.rel); });
chips($('#iEle'), true); chips($('#iMec'), true);
$('#fIni').addEventListener('submit', e => {
  e.preventDefault();
  const data = $('#iData').value; if (!data) { $('#iniErr').textContent = 'Informe a data.'; return; }
  const id = uid(), ant = ultimoEncerrado();
  const t = { id, data, turno: $('#iTurno').value, letra: $('#iLetra').value, iniciadoEm: agoraHM(), criadoEm: Date.now(), encerradoEm: null,
    equipe: { ele: chipSel($('#iEle')), mec: chipSel($('#iMec')) }, ocorrencias: [], pendencias: [], obs: '' };
  if (ant) ant.pendencias.filter(p => p.status !== 'concluida').forEach(p => t.pendencias.push({ id: uid(), esp: p.esp, texto: p.texto, origem: 'recebida', de: tituloTurno(ant), status: 'aberta' }));
  DB.turnos[id] = t; DB.ordem.push(id); DB.atual = id; DB.cfg.ultimaLetra = t.letra; salvar();
  $('#iniErr').textContent = ''; $('#iData').value = '';
  toast('Turno iniciado.'); ir('lan');
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
    + '<div class="sm mut">' + esc(meta.join(' · ')) + '</div>' + linhas.join('')
    + '<div class="act"><button type="button" class="btn" data-ed="' + o.id + '">' + (o.rascunho ? 'Completar' : 'Editar') + '</button><button type="button" class="btn" data-dup="' + o.id + '">Duplicar</button></div></section>';
}
function renderLan() {
  const t = turnoAtual(); if (!t) return;
  $('#lanSub').textContent = tituloTurno(t);
  const o = [...t.ocorrencias].sort((a, b) => (b.rascunho - a.rascunho) || (toMin(a.hi) || 0) - (toMin(b.hi) || 0));
  $('#lanLista').innerHTML = o.length ? '<h3>' + o.length + ' lançamento' + (o.length === 1 ? '' : 's') + '</h3>' + o.map(cardOcc).join('') : '<p class="note info sm">Nenhuma ocorrência lançada ainda. Se o turno terminar assim, o relatório sai como "sem ocorrências".</p>';
  montaDatalist();
}
$('#lanLista').addEventListener('click', e => {
  const ed = e.target.closest('[data-ed]'); if (ed) { abrirOcc(ed.dataset.ed); return; }
  const dp = e.target.closest('[data-dup]');
  if (dp) { const o = turnoAtual().ocorrencias.find(x => x.id === dp.dataset.dup); if (!o) return; abrirOcc(null, Object.assign({}, o, { id: null, hi: '', hf: '', tm: '', rascunho: false })); }
});
chips($('#qEsp'), false);
$('#fQuick').addEventListener('submit', e => {
  e.preventDefault();
  const eq = $('#qEq').value.trim(); if (!eq) { $('#qEq').focus(); return; }
  const t = turnoAtual();
  t.ocorrencias.push({ id: uid(), esp: chipSel($('#qEsp'))[0] || 'ele', area: '', eq, tipo: '', falha: '', acao: '', hi: agoraHM(), hf: '', parou: '', tm: '', sit: '', obs: '', pend: false, quem: [], rascunho: true, criadoEm: Date.now() });
  salvar(); $('#qEq').value = ''; toast('Rascunho aberto às ' + agoraHM() + '. Complete depois.'); renderLan();
});
function todasOcc() { return DB.ordem.flatMap(id => DB.turnos[id].ocorrencias.map(o => Object.assign({ _t: DB.turnos[id] }, o))); }
function montaDatalist() {
  const vistos = new Set(), eqs = [];
  todasOcc().sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0)).forEach(o => { const k = normEq(o.eq); if (o.eq && !vistos.has(k)) { vistos.add(k); eqs.push(o.eq); } });
  $('#dlEq').innerHTML = eqs.slice(0, 200).map(v => '<option value="' + esc(v) + '">').join('');
}

/* ---------- Formulário de ocorrência ---------- */
let occId = null, occVoltarPara = 'lan';
const vazio = () => ({ esp: 'ele', area: '', eq: '', tipo: '', falha: '', acao: '', hi: '', hf: '', parou: '', tm: '', sit: '', obs: '', pend: false, quem: [], rascunho: false });
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
  const t = turnoAtual(); const base = (esp === 'mec' ? t.equipe.mec : t.equipe.ele) || [];
  const extra = sel.filter(n => !base.includes(n)); montaChips($('#oQuem'), [...base, ...extra], sel);
  if (!base.length && !extra.length) $('#oQuem').innerHTML = '<span class="hint">Equipe não informada ao iniciar o turno. Digite o nome abaixo.</span>';
}
chips($('#oEsp'), false, v => { montaTipos(v[0], ''); montaQuem(v[0], []); historicoEq(); });
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
  const t = turnoAtual(); o.rascunho = rascunho;
  /* mesma grafia para o mesmo equipamento: "vt 03" vira "VT-03" se já existe assim */
  const k = normEq(o.eq), ant = k && todasOcc().find(x => x.id !== occId && normEq(x.eq) === k); if (ant) o.eq = ant.eq;
  if (occId) { const i = t.ocorrencias.findIndex(x => x.id === occId); Object.assign(t.ocorrencias[i], o); o = t.ocorrencias[i]; }
  else { o.id = uid(); o.criadoEm = Date.now(); t.ocorrencias.push(o); }
  /* pendência ligada à ocorrência: criada quando ficou pendente, ou paliativo com a caixa marcada */
  const quer = !rascunho && (o.sit === 'pendente' || (o.sit === 'paliativo' && o.pend));
  const i = t.pendencias.findIndex(p => p.occId === o.id);
  const txt = (o.eq ? o.eq + ': ' : '') + (o.obs || (o.sit === 'pendente' ? 'atendimento não concluído' : 'paliativo, precisa de serviço definitivo'));
  if (quer && i < 0) t.pendencias.push({ id: uid(), esp: o.esp, texto: txt, origem: 'turno', occId: o.id, status: 'aberta' });
  else if (quer) { t.pendencias[i].texto = txt; t.pendencias[i].esp = o.esp; }
  else if (i >= 0) t.pendencias.splice(i, 1);
  salvar();
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
  const t = turnoAtual(); t.ocorrencias = t.ocorrencias.filter(x => x.id !== occId); t.pendencias = t.pendencias.filter(p => p.occId !== occId); salvar(); ir('lan');
});
$('#occVoltar').addEventListener('click', () => ir(occVoltarPara));

/* ---------- Fechamento ---------- */
function avisos(t) {
  const a = [];
  const r = t.ocorrencias.filter(o => o.rascunho).length;
  if (r) a.push({ tipo: 'err', tx: r + ' rascunho' + (r > 1 ? 's' : '') + ' sem completar. Complete ou exclua antes de encerrar.' });
  t.ocorrencias.filter(o => !o.rascunho).forEach(o => {
    const d = durMin(o.hi, o.hf);
    if (o.parou === 'sim' && d != null && Number(o.tm) > d) a.push({ tipo: 'warn', tx: o.eq + ': tempo parado (' + fmtDur(Number(o.tm)) + ') maior que a duração do atendimento (' + fmtDur(d) + ').' });
    if (d != null && d > 600) a.push({ tipo: 'warn', tx: o.eq + ': atendimento com ' + fmtDur(d) + '. Confira as horas.' });
    if (!o.quem.length) a.push({ tipo: 'warn', tx: o.eq + ': sem nome de quem atendeu.' });
  });
  if (!t.ocorrencias.length) a.push({ tipo: 'info', tx: 'Nenhuma ocorrência lançada: o relatório sairá como "sem ocorrências".' });
  return a;
}
function renderFechar() {
  const t = turnoAtual(); if (!t) return;
  $('#fAvisos').innerHTML = avisos(t).map(x => '<div class="note ' + x.tipo + '">' + esc(x.tx) + '</div>').join('');
  renderPend(t);
  $('#fEqEle').value = t.equipe.ele.join(', '); $('#fEqMec').value = t.equipe.mec.join(', '); $('#fObs').value = t.obs || '';
  $('#fConf').checked = false; $('#fErr').textContent = '';
}
function renderPend(t) {
  const el = $('#pendLista');
  if (!t.pendencias.length) { el.innerHTML = '<p class="hint">Nenhuma pendência registrada.</p>'; return; }
  el.innerHTML = t.pendencias.map(p => '<div class="pend' + (p.status === 'concluida' ? ' done' : '') + '"><div class="tx"><span class="pill ' + p.esp + '">' + ESP[p.esp].nome + '</span> ' + esc(p.texto)
    + (p.origem === 'recebida' ? '<br><span class="hint">recebida de ' + esc(p.de) + '</span>' : (p.occId ? '<br><span class="hint">gerada por uma ocorrência deste turno</span>' : '')) + '</div>'
    + (p.status === 'concluida' ? '<button type="button" class="btn" data-pre="' + p.id + '">Reabrir</button>' : '<button type="button" class="btn ok" data-pok="' + p.id + '">Concluída</button>')
    + (p.occId ? '' : '<button type="button" class="btn danger" data-pdel="' + p.id + '" aria-label="Remover">✕</button>') + '</div>').join('');
}
$('#pendLista').addEventListener('click', e => {
  const t = turnoAtual(); const b = e.target.closest('[data-pok],[data-pre],[data-pdel]'); if (!b) return;
  if (b.dataset.pok) t.pendencias.find(p => p.id === b.dataset.pok).status = 'concluida';
  if (b.dataset.pre) t.pendencias.find(p => p.id === b.dataset.pre).status = 'aberta';
  if (b.dataset.pdel && confirm('Remover esta pendência?')) t.pendencias = t.pendencias.filter(p => p.id !== b.dataset.pdel);
  salvar(); renderPend(t);
});
chips($('#pEsp'), false);
$('#fPend').addEventListener('submit', e => {
  e.preventDefault(); const tx = $('#pTx').value.trim(); if (!tx) return;
  const t = turnoAtual(); t.pendencias.push({ id: uid(), esp: chipSel($('#pEsp'))[0] || 'ele', texto: tx, origem: 'turno', status: 'aberta' }); salvar(); $('#pTx').value = ''; renderPend(t);
});
['fEqEle', 'fEqMec', 'fObs'].forEach(id => $('#' + id).addEventListener('change', () => { const t = turnoAtual(); if (!t) return; t.equipe.ele = lista($('#fEqEle').value); t.equipe.mec = lista($('#fEqMec').value); t.obs = $('#fObs').value.trim(); salvar(); }));
$('#bEncerrar').addEventListener('click', () => {
  const t = turnoAtual(); if (!t) return;
  t.equipe.ele = lista($('#fEqEle').value); t.equipe.mec = lista($('#fEqMec').value); t.obs = $('#fObs').value.trim();
  if (t.ocorrencias.some(o => o.rascunho)) { $('#fErr').textContent = 'Há rascunhos sem completar. Volte aos lançamentos e complete ou exclua.'; return; }
  if (!$('#fConf').checked) { $('#fErr').textContent = 'Confirme com a equipe que tudo foi lançado.'; return; }
  t.encerradoEm = agoraHM(); t.encerradoTs = Date.now(); t.texto = textoRelatorio(t); DB.atual = null; salvar();
  toast('Turno encerrado. Relatório pronto.'); mostrarRel(t.id);
});

/* ---------- Texto do relatório (formato WhatsApp) ---------- */
function textoRelatorio(t) {
  const c = DB.cfg, E = c.emoji, L = [];
  const H = (tx, em) => L.push('*' + (E && em ? em + ' ' : '') + tx + '*');
  const tc = turnoCfg(t.turno);
  H(limpa(c.titulo).toUpperCase(), '📋');
  L.push('Data: ' + fd(t.data) + ' | Turno ' + t.turno + (tc ? ' (' + tc.ini + ' às ' + tc.fim + ')' : '') + ' | Letra ' + t.letra);
  const occ = t.ocorrencias.filter(o => !o.rascunho);
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
  const pa = t.pendencias.filter(p => p.status !== 'concluida'), pc = t.pendencias.filter(p => p.status === 'concluida');
  L.push(''); H('PENDÊNCIAS PARA O PRÓXIMO TURNO', '⏭️');
  if (pa.length) pa.forEach(p => L.push('- [' + ESP[p.esp].nome + '] ' + limpa(p.texto) + (p.origem === 'recebida' ? ' (vem de turno anterior)' : ''))); else L.push('Nenhuma.');
  if (pc.length) L.push('Concluídas neste turno: ' + pc.map(p => limpa(p.texto)).join('; ') + '.');
  if (t.obs) { L.push(''); H('OBSERVAÇÕES', '📝'); L.push(limpa(t.obs)); }
  L.push(''); H('EQUIPE', '👷');
  L.push('Elétrica: ' + (t.equipe.ele.length ? juntar(t.equipe.ele.map(limpa)) : 'não informada'));
  L.push('Mecânica: ' + (t.equipe.mec.length ? juntar(t.equipe.mec.map(limpa)) : 'não informada'));
  L.push('Turno encerrado às ' + (t.encerradoEm || agoraHM()) + '.');
  return L.join('\n');
}

/* ---------- Relatório: ver, enviar, reabrir ---------- */
let relId = null;
const relTurnoAtivo = () => relId && DB.atual === relId;
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
  /* No app nativo a folha de compartilhar permite escolher direto o grupo; o link whatsapp:// é a alternativa */
  const ok = await compartilhar(tx, tituloTurno(t));
  if (ok === null) { if (!(await abrirWhatsApp(tx))) copiar(tx); }
});
$('#bShare').addEventListener('click', async () => { const tx = $('#taCopy').value; const ok = await compartilhar(tx, 'Relatório de turno'); if (ok === null) copiar(tx); });
$('#bCopy').addEventListener('click', () => copiar($('#taCopy').value));
$('#bReabrir').addEventListener('click', () => {
  const t = DB.turnos[relId]; if (!t) return;
  if (DB.atual) { toast('Encerre o turno em andamento antes de reabrir outro.'); return; }
  if (!confirm('Reabrir o turno ' + tituloTurno(t) + '? Será preciso encerrar de novo para gerar o relatório.')) return;
  t.encerradoEm = null; t.texto = ''; DB.atual = t.id; salvar(); ir('lan');
});

/* ---------- Histórico ---------- */
function renderHist() {
  const ids = [...DB.ordem].reverse();
  $('#histLista').innerHTML = ids.length ? ids.map(id => linhaHist(DB.turnos[id])).join('') : '<p class="hint" style="padding:10px 0">Nenhum turno registrado ainda.</p>';
}

/* ---------- Configurações ---------- */
function renderCfg() {
  const c = DB.cfg;
  $('#cTitulo').value = c.titulo; $('#cAreas').value = c.areas.join('\n');
  $('#cTurnos').value = c.turnos.map(t => t.nome + ', ' + t.ini + ', ' + t.fim).join('\n');
  $('#cLetras').value = c.letras.join(', '); $('#cEle').value = c.equipeEle.join(', '); $('#cMec').value = c.equipeMec.join(', ');
  $('#cTipEle').value = c.tiposEle.join(', '); $('#cTipMec').value = c.tiposMec.join(', '); $('#cEmoji').checked = !!c.emoji;
  $('#cfgVer').textContent = 'Versão ' + VERSAO + (nativo ? ' · app' : ' · navegador');
}
$('#fCfg').addEventListener('submit', e => {
  e.preventDefault(); const c = DB.cfg;
  c.titulo = $('#cTitulo').value.trim() || CFG_PADRAO().titulo;
  c.areas = [...new Set($('#cAreas').value.split('\n').map(x => x.trim()).filter(Boolean))]; if (!c.areas.length) c.areas = CFG_PADRAO().areas;
  const turnos = $('#cTurnos').value.split('\n').map(l => l.split(/[,;]/).map(x => x.trim())).filter(p => p[0]).map(p => ({ nome: p[0], ini: toMin(p[1]) != null ? p[1] : '', fim: toMin(p[2]) != null ? p[2] : '' }));
  c.turnos = turnos.length ? turnos : CFG_PADRAO().turnos;
  c.letras = lista($('#cLetras').value); if (!c.letras.length) c.letras = CFG_PADRAO().letras;
  c.equipeEle = lista($('#cEle').value); c.equipeMec = lista($('#cMec').value); c.tiposEle = lista($('#cTipEle').value); c.tiposMec = lista($('#cTipMec').value);
  c.emoji = $('#cEmoji').checked; salvar(); toast('Configurações salvas.'); ir('home');
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
  if (!confirm('Apagar TODOS os turnos, relatórios e configurações deste aparelho?')) return;
  if (!confirm('Tem certeza? Não dá para desfazer.')) return;
  DB = { cfg: CFG_PADRAO(), atual: null, turnos: {}, ordem: [] }; salvar(); if (Plug.Preferences) Plug.Preferences.remove({ key: KEY }).catch(() => {});
  toast('Dados apagados.'); renderTudo();
});

/* ---------- inicialização ---------- */
function renderTudo() { ir(DB.atual ? 'lan' : 'home'); }
carregar(); renderTudo(); restaurarNativo();
if (nativo && Plug.App && Plug.App.addListener) {
  Plug.App.addListener('backButton', () => {
    if (viewAtual === 'occ') ir(occVoltarPara); else if (viewAtual !== 'home') ir('home'); else Plug.App.exitApp();
  });
}
