/* Lançamento por voz: ouvir -> organizar (IA do servidor ou interpretador local) -> revisar -> lançar. */
'use strict';
(function () {
  const SR = Plug.SpeechRecognition || null;
  const WebSR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const ov = $('#vozOv');
  let estado = 'fechado', gravando = false, textoFinal = '', parcial = '', webRec = null, cartoes = [], fonte = '', motivoLocal = '';

  const vibra = (tipo) => {
    try {
      if (Plug.Haptics) { tipo === 'ok' ? Plug.Haptics.notification({ type: 'SUCCESS' }) : Plug.Haptics.impact({ style: tipo === 'forte' ? 'HEAVY' : 'MEDIUM' }); }
      else if (navigator.vibrate) navigator.vibrate(tipo === 'ok' ? [20, 60, 30] : 18);
    } catch (e) { /* sem vibração */ }
  };
  window.vibra = vibra;

  function mostra(fase) {
    estado = fase;
    $('#vozOuv').hidden = fase !== 'ouvindo'; $('#vozOuvBot').hidden = fase !== 'ouvindo';
    $('#vozKbd').hidden = fase !== 'digitar'; $('#vozPen').hidden = fase !== 'pensando'; $('#vozRev').hidden = fase !== 'revisao';
    $('#vozTit').lastChild.textContent = fase === 'revisao' ? ' Confira e lance' : fase === 'digitar' ? ' Descrever a ocorrência' : ' Lançar por voz';
  }
  function renderTx() {
    const el = $('#vozTx'); el.innerHTML = '';
    if (textoFinal) el.append(document.createTextNode(textoFinal + ' '));
    if (parcial) { const s = document.createElement('span'); s.className = 'par'; s.textContent = parcial; el.append(s); }
  }

  /* ---------- captura ---------- */
  async function permissaoNativa() {
    try {
      const a = await SR.available(); if (!a || !a.available) return false;
      let p = await SR.checkPermissions();
      if (p.speechRecognition !== 'granted') p = await SR.requestPermissions();
      return p.speechRecognition === 'granted';
    } catch (e) { return false; }
  }
  let ouvintes = [], ultimoCommit = '', reiniciando = false, cortou = false;
  const palavras = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  /* Alguns Android avisam "parou" mas continuam a mesma frase, mandando de novo o que já foi guardado.
     Se o começo do parcial repete o último trecho guardado, corta essa parte. */
  const compacto = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  function distancia(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let ant = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) cur[j] = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      [ant, cur] = [cur, ant];
    }
    return ant[n];
  }
  /* Alguns Android avisam "parou" mas continuam a mesma frase e mandam de novo o que já foi guardado,
     às vezes com grafia diferente ("rear-me" / "reame"). Procura o começo do parcial que corresponde
     ao último trecho guardado (comparação aproximada, letra a letra) e corta essa parte. */
  function semRepeticao(p) {
    const ca = compacto(ultimoCommit); if (!ca || !p) return p;
    const pal = String(p).trim().split(/\s+/);
    let melhor = -1, menor = Infinity, acc = '';
    for (let k = 0; k < pal.length; k++) {
      acc += compacto(pal[k]);
      if (acc.length < ca.length * 0.7) continue;
      if (acc.length > ca.length * 1.3) break;
      const d = distancia(acc, ca) / ca.length;
      if (d < menor) { menor = d; melhor = k; }
    }
    if (melhor >= 0 && menor <= 0.2) return pal.slice(melhor + 1).join(' ');
    /* parcial ainda mais curto que o trecho guardado e igual ao começo dele: é repetição em andamento */
    const cp = compacto(p);
    if (cp.length < ca.length && distancia(cp, ca.slice(0, cp.length)) / Math.max(1, cp.length) <= 0.2) return '';
    return p;
  }
  const opcoes = { language: 'pt-BR', partialResults: true, popup: false, maxResults: 1 };
  async function iniciarNativo() {
    ouvintes.forEach(h => h && h.remove && h.remove()); ouvintes = []; ultimoCommit = '';
    ouvintes.push(await SR.addListener('partialResults', d => {
      if (estado !== 'ouvindo') return;
      const bruto = (d.matches && d.matches[0]) || ''; parcial = semRepeticao(bruto); cortou = parcial !== bruto; renderTx();
    }));
    ouvintes.push(await SR.addListener('listeningState', d => {
      if (d.status !== 'stopped' || estado !== 'ouvindo') return;
      if (parcial) { textoFinal = (textoFinal + ' ' + parcial).trim(); ultimoCommit = cortou ? (ultimoCommit + ' ' + parcial).trim() : parcial; parcial = ''; cortou = false; renderTx(); }
      /* o Android encerra após uma pausa: se o executante ainda não tocou em Pronto, continua ouvindo */
      if (gravando && !reiniciando) {
        reiniciando = true;
        setTimeout(async () => {
          try { const s = await comPrazo(SR.isListening(), 600); if (gravando && !(s && s.listening)) await comPrazo(SR.start(opcoes), 1500); } catch (e) { /* tenta na próxima pausa */ }
          reiniciando = false;
        }, 200);
      }
    }));
    await comPrazo(SR.start(opcoes), 3000);
  }
  /* nunca deixa a tela presa esperando o microfone responder */
  const comPrazo = (pr, ms) => Promise.race([Promise.resolve(pr).catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);
  function iniciarWeb() {
    webRec = new WebSR(); webRec.lang = 'pt-BR'; webRec.continuous = true; webRec.interimResults = true;
    webRec.onresult = ev => {
      let fin = '', par = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) fin += r[0].transcript; else par += r[0].transcript; }
      if (fin) textoFinal = (textoFinal + ' ' + fin).trim(); parcial = par; renderTx();
    };
    webRec.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { gravando = false; toast('Microfone bloqueado. Use "Prefiro digitar".'); paraDigitar(); } };
    webRec.onend = () => { if (gravando && estado === 'ouvindo') { try { webRec.start(); } catch (e) { /* já ativo */ } } };
    webRec.start();
  }
  async function ouvir() {
    textoFinal = ''; parcial = ''; ultimoCommit = ''; renderTx(); mostra('ouvindo'); vibra();
    if (nativo && SR) {
      if (!(await permissaoNativa())) { toast('Sem permissão de microfone. Você pode digitar.'); paraDigitar(); return; }
      gravando = true; try { await iniciarNativo(); } catch (e) { gravando = false; toast('Não consegui ligar o microfone. Você pode digitar.'); paraDigitar(); }
    } else if (WebSR) { gravando = true; try { iniciarWeb(); } catch (e) { gravando = false; paraDigitar(); } }
    else paraDigitar();
  }
  async function pararCaptura() {
    gravando = false;
    if (parcial) { textoFinal = (textoFinal + ' ' + parcial).trim(); parcial = ''; }
    const ouv = ouvintes; ouvintes = [];
    if (nativo && SR) { await comPrazo(SR.stop(), 700); ouv.forEach(h => { try { h && h.remove && h.remove(); } catch (e) { /* já removido */ } }); }
    if (webRec) { try { webRec.stop(); } catch (e) { /* já parado */ } webRec = null; }
  }
  function paraDigitar() { mostra('digitar'); $('#vozTa').value = textoFinal || ''; setTimeout(() => $('#vozTa').focus(), 60); }

  /* ---------- organizar ---------- */
  function contexto() {
    const t = turnoAtual(), vistos = new Set(), eqs = [];
    todasOcc().sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0)).forEach(o => { const k = normEq(o.eq); if (o.eq && !vistos.has(k)) { vistos.add(k); eqs.push(o.eq); } });
    const equipe = [...new Set([...(t ? t.equipe.ele : []), ...(t ? t.equipe.mec : []), ...DB.cfg.equipeEle, ...DB.cfg.equipeMec, meuNome()].filter(Boolean))];
    return { agora: agoraHM(), areas: DB.cfg.areas, tiposEle: DB.cfg.tiposEle, tiposMec: DB.cfg.tiposMec, equipe, equipamentos: eqs.slice(0, 300) };
  }
  async function organizarServidor(texto, ctx) {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 12000);
    try {
      const r = await fetch(DB.sync.url.replace(/\/+$/, '') + '/functions/v1/rt-voz', { method: 'POST', signal: ac.signal,
        headers: { 'Content-Type': 'application/json', apikey: DB.sync.key, Authorization: 'Bearer ' + DB.sync.key }, body: JSON.stringify({ codigo: DB.sync.codigo, texto, ctx }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok || !Array.isArray(j.ocorrencias) || !j.ocorrencias.length) throw new Error((j && j.erro) || ('http ' + r.status));
      return j.ocorrencias;
    } finally { clearTimeout(tm); }
  }
  const casa = (v, lista) => { if (!v) return ''; const k = normEq(v); return lista.find(x => normEq(x) === k) || lista.find(x => normEq(x).includes(k) || k.includes(normEq(x))) || ''; };
  function normaliza(o, ctx) {
    const esp = o.esp === 'mec' ? 'mec' : 'ele';
    const quem = (Array.isArray(o.quem) ? o.quem : []).map(n => casa(n, ctx.equipe) || n).filter(Boolean);
    const hhmm = v => /^\d{1,2}:\d{2}$/.test(String(v || '')) ? String(v).padStart(5, '0') : '';
    return { esp, area: casa(o.area, DB.cfg.areas), eq: String(o.eq || '').trim(), tipo: casa(o.tipo, esp === 'mec' ? DB.cfg.tiposMec : DB.cfg.tiposEle),
      falha: String(o.falha || '').trim(), acao: String(o.acao || '').trim(), hi: hhmm(o.hi), hf: hhmm(o.hf),
      parou: o.parou === 'sim' || o.parou === 'nao' ? o.parou : '', tm: Number(o.tm) > 0 ? String(Math.round(Number(o.tm))) : '',
      sit: ['resolvido', 'paliativo', 'pendente'].includes(o.sit) ? o.sit : '', obs: String(o.obs || '').trim(), pend: o.sit === 'paliativo',
      quem: quem.length ? quem : (meuNome() ? [meuNome()] : []) };
  }
  async function organizar(texto) {
    texto = String(texto || '').trim();
    if (texto.length < 4) { toast('Não entendi nada. Tente de novo.'); ouvir(); return; }
    mostra('pensando'); $('#vozPenTx').textContent = '“' + texto + '”';
    const ctx = contexto(); let lista = null; fonte = 'local';
    if (equipeOk() && DB.cfg.ia !== false && navigator.onLine !== false) {
      try { lista = await organizarServidor(texto, ctx); fonte = 'ia'; } catch (e) {
        const m = String(e && e.message || '');
        motivoLocal = m === 'sem-chave' ? 'A IA ainda não foi ligada no servidor (falta cadastrar a chave da Anthropic).'
          : m === 'limite-diario' ? 'A equipe atingiu o limite diário de uso da IA.'
          : m === 'chave-invalida' ? 'A chave da IA cadastrada no servidor é inválida.'
          : /abort/i.test(m) ? 'A IA demorou demais para responder.' : 'A IA não respondeu.';
      }
    } else motivoLocal = !equipeOk() ? 'Sem equipe configurada.' : DB.cfg.ia === false ? 'A IA está desligada em Ajustes.' : 'Sem internet.';
    if (fonte === 'ia') motivoLocal = '';
    if (!lista) { await new Promise(r => setTimeout(r, 350)); lista = Interpretador.interpretar(texto, ctx).ocorrencias; }
    cartoes = lista.map(o => normaliza(o, ctx));
    cartoes.forEach(c => { c._texto = texto; });
    renderCartoes(); mostra('revisao'); requestAnimationFrame(() => $$('#vozCards textarea').forEach(autoAltura)); vibra();
  }

  /* ---------- revisão ---------- */
  const ic = (n, c) => '<svg class="ic' + (c ? ' ' + c : '') + '"><use href="#i-' + n + '"/></svg>';
  function faltas(c) {
    const f = [];
    if (!c.eq) f.push('eq'); if (!c.area) f.push('area'); if (!c.falha) f.push('falha'); if (!c.acao) f.push('acao');
    if (!c.hi) f.push('hi'); if (!c.hf && c.sit !== 'pendente') f.push('hf'); if (!c.parou) f.push('parou'); if (c.parou === 'sim' && !(Number(c.tm) > 0)) f.push('tm'); if (!c.sit) f.push('sit');
    return f;
  }
  const NOMES = { eq: 'equipamento', area: 'área', falha: 'o que aconteceu', acao: 'o que foi feito', hi: 'início', hf: 'fim', parou: 'se parou', tm: 'tempo parado', sit: 'situação' };
  function chipsHtml(campo, i, opcoes, atual) {
    return opcoes.map(([v, r]) => '<button type="button" class="chip" data-c="' + campo + '" data-i="' + i + '" data-v="' + esc(v) + '" aria-pressed="' + (atual === v) + '">' + esc(r) + '</button>').join('');
  }
  function renderCartoes() {
    $('#vozCards').innerHTML = cartoes.map((c, i) => {
      const f = faltas(c), fl = k => f.includes(k) ? ' falta' : '';
      const d = durMin(c.hi, c.hf);
      return '<section class="rcard" style="animation-delay:' + (i * 80) + 'ms">'
        + '<div class="rh"><button type="button" class="espt ' + c.esp + '" data-esp-t="' + i + '">' + ic(c.esp === 'mec' ? 'tool' : 'bolt', 's') + (c.esp === 'mec' ? 'Mecânica' : 'Elétrica') + '</button>'
        + '<input data-f="eq" data-i="' + i + '" value="' + esc(c.eq) + '" placeholder="Equipamento" list="dlEq" aria-label="Equipamento"' + (f.includes('eq') ? ' style="box-shadow:inset 0 -2px 0 var(--warn)"' : '') + '></div>'
        + '<div class="campo' + fl('area') + '">' + ic('pin') + '<div><div class="lb">Área</div><div class="mini">' + chipsHtml('area', i, DB.cfg.areas.map(a => [a, a]), c.area) + '</div></div></div>'
        + '<div class="campo' + fl('falha') + '">' + ic('alert') + '<div><div class="lb">O que aconteceu</div><textarea rows="1" data-f="falha" data-i="' + i + '" placeholder="Toque para escrever">' + esc(c.falha) + '</textarea></div></div>'
        + '<div class="campo' + fl('acao') + '">' + ic('wrench') + '<div><div class="lb">O que foi feito</div><textarea rows="1" data-f="acao" data-i="' + i + '" placeholder="Toque para escrever">' + esc(c.acao) + '</textarea></div></div>'
        + '<div class="campo' + (f.includes('hi') || f.includes('hf') ? ' falta' : '') + '">' + ic('clock') + '<div><div class="lb">Horário' + (d != null ? ' · ' + fmtDur(d) : '') + '</div>'
        + '<div class="horas"><label>Início<input type="time" data-f="hi" data-i="' + i + '" value="' + esc(c.hi) + '"></label><label>Fim<input type="time" data-f="hf" data-i="' + i + '" value="' + esc(c.hf) + '"></label></div>'
        + (c.hf ? '' : '<button type="button" class="btn" style="margin-top:8px;min-height:40px" data-agora="' + i + '">' + ic('clock', 's') + ' Terminou agora</button>') + '</div></div>'
        + '<div class="campo' + (f.includes('parou') || f.includes('tm') ? ' falta' : '') + '">' + ic('pause') + '<div><div class="lb">Equipamento parou?</div><div class="mini">' + chipsHtml('parou', i, [['sim', 'Sim'], ['nao', 'Não']], c.parou)
        + (c.parou === 'sim' ? '<input inputmode="numeric" data-f="tm" data-i="' + i + '" value="' + esc(c.tm) + '" placeholder="min" maxlength="4" aria-label="Minutos parado" style="max-width:110px"><span class="mut sm">min</span>' : '') + '</div></div></div>'
        + '<div class="campo' + fl('sit') + '">' + ic('status') + '<div><div class="lb">Situação</div><div class="mini">' + chipsHtml('sit', i, [['resolvido', 'Resolvido'], ['paliativo', 'Paliativo'], ['pendente', 'Pendente']], c.sit) + '</div></div></div>'
        + (c.sit === 'paliativo' || c.sit === 'pendente' || c.obs ? '<div class="campo">' + ic('note') + '<div><div class="lb">' + (c.sit === 'pendente' ? 'O que falta (vai para as pendências)' : 'Observação / próximo turno') + '</div><textarea rows="1" data-f="obs" data-i="' + i + '" placeholder="Opcional">' + esc(c.obs) + '</textarea></div></div>' : '')
        + '<div class="campo">' + ic('users') + '<div><div class="lb">Quem atendeu</div><input data-f="quem" data-i="' + i + '" value="' + esc(c.quem.join(', ')) + '" placeholder="Nomes separados por vírgula"></div></div>'
        + (c.tipo ? '<div class="campo">' + ic('tag') + '<div><div class="lb">Tipo de falha</div><div class="mini"><span class="pill ' + c.esp + '">' + esc(c.tipo) + '</span><button type="button" class="lnk" style="min-height:0;padding:2px 6px" data-semtipo="' + i + '">remover</button></div></div></div>' : '')
        + (f.length ? '<p class="rfalta">Falta: ' + esc(juntar(f.map(k => NOMES[k]))) + '</p>' : '')
        + '</section>';
    }).join('');
    $$('#vozCards textarea').forEach(autoAltura);
    atualizaBotao();
    $('#vozFonte').textContent = fonte === 'ia' ? 'Organizado pela inteligência artificial da equipe. Confira antes de lançar.' : 'Organizado no modo simples do celular, que pode errar. ' + motivoLocal + ' Confira com atenção.';
    $('#vozFonte').style.color = fonte === 'ia' ? '' : 'var(--warn)';
  }
  function autoAltura(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(44, ta.scrollHeight) + 'px'; }
  function atualizaBotao() {
    const total = cartoes.reduce((s, c) => s + faltas(c).length, 0), n = cartoes.length;
    const b = $('#vozLancar');
    b.lastChild.textContent = total ? ' Completar ' + total + ' campo' + (total > 1 ? 's' : '') : (n > 1 ? ' Lançar ' + n + ' ocorrências' : ' Lançar');
    b.className = 'btn big ' + (total ? 'pri' : 'ok');
    $$('#vozCards .rfalta').forEach((p, i) => { const f = faltas(cartoes[i]); p.textContent = f.length ? 'Falta: ' + juntar(f.map(k => NOMES[k])) : ''; });
  }
  $('#vozCards').addEventListener('input', e => {
    const el = e.target.closest('[data-f]'); if (!el) return; const c = cartoes[+el.dataset.i], k = el.dataset.f;
    c[k] = k === 'quem' ? lista(el.value) : el.value; if (el.tagName === 'TEXTAREA') autoAltura(el);
    const campo = el.closest('.campo'); if (campo && k !== 'quem' && k !== 'obs') campo.classList.toggle('falta', k === 'tm' ? !(Number(el.value) > 0) : !el.value.trim());
    atualizaBotao();
  });
  $('#vozCards').addEventListener('change', e => { const el = e.target.closest('[data-f="hi"],[data-f="hf"]'); if (el) renderCartoes(); });
  $('#vozCards').addEventListener('click', e => {
    const ch = e.target.closest('.chip[data-c]');
    if (ch) {
      const c = cartoes[+ch.dataset.i], k = ch.dataset.c; c[k] = c[k] === ch.dataset.v ? '' : ch.dataset.v;
      if (k === 'parou' && c.parou === 'sim' && !c.tm) { const d = durMin(c.hi, c.hf); if (d) c.tm = String(d); }
      if (k === 'sit') c.pend = c.sit === 'paliativo';
      vibra(); renderCartoes(); return;
    }
    const ag = e.target.closest('[data-agora]'); if (ag) { cartoes[+ag.dataset.agora].hf = agoraHM(); vibra(); renderCartoes(); return; }
    const et = e.target.closest('[data-esp-t]'); if (et) { const c = cartoes[+et.dataset.espT]; c.esp = c.esp === 'ele' ? 'mec' : 'ele'; c.tipo = ''; vibra(); renderCartoes(); return; }
    const st = e.target.closest('[data-semtipo]'); if (st) { cartoes[+st.dataset.semtipo].tipo = ''; renderCartoes(); }
  });

  /* ---------- lançar ---------- */
  function lancar(rascunho) {
    const t = turnoAtual(); if (!t) { toast('O turno foi encerrado. Comece um novo turno.'); fechar(); ir('home'); return; }
    if (!rascunho) {
      const i = cartoes.findIndex(c => faltas(c).length);
      if (i >= 0) {
        const card = $$('#vozCards .rcard')[i], alvo = card && (card.querySelector('.falta') || card);
        if (alvo) { alvo.scrollIntoView({ behavior: 'smooth', block: 'center' }); const inp = alvo.querySelector('input,textarea'); if (inp && !inp.value) setTimeout(() => inp.focus(), 300); }
        vibra('forte'); return;
      }
    } else if (cartoes.some(c => !c.eq)) { toast('Informe pelo menos o equipamento.'); return; }
    const ids = [];
    cartoes.forEach(c => {
      const o = Object.assign({}, c); delete o._texto; if (o.parou !== 'sim') o.tm = ''; if (!o.hi) o.hi = agoraHM();
      o.ditado = c._texto; occId = null; gravarOcc(o, !!rascunho);
      const ult = t.ocorrencias[t.ocorrencias.length - 1]; if (ult) ids.push(ult.id);
    });
    vibra('ok'); fechar();
    const n = ids.length;
    toast(rascunho ? 'Rascunho guardado.' : (n > 1 ? n + ' ocorrências lançadas.' : 'Ocorrência lançada.'), { txt: 'Desfazer', fn: () => desfazer(ids) });
    ir(viewAtual === 'lan' ? 'lan' : 'home', true);
  }
  function desfazer(ids) {
    const t = turnoAtual(); if (!t) return;
    ids.forEach(id => {
      const o = t.ocorrencias.find(x => x.id === id); if (!o) return; o.excluido = true; o.at = Date.now(); marcar('occs', id);
      t.pendencias.filter(p => p.occId === id && !p.excluido).forEach(p => { p.excluido = true; p.at = Date.now(); marcar('pends', p.id); });
    });
    salvar(); agendarSync(); toast('Desfeito.'); ir(viewAtual, true);
  }

  /* ---------- abrir / fechar ---------- */
  function abrir() {
    if (!turnoAtual()) { toast('Comece o turno primeiro.'); ir('home'); return; }
    $('#toast').hidden = true; ov.hidden = false; document.body.style.overflow = 'hidden'; ouvir();
  }
  async function fechar() { await pararCaptura(); ov.hidden = true; document.body.style.overflow = ''; estado = 'fechado'; }
  window.Voz = { abrir, fechar, aberta: () => estado !== 'fechado' };

  document.addEventListener('click', e => { if (e.target.closest('[data-voz]')) { e.preventDefault(); abrir(); } });
  $('#vozFechar').addEventListener('click', fechar);
  $('#vozPronto').addEventListener('click', async () => { const b = $('#vozPronto'); if (b.disabled) return; b.disabled = true; vibra(); try { await pararCaptura(); organizar(textoFinal); } finally { b.disabled = false; } });
  $('#vozDigitar').addEventListener('click', async () => { await pararCaptura(); paraDigitar(); });
  $('#vozTaOk').addEventListener('click', () => organizar($('#vozTa').value));
  $('#vozDeNovo').addEventListener('click', ouvir);
  $('#vozLancar').addEventListener('click', () => lancar(false));
  $('#vozRasc').addEventListener('click', () => lancar(true));
})();
