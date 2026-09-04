/* =========================================================================
   Trova Prezzo — motore di ricerca prezzi lato client
   Funziona su GitHub Pages: nessun server, nessuna API key.
   Le pagine dei negozi vengono lette tramite proxy CORS pubblici.
   ========================================================================= */
'use strict';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const CFG = {
  timeoutMs: 15000,      // timeout per singolo tentativo di fetch
  maxPerSource: 30,      // risultati massimi presi da ogni fonte
  minRelevance: 0.55     // quanta parte della query deve comparire nel titolo
};

/* ---------------------------------------------------------------- numeri */
const PRICE_RE = /(?:€|EUR)\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|EUR)/i;

function toNumber(str) {
  if (str == null) return null;
  const s = String(str).replace(/[\s\u00a0\u202f\u2009]/g, '');
  const m = s.match(/\d[\d.,]*/);
  if (!m) return null;
  let n = m[0].replace(/[.,]+$/, '');
  const lc = n.lastIndexOf(','), ld = n.lastIndexOf('.');
  if (lc > -1 && ld > -1) {
    n = lc > ld ? n.replace(/\./g, '').replace(',', '.') : n.replace(/,/g, '');
  } else if (lc > -1) {
    n = (n.length - lc - 1) === 3 ? n.replace(/,/g, '') : n.replace(',', '.');
  } else if (ld > -1) {
    if ((n.length - ld - 1) === 3) n = n.replace(/\./g, '');
  }
  const v = parseFloat(n);
  return Number.isFinite(v) ? v : null;
}
const eur = n => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });

function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/* ------------------------------------------------------------ affidabilità */
/* Punteggio 0-100: quanto ci si può fidare di chi vende.                    */
const TRUST = {
  'amazon.it': 95, 'amazon.com': 86, 'apple.com': 98, 'samsung.com': 95,
  'mediaworld.it': 94, 'unieuro.it': 92, 'euronics.it': 90, 'trony.it': 88,
  'expert.it': 87, 'comet.it': 87, 'monclick.it': 82, 'yeppon.it': 79,
  'bpm-power.com': 80, 'drop.it': 70, 'eprice.it': 70, 'ollo.it': 70,
  'epto.it': 68, 'nexths.it': 74, 'juice.it': 84, 'r-store.it': 82,
  'zalando.it': 92, 'decathlon.it': 93, 'ikea.com': 93, 'leroymerlin.it': 90,
  'obi-italia.it': 86, 'bricoman.it': 86, 'maisonsdumonde.com': 86,
  'douglas.it': 88, 'sephora.it': 89, 'pinalli.it': 84, 'notino.it': 80,
  'esselunga.it': 91, 'coop.it': 88, 'carrefour.it': 87, 'lidl.it': 88,
  'feltrinelli.it': 90, 'mondadoristore.it': 89, 'libraccio.it': 84,
  'ibs.it': 87, 'nike.com': 93, 'adidas.it': 92, 'cisalfasport.it': 86,
  'gamestop.it': 84, 'instantgaming.com': 74, 'eneba.com': 62,
  'ebay.it': 76, 'ebay.com': 72, 'subito.it': 55, 'wallapop.com': 52,
  'aliexpress.com': 60, 'temu.com': 45, 'wish.com': 32, 'banggood.com': 55,
  'trovaprezzi.it': 80, 'idealo.it': 82, 'kelkoo.it': 76, 'google.com': 75,
  'shopping.google.com': 75, 'pccomponentes.it': 78, 'bpm.it': 78,
  'manomano.it': 80, 'westwing.it': 80, 'privalia.com': 76, 'zavvi.it': 72,
  'unieurobusiness.it': 88, 'esprinet.com': 78, 'tigershop.it': 66
};

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}
function rootDomain(host) {
  const p = host.split('.');
  if (p.length <= 2) return host;
  const tail = p.slice(-2).join('.');
  if (/^(co|com|org|net|gov)\.[a-z]{2}$/.test(tail)) return p.slice(-3).join('.');
  return tail;
}
function trustOf(host) {
  if (!host) return 45;
  const root = rootDomain(host);
  if (TRUST[host] != null) return TRUST[host];
  if (TRUST[root] != null) return TRUST[root];
  // euristiche per negozi sconosciuti
  let s = 52;
  if (/\.it$/.test(root)) s += 8;            // negozio italiano: più tutele
  if (/\.(eu|de|fr|es)$/.test(root)) s += 3;
  if (/\.(cn|ru|top|xyz|shop|store|online|club)$/.test(root)) s -= 14;
  if (/(outlet|discount|cheap|sale|promo)\d*/.test(root)) s -= 6;
  return Math.max(20, Math.min(72, s));
}
const trustLabel = t => t >= 80 ? 'Affidabile' : t >= 65 ? 'Buona reputazione' : t >= 50 ? 'Poco noto' : 'Da verificare';
const trustClass = t => t >= 80 ? 't-hi' : t >= 60 ? 't-mid' : 't-lo';

