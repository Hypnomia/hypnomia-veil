// Wegwerf-Spike: Erkenner im Erweiterungskontext (Chrome: Offscreen-Dokument, Firefox: Hintergrundseite).
// Laedt das Modell aus dem Paket, nimmt Nachrichten entgegen (pruefeUrl, hole, lade, status) und misst Zeiten.
// Kein Produktcode. Die Logik fuer Vor- und Nachverarbeitung ist aus spike/s1-modell/messung.js uebernommen.
/* global ort */
const api = typeof browser !== 'undefined' ? browser : chrome;
const INSTANZ = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const GESTARTET = Date.now();
const jetzt = () => performance.now();
const runde = (x) => Math.round(x * 100) / 100;

const ZONEN = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const KLASSEN = [
  'FEMALE_GENITALIA_COVERED', 'FACE_FEMALE', 'BUTTOCKS_EXPOSED', 'FEMALE_BREAST_EXPOSED',
  'FEMALE_GENITALIA_EXPOSED', 'MALE_BREAST_EXPOSED', 'ANUS_EXPOSED', 'FEET_EXPOSED',
  'BELLY_COVERED', 'FEET_COVERED', 'ARMPITS_COVERED', 'ARMPITS_EXPOSED', 'FACE_MALE',
  'BELLY_EXPOSED', 'MALE_GENITALIA_EXPOSED', 'ANUS_COVERED', 'FEMALE_BREAST_COVERED',
  'BUTTOCKS_COVERED',
];
const ZUORDNUNG = {
  FEMALE_GENITALIA_EXPOSED: ['genitals', false], FEMALE_GENITALIA_COVERED: ['genitals', true],
  MALE_GENITALIA_EXPOSED: ['genitals', false],
  BUTTOCKS_EXPOSED: ['buttocks', false], BUTTOCKS_COVERED: ['buttocks', true],
  ANUS_EXPOSED: ['buttocks', false], ANUS_COVERED: ['buttocks', true],
  FEMALE_BREAST_EXPOSED: ['breast', false], FEMALE_BREAST_COVERED: ['breast', true],
  MALE_BREAST_EXPOSED: ['breast', false],
  BELLY_EXPOSED: ['belly', false], BELLY_COVERED: ['belly', true],
  FEET_EXPOSED: ['feet', false], FEET_COVERED: ['feet', true],
  ARMPITS_EXPOSED: ['armpits', false], ARMPITS_COVERED: ['armpits', true],
  FACE_FEMALE: ['face', false], FACE_MALE: ['face', false],
};
const GESICHTS_ZONEN = ['face', 'head', 'eyes', 'mouth'];
const NMS_IOU = 0.45;

let konfig = null;
let session = null;
let sessionInfo = null; // { modell, backend, S, eingabe, ausgabe, zeiten }
let ladeVersprechen = null;
let canvas = null;
let ctx = null;
// Laeufe nacheinander: parallele session.run-Aufrufe wuerden sich gegenseitig Wartezeit in die Messung schreiben.
let kette = Promise.resolve();
function nacheinander(fn) {
  const t0 = jetzt();
  const p = kette.then(async () => ({ warteMs: runde(jetzt() - t0), ergebnis: await fn() }));
  kette = p.catch(() => {});
  return p;
}
const protokoll = [];
function log(text) {
  protokoll.push(`${new Date().toISOString()} ${text}`);
  if (protokoll.length > 200) protokoll.shift();
}

async function ladeKonfig() {
  if (konfig) return konfig;
  konfig = await (await fetch(api.runtime.getURL('konfig.json'))).json();
  return konfig;
}

