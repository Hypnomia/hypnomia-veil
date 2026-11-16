// Einheitstest (Phase 11 E1, H1, N7): nur der Bild-Weg sendet den Schalter `verschmelzen`; der Video-Weg und alle anderen Aufrufer senden ihn nicht.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// pruefung.ts laesst sich in Node nicht laden (Importe ohne Endung), darum wird der Quelltext der Nachricht gelesen.
test('sendePruefe: der Schalter steht standardmaessig aus und kommt nur bei true in die Nachricht', () => {
  const text = readFileSync(fileURLToPath(new URL('../../src/schleier/pruefung.ts', import.meta.url)), 'utf8');
  assert.match(text, /verschmelzen = false,\n\): Promise<AntwortPruefe>/, 'Standard false');
  assert.ok(text.includes("...(verschmelzen ? { verschmelzen: true as const } : {}),"), 'Feld nur bei true');
});

test('Aufrufer im Schleier: nur der Bild-Weg (frageNach) uebergibt den Schalter, pruefeVideoBild und pruefeCanvas nicht; der Schalter steht im Schluessel des Zwischenspeichers', () => {
  const text = readFileSync(fileURLToPath(new URL('../../src/schleier/schleier.ts', import.meta.url)), 'utf8');
  const aufrufe = text.split('\n').filter((z) => z.includes('sendePruefe('));
  const mit = aufrufe.filter((z) => z.includes('BILD_VERSCHMILZT'));
  assert.equal(mit.length, 1, 'genau ein Aufrufer mit Schalter');
  assert.ok(mit[0].includes('q.quelle'), 'es ist der Bild-Weg');
  const video = aufrufe.find((z) => z.includes('zonen.hat(el)'));
  assert.ok(video && !video.includes('BILD_VERSCHMILZT') && !/,\s*true\s*\)/.test(video.split('zonen.hat(el)')[1] ?? ''), 'Video-Weg ohne Schalter');
  assert.ok(text.includes("`${epoche}|${verschmilzt ? 'v' : 'e'}|${adresse}`"), 'Schluessel des Zwischenspeichers enthaelt den Schalter');
});
