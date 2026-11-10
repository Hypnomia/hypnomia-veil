// Einheitstests Hilfe-Seite (Session 17, Entscheidung 179): kleiner Markdown-Leser, Linkziele, Reihenfolge, Suche und Adressen.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { anker, inline, lies, linkZiel, reinerText, titel } from '../../src/hilfe/markdown.ts';
import { REIHENFOLGE, baueAnleitungen, filtere, leseAdresse } from '../../src/hilfe/anleitungen.ts';
import { HILFE_ANKER, hilfeAdresse, loeseKurzadresse } from '../../src/hilfe/anker.ts';

test('Bloecke: Ueberschriften, Absaetze, Listen, Fortsetzungszeilen', () => {
  const b = lies('# Title\n\nFirst line\nsecond line.\n\n## Steps\n1. One\n2. Two\n   still two\n- a\n- b\n\n### Small');
  assert.deepEqual(b.map((x) => x.art), ['ueberschrift', 'absatz', 'ueberschrift', 'liste', 'liste', 'ueberschrift']);
  assert.equal(reinerText(b[1].inhalt), 'First line second line.');
  assert.equal(b[3].nummeriert, true);
  assert.equal(reinerText(b[3].punkte[1]), 'Two still two');
  assert.equal(b[4].nummeriert, false);
  assert.equal(b[2].anker, 'steps');
  assert.equal(titel(b, 'x'), 'Title');
  assert.equal(titel(lies('nur Text'), 'ersatz'), 'ersatz');
  // HTML-Kommentar auf einer Zeile (Vermerk zum lokalen Bild, Session 19): weder Absatz noch Suchtext
  const k = lies('# Title\n<!-- Nur lokal: Bild x.webp -->\nText\n\n<!-- noch einer -->\n- a');
  assert.deepEqual(k.map((x) => x.art), ['ueberschrift', 'absatz', 'liste']);
  assert.equal(reinerText(k[1].inhalt), 'Text');
});

test('Inline: fett, kursiv, code, Links; unpaarige Zeichen bleiben Text', () => {
  const t = inline('Press **Pause Mia** in *the* popup, type `about:addons`, see [updates](updates.md#chrome).');
  assert.deepEqual(t.map((x) => x.art), ['text', 'fett', 'text', 'kursiv', 'text', 'code', 'text', 'link', 'text']);
  assert.deepEqual(t[7].ziel, { art: 'anleitung', name: 'updates', anker: 'chrome' });
  assert.equal(reinerText(inline('2 * 3 = 6 and **open')), '2 * 3 = 6 and **open');
  // HTML bleibt Text.
  assert.deepEqual(inline('<img src=x onerror=alert(1)>'), [{ art: 'text', text: '<img src=x onerror=alert(1)>' }]);
});

test('Linkziele: nur https nach aussen, innen nur Dateinamen', () => {
  assert.equal(linkZiel('https://discord.gg/2C8YAwDkat').art, 'aussen');
  assert.equal(linkZiel('http://example.com').art, 'keins');
  assert.equal(linkZiel('javascript:alert(1)').art, 'keins');
  assert.equal(linkZiel('data:text/html,hi').art, 'keins');
  assert.equal(linkZiel('https://nutzer:pw@example.com').art, 'keins');
  assert.deepEqual(linkZiel('./faq.md'), { art: 'anleitung', name: 'faq', anker: '' });
  assert.deepEqual(linkZiel('#pause-from-the-popup'), { art: 'anleitung', name: '', anker: 'pause-from-the-popup' });
  assert.equal(linkZiel('../geheim.md').art, 'keins');
  assert.deepEqual(linkZiel('README.md'), { art: 'anleitung', name: 'readme', anker: '' });
  assert.equal(anker('Pause from the popup!'), 'pause-from-the-popup');
  assert.equal(anker('Mia’s Pack'), 'mias-pack');
});