// Modell und Session aufbauen; misst modellLaden, session, erstlauf.
async function ladeModell(modell, backend) {
  const k = await ladeKonfig();
  modell = modell ?? k.modell ?? '320n';
  backend = backend ?? k.backend ?? 'wasm';
  const S = modell === '320n' ? 320 : 640;
  const t0 = jetzt();
  ort.env.wasm.wasmPaths = api.runtime.getURL('ort/');
  ort.env.wasm.numThreads = k.threads ?? 1;
  const quelle = k.modellQuelle && k.modellQuelle !== 'paket' ? `${k.modellQuelle}${modell}.onnx` : api.runtime.getURL(`modelle/${modell}.onnx`);
  const bytes = new Uint8Array(await (await fetch(quelle)).arrayBuffer());
  const t1 = jetzt();
  let genutzt = backend;
  const fehler = [];
  try {
    session = await ort.InferenceSession.create(bytes, { executionProviders: [backend], graphOptimizationLevel: 'all' });
  } catch (e) {
    fehler.push(`${backend}: ${e && e.message ? e.message : e}`);
    if (backend === 'wasm') throw e;
    genutzt = 'wasm-rueckfall';
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  }
  const t2 = jetzt();
  const eingabe = session.inputNames[0];
  const ausgabe = session.outputNames[0];
  await session.run({ [eingabe]: new ort.Tensor('float32', new Float32Array(3 * S * S), [1, 3, S, S]) });
  const t3 = jetzt();
  canvas = new OffscreenCanvas(S, S);
  ctx = canvas.getContext('2d', { willReadFrequently: true });
  sessionInfo = {
    modell, backend, genutztesBackend: genutzt, S, eingabe, ausgabe, fehler,
    numThreads: ort.env.wasm.numThreads,
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : null,
    zeiten: { modellLadenMs: runde(t1 - t0), sessionMs: runde(t2 - t1), erstlaufMs: runde(t3 - t2), kaltstartMs: runde(t3 - t0) },
    geladenAm: Date.now(),
  };
  log(`Modell ${modell} ${genutzt} geladen in ${runde(t3 - t0)} ms`);
  return sessionInfo;
}
function stelleSessionSicher(modell, backend) {
  if (session && (!modell || sessionInfo.modell === modell) && (!backend || sessionInfo.backend === backend)) return Promise.resolve({ info: sessionInfo, kalt: false });
  if (!ladeVersprechen) {
    ladeVersprechen = ladeModell(modell, backend).finally(() => { ladeVersprechen = null; });
  }
  return ladeVersprechen.then((info) => ({ info, kalt: true }));
}

function baueTensor(bitmap, S, kanal) {
  const w = bitmap.width;
  const h = bitmap.height;
  const skala = S / Math.max(w, h);
  const zw = Math.max(1, Math.round(w * skala));
  const zh = Math.max(1, Math.round(h * skala));
  ctx.fillStyle = 'rgb(0,0,0)';
  ctx.fillRect(0, 0, S, S);
  ctx.drawImage(bitmap, 0, 0, zw, zh);
  const px = ctx.getImageData(0, 0, S, S).data;
  const flaeche = S * S;
  const daten = new Float32Array(3 * flaeche);
  const k0 = kanal === 'bgr' ? 2 : 0;
  const k2 = kanal === 'bgr' ? 0 : 2;
  for (let p = 0; p < flaeche; p++) {
    daten[p] = px[p * 4 + k0] / 255;
    daten[flaeche + p] = px[p * 4 + 1] / 255;
    daten[2 * flaeche + p] = px[p * 4 + k2] / 255;
  }
  return { tensor: new ort.Tensor('float32', daten, [1, 3, S, S]), skala, w, h };
}
function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  if (x2 <= x1 || y2 <= y1) return 0;
  const s = (x2 - x1) * (y2 - y1);
  return s / (a[2] * a[3] + b[2] * b[3] - s);
}
function nachverarbeite(ausgabe, geo, schwelle) {
  const [, kanaele, n] = ausgabe.dims;
  const d = ausgabe.data;
  const kAnz = kanaele - 4;
  const kand = [];
  for (let i = 0; i < n; i++) {
    let beste = -1;
    let best = -Infinity;
    for (let c = 0; c < kAnz; c++) { const s = d[(4 + c) * n + i]; if (s > best) { best = s; beste = c; } }
    if (best < schwelle) continue;
    const cw = d[2 * n + i];
    const ch = d[3 * n + i];
    const x = Math.max(0, (d[i] - cw / 2) / geo.skala);
    const y = Math.max(0, (d[n + i] - ch / 2) / geo.skala);
    kand.push({ klasse: KLASSEN[beste] ?? `K${beste}`, score: best, box: [x, y, Math.min(cw / geo.skala, geo.w - x), Math.min(ch / geo.skala, geo.h - y)] });
  }
  kand.sort((p, q) => q.score - p.score);
  const behalten = [];
  for (const k of kand) if (behalten.every((b) => iou(k.box, b.box) <= NMS_IOU)) behalten.push(k);
  return behalten.map((k) => ({ klasse: k.klasse, score: runde(k.score), box: k.box.map((v) => Math.trunc(v)) }));
}
function zonenAus(treffer) {
  const sichtbar = new Set();
  const bedeckt = new Set();
  let gesicht = false;
  for (const t of treffer) {
    const z = ZUORDNUNG[t.klasse];
    if (!z) continue;
    if (z[0] === 'face') gesicht = true;
    (z[1] ? bedeckt : sichtbar).add(z[0]);
  }
  if (gesicht) for (const z of GESICHTS_ZONEN) sichtbar.add(z);
  for (const z of sichtbar) bedeckt.delete(z);
  return { sichtbar: ZONEN.filter((z) => sichtbar.has(z)), bedeckt: ZONEN.filter((z) => bedeckt.has(z)) };
}

