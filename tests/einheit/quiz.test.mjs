// Einheitstests Auftrag Q: Quiz-Logik (Auswahl, Pruefen, Verweigern) und die im Code gedeckelten Blitz-Grenzen. Nur synthetische Daten.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_STREIFEN_HZ,
  MIN_WORT_MS,
  RUHIG_DREHZAHL,
  FOLGE_MAX_MS,
  SCHWARM_MAX_MS,
  SCHWARM_MAX_WORTE,
  WECHSEL_SPERRE_MS,
  WechselSperre,
  begrenzeAufgabe,
  spiralePeriodeS,
  streifenHz,
} from '../../src/quiz/grenzen.ts';
import {
  AUFGABE_GERAET,
  QuizSitzung,
  neuerSitzungsZustand,
  zaehleZulaessige,
  braucheGeraet,
  mischeBuchstaben,
  mischeReihenfolge,
  neuerAuswahlStand,
  normalisiereTippen,
  pruefeBuchstaben,
  pruefeCountdown,
  pruefeTippen,
  pruefeWortTippen,
  pruefeZahl,
  waehleFrage,
  waehlePinkFolge,
  waehleZaehlFolge,
} from '../../src/quiz/logik.ts';
import { SatzWahl } from '../../src/quiz/saetze.ts';
import { AUFGABEN_TYPEN, pruefeQuizBank, pruefeTexte } from '../../src/quiz/vertrag.ts';
import { DUMMY_QUIZ, DUMMY_TEXTE } from '../../scripts/pack/dummy-inhalte.mjs';

