// Wegwerf-Messcode Spike S1: Tempo und Treffer des Modells im Browser mit echten Testbildern.
// Kein Produktcode. Parameter kommen aus der URL (die Laufskripte setzen sie):
//   modell=640m|320n, kanal=rgb|bgr, backend=wasm|webgpu, threads=N, schwelle=0.2, max=N (nur die ersten N Bilder),
//   pad=ru|mitte (rechts/unten schwarz wie NudeNet, oder zentriert grau 114 wie Ultralytics), saetze=nsfw,sfw
const titel = (t) => { document.title = t; };
const jetzt = () => performance.now();

const ZONEN = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
// Klassenreihenfolge des Modells (18 Klassen), identisch fuer 640m und 320n.
const KLASSEN = [
  'FEMALE_GENITALIA_COVERED', 'FACE_FEMALE', 'BUTTOCKS_EXPOSED', 'FEMALE_BREAST_EXPOSED',
  'FEMALE_GENITALIA_EXPOSED', 'MALE_BREAST_EXPOSED', 'ANUS_EXPOSED', 'FEET_EXPOSED',
  'BELLY_COVERED', 'FEET_COVERED', 'ARMPITS_COVERED', 'ARMPITS_EXPOSED', 'FACE_MALE',
  'BELLY_EXPOSED', 'MALE_GENITALIA_EXPOSED', 'ANUS_COVERED', 'FEMALE_BREAST_COVERED',
  'BUTTOCKS_COVERED',
];
// Klasse -> [Zone, bedeckt] wie im alten Tool (zones.py) und im S0-Vorschlag.
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
// Aus einem Gesicht abgeleitete Zonen (im Produkt spaeter aus YuNet).
const GESICHTS_ZONEN = ['face', 'head', 'eyes', 'mouth'];
// Im SFW-Satz gilt: diese Zonen duerfen nie als sichtbar gemeldet werden.
const SFW_VERBOTEN = ['breast', 'genitals', 'buttocks', 'belly', 'armpits'];
const NMS_IOU = 0.45;

function simdVorhanden() {
  try {
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]));
  } catch { return false; }
}
function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function perzentil(a, p) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
}
const runde = (x) => Math.round(x * 100) / 100;

// ---------- Vorverarbeitung ----------
// Bild dekodieren (EXIF beachten), auf S x S bringen: Variante "ru" fuellt rechts/unten schwarz auf
// (wie NudeNet-Python), Variante "mitte" zentriert mit Grau 114 (wie Ultralytics-Training).
function baueTensor(ort, bitmap, S, kanal, pad, canvas, ctx) {
  const w = bitmap.width;
  const h = bitmap.height;
  const skala = S / Math.max(w, h);
  const zw = Math.max(1, Math.round(w * skala));
  const zh = Math.max(1, Math.round(h * skala));
  ctx.fillStyle = pad === 'mitte' ? 'rgb(114,114,114)' : 'rgb(0,0,0)';
  ctx.fillRect(0, 0, S, S);
  const ox = pad === 'mitte' ? Math.floor((S - zw) / 2) : 0;
  const oy = pad === 'mitte' ? Math.floor((S - zh) / 2) : 0;
  ctx.drawImage(bitmap, ox, oy, zw, zh);
  const px = ctx.getImageData(0, 0, S, S).data;
  const flaeche = S * S;
  const daten = new Float32Array(3 * flaeche);
  // RGB: Kanal 0 = Rot. BGR: Kanal 0 = Blau (so speist die Python-Bibliothek wegen Issue 203 ein).
  const k0 = kanal === 'bgr' ? 2 : 0;
  const k2 = kanal === 'bgr' ? 0 : 2;
  for (let p = 0; p < flaeche; p++) {
    daten[p] = px[p * 4 + k0] / 255;
    daten[flaeche + p] = px[p * 4 + 1] / 255;
    daten[2 * flaeche + p] = px[p * 4 + k2] / 255;
  }
  return { tensor: new ort.Tensor('float32', daten, [1, 3, S, S]), skala, ox, oy, w, h };
}

