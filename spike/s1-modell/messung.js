// Wegwerf-Messcode Spike S1: reine Tempo-Messung mit synthetischen Bildern.
const ANZAHL = 20;
const GROESSE = 640;
const SCHWELLE = 0.2;

const titel = (t) => { document.title = t; };
const jetzt = () => performance.now();

function simdVorhanden() {
  // Minimales Modul mit v128.const und i8x16.splat/any_true-artigem Opcode (0xfd Praefix).
  try {
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]));
  } catch { return false; }
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function perzentil(a, p) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
}
const runde = (x) => Math.round(x * 100) / 100;

// Pseudozufall, damit die Bilder je Lauf gleich sind.
function zufall(start) {
  let z = start >>> 0;
  return () => { z = (z * 1664525 + 1013904223) >>> 0; return z / 4294967296; };
}

function baueBild(i) {
  const c = new OffscreenCanvas(GROESSE, GROESSE);
  const g = c.getContext('2d', { willReadFrequently: true });
  const r = zufall(1000 + i);
  const verlauf = g.createLinearGradient(0, 0, GROESSE, GROESSE * (0.5 + r()));
  verlauf.addColorStop(0, `hsl(${Math.floor(r() * 360)} 70% 50%)`);
  verlauf.addColorStop(1, `hsl(${Math.floor(r() * 360)} 70% 30%)`);
  g.fillStyle = verlauf;
  g.fillRect(0, 0, GROESSE, GROESSE);
  for (let k = 0; k < 8; k++) {
    g.fillStyle = `hsla(${Math.floor(r() * 360)} 80% 55% / 0.8)`;
    g.fillRect(r() * 500, r() * 500, 40 + r() * 200, 40 + r() * 200);
  }
  const bild = g.getImageData(0, 0, GROESSE, GROESSE);
  const d = bild.data;
  const rauschen = 20 + (i % 5) * 15;
  for (let p = 0; p < d.length; p += 4) {
    const n = (r() - 0.5) * rauschen;
    d[p] += n; d[p + 1] += n; d[p + 2] += n;
  }
  return bild;
}

function baueTensor(ort, bild) {
  const flaeche = GROESSE * GROESSE;
  const daten = new Float32Array(3 * flaeche);
  const px = bild.data;
  for (let p = 0; p < flaeche; p++) {
    daten[p] = px[p * 4] / 255;
    daten[flaeche + p] = px[p * 4 + 1] / 255;
    daten[2 * flaeche + p] = px[p * 4 + 2] / 255;
  }
  return new ort.Tensor('float32', daten, [1, 3, GROESSE, GROESSE]);
}

// Zaehlt Werte ueber der Schwelle in den Klassenzeilen (YOLOv8: [1, 4+Klassen, Anker]).
function zaehleUeberSchwelle(ausgabe) {
  const [, zeilen, anker] = ausgabe.dims;
  if (!anker || zeilen <= 4) return 0;
  let n = 0;
  for (let z = 4; z < zeilen; z++) {
    const basis = z * anker;
    for (let a = 0; a < anker; a++) if (ausgabe.data[basis + a] > SCHWELLE) n++;
  }
  return n;
}