const bank = pruefeQuizBank(DUMMY_QUIZ);
// Deterministischer Zufall (Linear-Kongruenz), damit Laeufe wiederholbar sind.
function zufall(samen) {
  let s = samen >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const mitAufgabe = (id, typ, param = {}, geraet = 'beide', schwere = 'mittel') => ({ id, art: 'aufgabe', schwere, geraet, frage: 'x', aufgabe: { typ, param } });
const desktop = { geraet: 'desktop', ruhig: false };

test('Dummy-Bank ist gueltig (Grundlage der Tests)', () => {
  assert.ok(bank && bank.fragen.length === 11);
});

test('Auswahl: nie dieselbe Frage zweimal in Folge (5000 Zuege, mehrere Samen)', () => {
  for (const samen of [1, 2, 3, 42, 99]) {
    const z = zufall(samen);
    let stand = neuerAuswahlStand();
    let vorher = null;
    for (let i = 0; i < 1000; i++) {
      const r = waehleFrage(bank, stand, desktop, z);
      assert.ok(r.frage);
      assert.notEqual(r.frage.id, vorher, `Zug ${i}, Samen ${samen}`);
      vorher = r.frage.id;
      stand = r.stand;
    }
  }
});

test('Auswahl: Runden ohne Wiederholung (die ersten n Zuege sind verschieden, danach ungefaehr gleich oft)', () => {
  const z = zufall(7);
  let stand = neuerAuswahlStand();
  const n = bank.fragen.filter((f) => braucheGeraet(f) !== 'touch').length; // Desktop: 10
  assert.equal(n, 10);
  const zaehl = new Map();
  const erste = new Set();
  const ZUEGE = 3000;
  for (let i = 0; i < ZUEGE; i++) {
    const r = waehleFrage(bank, stand, desktop, z);
    stand = r.stand;
    if (i < n) erste.add(r.frage.id);
    zaehl.set(r.frage.id, (zaehl.get(r.frage.id) ?? 0) + 1);
  }
  assert.equal(erste.size, n);
  const werte = [...zaehl.values()];
  assert.equal(zaehl.size, n);
  assert.ok(Math.min(...werte) > (ZUEGE / n) * 0.8 && Math.max(...werte) < (ZUEGE / n) * 1.2, JSON.stringify(werte));
  console.log(`quiz: ${ZUEGE} Zuege, Haeufigkeit je Frage ${Math.min(...werte)} bis ${Math.max(...werte)} bei ${n} Fragen`);
});

test('Auswahl: Schwere ist gemischt (alle drei kommen vor, leicht und mittel haeufiger als fies)', () => {
  const z = zufall(11);
  let stand = neuerAuswahlStand();
  const zaehl = { leicht: 0, mittel: 0, fies: 0 };
  for (let i = 0; i < 2000; i++) {
    const r = waehleFrage(bank, stand, desktop, z);
    stand = r.stand;
    zaehl[r.frage.schwere]++;
  }
  assert.ok(zaehl.leicht > 0 && zaehl.mittel > 0 && zaehl.fies > 0, JSON.stringify(zaehl));
});

test('Geraet: Touch zieht nie desktop, Desktop nie touch (auch wenn das Pack sich beim Typ irrt)', () => {
  const z = zufall(5);
  for (const [geraet, verboten] of [['touch', 'desktop'], ['desktop', 'touch']]) {
    let stand = neuerAuswahlStand();
    for (let i = 0; i < 300; i++) {
      const r = waehleFrage(bank, stand, { geraet, ruhig: false }, z);
      stand = r.stand;
      assert.notEqual(braucheGeraet(r.frage), verboten);
    }
  }
  // Das Pack nennt `beide`, der Typ braucht aber Tastatur bzw. Finger: der Typ gilt.
  assert.equal(braucheGeraet(mitAufgabe('a', 'leertaste-halten', {}, 'beide')), 'desktop');
  assert.equal(braucheGeraet(mitAufgabe('b', 'finger-halten', {}, 'beide')), 'touch');
  assert.equal(AUFGABE_GERAET['klicken-zaehlen'], 'beide');
});

test('Ruhig-Modus: nie zaehlen, pink-klicken, wort-blitz', () => {
  const alle = pruefeQuizBank({
    version: 1,
    fragen: [
      ...AUFGABEN_TYPEN.map((t, i) => ({ id: `t-${i}`, art: 'aufgabe', schwere: 'leicht', frage: 'x', aufgabe: { typ: t, param: {} } })),
      { id: 'w', art: 'wissen', schwere: 'leicht', frage: 'x', antworten: ['a', 'b'], richtig: 0 },
    ],
  });
  const z = zufall(3);
  let stand = neuerAuswahlStand();
  const typen = new Set();
  for (let i = 0; i < 500; i++) {
    const r = waehleFrage(alle, stand, { geraet: 'desktop', ruhig: true }, z);
    stand = r.stand;
    if (r.frage.art === 'aufgabe') typen.add(r.frage.aufgabe.typ);
  }
  for (const verboten of ['zaehlen', 'pink-klicken', 'wort-blitz']) assert.ok(!typen.has(verboten), verboten);
  assert.ok(typen.has('wort-tippen'));
});

test('Auswahl: weniger als zwei zulaessige Fragen geben null', () => {
  const nurTouch = pruefeQuizBank({ version: 1, fragen: ['a', 'b', 'c'].map((n) => mitAufgabe(n, 'wort-tippen', {}, 'touch')) });
  assert.equal(waehleFrage(nurTouch, neuerAuswahlStand(), desktop).frage, null);
  // Weniger als zwei zulaessige Fragen: keine Auswahl (der Riegel zeigt sich nicht)
  const eine = pruefeQuizBank({ version: 1, fragen: [mitAufgabe('a', 'wort-tippen'), mitAufgabe('b', 'wort-tippen', {}, 'touch'), mitAufgabe('c', 'wort-tippen', {}, 'touch')] });
  assert.equal(zaehleZulaessige(eine, desktop), 1);
  assert.equal(waehleFrage(eine, neuerAuswahlStand(), desktop).frage, null);
  assert.equal(zaehleZulaessige(bank, desktop), 10);
});

test('mischeReihenfolge ist eine Permutation', () => {
  const z = zufall(8);
  for (let n = 2; n <= 6; n++) assert.deepEqual([...mischeReihenfolge(n, z)].sort(), Array.from({ length: n }, (_, i) => i));
});

test('Tippen: Gross- und Kleinschreibung, alle Satzzeichen und Leerraum egal; Woerter exakt, Apostroph im Wort bleibt', () => {
  const satz = 'Second test line, DOWN.';
  assert.ok(pruefeTippen(satz, 'Second test line, DOWN.'));
  assert.ok(pruefeTippen(satz, 'second test line, down'));
  assert.ok(pruefeTippen(satz, '  SECOND TEST LINE, DOWN!!  '));
  assert.ok(pruefeTippen(satz, 'Second  test   line, DOWN . '));
  assert.ok(pruefeTippen(satz, 'Second test line DOWN'), 'Komma mitten im Satz darf fehlen');
  assert.ok(pruefeTippen(satz, '"Second test line; DOWN"'), 'andere Satzzeichen, Anfuehrungszeichen');
  assert.ok(pruefeTippen(satz, '\u201cSecond test line\u201d \u2026 DOWN'), 'typografische Anfuehrungszeichen');
  assert.ok(pruefeTippen(satz, ' , Second test line DOWN'), 'Satzzeichen und Leerraum davor');
  assert.ok(!pruefeTippen(satz, 'Second test lines, DOWN'), 'anderes Wort');
  assert.ok(!pruefeTippen(satz, 'Second test line,'), 'Trigger fehlt');
  assert.ok(!pruefeTippen(satz, ''));
  assert.ok(!pruefeTippen(satz, '.,;'));
  assert.ok(pruefeTippen("Don't stop, pet!", 'dont stop pet') === false, 'Apostroph im Wort gehoert zum Wort');
  assert.ok(pruefeTippen("Don't stop, pet!", "don\u2019t STOP pet"));
  assert.ok(pruefeTippen("Say 'yes', pet.", 'say yes pet'), 'Apostroph als Anfuehrungszeichen faellt weg');
  assert.equal(normalisiereTippen('It\u2019s ok...'), "it's ok");
});

test('Aufgaben pruefen: wort-tippen, countdown, Zahl, Buchstaben', () => {
  assert.ok(pruefeWortTippen('TEST test Test', 'TEST', 3));
  assert.ok(pruefeWortTippen('down, down; down', 'DOWN', 3));
  assert.ok(!pruefeWortTippen('TEST TEST', 'TEST', 3));
  assert.ok(!pruefeWortTippen('TEST TEST TEST TEST', 'TEST', 3));
  assert.ok(!pruefeWortTippen('TEST TEST TOAST', 'TEST', 3));
  assert.ok(pruefeCountdown('10 9 8 7 6 5 4 3 2 1 DOWN', 10, 'DOWN'));
  assert.ok(pruefeCountdown('10, 9, 8, 7, 6, 5, 4, 3, 2, 1, down.', 10, 'DOWN'));
  assert.ok(!pruefeCountdown('10 9 8 7 6 5 4 3 2 DOWN', 10, 'DOWN'));
  assert.ok(!pruefeCountdown('1 2 3', 10, 'DOWN'));
  assert.ok(pruefeZahl(' 5 ', 5) && !pruefeZahl('5x', 5) && !pruefeZahl('', 0) && !pruefeZahl('4', 5));
  assert.ok(pruefeBuchstaben('o b e y', 'OBEY') && pruefeBuchstaben('OBEY', 'OBEY') && !pruefeBuchstaben('OBE', 'OBEY'));
});

test('Folgen: Zaehlen hat Zielwort 2 bis Haelfte, Pink nie als erstes, Raetsel ist gemischt', () => {
  for (let samen = 1; samen <= 200; samen++) {
    const z = zufall(samen);
    const a = waehleZaehlFolge(['POP', 'DOWN', 'OBEY', 'pink'], 'POP', 10, z);
    assert.equal(a.folge.length, 10);
    assert.equal(a.folge.filter((w) => w === 'POP').length, a.richtig);
    assert.ok(a.richtig >= 2 && a.richtig <= 5, String(a.richtig));
    const p = waehlePinkFolge(['A', 'B', 'C'], 8, z);
    assert.ok(p.pink >= 1 && p.pink < 8);
    // nie zwei gleiche Woerter nebeneinander
    for (const f of [a.folge, p.folge]) for (let i = 1; i < f.length; i++) assert.notEqual(f[i], f[i - 1], `Samen ${samen}: ${f.join(' ')}`);
    for (const n of [8, 11, 14]) {
      const g = waehleZaehlFolge(['POP', 'DOWN', 'OBEY', 'pink'], 'POP', n, z);
      for (let i = 1; i < g.folge.length; i++) assert.notEqual(g.folge[i], g.folge[i - 1]);
      assert.equal(g.folge.filter((w) => w === 'POP').length, g.richtig);
    }
    assert.notEqual(mischeBuchstaben('OBEY', z).replace(/ /g, ''), 'OBEY');
  }
});

test('Verweigern: Anteil wird getroffen, nie zweimal hintereinander, falsch hebt die Sperre nicht auf', () => {
  const z = zufall(21);
  const s = new QuizSitzung(bank, desktop, 0.3, z);
  let vorher = null;
  let verweigert = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const u = s.bewerte(true);
    assert.ok(!(vorher === 'verweigert' && u === 'verweigert'), `Zug ${i}`);
    if (u === 'verweigert') verweigert++;
    vorher = u;
  }
  // Mit der Sperre nach jeder Verweigerung liegt der Anteil unter 0,3 (p/(1+p) = 0,23), aber deutlich ueber 0,15.
  const anteil = verweigert / N;
  assert.ok(anteil > 0.18 && anteil < 0.3, `Anteil ${anteil}`);
  // 0 verweigert nie, ueberhoehte Werte werden auf 0,3 gedeckelt
  const nie = new QuizSitzung(bank, desktop, 0, zufall(1));
  for (let i = 0; i < 1000; i++) assert.equal(nie.bewerte(true), 'richtig');
  const hoch = new QuizSitzung(bank, desktop, 5, () => 0.29);
  assert.equal(hoch.bewerte(true), 'verweigert');
  assert.equal(hoch.bewerte(true), 'richtig', 'direkt danach nie');
  assert.equal(hoch.bewerte(true), 'verweigert');
  // falsch ist immer falsch
  // Die Sperre nach einer Verweigerung haelt, bis wirklich `richtig` durchgeht: falsche Antworten dazwischen heben sie nicht auf.
  const f = new QuizSitzung(bank, desktop, 0.3, () => 0);
  assert.equal(f.bewerte(true), 'verweigert');
  assert.equal(f.bewerte(false), 'falsch');
  assert.equal(f.bewerte(false), 'falsch');
  assert.equal(f.bewerte(true), 'richtig', 'nach falsch immer noch gesperrt');
  assert.equal(f.bewerte(true), 'verweigert', 'erst nach echtem richtig wieder frei');
  // Zustand gilt ueber Sitzungen hinweg (je Tab): zweiter Riegel, gleiche Sperre und gleicher Auswahlstand
  const geteilt = neuerSitzungsZustand();
  const s1 = new QuizSitzung(bank, desktop, 0.3, () => 0, geteilt);
  assert.equal(s1.bewerte(true), 'verweigert');
  const s2 = new QuizSitzung(bank, desktop, 0.3, () => 0, geteilt);
  assert.equal(s2.bewerte(true), 'richtig');
  const erste = s1.naechste();
  assert.notEqual(s2.naechste().id, erste.id);
  // Zufall >= Anteil: richtig
  assert.equal(new QuizSitzung(bank, desktop, 0.1, () => 0.1).bewerte(true), 'richtig');
});

