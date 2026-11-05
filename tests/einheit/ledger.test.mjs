// Einheitstest Auftrag L (Mia’s Ledger): reine Logik in src/ledger/logik.ts (Stand, Pruefung, Addieren, Tageswechsel, Erwachsenen-Minute,
// Stufe, Puffer) und die Texte in src/ledger/texte.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ENDGUELTIG_ABGELEHNT,
  FEHLER_SUMME,
  MAX_JE_NACHRICHT,
  Puffer,
  addiere,
  geloescht,
  leererLedger,
  minuteFaellig,
  mitStufe,
  neuerTag,
  ortsTag,
  pruefePlus,
  tageSeit,
  uhrMinute,
  vervollstaendigeLedger,
  zaehlungFuer,
} from '../../src/ledger/logik.ts';
import { LEDGER_ZAEHLER } from '../../src/ledger/vertrag.ts';
import { ZAEHLER_NAMEN, popupZeile, satzFuer, seitText, stufeSatz } from '../../src/ledger/texte.ts';

const t1 = new Date(2026, 10, 5, 10, 30);
const t2 = new Date(2026, 10, 6, 0, 5);

test('Stand: leer, vervollstaendigt, Muell wird bereinigt', () => {
  const l = leererLedger(t1);
  assert.equal(l.seit, t1.getTime());
  assert.equal(l.tag, '2026-11-05');
  for (const z of LEDGER_ZAEHLER) assert.equal(l.heute[z] + l.gesamt[z], 0);
  assert.deepEqual(vervollstaendigeLedger(undefined, t1), l);
  const v = vervollstaendigeLedger({ seit: 'x', tag: 'gestern', heute: { zensiert: -4, spiralen: 2.7, fremd: 9 }, gesamt: { zensiert: 'viel' }, hoechsteStufe: 99, extra: 1 }, t1);
  assert.equal(v.tag, '2026-11-05');
  assert.equal(v.seit, t1.getTime());
  assert.equal(v.heute.zensiert, 0);
  assert.equal(v.heute.spiralen, 2);
  assert.equal(v.gesamt.zensiert, 0);
  assert.equal(v.hoechsteStufe, 4);
  assert.ok(!('fremd' in v.heute) && !('extra' in v));
  console.log(`einheit ledger: ${LEDGER_ZAEHLER.length} Zaehler, Stand vervollstaendigt`);
});

test('Addieren: heute und gesamt wachsen, Tageswechsel setzt nur heute zurueck', () => {
  let l = addiere(leererLedger(t1), { zensiert: 3, quizGeloest: 1 }, t1);
  l = addiere(l, { zensiert: 4 }, t1);
  assert.equal(l.heute.zensiert, 7);
  assert.equal(l.gesamt.zensiert, 7);
  assert.equal(l.heute.quizGeloest, 1);
  assert.equal(l.seit, t1.getTime());
  const morgen = addiere(l, { zensiert: 2 }, t2);
  assert.equal(morgen.tag, '2026-11-06');
  assert.equal(morgen.heute.zensiert, 2);
  assert.equal(morgen.heute.quizGeloest, 0);
  assert.equal(morgen.gesamt.zensiert, 9);
  assert.equal(neuerTag(l, t1), l);
  assert.equal(neuerTag(l, t2).heute.zensiert, 0);
  assert.equal(ortsTag(new Date(2026, 0, 2)), '2026-01-02');
  console.log(`einheit ledger: Tageswechsel heute ${morgen.heute.zensiert}, gesamt ${morgen.gesamt.zensiert}`);
});

test('Pruefung: nur bekannte Schluessel, ganze Zahlen 0 bis 10000, erwachsenMinuten nur aus dem Hintergrund', () => {
  assert.deepEqual(pruefePlus({ zensiert: 5, spiralen: 1 }), { zensiert: 5, spiralen: 1 });
  assert.deepEqual(pruefePlus({ zensiert: MAX_JE_NACHRICHT }), { zensiert: MAX_JE_NACHRICHT });
  assert.deepEqual(pruefePlus({ zensiert: 2, unbekannt: 7, erwachsenMinuten: 50 }), { zensiert: 2 });
  assert.equal(pruefePlus({ zensiert: MAX_JE_NACHRICHT + 1 }), null);
  assert.equal(pruefePlus({ zensiert: -1 }), null);
  assert.equal(pruefePlus({ zensiert: 1.5 }), null);
  assert.equal(pruefePlus({ zensiert: '3' }), null);
  assert.equal(pruefePlus({ zensiert: NaN }), null);
  assert.equal(pruefePlus({ zensiert: 2, quizFalsch: -5 }), null);
  assert.equal(pruefePlus({}), null);
  assert.equal(pruefePlus({ zensiert: 0 }), null);
  assert.equal(pruefePlus({ unbekannt: 3 }), null);
  assert.equal(pruefePlus(null), null);
  assert.equal(pruefePlus('x'), null);
  assert.equal(pruefePlus([1, 2]), null);
  console.log('einheit ledger: 15 Pruefungsfaelle');
});

test('Erwachsenen-Minute: hoechstens einmal je Uhr-Minute ueber alle Tabs', () => {
  const ms = new Date(2026, 10, 5, 10, 30, 10).getTime();
  assert.equal(minuteFaellig(-1, ms), true);
  const m = uhrMinute(ms);
  assert.equal(minuteFaellig(m, ms), false);
  assert.equal(minuteFaellig(m, ms + 20_000), false, '10:30:10 und 10:30:30 liegen in derselben Uhr-Minute');
  assert.equal(minuteFaellig(m, (m + 1) * 60_000), true);
  assert.equal(minuteFaellig(m + 5, ms), true, 'Uhr zurueckgestellt: die gespeicherte Minute sperrt das Zaehlen nicht');
  let letzte = -1;
  let summe = 0;
  for (let s = 0; s < 150; s += 10) {
    const jetzt = (m + 0) * 60_000 + s * 1000;
    if (minuteFaellig(letzte, jetzt)) {
      summe++;
      letzte = uhrMinute(jetzt);
    }
  }
  assert.equal(summe, 3, '150 Sekunden ab Minutenanfang: drei Uhr-Minuten, je eine gezaehlt');
  console.log(`einheit ledger: 15 Meldungen in 150 s ergeben ${summe} Minuten`);
});