/* --------------------------------------------------------------- proxy CORS */
const PROXIES = [
  { id: 'allorigins', kind: 'html', url: u => 'https://api.allorigins.win/raw?charset=UTF-8&url=' + encodeURIComponent(u) },
  { id: 'codetabs',   kind: 'html', url: u => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u) },
  { id: 'corsproxy',  kind: 'html', url: u => 'https://corsproxy.io/?url=' + encodeURIComponent(u) },
  { id: 'jina',       kind: 'text', url: u => 'https://r.jina.ai/' + u },
  { id: 'thingproxy', kind: 'html', url: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) }
];

function preferredProxyOrder() {
  const last = localStorage.getItem('tp.proxy');
  const list = [...PROXIES];
  if (last) {
    const i = list.findIndex(p => p.id === last);
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
  }
  return list;
}

async function fetchThrough(targetUrl, onTry) {
  let lastErr = 'nessun proxy raggiungibile';
  for (const px of preferredProxyOrder()) {
    onTry && onTry(px.id);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CFG.timeoutMs);
    try {
      const res = await fetch(px.url(targetUrl), { signal: ctrl.signal, headers: { 'Accept': 'text/html,text/plain,*/*' } });
      clearTimeout(timer);
      if (!res.ok) { lastErr = 'HTTP ' + res.status; continue; }
      const body = await res.text();
      if (!body || body.length < 400) { lastErr = 'risposta vuota'; continue; }
      if (/captcha|unusual traffic|are you a robot|access denied/i.test(body.slice(0, 3000)) && body.length < 20000) {
        lastErr = 'bloccato dal sito'; continue;
      }
      localStorage.setItem('tp.proxy', px.id);
      return { body, proxy: px.id, kind: px.kind };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e.name === 'AbortError' ? 'timeout' : 'rete non disponibile';
    }
  }
  throw new Error(lastErr);
}

/* ------------------------------------------------------------------- fonti */
const enc = s => encodeURIComponent(s.trim());

const SOURCES = [
  { id: 'trovaprezzi', name: 'Trovaprezzi', base: 'https://www.trovaprezzi.it',
    search: q => `https://www.trovaprezzi.it/prezzi_.aspx?libera=${enc(q)}&sbox=1`,
    merchantSel: ['.merchant_name_bottom', '.merchant_name', '.merchant_link', 'img.merchant_logo[alt]', '[class*="merchant"]'] },
  { id: 'idealo', name: 'idealo', base: 'https://www.idealo.it',
    search: q => `https://www.idealo.it/prezzi/ricerca.html?q=${enc(q)}`,
    merchantSel: ['[class*="shopName"]', '[class*="offerList-item-shop"]', 'img[alt*="logo" i]'] },
  { id: 'ebay', name: 'eBay Italia', base: 'https://www.ebay.it',
    search: q => `https://www.ebay.it/sch/i.html?_nkw=${enc(q)}&_sop=15&LH_BIN=1&_ipg=60`,
    merchantSel: ['.s-item__seller-info-text', '.s-card__attribute-row'] },
  { id: 'google', name: 'Google Shopping', base: 'https://www.google.com',
    search: q => `https://www.google.com/search?q=${enc(q)}&tbm=shop&hl=it&gl=IT&num=40`,
    merchantSel: ['[class*="merchant"]', '.aULzUe', '.IuHnof'] },
  { id: 'amazon', name: 'Amazon.it', base: 'https://www.amazon.it',
    search: q => `https://www.amazon.it/s?k=${enc(q)}&language=it_IT`,
    merchantSel: [] }
];