test('Anleitungen: feste Reihenfolge, Suche ueber alle Woerter, Adressen', () => {
  const l = baueAnleitungen({
    '../../docs/faq.md': '# FAQ\nAsk on Discord.',
    '../../docs/README.md': '# Start here\nWelcome.',
    '../../docs/zzz-extra.md': '# Extra\nMore.',
    '../../docs/pause.md': '# Pause\nPause Mia stops everything.',
    '../../docs/nicht ok.md': '# Kaputt',
  });
  assert.deepEqual(l.map((a) => a.name), ['readme', 'pause', 'faq', 'zzz-extra']);
  assert.deepEqual(filtere(l, 'pause STOPS').map((a) => a.name), ['pause']);
  assert.equal(filtere(l, '').length, 4);
  assert.deepEqual(leseAdresse('#faq', l), { name: 'faq', anker: '' });
  assert.deepEqual(leseAdresse('#pause/oben', l), { name: 'pause', anker: 'oben' });
  assert.deepEqual(leseAdresse('#unbekannt/x', l), { name: 'readme', anker: '' });
  assert.deepEqual(leseAdresse('#%E0', l), { name: 'readme', anker: '' }); // kaputtes Prozentzeichen wirft nicht
  assert.deepEqual(leseAdresse('', l), { name: 'readme', anker: '' });
  // Kurzadressen (Vertrag Paket F)
  assert.equal(loeseKurzadresse('#pin'), 'how-i-work/pin-me');
  assert.equal(loeseKurzadresse('faq'), 'faq');
  assert.equal(hilfeAdresse('quiz'), 'hilfe.html#quiz');
  assert.deepEqual(leseAdresse('#pause', l), { name: 'pause', anker: '' });
});

// Die echten Anleitungen: jede Datei aus REIHENFOLGE ist da, hat einen Titel, interne Links zeigen auf vorhandene Dateien und Anker,
// aeussere Links sind https, keine Gedankenstriche, kein gerader Apostroph in englischen Woertern.
test('docs/: vollstaendig, Links gueltig, Typografie', { skip: !existsSync(new URL('../../docs/', import.meta.url)) }, () => {
  const ordner = new URL('../../docs/', import.meta.url);
  const quellen = Object.fromEntries(readdirSync(ordner).filter((d) => d.endsWith('.md')).map((d) => [d, readFileSync(new URL(d, ordner), 'utf8')]));
  const l = baueAnleitungen(quellen);
  const namen = new Set(l.map((a) => a.name));
  for (const n of REIHENFOLGE) assert.ok(namen.has(n), `docs/${n === 'readme' ? 'README' : n}.md fehlt`);
  const anker = new Map(l.map((a) => [a.name, new Set(a.bloecke.filter((b) => b.art === 'ueberschrift').map((b) => b.anker))]));
  const pruefeLinks = (teile, wo) => {
    for (const t of teile) {
      if (t.art === 'link') {
        assert.notEqual(t.ziel.art, 'keins', `${wo}: ungueltiger Link "${reinerText(t.kinder)}"`);
        if (t.ziel.art === 'anleitung') {
          const ziel = t.ziel.name || wo;
          assert.ok(namen.has(ziel), `${wo}: Link auf fehlende Anleitung ${ziel}`);
          if (t.ziel.anker) assert.ok(anker.get(ziel).has(t.ziel.anker), `${wo}: Anker #${t.ziel.anker} fehlt in ${ziel}`);
        }
      }
      if (t.kinder) pruefeLinks(t.kinder, wo);
    }
  };
  for (const a of l) {
    assert.notEqual(a.titel, a.name, `${a.name}: erste Zeile braucht "# Titel"`);
    for (const b of a.bloecke) for (const teile of b.art === 'liste' ? b.punkte : [b.inhalt]) pruefeLinks(teile, a.name);
  }
  // Jede Kurzadresse fuehrt auf eine vorhandene Anleitung und Ueberschrift.
  for (const [kurz, ziel] of Object.entries(HILFE_ANKER)) {
    const [name, a = ''] = ziel.split('/');
    assert.ok(namen.has(name), `Hilfe-Anker ${kurz}: Anleitung ${name} fehlt`);
    if (a) assert.ok(anker.get(name).has(a), `Hilfe-Anker ${kurz}: Abschnitt #${a} fehlt in ${name}`);
  }
  for (const [datei, text] of Object.entries(quellen)) {
    assert.ok(!/[–—]/.test(text), `${datei}: Gedankenstrich`);
    assert.ok(!/[A-Za-z]'[A-Za-z]/.test(text.replace(/`[^`]*`/g, '')), `${datei}: gerader Apostroph`);
    assert.ok(!/OFFEN:/.test(text), `${datei}: offener Punkt [OFFEN: ...]`);
  }
});
