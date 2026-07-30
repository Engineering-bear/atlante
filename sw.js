/* ============================================================
   SERVICE WORKER DI "GLI ANIMALI VIAGGIATORI"
   ------------------------------------------------------------
   È il programma che sta fra l'app e la rete. Decide, per ogni
   richiesta, se rispondere con una copia salvata o andare online.

   REGOLA PER GLI AGGIORNAMENTI: quando si carica una nuova
   versione dell'app su GitHub, va cambiato il numero qui sotto.
   È quel numero a far capire ai telefoni che devono buttare
   le copie vecchie e riscaricare tutto.
   ============================================================ */

const VERSIONE = "3.2.1";

// Tre magazzini separati, così si svuotano in modo indipendente
const CACHE_APP = `atlante-app-${VERSIONE}`;   // i file dell'app: si rinnova a ogni versione
const CACHE_LIBRERIE = "atlante-librerie";     // Leaflet e Firebase: sopravvivono agli aggiornamenti
const CACHE_TILE = "atlante-tile";             // i quadrotti della mappa

// Tetto ai quadrotti di mappa conservati. Le regole d'uso dei
// server OpenStreetMap vietano lo scaricamento massivo: si tiene
// quanto basta per rivedere offline le zone già guardate.
const MAX_TILE = 400;

// File dell'app da salvare subito, all'installazione
const FILE_APP = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icona-192.png",
  "./icona-512.png",
  "./icona-180.png",
  "./icona-maskable-512.png"
];

/* ============================================================
   INSTALLAZIONE
   ============================================================ */

self.addEventListener("install", evento => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE_APP);
    // 'reload' evita di salvare in cache una copia già vecchia
    await cache.addAll(FILE_APP.map(url => new Request(url, { cache: "reload" })));
    // La nuova versione entra in servizio senza aspettare
    // la chiusura di tutte le schede aperte
    await self.skipWaiting();
  })());
});

/* ============================================================
   ATTIVAZIONE: pulizia delle versioni precedenti
   ============================================================ */

self.addEventListener("activate", evento => {
  evento.waitUntil((async () => {
    const validi = [CACHE_APP, CACHE_LIBRERIE, CACHE_TILE];
    for (const nome of await caches.keys()) {
      if (nome.startsWith("atlante-") && !validi.includes(nome)) {
        await caches.delete(nome);
      }
    }
    await self.clients.claim();
  })());
});

/* ============================================================
   STRATEGIE
   ============================================================ */

// Prima la rete, la copia salvata solo se la rete manca.
// Usata per la pagina dell'app: garantisce che una versione
// nuova arrivi sempre, appena c'è connessione.
async function primaLaRete(richiesta, nomeCache, riserva) {
  const cache = await caches.open(nomeCache);
  try {
    const risposta = await fetch(richiesta);
    if (risposta && risposta.ok) cache.put(richiesta, risposta.clone());
    return risposta;
  } catch (e) {
    const salvata = await cache.match(richiesta) || (riserva && await cache.match(riserva));
    if (salvata) return salvata;
    throw e;
  }
}

// Prima la copia salvata, la rete solo se manca.
// Usata per file che non cambiano mai: librerie e quadrotti di mappa.
async function primaLaCopia(richiesta, nomeCache, tetto) {
  const cache = await caches.open(nomeCache);
  const salvata = await cache.match(richiesta);
  if (salvata) return salvata;

  const risposta = await fetch(richiesta);
  if (risposta && risposta.ok) {
    await cache.put(richiesta, risposta.clone());
    if (tetto) sfoltisci(nomeCache, tetto);
  }
  return risposta;
}

// Elimina le voci più vecchie quando un magazzino supera il tetto
async function sfoltisci(nomeCache, tetto) {
  const cache = await caches.open(nomeCache);
  const chiavi = await cache.keys();
  if (chiavi.length <= tetto) return;
  for (const chiave of chiavi.slice(0, chiavi.length - tetto)) {
    await cache.delete(chiave);
  }
}

/* ============================================================
   SMISTAMENTO DELLE RICHIESTE
   ============================================================ */

self.addEventListener("fetch", evento => {
  const richiesta = evento.request;

  // Si interviene solo sulle letture: le scritture passano sempre dalla rete
  if (richiesta.method !== "GET") return;

  const url = new URL(richiesta.url);

  /* MAI toccare il traffico di Firebase.
     Firestore ha un proprio meccanismo offline, molto più accurato
     di qualunque cache: intercettarlo lo romperebbe. Lo stesso vale
     per l'autenticazione. */
  if (url.hostname.endsWith("googleapis.com") ||
      url.hostname.endsWith("firebaseio.com") ||
      url.hostname.endsWith("google.com")) {
    return;
  }

  // La ricerca di località deve essere sempre viva: nessuna cache
  if (url.hostname.endsWith("nominatim.openstreetmap.org")) return;

  // Apertura dell'app: prima la rete, così gli aggiornamenti arrivano
  if (richiesta.mode === "navigate") {
    evento.respondWith(primaLaRete(richiesta, CACHE_APP, "./index.html"));
    return;
  }

  // Quadrotti della mappa
  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    evento.respondWith(
      primaLaCopia(richiesta, CACHE_TILE, MAX_TILE)
        .catch(() => new Response("", { status: 504 }))
    );
    return;
  }

  // Librerie esterne: Leaflet, Firebase, confini dei paesi
  if (url.hostname === "cdnjs.cloudflare.com" ||
      url.hostname === "www.gstatic.com" ||
      url.hostname === "raw.githubusercontent.com") {
    evento.respondWith(primaLaCopia(richiesta, CACHE_LIBRERIE));
    return;
  }

  // File dell'app (icone, manifest): copia salvata, poi rete
  if (url.origin === self.location.origin) {
    evento.respondWith(
      caches.match(richiesta).then(salvata => salvata || fetch(richiesta))
    );
  }
});