const AGGREGATORS = new Set(['trovaprezzi.it', 'idealo.it', 'google.com', 'kelkoo.it']);

/* Ripulisce e risolve un URL trovato nella pagina */
function resolveUrl(href, source) {
  if (!href) return null;
  try {
    let u = new URL(href, source.base);
    // link di uscita di Google: /url?q=<vero link>
    const inner = u.searchParams.get('q') || u.searchParams.get('url') || u.searchParams.get('adurl');
    if (inner && /^https?:\/\//i.test(inner)) u = new URL(inner);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.toString();
  } catch { return null; }
}

/* ------------------------------------------------------- estrazione da HTML */
/* Strategia generica e resistente ai cambi di markup: si parte dai testi che
   contengono un prezzo e si risale al contenitore che ha un link e un titolo. */
function extractFromHtml(html, source) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc || !doc.body) return [];
  const out = [], seen = new Set();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node, scanned = 0;

  while ((node = walker.nextNode())) {
    if (scanned++ > 25000 || out.length >= CFG.maxPerSource) break;
    const txt = (node.nodeValue || '').trim();
    if (txt.length < 2 || txt.length > 40) continue;
    const pm = txt.match(PRICE_RE);
    if (!pm) continue;
    const price = toNumber(pm[0]);
    if (!price || price < 0.5 || price > 500000) continue;

    // risali fino a un contenitore utile
    let el = node.parentElement, container = null, hop = 0;
    while (el && hop++ < 8) {
      const a = el.querySelector('a[href]');
      const len = (el.textContent || '').trim().length;
      if (a && len > 25 && len < 1200) { container = el; break; }
      el = el.parentElement;
    }
    if (!container) continue;

    const anchor = pickAnchor(container, source);
    if (!anchor) continue;
    const url = resolveUrl(anchor.getAttribute('href'), source);
    if (!url) continue;
    const key = url.split('?')[0] + '|' + price.toFixed(2);
    if (seen.has(key)) continue;

    const title = pickTitle(container, anchor);
    if (!title || title.length < 6) continue;

    seen.add(key);
    out.push(makeItem({ title, price, url, container, source, doc }));
  }
  return out;
}