test('Falsch gibt sofort die naechste Frage (keine Wartezeit in der Logik), nie dieselbe', () => {
  const s = new QuizSitzung(bank, desktop, 0.1, zufall(4));
  let alt = s.naechste();
  for (let i = 0; i < 200; i++) {
    assert.equal(s.bewerte(false), 'falsch');
    const neu = s.naechste();
    assert.notEqual(neu.id, alt.id);
    alt = neu;
  }
});

// ---------- Blitz-Grenzen ----------
test('Deckel: Spirale nie ueber 2,5 Hz, auch bei Unsinn; Ruhig auf 30 Prozent; Bewegung aus steht', () => {
  for (const wunsch of [undefined, 0, -3, NaN, Infinity, 1e-9, 0.01, 0.4, 0.8, 5, 24, 1e9]) {
    for (const arme of [undefined, 1, 2, 3, 8, 50]) {
      const p = spiralePeriodeS(wunsch, { arme });
      assert.ok(streifenHz(p, arme ?? 2) <= MAX_STREIFEN_HZ + 1e-9, `wunsch ${wunsch}, arme ${arme}: ${streifenHz(p, arme ?? 2)} Hz`);
      const r = spiralePeriodeS(wunsch, { arme, ruhig: true });
      assert.ok(Math.abs(streifenHz(r, arme ?? 2) - Math.min(streifenHz(p, arme ?? 2), MAX_STREIFEN_HZ) * RUHIG_DREHZAHL) < 1e-6);
      assert.ok(r > p);
    }
  }
  assert.equal(spiralePeriodeS(10, { bewegungAus: true }), null);
  assert.equal(streifenHz(null), 0);
  // Standard ist weit unter dem Deckel
  assert.ok(streifenHz(spiralePeriodeS(undefined)) < 0.2);
});

