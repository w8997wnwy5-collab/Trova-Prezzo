# 🏷️ Trova Prezzo

Web app (PWA) che cerca un prodotto sui negozi online, **confronta i prezzi**, valuta
**quanto è affidabile chi vende** e mette in evidenza **possibili errori di prezzo e offerte imperdibili**.

Funziona interamente nel browser: nessun server, nessuna API key, nessun dato che esce dal telefono.
Pensata per essere installata sulla schermata Home dell'iPhone.

<p align="center"><img src="docs/anteprima.png" width="340" alt="Anteprima di Trova Prezzo"></p>

---

## Cosa fa

| | |
|---|---|
| 🔎 **Ricerca multi-negozio** | Interroga in parallelo Trovaprezzi, idealo, eBay Italia, Google Shopping e Amazon.it |
| 🛡️ **Punteggio di affidabilità** | Ogni venditore ha un punteggio 0-100 (catalogo di negozi italiani noti + euristiche su dominio e TLD) |
| 🏆 **Miglior scelta** | Non il prezzo più basso e basta: il miglior compromesso tra prezzo (55%) e affidabilità (45%) |
| 🎯 **Errori di prezzo** | Prezzo ≤ 40% della mediana di mercato **da un venditore affidabile** → probabile errore di listino |
| 🔥 **Offerte imperdibili** | Prezzo tra il 40% e il 65% della mediana |
| ⚠️ **Anti-abbaglio** | Prezzo bassissimo da venditore poco noto → segnalato come *anomalo, da verificare*, non come affare |
| 🧹 **Filtro rumore** | Accessori, custodie e ricambi (prezzo < 12% della mediana o titolo poco pertinente) finiscono tra gli esclusi |
| 🔔 **Avvisi prezzo** | Salvi una ricerca con un prezzo obiettivo: quando la ripeti ti avvisa se qualcuno è sceso sotto |
| 📱 **PWA offline** | Il guscio dell'app è in cache: si apre anche senza rete (i prezzi ovviamente no) |

## Come funziona

1. **Recupero pagine** — il browser non può leggere direttamente i siti dei negozi (CORS), quindi le
   pagine passano da proxy pubblici (`allorigins`, `codetabs`, `corsproxy`, `r.jina.ai`) provati in
   sequenza finché uno risponde; il proxy che ha funzionato viene ricordato e riprovato per primo.
2. **Estrazione** — invece di dipendere dalle classi CSS di ogni sito (che cambiano di continuo), il
   parser parte dai **testi che contengono un prezzo** e risale nel DOM fino al contenitore che ha un
   link e un titolo. Sugli aggregatori cerca in più il nome del negozio. Se il proxy restituisce
   testo/markdown invece di HTML, usa un parser a righe.
3. **Pulizia** — pertinenza rispetto alla query (almeno il 55% delle parole nel titolo), deduplica
   per negozio+prezzo, rimozione degli outlier.
4. **Analisi** — mediana calcolata sui venditori credibili (affidabilità ≥ 60), da lì derivano
   risparmio percentuale, classificazione dell'affare e punteggio finale.

Lo stato di ogni fonte è mostrato in tempo reale: se un sito blocca il proxy lo vedi scritto, e l'app
propone comunque i link per aprire la ricerca a mano.

## Pubblicazione su GitHub Pages

1. **Settings → Pages → Build and deployment → Source: `Deploy from a branch`**
2. Branch: `main` (o il branch di questo lavoro), cartella `/ (root)` → **Save**
3. Dopo un minuto l'app è su `https://<utente>.github.io/Trova-Prezzo/`

### Aggiungere l'icona alla schermata Home (iPhone/iPad)

1. Apri il link **con Safari** (non Chrome: solo Safari installa le web app su iOS)
2. Tocca **Condividi** (il quadrato con la freccia) → **Aggiungi a Home**
3. Confermi il nome *Trova Prezzo* → l'icona 🏷️ compare tra le app e si apre a schermo intero

## Struttura

```
index.html                 interfaccia
assets/styles.css          tema scuro/chiaro, layout mobile-first
assets/app.js              proxy, parser, analisi prezzi, UI
sw.js                      service worker (guscio offline)
manifest.webmanifest       installazione PWA
icons/                     icona cartellino + lente (SVG e PNG)
```

## Limiti da conoscere

- I proxy CORS pubblici sono gratuiti e **non garantiti**: possono essere lenti, avere rate limit o
  essere bloccati dal negozio. L'app prova più proxy e degrada mostrando i link diretti.
- Alcuni siti (Amazon in particolare) rispondono spesso con una pagina anti-bot: in quel caso la fonte
  risulta "bloccata" ed è normale.
- I prezzi sono letti dalle pagine pubbliche al momento della ricerca, **possono non includere le
  spese di spedizione** e cambiano in continuazione.
- Un prezzo molto più basso della media può essere un vero errore di listino, ma anche un prodotto
  diverso, ricondizionato o un venditore poco serio. **Controlla sempre la pagina del negozio prima di comprare.**
