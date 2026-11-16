// Vorher-Nachher-Bilder Phase 11 E1 (kein Produktcode): rendert jugendfreie Testbilder mit der Erweiterung "vor" (Kopie ohne Verschmelzen) und
// "nach" (aktueller Bau) und setzt je Bild ein Nebeneinander (links vorher, rechts nachher) in den Ausgabeordner. Nur verdeckte Zustaende.
//   node scripts/messung/phase11-e1-bilder.mjs --vor <ordner chrome-mv3> --nach <ordner chrome-mv3> --bilder <ordner sfw> --aus <ordner>
import { chromium } from '@playwright/test';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const arg = (n) => process.argv[process.argv.indexOf(`--${n}`) + 1];
const VOR = arg('vor'), NACH = arg('nach'), BILDER = arg('bilder'), AUS = arg('aus');
const NAMEN = ['sfw-009-portraet', 'sfw-015-figur', 'sfw-022-figur', 'sfw-027-strand', 'sfw-028-strand', 'sfw-016-figur'];
const PRESETS = ['mia-wort', 'mosaik'];
const BED = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const zonen = {};
for (const z of ['eyes', 'mouth', 'face', 'head', ...BED]) zonen[z] = BED.includes(z) ? { an: true, bedeckt: true } : { an: true };

async function rendere(erweiterung, preset, dateien, verschmelzen) {
  const profil = await mkdtemp(path.join(tmpdir(), 'veil-e1-'));
  const ctx = await chromium.launchPersistentContext(profil, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`] });
  try {
    const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
    const id = new URL(worker.url()).host;
    const senden = (n) => worker.evaluate((m) => globalThis.chrome.runtime.sendMessage(m), n);
    const s = await ctx.newPage();
    await s.goto(`chrome-extension://${id}/options.html`);
    for (let i = 0; i < 150; i++) {
      try { await s.evaluate(() => globalThis.chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'wecke' })); if ((await senden({ ziel: 'erkenner', typ: 'wecke' }))?.ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    const aus = {};
    for (const [name, puffer] of dateien) {
      const klein = await sharp(puffer).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
      const a = await senden({ ziel: 'erkenner', typ: 'pruefe', id: `e1-${Math.random().toString(36).slice(2, 8)}`, quelle: { art: 'daten', dataUrl: `data:image/jpeg;base64,${klein.toString('base64')}` }, breite: 0, hoehe: 0,
        einstellungen: { schwelle: 0.1, zonen, rand: 0.15, preset }, rendern: true, ...(verschmelzen ? { verschmelzen: true } : {}) });
      if (!a.ok) throw new Error(`${name}: ${a.fehler}`);
      aus[name] = { flaechen: a.flaechen, png: Buffer.from(String(a.bild).slice(String(a.bild).indexOf(',') + 1), 'base64') };
    }
    return aus;
  } finally {
    await ctx.close();
    await rm(profil, { recursive: true, force: true });
  }
}

await mkdir(AUS, { recursive: true });
const dateien = [];
for (const n of NAMEN) dateien.push([n, await readFile(path.join(BILDER, `${n}.jpg`))]);
const protokoll = {};
for (const preset of PRESETS) {
  const vor = await rendere(VOR, preset, dateien, false);
  const nach = await rendere(NACH, preset, dateien, true);
  for (const n of NAMEN) {
    const a = await sharp(vor[n].png).metadata();
    const hoehe = 900;
    const l = await sharp(vor[n].png).resize({ height: hoehe }).jpeg({ quality: 88 }).toBuffer();
    const r = await sharp(nach[n].png).resize({ height: hoehe }).jpeg({ quality: 88 }).toBuffer();
    const lb = (await sharp(l).metadata()).width, rb = (await sharp(r).metadata()).width;
    const datei = path.join(AUS, `${n}-${preset}-vorher-nachher.jpg`);
    await sharp({ create: { width: lb + rb + 24, height: hoehe, channels: 3, background: '#ffffff' } }).composite([{ input: l, left: 0, top: 0 }, { input: r, left: lb + 24, top: 0 }]).jpeg({ quality: 88 }).toFile(datei);
    protokoll[`${n}|${preset}`] = { vorFlaechen: vor[n].flaechen.length, nachFlaechen: nach[n].flaechen.length, nachBoxen: nach[n].flaechen.map((f) => [f.zone, f.behandlung, f.box, f.wortBox ?? null]) };
  }
}
await writeFile(path.join(AUS, 'protokoll.json'), JSON.stringify(protokoll, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(protokoll).map(([k, v]) => [k, `${v.vorFlaechen} -> ${v.nachFlaechen}`]))));