test('Deckel: Woerter hoechstens 2 je Sekunde, Gesamtdauer hoechstens 15 s, zaehlen 8 bis 14 Woerter', () => {
  assert.equal(MIN_WORT_MS, 500);
  assert.ok(SCHWARM_MAX_WORTE === 12 && SCHWARM_MAX_MS === 2500 && FOLGE_MAX_MS === 15000);
  for (const typ of ['zaehlen', 'pink-klicken']) {
    for (const wortMs of [-5, 0, 1, 50, 185, 499, 500, 600, 1000, 3000, 1e9, NaN, 'schnell']) {
      for (const anzahlWoerter of [-1, 0, 1, 8, 14, 100, 1e9, NaN]) {
        const a = begrenzeAufgabe(typ, { wortMs, anzahlWoerter });
        assert.ok(a.wortMs >= 500 && a.wortMs <= 3000, `wortMs ${wortMs} -> ${a.wortMs}`);
        assert.ok(1000 / a.wortMs <= 2);
        assert.ok(a.anzahlWoerter >= 1 && a.anzahlWoerter <= 14);
        assert.ok(a.anzahlWoerter * a.wortMs <= FOLGE_MAX_MS, `Gesamtdauer ${a.anzahlWoerter} x ${a.wortMs}`);
        if (typ === 'pink-klicken') assert.ok(a.anzahlWoerter <= SCHWARM_MAX_WORTE);
        if (typ === 'zaehlen') {
          assert.ok(a.wortMs <= 1875, `zaehlen wortMs ${a.wortMs}`);
          assert.ok(a.anzahlWoerter >= 8 && a.anzahlWoerter <= 14, `zaehlen ${a.anzahlWoerter} Woerter bei ${a.wortMs} ms`);
        }
      }
    }
  }
  assert.equal(begrenzeAufgabe('zaehlen', {}).anzahlWoerter, 10);
  assert.equal(begrenzeAufgabe('zaehlen', { anzahlWoerter: 14 }).anzahlWoerter, 14);
  assert.equal(begrenzeAufgabe('zaehlen', { anzahlWoerter: 3 }).anzahlWoerter, 8);
  // wort-blitz: einmalig, 300 bis 1000 ms
  for (const z of [0, 1, 1e9, -1]) {
    const a = begrenzeAufgabe('wort-blitz', { zeigeMs: z });
    assert.ok(a.zeigeMs >= 300 && a.zeigeMs <= 1000);
  }
});