// Bild per Adresse holen (Host-Rechte erlauben fremde Urspruenge), dekodieren, pruefen.
async function pruefeUrl(nachricht) {
  const tStart = jetzt();
  const { info, kalt } = await stelleSessionSicher(nachricht.modell, nachricht.backend);
  const tSession = jetzt();
  const optionen = { credentials: nachricht.credentials ?? 'omit', cache: nachricht.cache ?? 'default' };
  if (nachricht.referrer) optionen.referrer = nachricht.referrer;
  let antwort;
  try {
    antwort = await fetch(nachricht.url, optionen);
  } catch (e) {
    return { ok: false, fehler: `fetch: ${e && e.message ? e.message : e}`, instanz: INSTANZ, kalt, ms: { session: runde(tSession - tStart) } };
  }
  const tNetz1 = jetzt();
  if (!antwort.ok) return { ok: false, status: antwort.status, instanz: INSTANZ, kalt, ms: { session: runde(tSession - tStart), netz: runde(tNetz1 - tSession) } };
  const blob = await antwort.blob();
  const tNetz2 = jetzt();
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (e) {
    return { ok: false, status: antwort.status, bytes: blob.size, fehler: `dekod: ${e && e.message ? e.message : e}`, instanz: INSTANZ, kalt };
  }
  const tDekod = jetzt();
  const geo = baueTensor(bitmap, info.S, nachricht.kanal ?? konfig.kanal ?? 'rgb');
  bitmap.close?.();
  const tVor = jetzt();
  const { warteMs, ergebnis: aus } = await nacheinander(() => session.run({ [info.eingabe]: geo.tensor }));
  const tInf = jetzt();
  const treffer = nachverarbeite(aus[info.ausgabe], geo, nachricht.schwelle ?? konfig.schwelle ?? 0.2);
  const zonen = zonenAus(treffer);
  const tNach = jetzt();
  return {
    ok: true, status: antwort.status, bytes: blob.size, breite: geo.w, hoehe: geo.h, treffer, zonen,
    instanz: INSTANZ, kalt, kaltstart: kalt ? info.zeiten : null, modell: info.modell, backend: info.genutztesBackend,
    ms: { session: runde(tSession - tStart), netz: runde(tNetz2 - tSession), dekod: runde(tDekod - tNetz2), vor: runde(tVor - tDekod), warte: warteMs, inf: runde(tInf - tVor - warteMs), nach: runde(tNach - tInf), gesamt: runde(tNach - tStart) },
  };
}

// Pixel aus dem Content-Script (z. B. Videobild), als Zahlenliste RGBA in Modellgroesse.
async function pruefePixel(nachricht) {
  const tStart = jetzt();
  const { info, kalt } = await stelleSessionSicher(nachricht.modell, nachricht.backend);
  const S = info.S;
  const quelle = nachricht.daten;
  const px = Array.isArray(quelle) ? quelle : Object.values(quelle);
  const flaeche = S * S;
  const daten = new Float32Array(3 * flaeche);
  for (let p = 0; p < flaeche; p++) {
    daten[p] = px[p * 4] / 255;
    daten[flaeche + p] = px[p * 4 + 1] / 255;
    daten[2 * flaeche + p] = px[p * 4 + 2] / 255;
  }
  const tVor = jetzt();
  const { warteMs, ergebnis: aus } = await nacheinander(() => session.run({ [info.eingabe]: new ort.Tensor('float32', daten, [1, 3, S, S]) }));
  const tInf = jetzt();
  // Das Content-Script fuellt rechts/unten schwarz auf (Seitenverhaeltnis bleibt), Skala wie bei Bildern.
  const geo = { skala: S / Math.max(nachricht.breite, nachricht.hoehe), w: nachricht.breite, h: nachricht.hoehe };
  const treffer = nachverarbeite(aus[info.ausgabe], geo, nachricht.schwelle ?? konfig.schwelle ?? 0.2);
  return { ok: true, treffer, zonen: zonenAus(treffer), instanz: INSTANZ, kalt, ms: { vor: runde(tVor - tStart), warte: warteMs, inf: runde(tInf - tVor - warteMs), gesamt: runde(jetzt() - tStart) } };
}