function pickAnchor(container, source) {
  const anchors = $$('a[href]', container).filter(a => {
    const h = a.getAttribute('href') || '';
    return h && !h.startsWith('#') && !/^javascript:/i.test(h);
  });
  if (!anchors.length) return null;
  // preferisci il link con il testo più simile a un titolo di prodotto
  let best = null, bestScore = -1;
  for (const a of anchors) {
    const t = (a.textContent || '').trim();
    let s = 0;
    if (t.length >= 12 && t.length <= 180) s += 3;
    if (a.querySelector('img')) s += 1;
    if (/prodotto|product|itm|\/dp\/|offerta|p\//i.test(a.getAttribute('href'))) s += 2;
    if (/^\s*(vedi|scopri|confronta|vai al negozio|acquista)\s*$/i.test(t)) s -= 2;
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return best;
}

function pickTitle(container, anchor) {
  const cands = [];
  const at = (anchor.textContent || '').trim();
  if (at) cands.push(at);
  const h = container.querySelector('h1,h2,h3,h4,[class*="title" i],[class*="name" i]');
  if (h) cands.push((h.textContent || '').trim());
  const img = container.querySelector('img[alt]');
  if (img) cands.push((img.getAttribute('alt') || '').trim());
  const t = anchor.getAttribute('title') || anchor.getAttribute('aria-label');
  if (t) cands.push(t.trim());
  const clean = cands
    .map(x => x.replace(/\s+/g, ' ').replace(PRICE_RE, '').trim())
    .filter(x => x.length >= 6 && x.length <= 200);
  clean.sort((a, b) => scoreTitle(b) - scoreTitle(a));
  return clean[0] || null;
}
function scoreTitle(t) {
  let s = Math.min(t.length, 90);
  if (/^(nuovo|nuova|opens in|apre in)\b/i.test(t)) s -= 20;
  if (/[|·•]/.test(t)) s -= 5;
  return s;
}

function makeItem({ title, price, url, container, source }) {
  let host = hostOf(url);
  let merchant = null;

  // sugli aggregatori il link resta interno: cerca il nome del negozio nel blocco
  if (AGGREGATORS.has(rootDomain(host)) && container && source.merchantSel) {
    for (const sel of source.merchantSel) {
      const el = container.querySelector(sel);
      if (!el) continue;
      const v = (el.getAttribute('alt') || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (v && v.length >= 2 && v.length <= 40) { merchant = v.replace(/\blogo\b/i, '').trim(); break; }
    }
  }
  const ship = shippingFrom(container);
  const domainForTrust = merchant ? guessDomain(merchant, host) : host;

  return {
    title: title.replace(/\s+/g, ' ').slice(0, 160),
    price, url, host,
    merchant: merchant || prettyHost(host),
    trust: trustOf(domainForTrust),
    shipping: ship,
    sourceId: source.id,
    sourceName: source.name
  };
}

function guessDomain(merchantName, fallbackHost) {
  const n = merchantName.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const d of Object.keys(TRUST)) {
    const core = d.split('.')[0].replace(/[^a-z0-9]/g, '');
    if (core.length > 3 && (core === n || n.startsWith(core) || core.startsWith(n))) return d;
  }
  return n.length > 2 ? n + '.it' : fallbackHost;
}
const prettyHost = h => h ? h.replace(/^www\./, '') : 'negozio sconosciuto';

function shippingFrom(container) {
  if (!container) return null;
  const t = (container.textContent || '').toLowerCase();
  if (/spedizione gratuita|consegna gratuita|spedizione gratis|free shipping|gratis/.test(t)) return 'Spedizione gratuita';
  const m = t.match(/\+\s?(?:€|eur)?\s?(\d[\d.,]*)\s?(?:€|eur)?\s?(?:di\s)?sped/);
  if (m) { const v = toNumber(m[1]); if (v) return '+ ' + eur(v) + ' spedizione'; }
  return null;
}

/* ------------------------------------------------- estrazione da testo/markdown */
function extractFromText(text, source) {
  const out = [], seen = new Set();
  const lines = text.split('\n');
  const linkRe = /\[([^\]]{6,180})\]\((https?:\/\/[^\s)]+)\)/g;

  for (let i = 0; i < lines.length && out.length < CFG.maxPerSource; i++) {
    linkRe.lastIndex = 0;
    let m;
    while ((m = linkRe.exec(lines[i]))) {
      const title = m[1].replace(/\s+/g, ' ').replace(PRICE_RE, '').trim();
      if (title.length < 6) continue;
      // il prezzo può stare sulla stessa riga o poco sotto
      let price = null;
      for (let j = i; j <= Math.min(i + 3, lines.length - 1) && price == null; j++) {
        const pm = lines[j].match(PRICE_RE);
        if (pm) { const v = toNumber(pm[0]); if (v && v > 0.5 && v < 500000) price = v; }
      }
      if (price == null) continue;
      const url = resolveUrl(m[2], source);
      if (!url) continue;
      const key = url.split('?')[0] + '|' + price.toFixed(2);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(makeItem({ title, price, url, container: null, source }));
    }
  }
  return out;
}