test('Deckel: Zeiten, Anzahlen und Texte werden geklemmt', () => {
  for (const typ of AUFGABEN_TYPEN) {
    for (const wert of [-1, 0, 1e9, NaN, '<b>x</b>', 'ok']) {
      const a = begrenzeAufgabe(typ, { sekunden: wert, anzahl: wert, abstandMs: wert, von: wert, wort: wert, woerter: wert, gemischt: wert });
      assert.ok(a.sekunden >= 2 && a.sekunden <= 30, `${typ} sekunden ${a.sekunden}`);
      assert.ok(a.anzahl >= 1 && a.anzahl <= 12);
      assert.ok(a.abstandMs >= 200 && a.abstandMs <= 5000);
      assert.ok(a.von >= 3 && a.von <= 20);
      assert.ok(!/[<>]/.test(a.wort) && a.wort.length > 0 && a.wort.length <= 24);
      assert.ok(a.woerter.length >= 2 && a.woerter.length <= 8);
    }
  }
  // gueltige Werte bleiben
  const k = begrenzeAufgabe('klicken-zaehlen', { anzahl: 7, abstandMs: 500 });
  assert.equal(k.anzahl, 7);
  assert.equal(k.abstandMs, 500);
  assert.equal(begrenzeAufgabe('spirale-ansehen', { sekunden: 10 }).sekunden, 10);
  assert.equal(begrenzeAufgabe('zaehlen', { wort: 'POP', woerter: 'DOWN,OBEY' }).woerter[0], 'POP', 'Zielwort ist immer in der Liste');
  // gemischt nur, wenn es wirklich eine Umstellung des Wortes ist
  assert.equal(begrenzeAufgabe('buchstaben-raetsel', { wort: 'OBEY', gemischt: 'B E O Y' }).gemischt, 'B E O Y');
  assert.equal(begrenzeAufgabe('buchstaben-raetsel', { wort: 'OBEY', gemischt: 'X X X X' }).gemischt, '');
  assert.equal(begrenzeAufgabe('buchstaben-raetsel', { wort: 'OBEY', gemischt: 'OBEY' }).gemischt, '');
});