test('Fehlertexte: Pruefung endgueltig, anderes bleibt im Puffer', () => {
  assert.ok(ENDGUELTIG_ABGELEHNT.includes(FEHLER_SUMME));
  assert.ok(!ENDGUELTIG_ABGELEHNT.includes('Speicher voll'));
});

test('Hoechste Stufe nur anheben; Loeschen setzt alles zurueck, seit jetzt', () => {
  let l = leererLedger(t1);
  l = mitStufe(l, 2);
  assert.equal(l.hoechsteStufe, 2);
  assert.equal(mitStufe(l, 1), l);
  assert.equal(mitStufe(l, 4).hoechsteStufe, 4);
  assert.equal(mitStufe(l, 9).hoechsteStufe, 4);
  l = addiere(l, { besuche: 3 }, t1);
  const weg = geloescht(t2);
  assert.equal(weg.seit, t2.getTime());
  assert.equal(weg.hoechsteStufe, 0);
  assert.equal(weg.gesamt.besuche, 0);
  assert.equal(weg.heute.besuche, 0);
});

test('Tage seit Beginn: Kalendertage, am selben Tag 0', () => {
  assert.equal(tageSeit(t1.getTime(), t1), 0);
  assert.equal(tageSeit(t1.getTime(), t2), 1);
  assert.equal(tageSeit(new Date(2026, 9, 25, 23, 0).getTime(), new Date(2026, 10, 5, 1, 0)), 11);
  assert.equal(tageSeit(t2.getTime(), t1), 0);
});

test('Puffer: Ereignisse werden gezaehlt, Blitz nach Woertern, Quiz-Start zaehlt nicht', () => {
  const p = new Puffer();
  assert.equal(p.leer, true);
  for (let i = 0; i < 5; i++) p.zaehle({ art: 'zensiert' });
  p.zaehle({ art: 'quiz-richtig' });
  p.zaehle({ art: 'quiz-falsch' });
  p.zaehle({ art: 'quiz-verweigert' });
  p.zaehle({ art: 'werbung' });
  p.zaehle({ art: 'blitz', woerter: 4 });
  p.zaehle({ art: 'blitz', woerter: 3 });
  p.zaehle({ art: 'spirale' });
  p.zaehle({ art: 'besuch' });
  assert.equal(p.zaehle({ art: 'quiz-start' }), false);
  assert.equal(p.zaehle({ art: 'blitz', woerter: 0 }), false);
  assert.equal(p.zaehle({ art: 'blitz', woerter: NaN }), false);
  assert.equal(p.zaehle({ art: 'gibtsnicht' }), false);
  const s = p.nimm();
  assert.deepEqual(s, { zensiert: 5, quizGeloest: 1, quizFalsch: 1, quizVerweigert: 1, werbung: 1, blitzwoerter: 7, spiralen: 1, besuche: 1 });
  assert.equal(p.leer, true);
  assert.deepEqual(pruefePlus(s), s, 'was der Puffer liefert, besteht die Pruefung des Hintergrunds');
  p.zurueck(s);
  p.zaehle({ art: 'zensiert' });
  assert.equal(p.nimm().zensiert, 6);
  const gross = new Puffer();
  gross.zaehle({ art: 'blitz', woerter: 9_000 });
  gross.zaehle({ art: 'blitz', woerter: 9_000 });
  assert.equal(gross.nimm().blitzwoerter, MAX_JE_NACHRICHT);
  assert.equal(zaehlungFuer({ art: 'zensiert' })?.[0], 'zensiert');
  console.log(`einheit ledger: Puffer summiert ${Object.values(s).reduce((a, b) => a + b, 0)} Zaehlungen in ${Object.keys(s).length} Zaehlern`);
});

test('Texte: jeder Zaehler hat Name und vier Stufen, Popup-Zeile auch bei 0, keine Gedankenstriche', () => {
  const alle = [];
  for (const z of LEDGER_ZAEHLER) {
    assert.ok(ZAEHLER_NAMEN[z].length > 0);
    const saetze = new Set([0, 1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 300, 1000].map((n) => satzFuer(z, n)));
    assert.equal(saetze.size, 4, `${z}: vier verschiedene Saetze`);
    alle.push(ZAEHLER_NAMEN[z], ...saetze);
  }
  for (let s = 0; s <= 4; s++) alle.push(stufeSatz(s));
  alle.push(popupZeile(0), popupZeile(1), popupZeile(34), seitText('Nov 5, 2026', 0), seitText('Nov 5, 2026', 1), seitText('Nov 5, 2026', 12));
  assert.ok(popupZeile(34).includes('34'));
  assert.ok(popupZeile(0).length > 0 && !popupZeile(0).includes('0 '));
  assert.ok(seitText('Nov 5, 2026', 12).includes('12 days'));
  for (const t of alle) {
    assert.ok(!/[–—]/.test(t), `Gedankenstrich in: ${t}`);
    assert.ok(!t.includes("'"), `gerades Apostroph in: ${t}`);
  }
  console.log(`einheit ledger: ${alle.length} Texte geprueft`);
});