async function lauf() {
  const start = jetzt();
  const params = new URLSearchParams(location.search);
  const browser = params.get('browser') ?? 'unbekannt';
  const wunschBackend = params.get('backend') === 'webgpu' ? 'webgpu' : 'wasm';
  const threads = Math.max(1, Number(params.get('threads') ?? 1) || 1);
  // Name des Messlaufs: wasm, webgpu oder wasm-threadsN.
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

  titel('S1: lade Modell');
  const t0 = jetzt();
  const antwort = await fetch('/modell.onnx');
  const modell = new Uint8Array(await antwort.arrayBuffer());
  const modellLadenMs = jetzt() - t0;

  titel('S1: erstelle Session');
  const tKalt = jetzt();
  const fehlerLog = [];
  let genutztesBackend = wunschBackend;
  let session;
  try {
    session = await ort.InferenceSession.create(modell, {
      executionProviders: [wunschBackend],
      graphOptimizationLevel: 'all',
    });
  } catch (e) {
    // Rueckfall auf wasm, Fehler wird protokolliert.
    fehlerLog.push(`${wunschBackend}: ${e && e.message ? e.message : e}`);
    if (wunschBackend === 'wasm') throw e;
    genutztesBackend = 'wasm-rueckfall';
    session = await ort.InferenceSession.create(modell, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  }
  const eingabeName = session.inputNames[0];
  const bilder = [];
  for (let i = 0; i < ANZAHL; i++) bilder.push(baueBild(i));

  // Kaltstart: Session-Erstellung bis erste Inferenz fertig.
  const erste = await session.run({ [eingabeName]: baueTensor(ort, bilder[0]) });
  const kaltstartMs = jetzt() - tKalt;
  const ausgabeName = session.outputNames[0];
  const ausgabeForm = session.outputNames.map((n) => ({ name: n, dims: erste[n].dims }));

  const inferenzMs = [];
  const tensorMs = [];
  let ueberSchwelle = 0;
  for (let i = 0; i < ANZAHL; i++) {
    titel(`S1: Bild ${i + 1}/${ANZAHL}`);
    const tt = jetzt();
    const tensor = baueTensor(ort, bilder[i]);
    tensorMs.push(jetzt() - tt);
    const ti = jetzt();
    const aus = await session.run({ [eingabeName]: tensor });
    inferenzMs.push(jetzt() - ti);
    ueberSchwelle += zaehleUeberSchwelle(aus[ausgabeName]);
  }

  // Tatsaechlich per Netz geladene ORT-Dateien (.wasm und .mjs), fuer die Aussage "welche wasm-Datei".
  const geladeneOrt = performance.getEntriesByType('resource')
    .map((r) => r.name.replace(location.origin, ''))
    .filter((n) => /\/ort\/.*\.(wasm|mjs|js)(\?|$)/.test(n));

  const ergebnis = {
    browser,
    backend: backendName,
    angefordertesBackend: wunschBackend,
    genutztesBackend,
    navigatorGpu: gpuVorhanden ? 'ja' : 'nein',
    gpuAdapter,
    fehlerLog,
    geladeneOrt,
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : null,
    userAgent: navigator.userAgent,
    ortVersion: ort.env.versions?.common ?? null,
    simd: simd ? 'ja' : 'nein',
    simdOrtFlag: ort.env.wasm.simd ?? null,
    numThreads: ort.env.wasm.numThreads,
    modellLadenMs: runde(modellLadenMs),
    kaltstartMs: runde(kaltstartMs),
    anzahl: inferenzMs.length,
    medianMs: runde(median(inferenzMs)),
    p90Ms: runde(perzentil(inferenzMs, 0.9)),
    minMs: runde(Math.min(...inferenzMs)),
    maxMs: runde(Math.max(...inferenzMs)),
    tensorBauMedianMs: runde(median(tensorMs)),
    eingabeName,
    ausgabeForm,
    werteUeberSchwelle: ueberSchwelle,
    schwelle: SCHWELLE,
    gesamtMs: runde(jetzt() - start),
  };
  let gespeichert = null;
  try {
    const r = await fetch('/api/ergebnis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ergebnis),
    });
    gespeichert = (await r.json()).datei;
  } catch (e) { gespeichert = `POST-Fehler: ${e}`; }
  ergebnis.datei = gespeichert;
  document.documentElement.dataset.ergebnis = JSON.stringify(ergebnis);
  titel('S1: fertig');
  document.documentElement.dataset.fertig = '1';
}

lauf().catch((fehler) => {
  document.documentElement.dataset.fehler = String(fehler && fehler.stack ? fehler.stack : fehler);
  titel('S1: FEHLER');
  document.documentElement.dataset.fertig = '1';
});