test('Deckel: vollflaechige Wechsel hoechstens 3 je Sekunde (Sperre 334 ms), 10000 Versuche', () => {
  assert.equal(WECHSEL_SPERRE_MS, 334);
  let jetzt = 0;
  const s = new WechselSperre(() => jetzt);
  const erlaubt = [];
  for (let i = 0; i < 10000; i++) {
    jetzt += 7; // ein Versuch alle 7 ms
    if (s.versuche()) erlaubt.push(jetzt);
  }
  assert.ok(erlaubt.length > 100);
  // in jedem Fenster von 1000 ms hoechstens 3 Wechsel
  for (let i = 0; i + 3 < erlaubt.length; i++) assert.ok(erlaubt[i + 3] - erlaubt[i] >= 1000, `Fenster ab ${erlaubt[i]}`);
  for (let i = 1; i < erlaubt.length; i++) assert.ok(erlaubt[i] - erlaubt[i - 1] >= 334);
  // direkt hintereinander: nur der erste
  let t2 = 100;
  const s2 = new WechselSperre(() => t2);
  assert.ok(s2.versuche() && !s2.versuche());
  t2 += 333;
  assert.ok(!s2.versuche());
  t2 += 1;
  assert.ok(s2.versuche());
});

test('Woerter mit Leerzeichen: wort-tippen, countdown und zaehlen bekommen den Standard (Eingabe trennt an Leerraum)', () => {
  assert.equal(begrenzeAufgabe('wort-tippen', { wort: 'SLEEP NOW' }).wort, 'DOWN');
  assert.equal(begrenzeAufgabe('countdown', { wort: 'SLEEP NOW' }).wort, 'DOWN');
  assert.equal(begrenzeAufgabe('zaehlen', { wort: 'SLEEP NOW' }).wort, 'POP');
  assert.ok(begrenzeAufgabe('zaehlen', { woerter: 'SLEEP NOW,DOWN' }).woerter.every((w) => !w.includes(' ')));
  assert.equal(begrenzeAufgabe('wort-blitz', { wort: 'SLEEP NOW' }).wort, 'SLEEP NOW', 'Blitz und Raetsel pruefen ohne Leerraum');
});

