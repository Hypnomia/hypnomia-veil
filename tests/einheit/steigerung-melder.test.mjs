// Einheitstests der reinen Teile des Steigerungs-Melders (Zaehlung neuer Urteile je Minute, Entscheidung ueber die Meldung), ohne Browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baueMinute, inhaltVon, NeueUrteileZaehler } from '../../src/schleier/steigerung-zaehler.ts';

// Attrappe: Element mit Attributen; `src` kann spaeter wechseln.
function bild(attr = {}, currentSrc = '') {
  const e = { tagName: 'IMG', currentSrc, attr: { ...attr }, getAttribute: (n) => (n in e.attr ? e.attr[n] : null) };
  return e;
}
const LAGE = { oberste: true, frei: true, pause: false, aus: false, sichtbar: true };

test('Inhalt: currentSrc vor src, poster, style, zuletzt der Tag', () => {
  assert.equal(inhaltVon(bild({ src: 'a.jpg' }, 'https://x.test/b.jpg')), 'https://x.test/b.jpg');
  assert.equal(inhaltVon(bild({ src: 'a.jpg' })), 'a.jpg');
  assert.equal(inhaltVon(bild({ poster: 'p.jpg' })), 'p.jpg');
  assert.equal(inhaltVon(bild({ style: 'background:red' })), 'background:red');
  assert.equal(inhaltVon(bild()), 'IMG');
});

test('Zaehlung: jedes neue Urteil zaehlt einmal, Neubewertung desselben Inhalts nicht', () => {
  const z = new NeueUrteileZaehler();
  const a = bild({ src: 'a.jpg' });
  const b = bild({ src: 'b.jpg' });
  z.zensiert(a);
  z.zensiert(b);
  z.zensiert(a); // Stufe, Pack oder Schwelle geaendert: neu bewertet, gleicher Inhalt
  z.zensiert(a);
  assert.equal(z.stand, 2);
  a.attr.src = 'c.jpg'; // neues Bild im selben Element: zaehlt
  z.zensiert(a);
  assert.equal(z.stand, 3);
});

test('Zaehlung: auch nach einer Meldung zaehlt derselbe Inhalt nicht erneut', () => {
  const z = new NeueUrteileZaehler();
  const a = bild({ src: 'a.jpg' });
  z.zensiert(a);
  assert.equal(z.nimm(), 1);
  assert.equal(z.stand, 0);
  z.zensiert(a); // Ende der Pause: neu bewertet
  assert.equal(z.nimm(), 0);
});

test('Minute: oberste Seite, frei, nicht pausiert, sichtbar: Meldung mit Zahl, Zaehler beginnt neu', () => {
  const z = new NeueUrteileZaehler();
  z.zensiert(bild({ src: '1' }));
  z.zensiert(bild({ src: '2' }));
  z.zensiert(bild({ src: '3' }));
  assert.deepEqual(baueMinute(LAGE, z, () => true), { erwachsen: true, zensiert: 3 });
  assert.deepEqual(baueMinute(LAGE, z, () => false), { erwachsen: false, zensiert: 0 });
});

test('Minute: nichts gemeldet und nichts aufgestaut bei Pause, Ausnahme, Frame, fehlender Freischaltung und unsichtbarem Tab', () => {
  for (const aus of [{ pause: true }, { aus: true }, { oberste: false }, { frei: false }, { sichtbar: false }]) {
    const z = new NeueUrteileZaehler();
    z.zensiert(bild({ src: 'x' }));
    assert.equal(baueMinute({ ...LAGE, ...aus }, z, () => true), null, JSON.stringify(aus));
    assert.equal(z.stand, 0, `verworfen bei ${JSON.stringify(aus)}`);
  }
});

test('Minute: wirft das Erkennen der Seite, geht nichts raus und die Zahl bleibt nicht stehen', () => {
  const z = new NeueUrteileZaehler();
  z.zensiert(bild({ src: 'x' }));
  assert.equal(
    baueMinute(LAGE, z, () => {
      throw new Error('kaputt');
    }),
    null,
  );
  assert.equal(z.stand, 0);
});