// ---------- Nachverarbeitung ----------
function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  if (x2 <= x1 || y2 <= y1) return 0;
  const schnitt = (x2 - x1) * (y2 - y1);
  return schnitt / (a[2] * a[3] + b[2] * b[3] - schnitt);
}
function nms(kandidaten) {
  const sortiert = [...kandidaten].sort((p, q) => q.score - p.score);
  const behalten = [];
  for (const k of sortiert) if (behalten.every((b) => iou(k.box, b.box) <= NMS_IOU)) behalten.push(k);
  return behalten;
}
// Ausgabe [1, 4+18, N] -> Treffer mit Box in Originalpixeln.
function nachverarbeite(ausgabe, geo, schwelle) {
  const [, kanaele, n] = ausgabe.dims;
  const d = ausgabe.data;
  const kAnz = kanaele - 4;
  const kandidaten = [];
  for (let i = 0; i < n; i++) {
    let beste = -1;
    let best = -Infinity;
    for (let c = 0; c < kAnz; c++) {
      const s = d[(4 + c) * n + i];
      if (s > best) { best = s; beste = c; }
    }
    if (best < schwelle) continue;
    const cw = d[2 * n + i];
    const ch = d[3 * n + i];
    const x = Math.max(0, (d[i] - cw / 2 - geo.ox) / geo.skala);
    const y = Math.max(0, (d[n + i] - ch / 2 - geo.oy) / geo.skala);
    const w = Math.min(cw / geo.skala, geo.w - x);
    const h = Math.min(ch / geo.skala, geo.h - y);
    kandidaten.push({ klasse: KLASSEN[beste] ?? `K${beste}`, score: best, box: [x, y, w, h] });
  }
  return nms(kandidaten).map((k) => ({ klasse: k.klasse, score: runde(k.score), box: k.box.map((v) => Math.trunc(v)) }));
}
// Treffer -> Zonen (sichtbar / bedeckt), sichtbar gewinnt.
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

// ---------- Vergleich mit Soll ----------
function neueZaehlung() {
  const z = {};
  for (const zone of ZONEN) {
    z[zone] = {
      soll_sichtbar: 0, treffer_sichtbar: 0, treffer_irgendwie: 0,
      soll_bedeckt: 0, treffer_bedeckt_irgendwie: 0,
      fehlalarm_nsfw: 0, fehlalarm_sfw: 0, bedeckt_gemeldet_sfw: 0,
    };
  }
  return z;
}
function zaehle(zaehlung, satz, soll, ist) {
  if (satz === 'sfw') {
    // Regel fuer den unmarkierten SFW-Satz: Koerperzonen duerfen nicht sichtbar gemeldet werden.
    for (const z of ist.sichtbar) if (SFW_VERBOTEN.includes(z)) zaehlung[z].fehlalarm_sfw++;
    for (const z of ist.bedeckt) if (SFW_VERBOTEN.includes(z)) zaehlung[z].bedeckt_gemeldet_sfw++;
    return;
  }
  if (!soll) return;
  const sollS = new Set(soll.sichtbar ?? []);
  const sollB = new Set(soll.bedeckt ?? []);
  const istS = new Set(ist.sichtbar);
  const istB = new Set(ist.bedeckt);
  for (const z of ZONEN) {
    if (sollS.has(z)) {
      zaehlung[z].soll_sichtbar++;
      if (istS.has(z)) zaehlung[z].treffer_sichtbar++;
      if (istS.has(z) || istB.has(z)) zaehlung[z].treffer_irgendwie++;
    } else if (sollB.has(z)) {
      zaehlung[z].soll_bedeckt++;
      if (istS.has(z) || istB.has(z)) zaehlung[z].treffer_bedeckt_irgendwie++;
    } else if (istS.has(z)) {
      zaehlung[z].fehlalarm_nsfw++;
    }
  }
}