test('Erzwungene Frage muss zulaessig sein (Ruhig-Modus, Geraet)', () => {
  const alle = pruefeQuizBank({
    version: 1,
    fragen: [mitAufgabe('z', 'zaehlen'), mitAufgabe('a', 'wort-tippen'), mitAufgabe('b', 'wort-tippen'), mitAufgabe('t', 'finger-halten')],
  });
  const ruhig = new QuizSitzung(alle, { geraet: 'desktop', ruhig: true }, 0.1, zufall(1));
  assert.equal(ruhig.erzwinge('z'), null, 'zaehlen im Ruhig-Modus');
  assert.equal(ruhig.erzwinge('t'), null, 'Finger-Aufgabe am Desktop');
  assert.equal(ruhig.erzwinge('a').id, 'a');
  const normal = new QuizSitzung(alle, { geraet: 'desktop', ruhig: false }, 0.1, zufall(1));
  assert.equal(normal.erzwinge('z').id, 'z');
});

test('einWort nur Buchstaben und Ziffern; Pruefen ueber normalisiereTippen; Zaehlfolge mit nur einem Fuellwort', () => {
  assert.equal(begrenzeAufgabe('wort-tippen', { wort: 'well-known' }).wort, 'DOWN');
  assert.equal(begrenzeAufgabe('wort-tippen', { wort: 'Sleep2' }).wort, 'Sleep2');
  assert.ok(pruefeBuchstaben('OBEY.', 'OBEY') && pruefeBuchstaben('o-b-e-y!', 'OBEY') && !pruefeBuchstaben('OBE', 'OBEY'));
  assert.ok(pruefeZahl('5.', 5) && pruefeZahl(' 5 ', 5) && !pruefeZahl('5x', 5) && !pruefeZahl('.', 5));
  for (let samen = 1; samen <= 100; samen++) {
    const r = waehleZaehlFolge(['POP', 'DOWN'], 'POP', 12, zufall(samen));
    for (let i = 1; i < r.folge.length; i++) assert.notEqual(r.folge[i], r.folge[i - 1], r.folge.join(' '));
    const q = waehleZaehlFolge(['POP'], 'POP', 12, zufall(samen));
    for (let i = 1; i < q.folge.length; i++) assert.notEqual(q.folge[i], q.folge[i - 1], q.folge.join(' '));
  }
});

test('Mias Saetze: Auswahl aus der Pack-Gruppe, nie zweimal derselbe, Rueckfall ohne Pack-Texte', () => {
  const texte = pruefeTexte({
    version: 1,
    gruppen: { ...DUMMY_TEXTE.gruppen, falsch: ['Eins.', 'Zwei.', 'Drei.'] },
  });
  assert.ok(texte);
  const w = new SatzWahl(texte, zufall(2));
  let vorher = '';
  for (let i = 0; i < 100; i++) {
    const s = w.hole('falsch');
    assert.notEqual(s, vorher);
    vorher = s;
  }
  assert.equal(w.hole('start'), 'Test start line.');
  assert.equal(w.hole('freigelegt', { seconds: 9.6 }), 'Test reveal line, 10 seconds.');
  const ohne = new SatzWahl(null, zufall(2));
  for (const g of ['start', 'richtig', 'falsch', 'verweigert']) assert.ok(ohne.hole(g).length > 0, g);
  assert.equal(ohne.hole('stufe1'), '');
});