/* --------------------------------------------------------- pertinenza query */
const STOP = new Set(['di', 'da', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'con', 'per', 'e', 'the', 'a']);
const norm = s => (s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

function tokens(q) { return norm(q).split(' ').filter(t => t.length > 1 && !STOP.has(t)); }

function relevance(title, qTokens) {
  if (!qTokens.length) return 1;
  const t = ' ' + norm(title) + ' ';
  let hit = 0;
  for (const tok of qTokens) if (t.includes(tok)) hit++;
  return hit / qTokens.length;
}

/* ====================================================================== */
/*                       ANALISI: classifica e affari                     */
/* ====================================================================== */

function analyze(raw, query, opts) {
  const qTokens = tokens(query);
  const kept = [], dropped = [];

  for (const it of raw) {
    it.rel = relevance(it.title, qTokens);
    if (it.rel < CFG.minRelevance) { it.dropReason = 'poco pertinente con la ricerca'; dropped.push(it); }
    else kept.push(it);
  }

  // deduplica: stesso negozio e prezzo quasi identico
  const byKey = new Map();
  for (const it of kept) {
    const key = norm(it.merchant) + '|' + Math.round(it.price * 100) / 100;
    const prev = byKey.get(key);
    if (!prev || it.rel > prev.rel) byKey.set(key, it);
  }
  let live = [...byKey.values()];

  // filtri utente
  if (opts.onlyTrusted) {
    live = live.filter(it => { if (it.trust >= 70) return true; it.dropReason = 'venditore sotto la soglia di affidabilità'; dropped.push(it); return false; });
  }
  if (opts.maxPrice) {
    live = live.filter(it => { if (it.price <= opts.maxPrice) return true; it.dropReason = 'sopra il prezzo massimo'; dropped.push(it); return false; });
  }

  // riferimento di mercato: mediana dei venditori credibili
  const baseline = list => {
    const solid = list.filter(it => it.trust >= 60).map(it => it.price);
    return median(solid.length >= 3 ? solid : list.map(it => it.price));
  };
  let med = baseline(live);

  // prezzi assurdamente bassi = quasi sempre un altro prodotto (custodia, ricambio…)
  if (med && opts.hideOutliers) {
    live = live.filter(it => {
      if (it.price >= med * 0.12) return true;
      it.dropReason = 'prezzo troppo basso rispetto al mercato: probabile accessorio o prodotto diverso';
      dropped.push(it); return false;
    });
    // senza gli accessori il prezzo di mercato è più veritiero: ricalcolalo
    med = baseline(live) || med;
  }

  const min = live.length ? Math.min(...live.map(i => i.price)) : 0;
  for (const it of live) {
    it.deal = dealOf(it, med);
    it.saving = med ? Math.max(0, med - it.price) : 0;
    it.savingPct = med ? Math.round((1 - it.price / med) * 100) : 0;
    const priceScore = min ? min / it.price : 0;
    it.score = 0.55 * priceScore + 0.45 * (it.trust / 100);
    // un prezzo sospetto da venditore ignoto non deve guidare la classifica
    if (it.deal && it.deal.level === 'risk') it.score *= 0.7;
  }

  live.sort((a, b) => b.score - a.score);

  // miglior scelta: buon prezzo ma venditore serio
  const trustworthy = live.filter(it => it.trust >= 70);
  const best = (trustworthy.length ? trustworthy : live)[0] || null;
  const deals = live.filter(it => it.deal && it.deal.level !== 'good' && it !== best)
                    .sort((a, b) => a.price - b.price);

  return { items: live, dropped, best, deals, median: med, min };
}

function dealOf(it, med) {
  if (!med) return null;
  const r = it.price / med;
  if (r <= 0.40) return it.trust >= 70
    ? { level: 'error', label: 'Possibile errore di prezzo', cls: 'b-error', icon: '🎯' }
    : { level: 'risk',  label: 'Prezzo anomalo — verifica bene', cls: 'b-risk', icon: '⚠️' };
  if (r <= 0.65) return it.trust >= 55
    ? { level: 'deal', label: 'Offerta imperdibile', cls: 'b-deal', icon: '🔥' }
    : { level: 'risk', label: 'Prezzo basso, venditore poco noto', cls: 'b-risk', icon: '⚠️' };
  if (r <= 0.85) return { level: 'good', label: 'Buon prezzo', cls: 'b-good', icon: '👍' };
  return null;
}

/* ====================================================================== */
/*                                RICERCA                                 */
/* ====================================================================== */

const state = {
  sources: loadJSON('tp.sources', null) || Object.fromEntries(SOURCES.map(s => [s.id, true])),
  history: loadJSON('tp.history', []),
  watch:   loadJSON('tp.watch', []),
  last:    null,
  running: false
};

const mq = q => (typeof matchMedia === 'function' ? matchMedia(q) : { matches: false });

function loadJSON(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

async function runSearch(query) {
  query = (query || '').trim();
  if (!query || state.running) return;
  state.running = true;
  $('#q').value = query;
  $('#q').blur();
  $('#searchBtn').disabled = true;
  $('#status').hidden = false;
  $('#spinner').style.display = '';
  $('#statusText').textContent = `Sto cercando “${query}” sui negozi…`;
  ['#bestWrap', '#dealsWrap', '#resultsWrap', '#fallbackWrap', '#intro'].forEach(s => { $(s).hidden = true; });

  const active = SOURCES.filter(s => state.sources[s.id]);
  const pills = {};
  $('#sourcePills').innerHTML = '';
  for (const s of active) {
    const el = document.createElement('span');
    el.className = 'pill wait';
    el.innerHTML = `<span>⏳</span>${esc(s.name)}`;
    $('#sourcePills').appendChild(el);
    pills[s.id] = el;
  }

  const collected = [];
  const notes = [];

  await Promise.all(active.map(async src => {
    try {
      const { body, kind } = await fetchThrough(src.search(query));
      const looksHtml = /<\/?(html|body|div|li|span)\b/i.test(body.slice(0, 4000));
      const items = (kind === 'text' && !looksHtml) ? extractFromText(body, src) : extractFromHtml(body, src);
      const good = items.filter(i => relevance(i.title, tokens(query)) >= 0.35);
      collected.push(...good);
      pills[src.id].className = good.length ? 'pill ok' : 'pill';
      pills[src.id].innerHTML = `<span>${good.length ? '✓' : '–'}</span>${esc(src.name)} · ${good.length} offerte`;
      if (!good.length) notes.push(`${src.name}: nessun prezzo leggibile nella pagina`);
    } catch (e) {
      pills[src.id].className = 'pill err';
      pills[src.id].innerHTML = `<span>✕</span>${esc(src.name)} · ${esc(e.message)}`;
      notes.push(`${src.name}: ${e.message}`);
    }
  }));

  const opts = {
    onlyTrusted: $('#onlyTrusted').checked,
    hideOutliers: $('#hideOutliers').checked,
    maxPrice: toNumber($('#maxPrice').value) || null
  };
  const res = analyze(collected, query, opts);
  state.last = { query, res, opts, notes };

  $('#spinner').style.display = 'none';
  $('#statusText').textContent = res.items.length
    ? `${res.items.length} offerte confrontate · prezzo di mercato ≈ ${res.median ? eur(res.median) : 'n.d.'}`
    : 'Nessun prezzo recuperato dalle fonti selezionate.';

  render(res, query, notes);
  pushHistory(query);
  checkWatch(query, res);
  state.running = false;
  $('#searchBtn').disabled = false;
}

/* ====================================================================== */
/*                              INTERFACCIA                               */
/* ====================================================================== */

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cardHtml(it, extraClass = '') {
  const deal = it.deal;
  const badge = deal ? `<span class="badge ${deal.cls}">${deal.icon} ${esc(deal.label)}</span>` : '';
  const save = it.savingPct >= 5 ? `<span class="savings">−${it.savingPct}% sul prezzo medio</span>` : '';
  return `
  <a class="card ${extraClass}" href="${esc(it.url)}" target="_blank" rel="noopener nofollow">
    <div class="rowtop">
      <div class="info">
        <p class="title">${esc(it.title)}</p>
        <div class="meta">
          <span class="merchant">${esc(it.merchant)}</span>
          <span class="trust ${trustClass(it.trust)}">${it.trust} · ${trustLabel(it.trust)}</span>
          ${it.shipping ? `<span>${esc(it.shipping)}</span>` : ''}
          <span>via ${esc(it.sourceName)}</span>
        </div>
      </div>
      <div class="price"><b>${eur(it.price)}</b>${save ? `<small>${save}</small>` : ''}</div>
    </div>
    ${badge}
  </a>`;
}

function render(res, query, notes) {
  // ---- miglior scelta
  if (res.best) {
    const b = res.best;
    const why = [];
    why.push(`Prezzo ${b.price <= res.min * 1.001 ? 'più basso trovato' : `a ${eur(b.price)}`}`);
    why.push(`affidabilità ${b.trust}/100 (${trustLabel(b.trust).toLowerCase()})`);
    if (res.median && b.price < res.median) why.push(`${Math.round((1 - b.price / res.median) * 100)}% sotto il prezzo medio di mercato`);
    $('#best').innerHTML = cardHtml(b, 'hero') +
      `<div class="panel" style="margin-top:10px">
         <p class="hero-why" style="border:0;padding:0;margin:0">Perché: ${esc(why.join(' · '))}.</p>
         <div class="bars">
           <span class="bar">Offerte confrontate: ${res.items.length}</span>
           <span class="bar">Prezzo minimo: ${eur(res.min)}</span>
           <span class="bar">Mediana: ${res.median ? eur(res.median) : 'n.d.'}</span>
         </div>
         <div class="links">
           <a href="#" id="watchAdd">🔔 Avvisami se scende sotto…</a>
         </div>
       </div>`;
    $('#bestWrap').hidden = false;
    $('#watchAdd').onclick = e => { e.preventDefault(); addWatch(query, b.price); };
  } else {
    $('#bestWrap').hidden = true;
  }

  // ---- affari / errori di prezzo
  if (res.deals.length) {
    $('#deals').innerHTML = res.deals.slice(0, 8).map(it => cardHtml(it, it.deal.level === 'error' ? 'hot' : '')).join('');
    $('#dealsSub').textContent = res.median
      ? `Confrontati con il prezzo mediano di ${eur(res.median)}. Un prezzo molto più basso può essere un errore di listino: verifica la pagina prima di ordinare.`
      : '';
    $('#dealsWrap').hidden = false;
  } else {
    $('#dealsWrap').hidden = true;
  }

  // ---- tutti i risultati
  if (res.items.length) {
    $('#resCount').textContent = `(${res.items.length})`;
    paintList();
    $('#resultsWrap').hidden = false;
  } else {
    $('#resultsWrap').hidden = true;
  }

  // ---- esclusi
  if (res.dropped.length) {
    $('#excludedCount').textContent = res.dropped.length === 1
      ? '1 risultato escluso' : res.dropped.length + ' risultati esclusi';
    $('#excluded').innerHTML = res.dropped.slice(0, 20).map(it =>
      cardHtml(it) + `<p class="muted" style="margin:-4px 0 6px 4px;font-size:11.5px">Escluso: ${esc(it.dropReason || '')}</p>`).join('');
    $('#excludedWrap').hidden = false;
  } else {
    $('#excludedWrap').hidden = true;
  }

  // ---- fallback: apri le ricerche a mano
  const links = SOURCES.map(s => `<a href="${esc(s.search(query))}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>`).join('');
  $('#fallbackLinks').innerHTML = links;
  if (res.items.length < 3) {
    $('#fallbackMsg').textContent = notes.length
      ? 'Alcune fonti non hanno risposto (' + notes.slice(0, 3).join(' · ') + '). Puoi aprire la ricerca direttamente sui siti:'
      : 'Pochi risultati leggibili. Puoi aprire la ricerca direttamente sui siti:';
    $('#fallbackWrap').hidden = false;
  } else {
    $('#fallbackWrap').hidden = true;
  }
}

function paintList() {
  if (!state.last) return;
  const mode = $('#sortBy').value;
  const items = [...state.last.res.items].sort((a, b) =>
    mode === 'price' ? a.price - b.price :
    mode === 'trust' ? b.trust - a.trust || a.price - b.price :
    b.score - a.score);
  $('#results').innerHTML = items.map(it => cardHtml(it)).join('');
}

/* ------------------------------------------------------------- cronologia */
function pushHistory(q) {
  state.history = [q, ...state.history.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  saveJSON('tp.history', state.history);
  paintChips();
}
const SUGGEST = ['AirPods Pro 2', 'PlayStation 5 Slim', 'Dyson V15', 'iPhone 15 128GB', 'Nintendo Switch OLED', 'Monitor 27 144Hz'];
function paintChips() {
  const list = state.history.length ? state.history : SUGGEST;
  $('#chips').innerHTML = list.map(q => `<button class="chip" type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('') +
    (state.history.length ? `<button class="chip" type="button" data-clear="1">✕ pulisci</button>` : '');
}

/* ------------------------------------------------------------ avvisi prezzo */
function addWatch(query, currentBest) {
  const suggested = Math.floor(currentBest * 0.9);
  const raw = prompt(`Avvisami quando “${query}” scende sotto (€):`, String(suggested));
  if (raw == null) return;
  const target = toNumber(raw);
  if (!target) { toast('Prezzo non valido'); return; }
  state.watch = [{ query, target, best: currentBest, ts: Date.now() },
                 ...state.watch.filter(w => w.query.toLowerCase() !== query.toLowerCase())].slice(0, 20);
  saveJSON('tp.watch', state.watch);
  paintWatch();
  toast(`Avviso salvato: ${query} sotto ${eur(target)}`);
}

function checkWatch(query, res) {
  const w = state.watch.find(w => w.query.toLowerCase() === query.toLowerCase());
  if (!w || !res.best) return;
  w.best = res.min || res.best.price;
  w.ts = Date.now();
  w.hit = w.best <= w.target;
  saveJSON('tp.watch', state.watch);
  paintWatch();
  if (w.hit) toast(`🔔 ${query} è a ${eur(w.best)}: sotto la tua soglia di ${eur(w.target)}!`);
}

function paintWatch() {
  if (!state.watch.length) {
    $('#watchList').innerHTML = `<p class="empty">Nessun avviso salvato. Fai una ricerca e tocca “Avvisami se scende sotto…”.</p>`;
    return;
  }
  $('#watchList').innerHTML = state.watch.map((w, i) => `
    <div class="watch ${w.hit ? 'hit' : ''}">
      <div class="wq">
        <b>${esc(w.query)}</b>
        <span>obiettivo ${eur(w.target)}${w.best ? ` · ultimo minimo ${eur(w.best)}` : ''}${w.hit ? ' · 🎉 obiettivo raggiunto' : ''}</span>
      </div>
      <button class="mini" data-watch-run="${i}">Cerca</button>
      <button class="mini danger" data-watch-del="${i}">✕</button>
    </div>`).join('');
}

/* ---------------------------------------------------------------- varie UI */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

function paintSourceToggles() {
  $('#sourceToggles').innerHTML = SOURCES.map(s => `
    <label class="src-toggle ${state.sources[s.id] ? 'on' : ''}" data-src="${s.id}">
      <input type="checkbox" ${state.sources[s.id] ? 'checked' : ''}>${esc(s.name)}
    </label>`).join('');
}

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#f4f5fb' : '#0f1024');
  saveJSON('tp.theme', t);
}

/* -------------------------------------------------------------- avvio app */
function init() {
  applyTheme(loadJSON('tp.theme', null) || (mq('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  paintChips(); paintWatch(); paintSourceToggles();

  $('#searchForm').addEventListener('submit', e => { e.preventDefault(); runSearch($('#q').value); });
  $('#sortBy').addEventListener('change', paintList);
  $('#themeBtn').addEventListener('click', () =>
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));

  $('#chips').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.clear) { state.history = []; saveJSON('tp.history', []); paintChips(); return; }
    runSearch(b.dataset.q);
  });

  $('#sourceToggles').addEventListener('change', e => {
    const lab = e.target.closest('.src-toggle'); if (!lab) return;
    state.sources[lab.dataset.src] = e.target.checked;
    if (!Object.values(state.sources).some(Boolean)) { state.sources[lab.dataset.src] = true; e.target.checked = true; toast('Serve almeno una fonte attiva'); }
    lab.classList.toggle('on', e.target.checked);
    saveJSON('tp.sources', state.sources);
  });

  $('#watchList').addEventListener('click', e => {
    const run = e.target.closest('[data-watch-run]'), del = e.target.closest('[data-watch-del]');
    if (run) runSearch(state.watch[+run.dataset.watchRun].query);
    if (del) { state.watch.splice(+del.dataset.watchDel, 1); saveJSON('tp.watch', state.watch); paintWatch(); }
  });

  // suggerimento "aggiungi a Home" su iPhone/iPad
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = navigator.standalone || mq('(display-mode: standalone)').matches;
  if (isIOS && !standalone && !localStorage.getItem('tp.iosHint')) {
    $('#iosHint').hidden = false;
    $('#iosHintClose').onclick = () => { $('#iosHint').hidden = true; localStorage.setItem('tp.iosHint', '1'); };
  }

  // ricerca da URL condiviso: ?q=...
  const q = new URLSearchParams(location.search).get('q');
  if (q) runSearch(q);

  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
}

document.addEventListener('DOMContentLoaded', init);