async function lauf() {
  const start = jetzt();
  const params = new URLSearchParams(location.search);
  const browser = params.get('browser') ?? 'unbekannt';
  const modell = params.get('modell') === '320n' ? '320n' : '640m';
  const S = modell === '320n' ? 320 : 640;
  const kanal = params.get('kanal') === 'bgr' ? 'bgr' : 'rgb';
  const pad = params.get('pad') === 'mitte' ? 'mitte' : 'ru';
  const schwelle = Number(params.get('schwelle') ?? 0.2) || 0.2;
  const max = Number(params.get('max') ?? 0) || 0;
  const saetze = (params.get('saetze') ?? 'nsfw,sfw').split(',');
  const wunschBackend = params.get('backend') === 'webgpu' ? 'webgpu' : 'wasm';
  const threads = Math.max(1, Number(params.get('threads') ?? 1) || 1);
  const backendName = wunschBackend === 'webgpu' ? 'webgpu' : (threads > 1 ? `wasm-threads${threads}` : 'wasm');
  const simd = simdVorhanden();
  const gpuVorhanden = typeof navigator !== 'undefined' && !!navigator.gpu;
  let gpuAdapter = null;
  if (gpuVorhanden) {
    try {
      const a = await navigator.gpu.requestAdapter();
      if (a) {
        const info = a.info ?? (a.requestAdapterInfo ? await a.requestAdapterInfo() : {});
        gpuAdapter = { vendor: info.vendor ?? '', architecture: info.architecture ?? '', description: info.description ?? '' };
      } else gpuAdapter = 'kein Adapter';
    } catch (e) { gpuAdapter = `Fehler: ${e}`; }
  }

  ort.env.wasm.numThreads = threads;
  ort.env.wasm.wasmPaths = `${location.origin}/ort/`;

  titel('S1: lade Bilderliste und Soll');
  const liste = (await (await fetch('/api/bilder')).json()).filter((b) => saetze.includes(b.satz));
  const bilder = max > 0 ? liste.slice(0, max) : liste;
  const soll = (await (await fetch('/soll-zonen.json')).json()).bilder ?? {};

  titel('S1: lade Modell');
  const t0 = jetzt();
  const antwort = await fetch(`/modell/${modell}.onnx`);
  const modellBytes = new Uint8Array(await antwort.arrayBuffer());
  const modellLadenMs = jetzt() - t0;

  titel('S1: erstelle Session');
  const tKalt = jetzt();
  const fehlerLog = [];
  let genutztesBackend = wunschBackend;
  let session;
  try {
    session = await ort.InferenceSession.create(modellBytes, { executionProviders: [wunschBackend], graphOptimizationLevel: 'all' });
  } catch (e) {
    fehlerLog.push(`${wunschBackend}: ${e && e.message ? e.message : e}`);
    if (wunschBackend === 'wasm') throw e;
    genutztesBackend = 'wasm-rueckfall';
    session = await ort.InferenceSession.create(modellBytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  }
  const sessionMs = jetzt() - tKalt;
  const eingabeName = session.inputNames[0];
  const ausgabeName = session.outputNames[0];
  const canvas = new OffscreenCanvas(S, S);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Kaltstart: Session-Erstellung bis erste Inferenz (Nullbild) fertig.
  const erste = await session.run({ [eingabeName]: new ort.Tensor('float32', new Float32Array(3 * S * S), [1, 3, S, S]) });
  const kaltstartMs = jetzt() - tKalt;
  const ausgabeForm = session.outputNames.map((n) => ({ name: n, dims: erste[n].dims }));

  const vorMs = [];
  const dekodMs = [];
  const infMs = [];
  const nachMs = [];
  const zaehlung = neueZaehlung();
  const jeBild = {};
  const fehlerBilder = [];
  let i = 0;
  for (const b of bilder) {
    i++;
    titel(`S1: Bild ${i}/${bilder.length}`);
    try {
      const td = jetzt();
      const blob = await (await fetch(`/bild/${b.satz}/${encodeURIComponent(b.name)}`)).blob();
      const tdek = jetzt();
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const tv = jetzt();
      const geo = baueTensor(ort, bitmap, S, kanal, pad, canvas, ctx);
      bitmap.close?.();
      const ti = jetzt();
      const aus = await session.run({ [eingabeName]: geo.tensor });
      const tn = jetzt();
      const treffer = nachverarbeite(aus[ausgabeName], geo, schwelle);
      const ist = zonenAus(treffer);
      const te = jetzt();
      dekodMs.push(tv - tdek);
      vorMs.push(ti - tv);
      infMs.push(tn - ti);
      nachMs.push(te - tn);
      const schluessel = `${b.satz}/${b.name}`;
      zaehle(zaehlung, b.satz, soll[schluessel], ist);
      jeBild[schluessel] = { breite: geo.w, hoehe: geo.h, treffer, ist, ms: { netz: runde(tdek - td), dekod: runde(tv - tdek), vor: runde(ti - tv), inf: runde(tn - ti), nach: runde(te - tn) } };
    } catch (e) {
      fehlerBilder.push(`${b.satz}/${b.name}: ${e && e.message ? e.message : e}`);
    }
  }

  // Kennzahlen je Zone in Prozent.
  const zonen = {};
  let sollGesamt = 0; let trefferGesamt = 0; let trefferIrgendwieGesamt = 0; let fehlNsfw = 0; let fehlSfw = 0;
  const anzahlSfw = bilder.filter((b) => b.satz === 'sfw').length;
  for (const z of ZONEN) {
    const c = zaehlung[z];
    zonen[z] = {
      ...c,
      verpasst_prozent: c.soll_sichtbar ? runde(100 * (1 - c.treffer_sichtbar / c.soll_sichtbar)) : null,
      verpasst_irgendwie_prozent: c.soll_sichtbar ? runde(100 * (1 - c.treffer_irgendwie / c.soll_sichtbar)) : null,
      fehlalarm_sfw_prozent: anzahlSfw ? runde(100 * c.fehlalarm_sfw / anzahlSfw) : null,
    };
    if (SFW_VERBOTEN.includes(z)) { sollGesamt += c.soll_sichtbar; trefferGesamt += c.treffer_sichtbar; trefferIrgendwieGesamt += c.treffer_irgendwie; fehlNsfw += c.fehlalarm_nsfw; fehlSfw += c.fehlalarm_sfw; }
  }
  const sfwBilderMitFehlalarm = Object.entries(jeBild).filter(([k, v]) => k.startsWith('sfw/') && v.ist.sichtbar.some((z) => SFW_VERBOTEN.includes(z))).length;

  const geladeneOrt = performance.getEntriesByType('resource')
    .map((r) => r.name.replace(location.origin, ''))
    .filter((n) => /\/ort\/.*\.(wasm|mjs|js)(\?|$)/.test(n));

  const ergebnis = {
    browser, modell, kanal, pad, schwelle, nmsIou: NMS_IOU,
    backend: backendName, angefordertesBackend: wunschBackend, genutztesBackend,
    navigatorGpu: gpuVorhanden ? 'ja' : 'nein', gpuAdapter, fehlerLog, geladeneOrt,
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : null,
    userAgent: navigator.userAgent, ortVersion: ort.env.versions?.common ?? null,
    simd: simd ? 'ja' : 'nein', numThreads: ort.env.wasm.numThreads,
    modellLadenMs: runde(modellLadenMs), sessionMs: runde(sessionMs), kaltstartMs: runde(kaltstartMs),
    anzahl: infMs.length, anzahlNsfw: bilder.length - anzahlSfw, anzahlSfw,
    dekodMedianMs: runde(median(dekodMs)), vorMedianMs: runde(median(vorMs)),
    infMedianMs: runde(median(infMs)), infP90Ms: runde(perzentil(infMs, 0.9)), infP95Ms: runde(perzentil(infMs, 0.95)),
    infMinMs: runde(Math.min(...infMs)), infMaxMs: runde(Math.max(...infMs)),
    nachMedianMs: runde(median(nachMs)),
    jeBildMedianMs: runde(median(dekodMs.map((v, k) => v + vorMs[k] + infMs[k] + nachMs[k]))),
    bilderProSekunde: runde(1000 / (median(dekodMs) + median(vorMs) + median(infMs) + median(nachMs))),
    koerperzonen: {
      soll_sichtbar: sollGesamt, treffer_sichtbar: trefferGesamt, treffer_irgendwie: trefferIrgendwieGesamt,
      verpasst_prozent: sollGesamt ? runde(100 * (1 - trefferGesamt / sollGesamt)) : null,
      verpasst_irgendwie_prozent: sollGesamt ? runde(100 * (1 - trefferIrgendwieGesamt / sollGesamt)) : null,
      fehlalarm_nsfw: fehlNsfw, fehlalarm_sfw_zonen: fehlSfw,
      sfw_bilder_mit_fehlalarm: sfwBilderMitFehlalarm,
      sfw_bilder_mit_fehlalarm_prozent: anzahlSfw ? runde(100 * sfwBilderMitFehlalarm / anzahlSfw) : null,
    },
    zonen, fehlerBilder, eingabeName, ausgabeForm, jeBild,
    gesamtMs: runde(jetzt() - start),
  };
  let gespeichert = null;
  try {
    const r = await fetch('/api/ergebnis', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ergebnis) });
    gespeichert = (await r.json()).datei;
  } catch (e) { gespeichert = `POST-Fehler: ${e}`; }
  ergebnis.datei = gespeichert;
  const kurz = { ...ergebnis };
  delete kurz.jeBild;
  document.documentElement.dataset.ergebnis = JSON.stringify(kurz);
  titel('S1: fertig');
  document.documentElement.dataset.fertig = '1';
}

lauf().catch((fehler) => {
  document.documentElement.dataset.fehler = String(fehler && fehler.stack ? fehler.stack : fehler);
  titel('S1: FEHLER');
  document.documentElement.dataset.fertig = '1';
});
