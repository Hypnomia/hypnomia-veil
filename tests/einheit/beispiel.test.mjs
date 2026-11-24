// Einheitstests der Beispielbilder und Daten der Live-Vorschau (Phase 11 E5 Teil A): Datendatei wohlgeformt, SHA-256 gegen die Bilder (ohne Bilder laut
// uebersprungen), Ladeliste des Baus (V5), Adresse im Bau, die eine Bedingung der Gesichtssuche (V6), Erlaubnisliste und BUILD.md des Release-Skripts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BEISPIELE, BEISPIEL_KENNUNGEN, BEISPIEL_SCHWELLE, beispielAdresse, beispielPfad, istBeispielKennung, trefferFuer } from '../../src/beispiel.ts';
import { brauchtGesichtssuche, zonenBrauchenGesicht } from '../../src/erkenner/gesichtssuche.ts';
import { vervollstaendige } from '../../src/einstellungen.ts';
import { pruefeBeispielSatz } from '../../scripts/beispiel-pruefung.mjs';
import { RASTER_ORTE_ERLAUBT, bauBefehl, baueBuildMd } from '../../scripts/release/firefox.mjs';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATEI = join(WURZEL, 'data/beispiel-treffer.json');
const daten = JSON.parse(readFileSync(DATEI, 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const ZONEN = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];

test('Datendatei: vier Bilder in fester Reihenfolge, Kopf ohne Pfade und Uhrzeit', () => {
  assert.equal(daten.version, 1);
  assert.equal(daten.schwelle, 0.1);
  assert.match(daten.gitCommit, /^[0-9a-f]{40}$/);
  for (const m of ['320n', 'yunet']) {
    assert.match(daten.modelle[m].sha256, /^[0-9a-f]{64}$/);
    // Die Modell-Hashes gehoeren zu den Modellen im Repo.
    assert.equal(daten.modelle[m].sha256, sha(readFileSync(join(WURZEL, 'public/modelle', daten.modelle[m].datei))), m);
  }
  assert.deepEqual(daten.bilder.map((b) => b.kennung), ['vorn', 'rueck', 'sitz', 'portraet']);
  const text = readFileSync(DATEI, 'utf8');
  assert.ok(!/\/Users\/|\/home\/|[A-Za-z]:\\|\d{4}-\d{2}-\d{2}T/.test(text), 'Pfad oder Uhrzeit in der Datendatei');
  assert.ok(!text.includes('—') && !text.includes('–'));
});

test('Datendatei: je Bild Treffer in den Bildgrenzen, ohne Gesichtssuche nie ein YuNet-Treffer', () => {
  for (const b of daten.bilder) {
    assert.match(b.datei, /^[a-z0-9-]+\.webp$/, b.kennung);
    assert.match(b.sha256, /^[0-9a-f]{64}$/, b.kennung);
    assert.ok(b.breite > 0 && b.hoehe > 0 && b.breite <= 1600 && b.hoehe <= 1600, b.kennung);
    for (const [satz, liste] of [['mit', b.trefferMitGesicht], ['ohne', b.trefferOhneGesicht]]) {
      assert.ok(Array.isArray(liste) && liste.length > 0, `${b.kennung} ${satz}`);
      for (const t of liste) {
        assert.ok(ZONEN.includes(t.zone), `${b.kennung} ${satz} Zone ${t.zone}`);
        assert.equal(typeof t.bedeckt, 'boolean');
        assert.ok(t.score >= daten.schwelle && t.score <= 1, `${b.kennung} ${satz} Score ${t.score}`);
        assert.equal(t.box.length, 4);
        const [x, y, w, h] = t.box;
        assert.ok(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= b.breite + 1 && y + h <= b.hoehe + 1, `${b.kennung} ${satz} Box ${t.box}`);
      }
    }
    assert.ok(!b.trefferOhneGesicht.some((t) => t.quelle === 'yunet'), `${b.kennung}: YuNet-Treffer im Satz ohne Gesichtssuche`);
  }
  assert.ok(daten.bilder.some((b) => b.trefferMitGesicht.some((t) => t.quelle === 'yunet')), 'kein YuNet-Treffer im Satz mit Gesichtssuche');
});

test('SHA-256 der Quellbilder passt zur Datendatei (ohne Bilder laut uebersprungen)', (t) => {
  const ordner = join(WURZEL, '../02 Assets Mia/beispielfrau/vorschau');
  const fehlend = daten.bilder.filter((b) => !existsSync(join(ordner, b.datei)));
  if (fehlend.length) {
    console.warn(`UEBERSPRUNGEN (laut): Beispielbilder fehlen ausserhalb des Repos: ${fehlend.map((b) => b.datei).join(', ')}`);
    t.skip('Beispielbilder fehlen');
    return;
  }
  for (const b of daten.bilder) assert.equal(sha(readFileSync(join(ordner, b.datei))), b.sha256, b.datei);
});

test('Ladeliste des Baus: leer, vollstaendig, unvollstaendig, falsche Pruefsumme', () => {
  const bilder = new Map(daten.bilder.map((b, i) => [b.datei, Buffer.from(`bild-${i}`)]));
  const echt = { bilder: daten.bilder.map((b) => ({ kennung: b.kennung, datei: b.datei, sha256: sha(bilder.get(b.datei)) })) };
  // Kein Bild da: Warnung statt Fehler (der Bau laeuft, die Vorschau zeigt die Strichzeichnung).
  assert.deepEqual(pruefeBeispielSatz(echt, () => null), { art: 'keine', bilder: [] });
  // Voller Satz: je Bild Kennung, Quelldatei und Bytes, in Reihenfolge der Daten.
  const satz = pruefeBeispielSatz(echt, (d) => bilder.get(d) ?? null);
  assert.equal(satz.art, 'satz');
  assert.deepEqual(satz.bilder.map((b) => b.kennung), ['vorn', 'rueck', 'sitz', 'portraet']);
  assert.deepEqual(satz.bilder.map((b) => b.datei), daten.bilder.map((b) => b.datei));
  // Unvollstaendig (eins fehlt): Baufehler mit dem Namen der fehlenden Datei.
  assert.throws(() => pruefeBeispielSatz(echt, (d) => (d === daten.bilder[2].datei ? null : bilders(d))), new RegExp(daten.bilder[2].datei));
  function bilders(d) { return bilder.get(d) ?? null; }
  // Abweichende Pruefsumme: Baufehler.
  assert.throws(() => pruefeBeispielSatz(echt, (d) => (d === daten.bilder[0].datei ? Buffer.from('anderes bild') : bilders(d))), /SHA-256 weicht ab/);
  // Leere oder fehlerhafte Daten.
  assert.throws(() => pruefeBeispielSatz({ bilder: [] }, () => null), /leer/);
  assert.throws(() => pruefeBeispielSatz(null, () => null), /leer/);
});

test('wxt.config.ts: Ladeliste nach beispiel/<kennung>.webp, VEIL_BEISPIEL, Pruefung der Webp-Metadaten, kein web_accessible_resources', () => {
  const text = readFileSync(join(WURZEL, 'wxt.config.ts'), 'utf8');
  assert.ok(text.includes('VEIL_BEISPIEL') && text.includes('relativeDest: `beispiel/${b.kennung}.webp`'));
  assert.ok(/\.\.\.beispielBilder\(\)/.test(text) && /pruefeWebpDateien\(kopiert/.test(text), 'Beispielbilder gehen durch die Metadaten-Pruefung');
  assert.ok(!/web_accessible_resources/.test(text.replace(/\/\/.*$/gm, '')), 'kein web_accessible_resources');
});

test('Liste und Adresse: vier Bilder aus den Daten, Adresse null ohne Datei im Bau', async () => {
  assert.deepEqual(BEISPIELE.map((b) => b.kennung), [...BEISPIEL_KENNUNGEN]);
  assert.equal(BEISPIEL_SCHWELLE, 0.1);
  for (const b of BEISPIELE) {
    const d = daten.bilder.find((x) => x.kennung === b.kennung);
    assert.deepEqual(b, { kennung: d.kennung, datei: d.datei, sha256: d.sha256, breite: d.breite, hoehe: d.hoehe });
    assert.equal(beispielPfad(b.kennung), `beispiel/${b.kennung}.webp`);
  }
  assert.ok(istBeispielKennung('portraet') && !istBeispielKennung('seite') && !istBeispielKennung(undefined));
  // Adresse: nur wenn der HEAD-Abruf ok ist; je Kennung einmal.
  const anfragen = [];
  globalThis.browser = { runtime: { getURL: (p) => `chrome-extension://abc${p}` } };
  globalThis.fetch = async (url, opt) => {
    anfragen.push([url, opt?.method]);
    if (url.endsWith('/beispiel/vorn.webp')) return { ok: true };
    if (url.endsWith('/beispiel/rueck.webp')) return { ok: false };
    throw new Error('nicht erreichbar');
  };
  try {
    assert.equal(await beispielAdresse('vorn'), 'chrome-extension://abc/beispiel/vorn.webp');
    assert.equal(await beispielAdresse('vorn'), 'chrome-extension://abc/beispiel/vorn.webp');
    assert.equal(await beispielAdresse('rueck'), null);
    assert.equal(await beispielAdresse('sitz'), null);
    assert.deepEqual(anfragen.map((a) => a[1]), ['HEAD', 'HEAD', 'HEAD']);
    assert.equal(anfragen.length, 3);
  } finally {
    delete globalThis.browser;
    delete globalThis.fetch;
  }
});

test('trefferFuer: zwei Saetze, frische Kopie, leer bei unbekannter Kennung', () => {
  for (const b of daten.bilder) {
    assert.deepEqual(trefferFuer(b.kennung, true), b.trefferMitGesicht);
    assert.deepEqual(trefferFuer(b.kennung, false), b.trefferOhneGesicht);
  }
  const a = trefferFuer('vorn', true);
  a[0].box[0] = -99;
  a[0].score = 0;
  assert.notEqual(trefferFuer('vorn', true)[0].box[0], -99);
  assert.notEqual(trefferFuer('vorn', true)[0].score, 0);
  assert.deepEqual(trefferFuer('unbekannt', true), []);
});

test('Bedingung der Gesichtssuche (V6): Gesichtszone an, nichts davon an, Balken zwingt die Augen', () => {
  const ohneGesicht = (extra = {}) => {
    const e = vervollstaendige({ zonen: Object.fromEntries(['eyes', 'mouth', 'face', 'head'].map((z) => [z, { an: false }])), ...extra });
    return e;
  };
  // 1. keine der vier Gesichtszonen, Mosaik, kein Eye bar: keine Suche
  assert.equal(brauchtGesichtssuche(ohneGesicht({ preset: 'mosaik', augenbalken: false })), false);
  // 2. eine Gesichtszone an: Suche, jede der vier einzeln
  for (const z of ['eyes', 'mouth', 'face', 'head']) {
    const e = ohneGesicht({ preset: 'mosaik' });
    e.zonen[z] = { ...e.zonen[z], an: true };
    assert.equal(brauchtGesichtssuche(e), true, z);
  }
  // 3. keine Gesichtszone, aber Balken (Preset Zensurbalken oder Schalter Eye bar): die Augen laufen mit, also Suche
  assert.equal(brauchtGesichtssuche(ohneGesicht({ preset: 'zensurbalken' })), true);
  assert.equal(brauchtGesichtssuche(ohneGesicht({ preset: 'mosaik', augenbalken: true })), true);
  // Koerperzonen allein loesen keine Suche aus.
  assert.equal(zonenBrauchenGesicht({ ...Object.fromEntries(ZONEN.map((z) => [z, { an: !['eyes', 'mouth', 'face', 'head'].includes(z) }])) }), false);
});

test('Erkenner benutzt die Bedingung und die Schrift aus den neuen Modulen, keine Kopie', () => {
  const erkenner = readFileSync(join(WURZEL, 'src/erkenner/erkenner.ts'), 'utf8');
  assert.ok(erkenner.includes("from './gesichtssuche'") && erkenner.includes('brauchtGesichtssuche(e)'));
  assert.ok(erkenner.includes("from './wort-schrift'"));
  assert.ok(!/function brauchtGesicht\b/.test(erkenner) && !erkenner.includes('new FontFace'), 'Kopie der Logik im Erkenner');
  for (const datei of ['src/erkenner/gesichtssuche.ts', 'src/erkenner/wort-schrift.ts', 'src/beispiel.ts']) {
    const t = readFileSync(join(WURZEL, datei), 'utf8');
    assert.ok(!/onnxruntime|erkenner\/erkenner|from '\.\/erkenner'|from '\.\/index'/.test(t.replace(/\/\/.*$/gm, '')), `${datei} zieht den Erkenner oder onnxruntime`);
  }
});

test('Release-Skript: Erlaubnisliste der Rasterbilder, Befehl und BUILD.md kennen extern/beispiel', () => {
  for (const ok of ['public/icons/a.png', 'extern/kern/kern-01.webp', 'extern/chibi/x.webp', 'extern/beispiel/a-portraet-10.webp']) assert.ok(RASTER_ORTE_ERLAUBT.test(ok), ok);
  for (const schlecht of ['extern/beispiele/a.webp', 'beispiel/vorn.webp', 'src/a.webp', 'extern/beispiel.webp', 'public/beispiel/a.webp', 'docs/x.png']) assert.ok(!RASTER_ORTE_ERLAUBT.test(schlecht), schlecht);
  assert.ok(bauBefehl({ kanal: 'amo', baudatum: '2026-11-06' }).includes('VEIL_BEISPIEL=extern/beispiel'));
  const md = baueBuildMd({
    version: '0.8.0', kanal: 'amo', baudatum: '2026-11-06', system: 'macOS 99', node: 'v99', npm: '99', ort: { version: '1' }, modelle: [],
    kern: [], chibi: [], beispiel: ['a-portraet-10.webp'],
  });
  for (const teil of ['extern/beispiel', 'a-portraet-10.webp', 'VEIL_BEISPIEL=extern/beispiel', 'beispiel/portraet.webp']) assert.ok(md.includes(teil), teil);
  assert.ok(!md.includes('—') && !md.includes('–'));
});
