// Messseite (kein Produktcode): Kosten von YuNet (Eingabe 320 und 640) und 320n je Bild im Browser, WASM, 1 Thread.
// Vorverarbeitung wie src/erkenner/erkenner.ts (Arbeitsbild bis 1600, OffscreenCanvas, Glaettung hoch, rechts und unten schwarz).
// Parameter: zuerst=yunet|320n (welches Modell zuerst gebaut wird), max=N (nur die ersten N Bilder je Satz, 0 = alle).
import { macheEingabeFrei, yunetNachverarbeite, n320Nachverarbeite } from '/yunet-kern.mjs';

const ort = globalThis.ort;
const jetzt = () => performance.now();
const titel = (t) => { document.title = t; };
const q = new URLSearchParams(location.search);
const zuerst = q.get('zuerst') === '320n' ? '320n' : 'yunet';
const max = Number(q.get('max') ?? 0) || 0;
const MAX_SEITE = 1600;

async function holeBytes(url) {
  const t0 = jetzt();
  const a = await fetch(url);
  if (!a.ok) throw new Error(`${url}: HTTP ${a.status}`);
  const b = new Uint8Array(await a.arrayBuffer());
  return { bytes: b, ms: jetzt() - t0 };
}

const leinwaende = new Map();
// Je Konfiguration eine eigene Leinwand (wie im Produkt, wo eine Leinwand dauerhaft einem Modell dient).
function leinwand(S, art) {
  const schluessel = `${art}${S}`;
  if (!leinwaende.has(schluessel)) {
    const l = new OffscreenCanvas(S, S);
    leinwaende.set(schluessel, l.getContext('2d', { willReadFrequently: true }));
  }
  return leinwaende.get(schluessel);
}

// Feld S x S: Seitenverhaeltnis bleibt, rechts und unten schwarz. art 'n320': RGB 0..1; art 'yunet': BGR 0..255.
function baueTensor(quelle, breite, hoehe, S, art) {
  const k = leinwand(S, art);
  k.imageSmoothingEnabled = true;
  k.imageSmoothingQuality = 'high';
  const skala = S / Math.max(breite, hoehe);
  k.fillStyle = 'rgb(0,0,0)';
  k.fillRect(0, 0, S, S);
  k.drawImage(quelle, 0, 0, Math.max(1, Math.round(breite * skala)), Math.max(1, Math.round(hoehe * skala)));
  const px = k.getImageData(0, 0, S, S).data;
  const f = S * S;
  const d = new Float32Array(3 * f);
  if (art === 'n320') {
    for (let p = 0; p < f; p++) {
      d[p] = px[p * 4] / 255;
      d[f + p] = px[p * 4 + 1] / 255;
      d[2 * f + p] = px[p * 4 + 2] / 255;
    }
  } else {
    for (let p = 0; p < f; p++) {
      d[p] = px[p * 4 + 2];
      d[f + p] = px[p * 4 + 1];
      d[2 * f + p] = px[p * 4];
    }
  }
  return { tensor: new ort.Tensor('float32', d, [1, 3, S, S]), skala };
}

function arbeitsbild(bitmap) {
  const g = Math.max(bitmap.width, bitmap.height);
  if (g <= MAX_SEITE) return { quelle: bitmap, breite: bitmap.width, hoehe: bitmap.height };
  const f = MAX_SEITE / g;
  const breite = Math.max(1, Math.round(bitmap.width * f));
  const hoehe = Math.max(1, Math.round(bitmap.height * f));
  const l = new OffscreenCanvas(breite, hoehe);
  const c = l.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.drawImage(bitmap, 0, 0, breite, hoehe);
  return { quelle: l, breite, hoehe };
}

