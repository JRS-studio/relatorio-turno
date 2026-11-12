/* Interpretador local: transforma a fala do executante em campos da ocorrência, sem internet.
   É a reserva quando o servidor/IA não está disponível. Regras simples e previsíveis. */
'use strict';
(function () {
  const semAc = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const compacta = s => semAc(s).replace(/[^a-z0-9]/g, '');
  const p2 = n => String(n).padStart(2, '0');
  const hm = m => p2(Math.floor(((m % 1440) + 1440) % 1440 / 60)) + ':' + p2(((m % 60) + 60) % 60);
  const toMin = s => { const x = String(s || '').split(':').map(Number); return x.length === 2 && !isNaN(x[0]) ? x[0] * 60 + x[1] : null; };

  const UNID = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 };
  const DEZ = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60 };
  /* "vinte e cinco" -> 25, "duas" -> 2 (só números até 99) */
  function numerosPorExtenso(t) {
    t = t.replace(/\b(vinte|trinta|quarenta|cinquenta)\s+e\s+(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove)\b/g, (_, d, u) => String(DEZ[d] + UNID[u]));
    t = t.replace(/\b(vinte|trinta|quarenta|cinquenta|sessenta)\b/g, (_, d) => String(DEZ[d]));
    t = t.replace(/\b(zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove)\b/g, (m, u, off, s) => {
      /* "um/uma" só vira número perto de hora/minuto ("uma hora", "uma e meia") */
      if ((u === 'um' || u === 'uma') && !/^\s*(hora|e\s+(meia|\d)|h\b|minuto)/.test(s.slice(off + m.length))) return m;
      return String(UNID[u]);
    });
    return t.replace(/\bmeio[\s-]dia\b/g, '12:00').replace(/\bmeia[\s-]noite\b/g, '00:00');
  }

  /* encontra horários com posição: 14h30, 14:30, 14 horas e 30, 2 e meia (da tarde), às 14 */
  function horarios(t) {
    const r = [], re = /\b(\d{1,2})\s*(?::|h|horas?)\s*(?:e\s*)?(\d{2}|meia)?(?:\s*(?:minutos?|min))?\b(\s*da\s+(tarde|noite|manha|madrugada))?|\b(?:as|das|a partir das|desde as|ate as|pelas)\s+(\d{1,2})(?:\s+e\s+(\d{1,2}|meia))?(\s*da\s+(tarde|noite|manha|madrugada))?\b/g;
    let m;
    while ((m = re.exec(t))) {
      let h = Number(m[1] != null ? m[1] : m[5]), mi = m[2] != null ? m[2] : m[6], per = m[4] || m[8];
      if (m[1] != null && !/[:h]|hora/.test(m[0])) continue;
      if (m[1] != null && /hora/.test(m[0]) && !/\b(as|das|desde|ate|a partir das|pelas|por volta das)\s*$/.test(t.slice(Math.max(0, m.index - 16), m.index))) continue;
      const min = mi === 'meia' ? 30 : (mi ? Number(mi) : 0);
      if (h > 23 || min > 59) continue;
      /* "40 minutos" sozinho não é horário */
      if (m[1] != null && /^\d+\s*(minutos?|min)$/.test(m[0].trim())) continue;
      if (per && (per === 'tarde' || per === 'noite') && h < 12) h += 12;
      r.push({ v: hm(h * 60 + min), i: m.index, f: m.index + m[0].length });
    }
    return r;
  }
  /* duração em minutos: "40 minutos", "1 hora e 20", "meia hora", "uma hora" */
  function duracoes(t) {
    const r = [], re = /\b(?:(\d{1,2})\s*h(?:oras?)?(?:\s*e\s*(\d{1,2})(?:\s*min(?:utos?)?)?)?|(\d{1,3})\s*min(?:utos?)?|(meia)\s+hora)\b/g;
    let m;
    while ((m = re.exec(t))) {
      const ctxAntes = t.slice(Math.max(0, m.index - 14), m.index);
      if (m[1] != null && /\b(as|das|desde|ate)\s*$/.test(ctxAntes)) continue; /* é horário, não duração */
      if (m[1] != null && !/hora/.test(m[0])) continue; /* "14h30" é horário */
      const v = m[4] ? 30 : m[3] ? Number(m[3]) : Number(m[1]) * 60 + Number(m[2] || 0);
      r.push({ v, i: m.index, f: m.index + m[0].length });
    }
    return r;
  }
  const perto = (t, i, f, re, raio) => re.test(t.slice(Math.max(0, i - (raio || 40)), Math.min(t.length, f + (raio || 40))));

  const PAL_ELE = /\b(motor|sensor|cabo|borne|terminal|painel|inversor|clp|plc|contator|disjuntor|rele|fusivel|lampada|iluminacao|refletor|tensao|corrente|curto|aterramento|encoder|chave|botoeira|eletric|fase|alimentacao|desarm)/g;
  const PAL_MEC = /\b(rolamento|correia|rolo|rolete|redutor|acoplamento|vazamento|vazando|hidraulic|pneumatic|cilindro|mangueira|oleo|graxa|lubrifica|solda|estrutura|chapa|parafuso|engrenagem|corrente de transmissao|mancal|eixo|desalinh|vibracao|tambor|raspador|chute|calha|bomba)/g;
  const SIN_TIPO = [
    [/motor/, 'motor'], [/sensor|indutivo|fim de curso|fotoeletric/, 'sensor'], [/cabo|borne|terminal|conex|emenda/, 'cabo'],
    [/inversor/, 'inversor'], [/clp|plc|automac|cartao|rede profibus|ihm/, 'clp'], [/contator|disjuntor|rele|fusivel/, 'contator'],
    [/lampada|ilumina|refletor/, 'ilumina'], [/rolamento|mancal/, 'rolamento'], [/correia|rolo|rolete|tambor/, 'correia'],
    [/redutor|engrenag/, 'redutor'], [/hidraul|oleo|mangueira/, 'hidraul'], [/pneumat|ar comprimido|cilindro/, 'pneumat'],
    [/vazament|vazando/, 'vazament'], [/desgast|trinc|estrutur|solda|chapa/, 'desgast']
  ];
  const ACAO = /\b(trocou|trocamos|substituiu|substituimos|reapertou|reapertamos|apertou|ajustou|ajustamos|limpou|limpamos|lubrificou|lubrificamos|alinhou|alinhamos|liberou|liberamos|resetou|rearmou|religou|religamos|testou|mediu|verificou|instalou|reparou|consertou|soldou|regulou|isolou|refez|recuperou|tensionou|eliminou|corrigiu|desobstruiu|troquei|trocad[oa]s?|troca d[oe]|substitui|substituid|reapert|apertei|ajustei|ajustad|limpei|limpez|lubrifiquei|lubrificad|alinhei|alinhad|realiz|fiz|feito|feita|resetei|resetad|rearmei|rearmad|religuei|religad|liberei|testei|testad|medi\b|medicao|verifiquei|instalei|instalad|reparei|consertei|soldei|desobstrui|regulei|regulad|isolei|refiz|recuperei|tensionei|tensionad|eliminei|corrigi|normalizei)/;
  const LIXO = /^(e|ai|entao|tipo|ne|bom|olha|assim|la|o|a|os|as|uma?|que)\b\s*/;

  const limpaFrase = s => {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    let ant; do { ant = s; s = s.replace(/^(e|aí|ai|então|entao|tipo|né|ne|bom|olha|assim|daí|dai)[,\s]+/i, ''); } while (s !== ant);
    s = s.replace(/[,\s]+(né|ne|tá|ta)\s*$/i, '').replace(/[\s,;.]+$/, '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  };

  function interpretar(texto, ctx) {
    ctx = ctx || {};
    const orig = String(texto || '').replace(/\s+/g, ' ').trim();
    const t = numerosPorExtenso(semAc(orig));
    const agoraMin = toMin(ctx.agora) != null ? toMin(ctx.agora) : (new Date().getHours() * 60 + new Date().getMinutes());
    const o = { esp: '', area: '', eq: '', tipo: '', falha: '', acao: '', hi: '', hf: '', parou: '', tm: 0, sit: '', obs: '', quem: [] };

    /* especialidade */
    const ne = (t.match(PAL_ELE) || []).length, nm = (t.match(PAL_MEC) || []).length;
    o.esp = /\b(mecanic)/.test(t) ? 'mec' : /\b(eletric)/.test(t) && !/motor eletric/.test(t) ? 'ele' : (nm > ne ? 'mec' : 'ele');

    /* área: a mais longa da lista que aparece no texto */
    const areas = (ctx.areas || []).slice().sort((a, b) => b.length - a.length);
    const tc = compacta(t);
    for (const a of areas) { const k = compacta(numerosPorExtenso(semAc(a))); if (k && tc.includes(k)) { o.area = a; break; } }

    /* equipamento: um já conhecido; senão uma TAG (letras + números) */
    const eqs = (ctx.equipamentos || []).slice().sort((a, b) => b.length - a.length);
    for (const e of eqs) { const k = compacta(e); if (k.length >= 2 && tc.includes(k)) { o.eq = e; break; } }
    if (!o.eq) {
      const proib = /^(as|das|ate|de|do|da|em|no|na|um|uma|por|com|sem|e|o|a|h|min|hora|horas|linha|area|turno)$/;
      const re = /\b([a-z]{1,4})\s?-?\s?(\d{1,4}[a-z]?)\b/g; let m;
      while ((m = re.exec(t))) {
        if (proib.test(m[1])) continue;
        if (/^(h|min|hs)$/.test(m[1])) continue;
        const ctxDepois = t.slice(m.index + m[0].length, m.index + m[0].length + 10);
        if (/^\s*(minutos?|min|horas?|h\b)/.test(ctxDepois)) continue;
        o.eq = m[1].toUpperCase() + '-' + m[2].toUpperCase(); break;
      }
    }
    if (!o.eq) {
      const m = t.match(/\b(no|na|do|da)\s+((?:ventilador|exaustor|bomba|motor|correia|transportador|britador|peneira|painel|compressor|ponte rolante|talha|forno|moinho|alimentador|redutor)(?:\s+(?:\d+[a-z]?|[a-z]{1,3}-?\d+))?)/);
      if (m) o.eq = limpaFrase(m[2]);
    }

    /* tipo de falha */
    const lt = o.esp === 'mec' ? (ctx.tiposMec || []) : (ctx.tiposEle || []);
    for (const [re, chave] of SIN_TIPO) {
      if (!re.test(t)) continue;
      const alvo = lt.find(x => semAc(x).includes(chave));
      if (alvo) { o.tipo = alvo; break; }
    }

    /* horários */
    const hs = horarios(t);
    const marcaIni = /(comec|inici|desde|a partir|desarm|parou|caiu|travou|falh|deu problema|chamad|acionad|aconteceu)/;
    const marcaFim = /(ate|termin|acab|liber|normaliz|voltou|resolv|fim|finaliz|ficou pronto|entreg)/;
    for (const x of hs) {
      const antes = t.slice(Math.max(0, x.i - 35), x.i);
      if (!o.hf && marcaFim.test(antes) && !(marcaIni.test(antes) && antes.search(marcaIni) > antes.search(marcaFim))) o.hf = x.v;
      else if (!o.hi) o.hi = x.v;
      else if (!o.hf) o.hf = x.v;
    }
    if (!o.hf && /\b(acabei|terminei|liberei|finalizei|liberado|normalizado)\s+(agora|neste momento|agorinha)\b|\bagora\s+(liberado|normalizado)\b/.test(t)) o.hf = hm(agoraMin);
    const fazM = t.match(/\b(?:faz|ha)\s+(\d{1,3})\s*min/) || (/\b(?:faz|ha)\s+meia\s+hora\b/.test(t) ? [0, 30] : null);
    if (!o.hi && fazM) o.hi = hm(agoraMin - Number(fazM[1]));

    /* parada e duração */
    const ds = duracoes(t);
    if (/\b(nao (parou|teve parada|parei|chegou a parar)|sem parada|nao ficou parad|continuou rodando|rodando normal)/.test(t)) o.parou = 'nao';
    else if (/\b(parad[oa]|parou|ficou parad|equipamento parad|linha parad|desligad[oa]|travou)/.test(t)) o.parou = 'sim';
    for (const d of ds) {
      if (o.parou === 'sim' && !o.tm && perto(t, d.i, d.f, /parad|parou|parada/, 30)) { o.tm = d.v; continue; }
      if (perto(t, d.i, d.f, /levei|levou|durou|demor|gastei|em (\d+|meia)/, 25)) {
        if (o.hi && !o.hf) o.hf = hm(toMin(o.hi) + d.v); else if (o.hf && !o.hi) o.hi = hm(toMin(o.hf) - d.v);
      }
    }
    if (o.parou === 'sim' && !o.tm && o.hi && o.hf) { const d = toMin(o.hf) - toMin(o.hi); o.tm = d < 0 ? d + 1440 : d; }

    /* situação */
    if (/\b(pendente|aguardando|falta (trocar|fazer|terminar)|nao (deu|consegui|terminei|terminamos|deu tempo)|ficou para o proximo|proximo turno|sem peca|esperando)/.test(t)) o.sit = 'pendente';
    else if (/\b(paliativ|provisori|gambiarra|improvis|precisa (trocar|substituir|programar)|programar (a )?troca|na preventiva|temporari)/.test(t)) o.sit = 'paliativo';
    else if (/\b(resolvid|normaliz|liberad|liberei|funcionando|ok|operando|voltou a funcionar|em operacao)/.test(t)) o.sit = 'resolvido';

    /* quem */
    (ctx.equipe || []).forEach(n => { const k = semAc(n).split(' ')[0]; if (k.length > 2 && new RegExp('\\b' + k + '\\b').test(t)) o.quem.push(n); });

    /* falha x ação: quebra em trechos e separa pelos verbos de ação */
    const trechos = orig.split(/(?<=[.;!?])\s+|,\s+|\s+(?:e\s+(?:a[ií]\s+|ent[aã]o\s+)?|depois\s+|a[ií]\s+)(?=(?:eu\s+|a gente\s+|foi\s+|o\s+[A-Za-zÀ-ú]+\s+|a\s+[A-Za-zÀ-ú]+\s+)?(?:troc|troq|substitu|reapert|apertei|ajust|limp|lubrific|alinh|realiz|fiz|reset|rearm|relig|liber|test|medi|verifiq|instal|repar|consert|sold|desobstru|regul|isol|refiz|recuper|tension|elimin|corrigi|normaliz))/i).map(s => s.trim()).filter(Boolean);
    const falhas = [], acoes = [], obs = [];
    const tira = s => s
      .replace(/(?:^|\s)(d?as|às|desde (as|às)|até (as|às)|ate as|a partir das|pelas)\s+(\d{1,2}|uma|duas|três|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|meio-dia|meia-noite)([:h]\d{0,2})?(\s+e\s+(\d{1,2}|meia))?(\s+horas?)?(\s+da\s+(tarde|manhã|manha|noite))?/gi, ' ')
      .replace(/\b(o\s+)?(equipamento|linha|máquina|maquina)?\s*(ficou\s+)?parad[oa]\s+(por\s+)?(cerca de\s+)?(\d+|uma?|meia)\s*(minutos?|min|horas?)(\s+e\s+\d+(\s*minutos?)?)?/gi, ' ')
      .replace(/[,\s]+(resolvido|normalizado|liberado|ok|pendente|paliativo)\s*$/i, '')
      .replace(/\s+/g, ' ').trim();
    trechos.forEach(tr0 => {
      const tr = tira(tr0); if (!tr) return;
      const n = numerosPorExtenso(semAc(tr));
      const so = n.replace(/\b(as|das|ate|desde|a partir das|de|e|o|a|ficou|foi|equipamento|parad[oa]|por|durante|cerca de|uns|umas)\b/g, ' ').replace(/\d{1,2}\s*(:|h|horas?)\s*\d{0,2}|\d+\s*min(utos?)?|meia hora|minutos?|horas?/g, ' ').replace(/\s+/g, ' ').trim();
      if (so.length < 3) return; /* trecho só de horário/duração */
      const meta = so.replace(/\b(levou|levei|levamos|durou|demorou|gastei|comecou|comecei|iniciou|terminou|terminei|acabou|acabei|finalizei|agora|neste momento|nao|parou|parada|sem|teve|chegou|parar|tarde|manha|noite|madrugada|resolvid[oa]|normalizad[oa]|pendente|paliativo|ok|liberad[oa]|em|operacao|funcionando|cerca|mais ou menos|uns|quem|que|atendeu|atendemos|atendi|eu|a gente|com|o|a|os|as)\b/g, ' ').replace(/\s+/g, ' ').trim();
      const nomes = (ctx.equipe || []).map(x => semAc(x).split(' ')[0]);
      const resto = meta.split(' ').filter(w => w && !nomes.includes(w));
      if (resto.length === 0) return;
      if (/^(resolvid|normaliz|liberad[oa]?$|ok$|funcionando$|paliativ|pendente$)/.test(so) && so.split(' ').length <= 3) return;
      if (/^(na|no|da|do)?\s*(linha|area|setor)\b/.test(so) && so.split(' ').length <= 3) return;
      if (/(precisa|programar|falta|aguardando|proximo turno|preventiva)/.test(n)) { obs.push(tr); return; }
      if (ACAO.test(n)) acoes.push(tr); else falhas.push(tr);
    });
    o.obs = limpaFrase(obs.join(', ').replace(/^\s*(paliativo|provis[oó]rio|pendente)[,\s]+/i, ''));
    /* TAG escrita do jeito falado ("vt 03") vira a grafia padrão ("VT-03") dentro do texto */
    const mt = o.eq.match(/^([A-Za-z]{1,4})-?(\d+[A-Za-z]?)$/);
    if (mt) { const re = new RegExp('\\b' + mt[1] + '\\s*-?\\s*' + mt[2] + '\\b', 'i'); falhas.forEach((_, k) => { falhas[k] = falhas[k].replace(re, o.eq); }); acoes.forEach((_, k) => { acoes[k] = acoes[k].replace(re, o.eq); }); }
    o.falha = limpaFrase(falhas.join(', '));
    o.acao = limpaFrase(acoes.join(', '));
    if (!o.falha && !o.acao) o.falha = limpaFrase(orig);
    return { ocorrencias: [o] };
  }

  window.Interpretador = { interpretar, _int: { horarios, duracoes, numerosPorExtenso, semAc } };
})();
