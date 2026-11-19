// Einheit: Reiter der Einstellungsseite (Phase 11 E4d1, D1 bis D3). Reine Daten aus reiter-daten.ts und die Zuordnung der Abschnitte in index.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REITER, STANDARD_REITER, ankerFuerReiter } from '../../entrypoints/options/reiter-daten.ts';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(path.join(wurzel, 'entrypoints/options/index.html'), 'utf8');

// Ohne Kommentare, damit Beispiele in Kommentaren nichts zaehlen.
const ohneKommentare = html.replace(/<!--[\s\S]*?-->/g, '');

// Die ids je Panel in index.html (Panel = div mit data-reiter bis zum naechsten Panel oder zum Ende des Rasters).
function idsJePanel() {
  const teile = ohneKommentare.split(/<div id="panel-/).slice(1);
  const aus = {};
  for (const t of teile) {
    const reiter = /data-reiter="([a-z]+)"/.exec(t)[1];
    aus[reiter] = [...t.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  }
  return aus;
}

test('D1: sieben Reiter in der Reihenfolge des Entwurfs, Namen an einer Stelle', () => {
  assert.deepEqual(
    REITER.map((r) => r.name),
    ['Style', 'What I cover', 'Adult sites', 'Mia’s extras', 'Pack and sound', 'Ledger', 'About'],
  );
  assert.equal(new Set(REITER.map((r) => r.id)).size, 7);
  assert.equal(new Set(REITER.map((r) => r.anker)).size, 7);
  assert.equal(STANDARD_REITER, 'stil');
});

test('D3: die Vertragsanker liegen in index.html im Panel ihres Reiters (die Seite loest sie ueber das Panel des Elements auf)', () => {
  const je = idsJePanel();
  const soll = {
    covering: 'zonen',
    'abschnitt-stil': 'stil',
    'abschnitt-zonen': 'zonen',
    'abschnitt-stimmung': 'zonen',
    'abschnitt-ausnahmen': 'zonen',
    stand: 'pack',
    erwachsen: 'erwachsen',
    kontrolle: 'extras',
    ton: 'pack',
    ledger: 'ledger',
    ueber: 'ueber',
    'abschnitt-interview': 'ueber',
  };
  for (const [anker, reiter] of Object.entries(soll)) assert.ok(je[reiter].includes(anker), `#${anker} im Panel ${reiter}`);
  // #neu baut pack-karte.ts in #stand (Reiter Pack and sound), steht darum nicht in index.html.
  for (const r of REITER) assert.equal(ankerFuerReiter(r.id), r.anker);
});

test('D2: jeder Teil steht in index.html im Panel seines Reiters, jede id genau einmal', () => {
  const je = idsJePanel();
  assert.deepEqual(Object.keys(je), ['stil', 'zonen', 'erwachsen', 'extras', 'pack', 'ledger', 'ueber']);
  const sollTeile = {
    stil: ['abschnitt-stil', 'preset-karten', 'augenbalken', 'wort-themen', 'video-zonen'],
    // E4d2 (F1 bis F3): die Plaetze der Bausteine ersetzen den Regler `stimmung` und die Liste `zonen`
    zonen: ['covering', 'abschnitt-stimmung', 'stimmung-ort', 'abschnitt-zonen', 'zonen-ort', 'kleidung-ort', 'strict', 'abschnitt-ausnahmen'],
    // E4d2 (F3, F4): Gruppe der Erwachsenenseiten statt `erw-an`, Plaetze der Stufen statt der Regler `verweigern` und `freilegen`
    erwachsen: ['erwachsen', 'erw-stufe-ort', 'erw-ersatz', 'erw-inhalt', 'verweigern-ort', 'freilegen-ort'],
    extras: ['kontrolle', 'ruhig', 'kon-werbung', 'kon-blitz', 'kon-leerlauf', 'kon-warnung-ok'],
    pack: ['stand', 'ton'],
    ledger: ['ledger'],
    ueber: ['ueber', 'abschnitt-interview', 'interview-neu'],
  };
  for (const [reiter, ids] of Object.entries(sollTeile)) for (const id of ids) assert.ok(je[reiter].includes(id), `${id} im Reiter ${reiter}`);
  const alle = [...ohneKommentare.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const doppelt = alle.filter((id, i) => alle.indexOf(id) !== i);
  assert.deepEqual(doppelt, [], 'keine id doppelt in index.html');
  // Der Anker jedes Reiters ist ein Element im Panel dieses Reiters.
  for (const r of REITER) assert.ok(je[r.id].includes(r.anker), `Anker ${r.anker} liegt im Panel ${r.id}`);
});

test('D4: jedes Panel ist ein tabpanel, vom Reiter benannt und beim Laden verborgen', () => {
  for (const r of REITER) {
    const m = new RegExp(`<div id="panel-${r.id}"[^>]*>`).exec(ohneKommentare);
    assert.ok(m, `Panel ${r.id}`);
    assert.match(m[0], /role="tabpanel"/);
    assert.match(m[0], new RegExp(`aria-labelledby="reiter-${r.id}"`));
    assert.match(m[0], /\shidden[\s>]/);
  }
});