// Nur holen (S2): Status, Bytes, Netzzeit, optional dekodieren. Mehrere Adressen parallel.
async function hole(nachricht) {
  const urls = nachricht.urls ?? [];
  const parallel = nachricht.parallel ?? 6;
  const dekod = !!nachricht.dekod;
  const S = nachricht.S ?? 320;
  const ergebnisse = new Array(urls.length);
  let i = 0;
  const tAlle = jetzt();
  async function arbeiter() {
    while (i < urls.length) {
      const idx = i++;
      const url = urls[idx];
      const t0 = jetzt();
      const e = { idx, host: safeHost(url) };
      try {
        const optionen = { credentials: nachricht.credentials ?? 'omit', cache: nachricht.cache ?? 'default' };
        if (nachricht.referrer) optionen.referrer = nachricht.referrer;
        const a = await fetch(url, optionen);
        e.status = a.status;
        e.typ = a.headers.get('content-type') ?? '';
        const blob = await a.blob();
        e.bytes = blob.size;
        e.netzMs = runde(jetzt() - t0);
        if (dekod && a.ok) {
          const t1 = jetzt();
          const bmp = await createImageBitmap(blob, { resizeWidth: S, resizeHeight: S, resizeQuality: 'low' });
          e.dekodMs = runde(jetzt() - t1);
          e.dekodOk = true;
          bmp.close?.();
        }
      } catch (err) {
        e.fehler = `${err && err.name ? err.name : ''}: ${err && err.message ? err.message : err}`.slice(0, 200);
        e.netzMs = runde(jetzt() - t0);
      }
      ergebnisse[idx] = e;
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, urls.length) }, arbeiter));
  return { ok: true, instanz: INSTANZ, gesamtMs: runde(jetzt() - tAlle), anzahl: urls.length, ergebnisse };
}
function safeHost(url) { try { return new URL(url).host; } catch { return '?'; } }

// Videobild im Erkenner: stummes Video laden, Zeitpunkt ansteuern, zeichnen (S3-Ausweg fuer fremde Quellen).
async function videoBild(nachricht) {
  const t0 = jetzt();
  if (typeof document === 'undefined') return { ok: false, fehler: 'kein DOM' };
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  if (nachricht.crossorigin) v.crossOrigin = 'anonymous';
  v.src = nachricht.url;
  const warte = (ev, ms) => new Promise((ok, fehl) => {
    const t = setTimeout(() => fehl(new Error(`Zeitlimit ${ev}`)), ms);
    v.addEventListener(ev, () => { clearTimeout(t); ok(); }, { once: true });
    v.addEventListener('error', () => { clearTimeout(t); fehl(new Error(`Videofehler ${v.error?.code}`)); }, { once: true });
  });
  try {
    await warte('loadeddata', 10000);
    const tLade = jetzt();
    v.currentTime = nachricht.zeit ?? 0.5;
    await warte('seeked', 10000);
    const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
    const g = c.getContext('2d');
    g.drawImage(v, 0, 0);
    let lesbar = true;
    let fehler = null;
    try { g.getImageData(0, 0, 1, 1); } catch (e) { lesbar = false; fehler = e.name; }
    v.removeAttribute('src');
    v.load();
    return { ok: true, breite: v.videoWidth, hoehe: v.videoHeight, lesbar, fehler, ms: { laden: runde(tLade - t0), gesamt: runde(jetzt() - t0) } };
  } catch (e) {
    return { ok: false, fehler: e.message, ms: { gesamt: runde(jetzt() - t0) } };
  }
}

