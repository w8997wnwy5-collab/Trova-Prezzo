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

/* ------------------------------------------------- numeri, valute e cambio */
/* In Svizzera i prezzi si scrivono 1'299.90, CHF 249.-, Fr. 89.–;            */
/* in Italia 1.299,90 €. Qui vengono normalizzati entrambi.                   */

const CUR_RE = /CHF|SFr\.?|Fr\.|₣|€|EUR/i;
const NUM_RE = /\d[\d'’  .,]*(?:[.,][-–—])?/;
const PRICE_RE = new RegExp(
  '(?:' + CUR_RE.source + ')\\s*' + NUM_RE.source +
  '|' + NUM_RE.source + '\\s*(?:' + CUR_RE.source + ')' +
  '|\\d[\\d\'’ .,]*[.,][-–—]', 'i');

function currencyOf(tok) {
  if (!tok) return null;
  return /€|eur/i.test(tok) ? 'EUR' : 'CHF';
}

function toNumber(str) {
  if (str == null) return null;
  let s = String(str).replace(/[\s   '’]/g, '');
  const m = s.match(/\d[\d.,]*(?:[.,][-–—])?/);
  if (!m) return null;
  let n = m[0].replace(/[.,][-–—]$/, '').replace(/[.,]+$/, '');   // 249.- e 89.– valgono 249 e 89
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

/* Legge un prezzo con la sua valuta. `fallbackCur` è la valuta del negozio,
   usata quando il testo scrive solo "249.-" senza simbolo. */
function readPrice(text, fallbackCur) {
  if (!text) return null;
  const hit = String(text).match(PRICE_RE);
  if (!hit) return null;
  const value = toNumber(hit[0]);
  if (value == null) return null;
  const curTok = (hit[0].match(CUR_RE) || [null])[0];
  return { value, cur: currencyOf(curTok) || fallbackCur || 'CHF' };
}

/* Molti negozi svizzeri scrivono solo "219.90" e mettono "CHF" in un altro
   elemento: un numero nudo vale come prezzo solo se il contesto lo conferma. */
const BARE_RE = /^[\s(]*\d{1,3}(?:['’ ]\d{3})*(?:[.,]\d{2})?[\s)]*$/;

function priceContext(el) {
  for (let i = 0; el && i < 4; i++, el = el.parentElement) {
    const attrs = String(el.className || '') + ' ' + String(el.id || '') +
                  ' ' + String((el.getAttribute && el.getAttribute('data-testid')) || '');
    if (/price|prezzo|preis|prix|amount|betrag|costo/i.test(attrs)) return true;
    const t = el.textContent || '';
    if (t.length < 120 && CUR_RE.test(t)) return true;
  }
  return false;
}

function readBarePrice(txt, el, fallbackCur) {
  if (!BARE_RE.test(txt)) return null;
  const value = toNumber(txt);
  if (value == null || value < 1) return null;
  if (!/[.,]\d{2}\s*\)?\s*$/.test(txt) && value < 10) return null;   // "5" non è un prezzo
  return priceContext(el) ? { value, cur: fallbackCur || 'CHF' } : null;
}

/* ------------------------------------------------------------------ cambio */
const FALLBACK_RATE = 0.94;                 // CHF per 1 EUR, usato se il cambio live non arriva
const FX = { rate: FALLBACK_RATE, ts: 0, live: false };

async function loadRate() {
  const cached = loadJSON('tp.fx', null);
  if (cached && cached.rate && Date.now() - cached.ts < 864e5) {
    Object.assign(FX, { rate: cached.rate, ts: cached.ts, live: true });
    return;
  }
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=EUR&to=CHF');
    const j = await r.json();
    if (j && j.rates && j.rates.CHF) {
      Object.assign(FX, { rate: j.rates.CHF, ts: Date.now(), live: true });
      saveJSON('tp.fx', { rate: FX.rate, ts: FX.ts });
    }
  } catch { /* si resta sul tasso di riserva */ }
}

let DISPLAY = 'CHF';                        // valuta in cui si confronta

function convert(value, from, to = DISPLAY) {
  if (!from || from === to) return value;
  return from === 'EUR' ? value * FX.rate : value / FX.rate;
}

const money = (n, cur = DISPLAY) => (n == null || !isFinite(n)) ? '—' :
  n.toLocaleString(cur === 'CHF' ? 'de-CH' : 'it-IT',
                   { style: 'currency', currency: cur, maximumFractionDigits: 2 });

function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/* ------------------------------------------------------------ affidabilità */
/* Punteggio 0-100: quanto ci si può fidare di chi vende.                    */
const TRUST = {
  /* --- Svizzera --------------------------------------------------------- */
  'digitec.ch': 95, 'galaxus.ch': 95, 'brack.ch': 92, 'microspot.ch': 90,
  'interdiscount.ch': 90, 'fust.ch': 89, 'melectronics.ch': 88, 'migros.ch': 91,
  'coop.ch': 90, 'manor.ch': 88, 'mediamarkt.ch': 90, 'steg-electronics.ch': 84,
  'nettoshop.ch': 84, 'daydeal.ch': 82, 'qoqa.ch': 80, 'conrad.ch': 85,
  'distrelec.ch': 85, 'arp.ch': 82, 'pcp.ch': 82, 'alltron.ch': 82,
  'techmania.ch': 78, 'exlibris.ch': 88, 'orellfuessli.ch': 87, 'thalia.ch': 86,
  'zalando.ch': 92, 'ikea.ch': 93, 'decathlon.ch': 92, 'ochsner-sport.ch': 87,
  'sportxx.ch': 86, 'transa.ch': 88, 'jumbo.ch': 87, 'hornbach.ch': 87,
  'bauhaus.ch': 86, 'obi.ch': 85, 'landi.ch': 86, 'zurrose.ch': 88,
  'amavita.ch': 87, 'sunstore.ch': 85, 'lehner-versand.ch': 80, 'ackermann.ch': 78,
  'ricardo.ch': 68, 'anibis.ch': 52, 'tutti.ch': 52, 'galaxus.de': 88,
  'toppreise.ch': 86, 'comparis.ch': 85, 'preisvergleich.ch': 78, 'apple.com': 98,

  /* --- Italia ed estero in euro ----------------------------------------- */
  'amazon.it': 92, 'amazon.de': 90, 'amazon.com': 84, 'samsung.com': 95,
  'mediaworld.it': 90, 'unieuro.it': 88, 'euronics.it': 87, 'trony.it': 85,
  'expert.it': 84, 'comet.it': 84, 'monclick.it': 79, 'yeppon.it': 76,
  'bpm-power.com': 78, 'eprice.it': 68, 'nexths.it': 72, 'r-store.it': 80,
  'zalando.it': 89, 'decathlon.it': 90, 'ikea.com': 91, 'leroymerlin.it': 87,
  'douglas.it': 85, 'sephora.it': 86, 'notino.it': 78, 'feltrinelli.it': 87,
  'mondadoristore.it': 86, 'ibs.it': 84, 'nike.com': 91, 'adidas.it': 90,
  'gamestop.it': 82, 'instantgaming.com': 72, 'eneba.com': 60,
  'ebay.it': 74, 'ebay.de': 74, 'ebay.com': 70, 'subito.it': 52,
  'aliexpress.com': 58, 'temu.com': 45, 'wish.com': 32, 'banggood.com': 55,
  'trovaprezzi.it': 80, 'idealo.it': 82, 'idealo.de': 82, 'kelkoo.it': 74,
  'google.com': 75, 'manomano.it': 78, 'pccomponentes.it': 76, 'notebooksbilliger.de': 84,
  'cyberport.de': 82, 'coolblue.de': 84, 'bike-components.de': 85
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
  if (/\.ch$/.test(root)) s += 10;           // negozio svizzero: consegna interna, garanzia locale
  if (/\.(it|de|at|fr)$/.test(root)) s += 5; // UE: acquisto affidabile ma con import
  if (/\.(eu|es|nl)$/.test(root)) s += 2;
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
  /* ---------------------------- Svizzera (prezzi in CHF) ---------------- */
  { id: 'toppreise', name: 'Toppreise', region: 'CH', cur: 'CHF', base: 'https://www.toppreise.ch',
    search: q => `https://www.toppreise.ch/suche?search=${enc(q)}`,
    merchantSel: ['[class*="shop" i]', '[class*="merchant" i]', 'img[alt*="logo" i]'] },
  { id: 'googlech', name: 'Google Shopping CH', region: 'CH', cur: 'CHF', base: 'https://www.google.com',
    search: q => `https://www.google.com/search?q=${enc(q)}&tbm=shop&hl=it&gl=CH&num=40`,
    merchantSel: ['[class*="merchant"]', '.aULzUe', '.IuHnof'] },
  { id: 'digitec', name: 'digitec', region: 'CH', cur: 'CHF', base: 'https://www.digitec.ch',
    search: q => `https://www.digitec.ch/it/search?q=${enc(q)}`, merchantSel: [] },
  { id: 'galaxus', name: 'Galaxus', region: 'CH', cur: 'CHF', base: 'https://www.galaxus.ch',
    search: q => `https://www.galaxus.ch/it/search?q=${enc(q)}`, merchantSel: [] },
  { id: 'brack', name: 'Brack', region: 'CH', cur: 'CHF', base: 'https://www.brack.ch',
    search: q => `https://www.brack.ch/search?query=${enc(q)}`, merchantSel: [] },
  { id: 'microspot', name: 'microspot', region: 'CH', cur: 'CHF', base: 'https://www.microspot.ch',
    search: q => `https://www.microspot.ch/it/search?q=${enc(q)}`, merchantSel: [], off: true },
  { id: 'interdiscount', name: 'Interdiscount', region: 'CH', cur: 'CHF', base: 'https://www.interdiscount.ch',
    search: q => `https://www.interdiscount.ch/it/search?q=${enc(q)}`, merchantSel: [], off: true },
  { id: 'ricardo', name: 'Ricardo', region: 'CH', cur: 'CHF', base: 'https://www.ricardo.ch',
    search: q => `https://www.ricardo.ch/it/s/${enc(q)}`, merchantSel: [], off: true },

  /* ---------------------------- Italia ed estero (prezzi in EUR) -------- */
  { id: 'trovaprezzi', name: 'Trovaprezzi', region: 'EU', cur: 'EUR', base: 'https://www.trovaprezzi.it',
    search: q => `https://www.trovaprezzi.it/prezzi_.aspx?libera=${enc(q)}&sbox=1`,
    merchantSel: ['.merchant_name_bottom', '.merchant_name', '.merchant_link', 'img.merchant_logo[alt]', '[class*="merchant"]'] },
  { id: 'idealo', name: 'idealo', region: 'EU', cur: 'EUR', base: 'https://www.idealo.it',
    search: q => `https://www.idealo.it/prezzi/ricerca.html?q=${enc(q)}`,
    merchantSel: ['[class*="shopName"]', '[class*="offerList-item-shop"]', 'img[alt*="logo" i]'] },
  { id: 'googleit', name: 'Google Shopping IT', region: 'EU', cur: 'EUR', base: 'https://www.google.com',
    search: q => `https://www.google.com/search?q=${enc(q)}&tbm=shop&hl=it&gl=IT&num=40`,
    merchantSel: ['[class*="merchant"]', '.aULzUe', '.IuHnof'] },
  { id: 'ebay', name: 'eBay Italia', region: 'EU', cur: 'EUR', base: 'https://www.ebay.it',
    search: q => `https://www.ebay.it/sch/i.html?_nkw=${enc(q)}&_sop=15&LH_BIN=1&_ipg=60`,
    merchantSel: ['.s-item__seller-info-text', '.s-card__attribute-row'] },
  { id: 'amazonit', name: 'Amazon.it', region: 'EU', cur: 'EUR', base: 'https://www.amazon.it',
    search: q => `https://www.amazon.it/s?k=${enc(q)}&language=it_IT`, merchantSel: [] },
  { id: 'amazonde', name: 'Amazon.de', region: 'EU', cur: 'EUR', base: 'https://www.amazon.de',
    search: q => `https://www.amazon.de/s?k=${enc(q)}`, merchantSel: [], off: true }
];

/* Regione di consegna dedotta dal dominio: .ch = acquisto interno */
const regionOfHost = h => /\.ch$/.test(rootDomain(h || '')) ? 'CH' : 'EU';

const AGGREGATORS = new Set(['trovaprezzi.it', 'idealo.it', 'google.com', 'toppreise.ch', 'comparis.ch', 'kelkoo.it']);

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
    const read = readPrice(txt, source.cur) || readBarePrice(txt, node.parentElement, source.cur);
    if (!read) continue;
    const price = read.value;
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
    out.push(makeItem({ title, price, cur: read.cur, url, container, source }));
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

function makeItem({ title, price, cur, url, container, source }) {
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

  const region = regionOfHost(AGGREGATORS.has(rootDomain(host)) ? domainForTrust : host);
  return {
    title: title.replace(/\s+/g, ' ').slice(0, 160),
    price, cur: cur || source.cur, url, host, region,
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
  if (/spedizione gratuita|consegna gratuita|spedizione gratis|gratis|free shipping|gratis lieferung|kostenlose lieferung|livraison gratuite/.test(t)) return 'Spedizione gratuita';
  const m = t.match(/(?:\+|spese di spedizione|versandkosten)[^\n]{0,18}?((?:chf|fr\.|€|eur)?\s?\d[\d'’.,]*(?:\s?(?:chf|€|eur))?)/);
  if (m) { const r = readPrice(m[1], null); if (r && r.value > 0) return '+ ' + money(r.value, r.cur) + ' spedizione'; }
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
      let read = null;
      for (let j = i; j <= Math.min(i + 3, lines.length - 1) && !read; j++) {
        const r = readPrice(lines[j], source.cur);
        if (r && r.value > 0.5 && r.value < 500000) read = r;
      }
      if (!read) continue;
      const url = resolveUrl(m[2], source);
      if (!url) continue;
      const key = url.split('?')[0] + '|' + read.value.toFixed(2);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(makeItem({ title, price: read.value, cur: read.cur, url, container: null, source }));
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

/* IVA svizzera all'importazione: 8.1%. Sotto ~5 CHF di imposta la dogana non
   riscuote nulla, quindi i piccoli acquisti restano al prezzo di listino. */
const IMPORT_VAT = 0.081, VAT_FREE_UNDER = 5;

function normalizePrice(it, opts) {
  const converted = convert(it.price, it.cur, opts.display);
  it.converted = converted;
  it.importCost = 0;
  if (opts.importVat && it.region !== 'CH' && opts.display === 'CHF') {
    const vat = converted * IMPORT_VAT;
    if (vat >= VAT_FREE_UNDER) it.importCost = vat;
  }
  it.norm = converted + it.importCost;
  return it.norm;
}

function analyze(raw, query, opts) {
  const qTokens = tokens(query);
  const kept = [], dropped = [];

  for (const it of raw) {
    normalizePrice(it, opts);
    it.rel = relevance(it.title, qTokens);
    if (it.rel < CFG.minRelevance) { it.dropReason = 'poco pertinente con la ricerca'; dropped.push(it); }
    else kept.push(it);
  }

  // deduplica: stesso negozio e prezzo quasi identico
  const byKey = new Map();
  for (const it of kept) {
    const key = norm(it.merchant) + '|' + Math.round(it.norm * 100) / 100;
    const prev = byKey.get(key);
    if (!prev || it.rel > prev.rel) byKey.set(key, it);
  }
  let live = [...byKey.values()];

  // filtri utente
  if (opts.onlyTrusted) {
    live = live.filter(it => { if (it.trust >= 70) return true; it.dropReason = 'venditore sotto la soglia di affidabilità'; dropped.push(it); return false; });
  }
  if (opts.maxPrice) {
    live = live.filter(it => { if (it.norm <= opts.maxPrice) return true; it.dropReason = 'sopra il prezzo massimo'; dropped.push(it); return false; });
  }

  // riferimento di mercato: mediana dei venditori credibili
  const baseline = list => {
    const solid = list.filter(it => it.trust >= 60).map(it => it.norm);
    return median(solid.length >= 3 ? solid : list.map(it => it.norm));
  };
  let med = baseline(live);

  // prezzi assurdamente bassi = quasi sempre un altro prodotto (custodia, ricambio…)
  if (med && opts.hideOutliers) {
    live = live.filter(it => {
      if (it.norm >= med * 0.12) return true;
      it.dropReason = 'prezzo troppo basso rispetto al mercato: probabile accessorio o prodotto diverso';
      dropped.push(it); return false;
    });
    // senza gli accessori il prezzo di mercato è più veritiero: ricalcolalo
    med = baseline(live) || med;
  }

  const min = live.length ? Math.min(...live.map(i => i.norm)) : 0;
  for (const it of live) {
    it.deal = dealOf(it, med);
    it.saving = med ? Math.max(0, med - it.norm) : 0;
    it.savingPct = med ? Math.round((1 - it.norm / med) * 100) : 0;
    const priceScore = min ? min / it.norm : 0;
    it.score = 0.55 * priceScore + 0.45 * (it.trust / 100);
    // un prezzo sospetto da venditore ignoto non deve guidare la classifica
    if (it.deal && it.deal.level === 'risk') it.score *= 0.7;
  }

  live.sort((a, b) => b.score - a.score);

  // miglior scelta: buon prezzo ma venditore serio
  const trustworthy = live.filter(it => it.trust >= 70);
  const best = (trustworthy.length ? trustworthy : live)[0] || null;
  const deals = live.filter(it => it.deal && it.deal.level !== 'good' && it !== best)
                    .sort((a, b) => a.norm - b.norm);

  return { items: live, dropped, best, deals, median: med, min };
}

function dealOf(it, med) {
  if (!med) return null;
  const r = it.norm / med;
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
  sources: { ...Object.fromEntries(SOURCES.map(s => [s.id, !s.off])), ...(loadJSON('tp.sources', null) || {}) },
  region:  loadJSON('tp.region', 'CH'),      // CH | ALL | EU
  display: loadJSON('tp.display', 'CHF'),    // valuta di confronto
  importVat: loadJSON('tp.importVat', true), // stima IVA import sugli acquisti esteri
  history: loadJSON('tp.history', []),
  watch:   loadJSON('tp.watch', []),
  last:    null,
  running: false
};
DISPLAY = state.display;

const sourcesForRegion = () =>
  SOURCES.filter(s => state.region === 'ALL' || s.region === state.region);

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

  const active = sourcesForRegion().filter(s => state.sources[s.id]);
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
    maxPrice: toNumber($('#maxPrice').value) || null,
    display: DISPLAY,
    importVat: state.importVat
  };
  const res = analyze(collected, query, opts);
  state.last = { query, res, opts, notes };

  $('#spinner').style.display = 'none';
  $('#statusText').textContent = res.items.length
    ? `${res.items.length} offerte confrontate · prezzo di mercato ≈ ${res.median ? money(res.median) : 'n.d.'}`
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
  const save = it.savingPct >= 5 ? `−${it.savingPct}% sul prezzo medio` : '';
  const foreign = it.cur !== DISPLAY;
  const orig = foreign || it.importCost
    ? `${foreign ? money(it.price, it.cur) : ''}${it.importCost ? ' + IVA import' : ''}`.trim()
    : '';
  return `
  <a class="card ${extraClass}" href="${esc(it.url)}" target="_blank" rel="noopener nofollow">
    <div class="rowtop">
      <div class="info">
        <p class="title">${esc(it.title)}</p>
        <div class="meta">
          <span class="merchant">${esc(it.merchant)}</span>
          <span class="trust ${trustClass(it.trust)}">${it.trust} · ${trustLabel(it.trust)}</span>
          <span>${it.region === 'CH' ? '🇨🇭 dalla Svizzera' : '✈︎ dall\'estero'}</span>
          ${it.shipping ? `<span>${esc(it.shipping)}</span>` : ''}
          <span>via ${esc(it.sourceName)}</span>
        </div>
      </div>
      <div class="price"><b>${money(it.norm)}</b>${orig ? `<small>${esc(orig)}</small>` : ''}${save ? `<small class="savings">${save}</small>` : ''}</div>
    </div>
    ${badge}
  </a>`;
}

function render(res, query, notes) {
  // ---- miglior scelta
  if (res.best) {
    const b = res.best;
    const why = [];
    why.push(`Prezzo ${b.norm <= res.min * 1.001 ? 'più basso trovato' : `a ${money(b.norm)}`}`);
    why.push(`affidabilità ${b.trust}/100 (${trustLabel(b.trust).toLowerCase()})`);
    if (res.median && b.norm < res.median) why.push(`${Math.round((1 - b.norm / res.median) * 100)}% sotto il prezzo medio di mercato`);
    $('#best').innerHTML = cardHtml(b, 'hero') +
      `<div class="panel" style="margin-top:10px">
         <p class="hero-why" style="border:0;padding:0;margin:0">Perché: ${esc(why.join(' · '))}.</p>
         <div class="bars">
           <span class="bar">Offerte confrontate: ${res.items.length}</span>
           <span class="bar">Prezzo minimo: ${money(res.min)}</span>
           <span class="bar">Mediana: ${res.median ? money(res.median) : 'n.d.'}</span>
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
      ? `Confrontati con il prezzo mediano di ${money(res.median)}. Un prezzo molto più basso può essere un errore di listino: verifica la pagina prima di ordinare.`
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
    mode === 'price' ? a.norm - b.norm :
    mode === 'trust' ? b.trust - a.trust || a.norm - b.norm :
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
  state.watch = [{ query, target, best: currentBest, cur: DISPLAY, ts: Date.now() },
                 ...state.watch.filter(w => w.query.toLowerCase() !== query.toLowerCase())].slice(0, 20);
  saveJSON('tp.watch', state.watch);
  paintWatch();
  toast(`Avviso salvato: ${query} sotto ${money(target)}`);
}

function checkWatch(query, res) {
  const w = state.watch.find(w => w.query.toLowerCase() === query.toLowerCase());
  if (!w || !res.best) return;
  w.best = res.min || res.best.norm;
  w.cur = DISPLAY;
  w.ts = Date.now();
  w.hit = w.best <= w.target;
  saveJSON('tp.watch', state.watch);
  paintWatch();
  if (w.hit) toast(`🔔 ${query} è a ${money(w.best, w.cur)}: sotto la tua soglia di ${money(w.target, w.cur)}!`);
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
        <span>obiettivo ${money(w.target, w.cur || 'CHF')}${w.best ? ` · ultimo minimo ${money(w.best, w.cur || 'CHF')}` : ''}${w.hit ? ' · 🎉 obiettivo raggiunto' : ''}</span>
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
  $('#sourceToggles').innerHTML = sourcesForRegion().map(s => `
    <label class="src-toggle ${state.sources[s.id] ? 'on' : ''}" data-src="${s.id}">
      <input type="checkbox" ${state.sources[s.id] ? 'checked' : ''}>${esc(s.name)}
    </label>`).join('');
}

function paintRegion() {
  $$('#regionSeg button').forEach(b => b.classList.toggle('on', b.dataset.region === state.region));
}

function paintFx() {
  const when = FX.ts ? new Date(FX.ts).toLocaleDateString('it-CH') : null;
  $('#fxNote').textContent = FX.live
    ? `Cambio in uso: 1 € = ${FX.rate.toFixed(3)} CHF (BCE, ${when}).`
    : `Cambio in uso: 1 € = ${FX.rate.toFixed(3)} CHF (valore di riserva: il cambio aggiornato non è raggiungibile).`;
}

function setDisplay(cur) {
  state.display = DISPLAY = cur;
  saveJSON('tp.display', cur);
  $('#curLabel').textContent = cur;
  paintFx();
  if (state.last) runSearch(state.last.query);   // riconverte i risultati già trovati
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
  paintChips(); paintWatch(); paintRegion(); paintSourceToggles();
  $('#displayCur').value = state.display;
  $('#importVat').checked = state.importVat;
  $('#curLabel').textContent = state.display;
  paintFx();
  loadRate().then(paintFx);

  $('#searchForm').addEventListener('submit', e => { e.preventDefault(); runSearch($('#q').value); });
  $('#sortBy').addEventListener('change', paintList);
  $('#themeBtn').addEventListener('click', () =>
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));

  $('#regionSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.region = b.dataset.region;
    saveJSON('tp.region', state.region);
    paintRegion(); paintSourceToggles();
    if (state.last) runSearch(state.last.query);
  });

  $('#displayCur').addEventListener('change', e => setDisplay(e.target.value));

  $('#importVat').addEventListener('change', e => {
    state.importVat = e.target.checked;
    saveJSON('tp.importVat', state.importVat);
    if (state.last) runSearch(state.last.query);
  });

  $('#chips').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.clear) { state.history = []; saveJSON('tp.history', []); paintChips(); return; }
    runSearch(b.dataset.q);
  });

  $('#sourceToggles').addEventListener('change', e => {
    const lab = e.target.closest('.src-toggle'); if (!lab) return;
    state.sources[lab.dataset.src] = e.target.checked;
    if (!sourcesForRegion().some(s => state.sources[s.id])) { state.sources[lab.dataset.src] = true; e.target.checked = true; toast('Serve almeno una fonte attiva'); }
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