async function sessionBauen(name, bytes, patchen) {
  const t0 = jetzt();
  let modell = bytes;
  let patchMs = 0;
  if (patchen) {
    const p0 = jetzt();
    modell = macheEingabeFrei(bytes);
    patchMs = jetzt() - p0;
  }
  const s0 = jetzt();
  const session = await ort.InferenceSession.create(modell, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const sessionMs = jetzt() - s0;
  return { name, session, patchMs, sessionMs, gesamtMs: jetzt() - t0 };
}

async function warmlauf(m, S) {
  const t0 = jetzt();
  await m.session.run({ [m.session.inputNames[0]]: new ort.Tensor('float32', new Float32Array(3 * S * S), [1, 3, S, S]) });
  return jetzt() - t0;
}

async function lauf() {
  const start = jetzt();
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = `${location.origin}/ort/`;
  titel('YuNet: Modelle laden');
  const holYunet = await holeBytes('/modell/yunet.onnx');
  const hol320 = await holeBytes('/modell/320n.onnx');
  const kalt = {};
  const reihenfolge = zuerst === 'yunet' ? ['yunet', '320n'] : ['320n', 'yunet'];
  const modelle = {};
  for (const n of reihenfolge) {
    const m = await sessionBauen(n, n === 'yunet' ? holYunet.bytes : hol320.bytes, n === 'yunet');
    // Warmlauf wie im Produkt (Leerbild); YuNet mit der Eingabe 640
    m.warmMs = await warmlauf(m, n === 'yunet' ? 640 : 320);
    modelle[n] = m;
    kalt[n] = { holMs: n === 'yunet' ? holYunet.ms : hol320.ms, patchMs: m.patchMs, sessionMs: m.sessionMs, warmMs: m.warmMs, ohnePatchMs: m.gesamtMs - m.patchMs + m.warmMs, reihenfolge: reihenfolge.indexOf(n) + 1 };
  }
  // zweite Eingabegroesse von YuNet vorwaermen (ein Lauf mit 320)
  await warmlauf(modelle.yunet, 320);

  const liste = await (await fetch('/api/bilder')).json();
  const auswahl = [];
  for (const satz of ['sfw', 'nsfw']) {
    const l = liste.filter((b) => b.satz === satz);
    auswahl.push(...(max ? l.slice(0, max) : l));
  }
  const konfig = [
    { id: 'yunet320', modell: 'yunet', S: 320 },
    { id: 'yunet640', modell: 'yunet', S: 640 },
    { id: 'n320', modell: '320n', S: 320 },
  ];
  const zeiten = Object.fromEntries(konfig.map((k) => [k.id, { vor: [], inf: [], nach: [], gesamt: [] }]));
  const dekod = [];
  const erkannt = [];
  let nr = 0;
  for (const b of auswahl) {
    titel(`YuNet: Bild ${++nr}/${auswahl.length}`);
    const blob = await (await fetch(`/bild/${b.satz}/${encodeURIComponent(b.name)}`)).blob();
    const d0 = jetzt();
    const bitmap = await createImageBitmap(blob);
    const arbeit = arbeitsbild(bitmap);
    dekod.push(jetzt() - d0);
    const eintrag = { satz: b.satz, name: b.name, breite: arbeit.breite, hoehe: arbeit.hoehe };
    for (const k of konfig) {
      const m = modelle[k.modell];
      // beim ersten Bild jeder Konfiguration ein unzaehlter Probelauf
      if (nr === 1) {
        const w = baueTensor(arbeit.quelle, arbeit.breite, arbeit.hoehe, k.S, k.modell === 'yunet' ? 'yunet' : 'n320');
        await m.session.run({ [m.session.inputNames[0]]: w.tensor });
      }
      const t0 = jetzt();
      const { tensor, skala } = baueTensor(arbeit.quelle, arbeit.breite, arbeit.hoehe, k.S, k.modell === 'yunet' ? 'yunet' : 'n320');
      const t1 = jetzt();
      const aus = await m.session.run({ [m.session.inputNames[0]]: tensor });
      const t2 = jetzt();
      let ergebnis;
      if (k.modell === 'yunet') {
        const roh = {};
        for (const n of Object.keys(aus)) roh[n] = aus[n].data;
        ergebnis = yunetNachverarbeite(roh, k.S, skala, arbeit.breite, arbeit.hoehe, 0.75, 0.3);
      } else {
        const o = aus[m.session.outputNames[0]];
        ergebnis = n320Nachverarbeite(o.data, o.dims, k.S, arbeit.breite, arbeit.hoehe, 0.1);
      }
      const t3 = jetzt();
      const z = zeiten[k.id];
      z.vor.push(t1 - t0);
      z.inf.push(t2 - t1);
      z.nach.push(t3 - t2);
      z.gesamt.push(t3 - t0);
      if (k.id === 'yunet640') eintrag.yunet = ergebnis;
      if (k.id === 'yunet320') eintrag.yunet320 = ergebnis;
      if (k.id === 'n320') eintrag.n320 = ergebnis;
    }
    erkannt.push(eintrag);
    bitmap.close?.();
  }
  return {
    zuerst,
    bilder: auswahl.length,
    simd: typeof WebAssembly === 'object',
    numThreads: ort.env.wasm.numThreads,
    crossOriginIsolated: self.crossOriginIsolated,
    kalt,
    dekodMs: dekod,
    zeiten,
    erkannt,
    gesamtMs: jetzt() - start,
  };
}

lauf()
  .then((e) => {
    document.documentElement.dataset.ergebnis = JSON.stringify(e);
    titel('YuNet: fertig');
  })
  .catch((f) => {
    document.documentElement.dataset.fehler = String(f && f.stack ? f.stack : f);
    titel('YuNet: Fehler');
  })
  .finally(() => {
    document.documentElement.dataset.fertig = '1';
  });