async function bearbeite(nachricht) {
  switch (nachricht.typ) {
    case 'wecke': return { ok: true, instanz: INSTANZ, kontext: konfig?.kontext ?? 'erkenner' };
    case 'status': {
      await ladeKonfig();
      let gpu = null;
      if (navigator.gpu) {
        try { const a = await navigator.gpu.requestAdapter(); gpu = a ? (a.info?.architecture ?? 'ja') : 'kein Adapter'; } catch (e) { gpu = `Fehler ${e.message}`; }
      }
      return { ok: true, instanz: INSTANZ, gestartet: GESTARTET, alterMs: Date.now() - GESTARTET, geladen: !!session, sessionInfo, konfig, navigatorGpu: !!navigator.gpu, gpu, crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : null, userAgent: navigator.userAgent, protokoll: protokoll.slice(-20) };
    }
    case 'lade': {
      session = null;
      const info = await ladeModell(nachricht.modell, nachricht.backend);
      return { ok: true, instanz: INSTANZ, info };
    }
    case 'pruefeUrl': return pruefeUrl(nachricht);
    case 'pruefePixel': return pruefePixel(nachricht);
    case 'hole': return hole(nachricht);
    case 'videoBild': return videoBild(nachricht);
    case 'steuer': {
      // Steuerfunktionen (steuer.js) in diesem Kontext ausfuehren, z. B. messeS2 mit tabs-API in Firefox.
      // Ohne tabs-API (Chrome Offscreen) nicht antworten; dann uebernimmt der Service Worker.
      if (!api.tabs || typeof window === 'undefined' || !window.veil || !window.veil[nachricht.fn]) return null;
      return window.veil[nachricht.fn](nachricht.params);
    }
    default: return undefined;
  }
}

// Steuerfunktionen im selben Kontext (Firefox-Hintergrundseite) rufen den Erkenner direkt, nicht per Nachricht.
self.veilBearbeite = bearbeite;
// Firefox hat keinen Service Worker: die Hintergrundseite beantwortet auch die "sw"-Nachrichten.
const IST_FIREFOX = navigator.userAgent.includes('Firefox');
let refererListener = null;
api.runtime.onMessage.addListener((nachricht, absender, antworte) => {
  if (!nachricht || !nachricht.typ) return undefined;
  if (nachricht.ziel === 'sw') {
    if (!IST_FIREFOX) return undefined;
    bearbeiteSw(nachricht).then(antworte);
    return true;
  }
  // Steuerfunktionen mit tabs-API: ohne tabs (Chrome Offscreen) nicht antworten, das macht der Service Worker.
  if (nachricht.typ === 'steuer' && !api.tabs) return undefined;
  if (!['wecke', 'status', 'lade', 'pruefeUrl', 'pruefePixel', 'hole', 'videoBild', 'steuer'].includes(nachricht.typ)) return undefined;
  bearbeite(nachricht).then((r) => antworte(r ?? { ok: false, fehler: 'keine Antwort' }), (e) => antworte({ ok: false, fehler: `${e && e.message ? e.message : e}`, instanz: INSTANZ }));
  return true;
});
// Firefox: "sw"-Nachrichten (Chrome: Service Worker) hier beantworten; auch direkt aus steuer.js aufrufbar.
async function bearbeiteSw(nachricht) {
  {
    if (nachricht.typ === 'setzeReferer') {
      // Firefox: Referer der eigenen Abrufe per webRequest (blocking) setzen.
      if (refererListener) { api.webRequest.onBeforeSendHeaders.removeListener(refererListener); refererListener = null; }
      if (nachricht.referer) {
        refererListener = (d) => {
          if (d.tabId !== -1) return {};
          const h = d.requestHeaders.filter((x) => x.name.toLowerCase() !== 'referer');
          h.push({ name: 'Referer', value: nachricht.referer });
          return { requestHeaders: h };
        };
        api.webRequest.onBeforeSendHeaders.addListener(refererListener, { urls: ['<all_urls>'] }, ['blocking', 'requestHeaders']);
      }
      return { ok: true, regeln: refererListener ? 1 : 0 };
    }
    return { ok: true, swInstanz: INSTANZ, offscreen: 'hintergrundseite', offscreenOffen: true, geschlossen: false };
  }
}
if (IST_FIREFOX) self.veilBearbeiteSw = bearbeiteSw;

ladeKonfig().then(async (k) => {
  log(`Erkenner gestartet, Kontext ${k.kontext ?? '?'}, Instanz ${INSTANZ}`);
  // Firefox: WebDriver darf moz-extension-Adressen nicht ansteuern, also oeffnet die Erweiterung die Steuerseite selbst.
  if (k.steuerTab && IST_FIREFOX) {
    try {
      const url = api.runtime.getURL('steuer.html');
      const offen = await api.tabs.query({ url });
      if (offen.length === 0) await api.tabs.create({ url });
    } catch (e) { log(`Steuerseite: ${e.message}`); }
  }
  if (k.vorladen) stelleSessionSicher().catch((e) => log(`Vorladen fehlgeschlagen: ${e.message}`));
});
