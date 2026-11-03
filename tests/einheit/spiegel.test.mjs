// Einheitstests ohne Browser: Zuordnung von Leinwaenden zu Videos (src/schleier/spiegel.ts, PHASE-3-BAUPLAN S1 bis S7).
// Das Dokument wird mit kleinen Attrappen nachgebaut (Knoten mit parentNode, contains, querySelectorAll und Rechteck).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flaeche, istVideoKandidat, sammleLeinwaende, Spiegel, sucheVideo, ueberdeckung, waehleSpiegelVideo } from '../../src/schleier/spiegel.ts';

const rect = (left, top, breite, hoehe) => ({ left, top, right: left + breite, bottom: top + hoehe });

// Attrappen-Dokument: Knoten mit Art (nodeType 1 Element, 11 Shadow Root, 9 Dokument).
function knoten(name, opt = {}) {
  const k = {
    name,
    localName: name,
    nodeType: opt.nodeType ?? 1,
    parentNode: null,
    kinder: [],
    rechteck: opt.rechteck ?? rect(0, 0, 0, 0),
    isConnected: true,
    getBoundingClientRect() {
      return this.rechteck;
    },
    contains(x) {
      for (let n = x; n; n = n.parentNode) if (n === this) return true;
      return false;
    },
    querySelectorAll(sel) {
      const aus = [];
      const gehe = (n) => {
        for (const kind of n.kinder) {
          if (kind.name === sel) aus.push(kind);
          gehe(kind);
        }
      };
      gehe(this);
      return aus;
    },
    haenge(kind) {
      kind.parentNode = this;
      this.kinder.push(kind);
      return kind;
    },
  };
  return k;
}

function seite() {
  const dok = knoten('#document', { nodeType: 9 });
  const html = dok.haenge(knoten('html'));
  const body = html.haenge(knoten('body'));
  return { dok, html, body };
}

test('Ueberdeckung: Anteil der Leinwandflaeche, den das Video deckt', () => {
  assert.equal(ueberdeckung(rect(0, 0, 100, 100), rect(0, 0, 100, 100)), 1);
  assert.equal(ueberdeckung(rect(0, 0, 100, 100), rect(50, 0, 100, 100)), 0.5);
  assert.equal(ueberdeckung(rect(0, 0, 100, 100), rect(200, 0, 50, 50)), 0);
  assert.equal(ueberdeckung(rect(10, 10, 20, 20), rect(0, 0, 100, 100)), 1);
  assert.equal(ueberdeckung(rect(0, 0, 0, 0), rect(0, 0, 100, 100)), 0);
  assert.equal(flaeche(rect(0, 0, 0, 50)), 0);
});

test('Auswahl: mindestens 50 Prozent, bei mehreren die groesste Ueberdeckung, bei Gleichstand das erste', () => {
  const c = rect(0, 0, 100, 100);
  assert.equal(waehleSpiegelVideo(c, [{ video: 'a', rechteck: rect(0, 0, 100, 49) }]), null);
  assert.equal(waehleSpiegelVideo(c, [{ video: 'a', rechteck: rect(0, 0, 100, 50) }]), 'a');
  assert.equal(
    waehleSpiegelVideo(c, [
      { video: 'a', rechteck: rect(0, 0, 100, 60) },
      { video: 'b', rechteck: rect(0, 0, 100, 90) },
      { video: 'c', rechteck: rect(0, 0, 100, 90) },
    ]),
    'b',
  );
  assert.equal(waehleSpiegelVideo(c, []), null);
});

test('Auswahl: eine Leinwand ohne Flaeche bleibt Spiegel des ersten Videos im Behaelter', () => {
  const leer = rect(0, 0, 0, 0);
  assert.equal(waehleSpiegelVideo(leer, [{ video: 'a', rechteck: rect(500, 500, 10, 10) }, { video: 'b', rechteck: rect(0, 0, 9, 9) }]), 'a');
  assert.equal(waehleSpiegelVideo(leer, []), null);
});

test('Suche: Video im Grosselternelement (TikTok: Leinwand in x-sr-wrap neben dem Video)', () => {
  const { body } = seite();
  const karte = body.haenge(knoten('div'));
  const video = karte.haenge(knoten('video', { rechteck: rect(0, 0, 270, 480) }));
  const huelle = karte.haenge(knoten('x-sr-wrap'));
  const leinwand = huelle.haenge(knoten('canvas', { rechteck: rect(0, 0, 270, 480) }));
  const leer = huelle.haenge(knoten('canvas', { rechteck: rect(0, 0, 0, 0) }));
  assert.equal(sucheVideo(leinwand), video);
  assert.equal(sucheVideo(leer), video, 'zweite, leere Leinwand im selben Behaelter');
});

test('Suche: Video im Elternelement; Leinwand ohne Video im Behaelter ist kein Spiegel', () => {
  const { body } = seite();
  const a = body.haenge(knoten('div'));
  const video = a.haenge(knoten('video', { rechteck: rect(0, 0, 100, 100) }));
  const nah = a.haenge(knoten('canvas', { rechteck: rect(0, 0, 100, 100) }));
  assert.equal(sucheVideo(nah), video);
  const b = body.haenge(knoten('div'));
  // Weit weg vom Video (das Grosselternelement body enthaelt es zwar, die Rechtecke ueberdecken sich aber nicht).
  const allein = b.haenge(knoten('canvas', { rechteck: rect(0, 300, 100, 100) }));
  const ring = b.haenge(knoten('div')).haenge(knoten('canvas', { rechteck: rect(0, 300, 64, 64) }));
  assert.equal(sucheVideo(allein), null);
  assert.equal(sucheVideo(ring), null);
});

test('Suche: weniger als die Haelfte Ueberdeckung ist kein Spiegel; ein fernes Video (Urgrosselternebene) zaehlt nicht', () => {
  const { body } = seite();
  const a = body.haenge(knoten('div'));
  a.haenge(knoten('video', { rechteck: rect(0, 0, 100, 100) }));
  const c = a.haenge(knoten('canvas', { rechteck: rect(60, 0, 100, 100) }));
  assert.equal(sucheVideo(c), null);
  const w1 = body.haenge(knoten('div'));
  w1.haenge(knoten('video', { rechteck: rect(0, 0, 100, 100) }));
  const tief = w1.haenge(knoten('div')).haenge(knoten('div')).haenge(knoten('div')).haenge(knoten('canvas', { rechteck: rect(0, 0, 100, 100) }));
  assert.equal(sucheVideo(tief), null, 'Video nicht in Eltern oder Grosseltern');
});

test('Suche: mehrere Videos, die groesste Ueberdeckung gewinnt', () => {
  const { body } = seite();
  const feed = body.haenge(knoten('div'));
  const v1 = feed.haenge(knoten('video', { rechteck: rect(0, 0, 100, 100) }));
  const v2 = feed.haenge(knoten('video', { rechteck: rect(0, 120, 100, 100) }));
  const huelle = feed.haenge(knoten('div'));
  const c = huelle.haenge(knoten('canvas', { rechteck: rect(0, 110, 100, 100) }));
  assert.equal(sucheVideo(c), v2);
  const c1 = huelle.haenge(knoten('canvas', { rechteck: rect(0, 10, 100, 100) }));
  assert.equal(sucheVideo(c1), v1);
});

test('Suche in einer Shadow Root: Leinwand direkt in der Wurzel, Video in derselben Wurzel', () => {
  const { body } = seite();
  const wirt = body.haenge(knoten('div'));
  const wurzel = knoten('#shadow', { nodeType: 11 });
  wurzel.parentNode = null; // die Wurzel hat keinen Elternknoten
  const video = wurzel.haenge(knoten('video', { rechteck: rect(0, 0, 50, 50) }));
  const c = wurzel.haenge(knoten('canvas', { rechteck: rect(0, 0, 50, 50) }));
  assert.equal(sucheVideo(c), video);
  void wirt;
});

test('Nachbarn: Leinwaende, in deren Behaelter das Video steckt', () => {
  const { body } = seite();
  const karte = body.haenge(knoten('div'));
  const video = karte.haenge(knoten('video'));
  const c1 = karte.haenge(knoten('x-sr-wrap')).haenge(knoten('canvas'));
  const fremd = body.haenge(knoten('div')).haenge(knoten('div')).haenge(knoten('canvas'));
  const liste = sammleLeinwaende(video);
  assert.ok(liste.includes(c1));
  assert.ok(!liste.includes(fremd));
});

test('Behaelter: body, html und das Dokument sind nie Behaelter (S7)', () => {
  const { body } = seite();
  // Video und Leinwand in verschiedenen Zweigen unter body: das Grosselternelement der Leinwand waere body, das gilt nicht.
  const a = body.haenge(knoten('div'));
  a.haenge(knoten('video', { rechteck: rect(0, 0, 100, 100) }));
  const b = body.haenge(knoten('div'));
  const c = b.haenge(knoten('div')).haenge(knoten('canvas', { rechteck: rect(0, 0, 100, 100) }));
  assert.equal(sucheVideo(c), null);
  // Leinwand direkt in body: kein Behaelter.
  const direkt = body.haenge(knoten('canvas', { rechteck: rect(0, 0, 100, 100) }));
  assert.equal(sucheVideo(direkt), null);
  // Video direkt in body: kein Vorfahr, unter dem nach Leinwaenden gesucht wird.
  const v = body.haenge(knoten('video'));
  assert.deepEqual(sammleLeinwaende(v), []);
  // Leinwand in einem div unter body: der Behaelter ist das div selbst (nicht body).
  const huelle = body.haenge(knoten('div'));
  const video = huelle.haenge(knoten('video', { rechteck: rect(0, 0, 100, 100) }));
  const ok = huelle.haenge(knoten('canvas', { rechteck: rect(0, 0, 100, 100) }));
  assert.equal(sucheVideo(ok), video);
});

test('Kandidaten: nur Videos mit Eigengroesse ab 32 px; unbekannte Masse zaehlen vorerst (S7)', () => {
  const v = (readyState, w, h) => ({ readyState, videoWidth: w, videoHeight: h });
  assert.equal(istVideoKandidat(v(0, 0, 0)), true, 'Masse noch unbekannt');
  assert.equal(istVideoKandidat(v(4, 0, 0)), false, 'nur Ton');
  assert.equal(istVideoKandidat(v(4, 16, 16)), false, 'unter 32 px');
  assert.equal(istVideoKandidat(v(4, 640, 16)), true, 'eine Seite ab 32 px');
  assert.equal(istVideoKandidat(v(4, 864, 1536)), true);
  const { body } = seite();
  const karte = body.haenge(knoten('div'));
  const ton = karte.haenge(knoten('video', { rechteck: rect(0, 0, 100, 100) }));
  ton.readyState = 4;
  ton.videoWidth = 0;
  ton.videoHeight = 0;
  const c = karte.haenge(knoten('canvas', { rechteck: rect(0, 0, 100, 100) }));
  assert.equal(sucheVideo(c), null, 'Video nur mit Ton bindet nicht');
  const leer = karte.haenge(knoten('canvas', { rechteck: rect(0, 0, 0, 0) }));
  assert.equal(sucheVideo(leer), null, 'auch nicht fuer eine Leinwand ohne Flaeche');
});

// ---------- Spiegel mit Attrappen-Haken ----------

function aufbau(opt = {}) {
  const { body } = seite();
  const karte = body.haenge(knoten('div'));
  const video = karte.haenge(knoten('video', { rechteck: rect(0, 0, 100, 100) }));
  const c = karte.haenge(knoten('x-sr-wrap')).haenge(knoten('canvas', { rechteck: rect(0, 0, 100, 100) }));
  const zv = { art: 'video', urteil: null, eingereiht: false, videoEcht: true };
  const zc = { art: 'canvas', urteil: null, eingereiht: false, generation: 0 };
  const zustaende = new Map([[video, zv], [c, zc]]);
  const protokoll = [];
  const uhr = { t: 10_000, letzteFreigabe: Number.NEGATIVE_INFINITY, zeitgeber: [] };
  let suchen = 0;
  const haken = {
    zustand: (el) => zustaende.get(el),
    angezeigt: (_el, z) => z.urteil,
    setze: (cc, z, u) => {
      z.urteil = u;
      z.generation++;
      z.eingereiht = false;
      protokoll.push(['setze', u]);
    },
    vergiss: (cc, z) => {
      z.urteil = null;
      z.eingereiht = false;
      z.generation++;
      protokoll.push(['vergiss']);
    },
    bewerte: () => protokoll.push(['bewerte']),
    aktiv: () => true,
    jetzt: () => uhr.t,
    timer: (fn, ms) => {
      const eintrag = { fn, ms, an: uhr.t, aktiv: true };
      uhr.zeitgeber.push(eintrag);
      return () => {
        eintrag.aktiv = false;
      };
    },
    letzteFreigabe: () => uhr.letzteFreigabe,
    merkeFreigabe: (t) => {
      uhr.letzteFreigabe = Math.max(uhr.letzteFreigabe, t);
      protokoll.push(['merke']);
    },
    gebunden: () => protokoll.push(['gebunden']),
    ...(opt.zaehleSuche
      ? {
          suche: (leinwand) => {
            suchen++;
            return sucheVideo(leinwand);
          },
        }
      : {}),
  };
  const spiegel = new Spiegel(haken, { wechselMinMs: 1000, blitzSperreMs: 334, aufraeumMs: 3000 });
  // Lässt die Scheinuhr vorgehen und feuert die faelligen Zeitgeber.
  const vor = (ms) => {
    uhr.t += ms;
    for (const e of uhr.zeitgeber.filter((x) => x.aktiv && x.an + x.ms <= uhr.t)) {
      e.aktiv = false;
      e.fn();
    }
  };
  return { body, karte, video, c, zv, zc, zustaende, protokoll, spiegel, uhr, vor, suchen: () => suchen };
}

const namen = (protokoll) => protokoll.map((p) => p[0]).filter((n) => n !== 'gebunden');

test('Spiegel: ohne Urteil des Videos bleibt die Leinwand ohne Urteil, dann folgt sie frei und verdeckt', () => {
  const { video, c, zv, zc, protokoll, spiegel } = aufbau();
  assert.equal(spiegel.ordne(c, zc), true);
  assert.equal(zc.urteil, null);
  assert.equal(spiegel.istSpiegel(c), true);
  zv.urteil = 'frei';
  spiegel.beiVideoUrteil(video);
  assert.equal(zc.urteil, 'frei');
  zv.urteil = 'verdeckt';
  spiegel.angleichen(video);
  assert.equal(zc.urteil, 'verdeckt');
  // Quellenwechsel, Zuruecksetzen: das Video hat kein Urteil mehr, die Leinwand wird mit zurueckgesetzt
  zv.urteil = null;
  spiegel.angleichen(video);
  assert.equal(zc.urteil, null);
  assert.deepEqual(namen(protokoll), ['setze', 'setze', 'vergiss']);
});

test('Spiegel: ordnet sich einem schon beurteilten Video zu (Leinwand kommt spaeter), Freigabe ueber die Bremse', () => {
  const { c, zv, zc, spiegel, uhr, vor } = aufbau();
  zv.urteil = 'verdeckt';
  assert.equal(spiegel.ordne(c, zc), true);
  assert.equal(zc.urteil, 'verdeckt', 'Verdecken wartet nie');
  zv.urteil = 'frei';
  uhr.letzteFreigabe = uhr.t - 100; // eine Freigabe im Dokument vor 100 ms
  assert.equal(spiegel.ordne(c, zc), true);
  assert.equal(zc.urteil, 'verdeckt', 'Freigabe ausserhalb eines Video-Wechsels wartet');
  vor(900);
  assert.equal(zc.urteil, 'verdeckt', 'die Leinwand wechselte vor 900 ms: 1000 ms sind noch nicht um');
  vor(200);
  assert.equal(zc.urteil, 'frei');
});

test('Spiegel: Freigabe nach einem Wechsel erst nach 1000 ms (Bremse je Leinwand), Verdecken sofort, Video-Wechsel ohne Bremse', () => {
  const { video, c, zv, zc, spiegel, uhr, vor, protokoll } = aufbau();
  zv.urteil = 'frei';
  spiegel.beiVideoUrteil(video); // Video-Wechsel: sofort
  spiegel.ordne(c, zc);
  assert.equal(zc.urteil, 'frei');
  zv.urteil = 'verdeckt';
  spiegel.angleichen(video);
  assert.equal(zc.urteil, 'verdeckt');
  // Das Video wird frei (ausserhalb eines Wechsels gesehen, zum Beispiel beim Wiederfinden): die Leinwand wartet 1000 ms nach ihrem letzten Wechsel.
  zv.urteil = 'frei';
  vor(400);
  spiegel.ordne(c, zc);
  assert.equal(zc.urteil, 'verdeckt');
  vor(500);
  assert.equal(zc.urteil, 'verdeckt', '900 ms nach dem Wechsel');
  vor(200);
  assert.equal(zc.urteil, 'frei', 'nach 1000 ms');
  assert.ok(protokoll.some((p) => p[0] === 'merke'), 'die Freigabe zaehlt fuer die Dokument-Sperre');
  assert.ok(uhr.letzteFreigabe > 0);
});

test('Spiegel: eine wartende Freigabe verfaellt, wenn das Video inzwischen verdeckt', () => {
  const { c, zv, zc, spiegel, vor, video } = aufbau();
  zv.urteil = 'verdeckt';
  spiegel.ordne(c, zc);
  zv.urteil = 'frei';
  vor(10);
  spiegel.ordne(c, zc); // Freigabe wartet (Wechsel vor 10 ms)
  assert.equal(zc.urteil, 'verdeckt');
  zv.urteil = 'verdeckt';
  spiegel.angleichen(video);
  zv.urteil = 'frei';
  vor(2000);
  assert.equal(zc.urteil, 'verdeckt', 'der Zeitgeber der alten Freigabe wurde abgebrochen und ein neuer Abgleich geschah nicht');
});

test('Spiegel: "frei" nur bei echter Pruefung des Videos; sonst bleibt die Leinwand verdeckt (S7)', () => {
  const { video, c, zv, zc, spiegel } = aufbau();
  zv.urteil = 'frei';
  zv.videoEcht = false; // zum Beispiel nur Ton oder Fehlerfall
  assert.equal(spiegel.ziel(video), 'verdeckt');
  spiegel.ordne(c, zc);
  assert.equal(zc.urteil, 'verdeckt');
  zv.videoEcht = true;
  spiegel.beiVideoUrteil(video);
  assert.equal(zc.urteil, 'frei');
});

test('Spiegel: leere Leinwand (0 x 0) im selben Behaelter folgt dem Video; mit Flaeche gilt die 50-Prozent-Regel bei jedem Abgleich neu (S7)', () => {
  const { karte, video, zv, zustaende, spiegel } = aufbau();
  const leer = karte.haenge(knoten('x-sr-wrap')).haenge(knoten('canvas', { rechteck: rect(0, 0, 0, 0) }));
  const zl = { art: 'canvas', urteil: null, eingereiht: false, generation: 0 };
  zustaende.set(leer, zl);
  assert.equal(spiegel.ordne(leer, zl), true);
  assert.equal(spiegel.videoVon(leer), video);
  zv.urteil = 'frei';
  spiegel.beiVideoUrteil(video);
  assert.equal(zl.urteil, 'frei');
  // Die Leinwand bekommt Flaeche, aber ausserhalb des Videos: die Beziehung faellt beim naechsten Abgleich weg.
  leer.rechteck = rect(500, 500, 100, 100);
  spiegel.pruefeNachbarn(video);
  assert.equal(spiegel.istSpiegel(leer), false);
  assert.equal(zl.urteil, null, 'wie jede Leinwand neu beginnen');
  assert.equal(spiegel.warSpiegel(leer), true);
  // Deckt das Video sie wieder, ist sie wieder Spiegel.
  leer.rechteck = rect(0, 0, 100, 100);
  spiegel.pruefeNachbarn(video);
  assert.equal(spiegel.istSpiegel(leer), true);
});

test('Spiegel: mehrere Videos, jede Leinwand folgt ihrem eigenen', () => {
  const { body, spiegel, zustaende } = aufbau();
  const feed = body.haenge(knoten('div'));
  const v1 = feed.haenge(knoten('video', { rechteck: rect(0, 0, 100, 100) }));
  const v2 = feed.haenge(knoten('video', { rechteck: rect(0, 200, 100, 100) }));
  const c1 = feed.haenge(knoten('div')).haenge(knoten('canvas', { rechteck: rect(0, 0, 100, 100) }));
  const c2 = feed.haenge(knoten('div')).haenge(knoten('canvas', { rechteck: rect(0, 200, 100, 100) }));
  const z1 = { art: 'video', urteil: null, eingereiht: false, videoEcht: true };
  const z2 = { art: 'video', urteil: null, eingereiht: false, videoEcht: true };
  const zc1 = { art: 'canvas', urteil: null, eingereiht: false, generation: 0 };
  const zc2 = { art: 'canvas', urteil: null, eingereiht: false, generation: 0 };
  for (const [k, z] of [[v1, z1], [v2, z2], [c1, zc1], [c2, zc2]]) zustaende.set(k, z);
  assert.equal(spiegel.ordne(c1, zc1), true);
  assert.equal(spiegel.ordne(c2, zc2), true);
  assert.equal(spiegel.videoVon(c1), v1);
  assert.equal(spiegel.videoVon(c2), v2);
  z1.urteil = 'frei';
  z2.urteil = 'verdeckt';
  spiegel.angleichen(v1);
  spiegel.angleichen(v2);
  assert.equal(zc1.urteil, 'frei');
  assert.equal(zc2.urteil, 'verdeckt');
  z2.urteil = null;
  spiegel.angleichen(v2);
  assert.equal(zc1.urteil, 'frei');
  assert.equal(zc2.urteil, null);
});

test('Spiegel: eine Leinwand mit eigenem Urteil beginnt als Spiegel neu (Nachbar-Pruefung beim Urteil des Videos)', () => {
  const { video, c, zv, zc, spiegel, protokoll } = aufbau();
  zc.urteil = 'frei'; // zuvor als gewoehnliche Leinwand freigegeben
  zv.urteil = 'verdeckt';
  spiegel.beiVideoUrteil(video);
  assert.equal(spiegel.videoVon(c), video);
  assert.equal(zc.urteil, 'verdeckt');
  assert.deepEqual(namen(protokoll), ['vergiss', 'setze']);
});

test('Spiegel: beim Entdecken des Videos (auch ohne Urteil) wird eine Leinwand mit Urteil neu zugeordnet und beginnt ohne Urteil (S7)', () => {
  const { video, c, zc, spiegel } = aufbau();
  zc.urteil = 'frei';
  spiegel.beiVideoEntdeckt(video);
  assert.equal(spiegel.videoVon(c), video);
  assert.equal(zc.urteil, null, 'das Video hat kein Urteil: verborgen');
});

test('Spiegel: Urteil aus der Warteschlange: die Leinwand ist inzwischen Spiegel, ordne verwirft den Platz und die Generation steigt (S7)', () => {
  const { c, zv, zc, spiegel } = aufbau();
  zc.eingereiht = true;
  const generation = zc.generation;
  zv.urteil = 'verdeckt';
  assert.equal(spiegel.ordne(c, zc), true);
  assert.equal(zc.eingereiht, false);
  assert.ok(zc.generation > generation, 'eine spaete Antwort der Schlange gilt nicht mehr');
  assert.equal(zc.urteil, 'verdeckt');
});

test('Spiegel: Video entfernt: die Bindung bleibt, erst das verzoegerte Aufraeumen loest sie (S7)', () => {
  const { video, c, zv, zc, spiegel, protokoll, uhr, vor } = aufbau();
  zv.urteil = 'frei';
  spiegel.ordne(c, zc);
  assert.equal(zc.urteil, 'frei');
  video.isConnected = false;
  // Abgleich in der Zwischenzeit (Entdecken der Leinwand, Takt): die Bindung bleibt, die Anzeige auch.
  assert.equal(spiegel.ordne(c, zc), true);
  assert.equal(spiegel.istSpiegel(c), true);
  assert.equal(zc.urteil, 'frei');
  // Erster Aufraeumdurchlauf: das Video ist neu getrennt, es bleibt offen.
  assert.equal(spiegel.raeumeAuf(), 1);
  assert.equal(spiegel.istSpiegel(c), true);
  vor(1000);
  assert.equal(spiegel.raeumeAuf(), 1, 'erst 1 s getrennt');
  vor(2000);
  assert.equal(spiegel.raeumeAuf(), 0);
  assert.equal(spiegel.istSpiegel(c), false);
  assert.equal(spiegel.warSpiegel(c), true);
  assert.equal(zc.urteil, null);
  assert.deepEqual(namen(protokoll), ['setze', 'merke', 'vergiss', 'bewerte']);
  void uhr;
});

test('Spiegel: kehrt das Video vor dem Aufraeumen zurueck, bleibt alles wie es war', () => {
  const { video, c, zv, zc, spiegel, vor } = aufbau();
  zv.urteil = 'frei';
  spiegel.ordne(c, zc);
  video.isConnected = false;
  spiegel.raeumeAuf();
  vor(500);
  video.isConnected = true;
  spiegel.beiVideoEntdeckt(video);
  assert.equal(spiegel.istSpiegel(c), true);
  assert.equal(zc.urteil, 'frei');
  vor(5000);
  assert.equal(spiegel.raeumeAuf(), 0);
  assert.equal(spiegel.istSpiegel(c), true);
});

test('Spiegel: ist die Leinwand selbst getrennt, bleibt die Bindung; angleichen und Aufraeumen lassen sie in Ruhe (S7)', () => {
  const { video, c, zv, zc, spiegel, vor, protokoll } = aufbau();
  zv.urteil = 'frei';
  spiegel.ordne(c, zc);
  c.isConnected = false;
  video.isConnected = false;
  zv.urteil = 'verdeckt';
  const vorher = protokoll.length;
  spiegel.angleichen(video);
  assert.equal(zc.urteil, 'frei', 'getrennte Leinwand wird nicht angeglichen');
  vor(10_000);
  assert.equal(spiegel.raeumeAuf(), 0);
  assert.equal(spiegel.istSpiegel(c), true);
  assert.equal(protokoll.length, vorher);
  // Beide kehren zurueck: der Abgleich beim Entdecken holt die Anzeige nach.
  c.isConnected = true;
  video.isConnected = true;
  assert.equal(spiegel.ordne(c, zc), true);
  assert.equal(zc.urteil, 'verdeckt');
});

test('Spiegel: ein anderes Video uebernimmt (Seite tauscht das Video aus): sofort neu zugeordnet, verborgen bis zu seinem Urteil', () => {
  const { karte, video, c, zv, zc, zustaende, spiegel } = aufbau();
  zv.urteil = 'frei';
  spiegel.ordne(c, zc);
  assert.equal(zc.urteil, 'frei');
  video.isConnected = false;
  karte.kinder.splice(karte.kinder.indexOf(video), 1);
  const neu = karte.haenge(knoten('video', { rechteck: rect(0, 0, 100, 100) }));
  const zn = { art: 'video', urteil: null, eingereiht: false, videoEcht: true };
  zustaende.set(neu, zn);
  spiegel.beiVideoEntdeckt(neu);
  assert.equal(spiegel.videoVon(c), neu);
  assert.equal(zc.urteil, null);
  zn.urteil = 'verdeckt';
  spiegel.beiVideoUrteil(neu);
  assert.equal(zc.urteil, 'verdeckt');
});

test('Spiegel: faellt das Spiegelvideo bei der Neubewertung weg (verschoben, noch im Dokument), wird die Beziehung geloest', () => {
  const { karte, video, c, zv, zc, spiegel } = aufbau();
  zv.urteil = 'frei';
  spiegel.ordne(c, zc);
  assert.equal(zc.urteil, 'frei');
  karte.kinder.splice(karte.kinder.indexOf(video), 1); // Video aus dem Behaelter genommen, bleibt aber im Dokument
  assert.equal(spiegel.ordne(c, zc), false);
  assert.equal(spiegel.istSpiegel(c), false);
  assert.equal(zc.urteil, null);
  assert.equal(spiegel.warSpiegel(c), true);
});

test('Spiegel: ordne ohne Video und ohne frueheren Spiegel fasst die Leinwand nicht an', () => {
  const { body, spiegel, zustaende, protokoll } = aufbau();
  const a = body.haenge(knoten('div'));
  const allein = a.haenge(knoten('canvas', { rechteck: rect(0, 0, 50, 50) }));
  const z = { art: 'canvas', urteil: 'frei', eingereiht: false, generation: 0 };
  zustaende.set(allein, z);
  assert.equal(spiegel.ordne(allein, z), false);
  assert.equal(z.urteil, 'frei');
  assert.equal(spiegel.warSpiegel(allein), false);
  assert.deepEqual(protokoll, []);
});

test('Spiegel: pruefeNachbarn misst jede Leinwand genau einmal (kein doppelter Abgleich beim Erst-Urteil, S7)', () => {
  const { video, c, zv, spiegel, suchen } = aufbau({ zaehleSuche: true });
  spiegel.ordne(c, { art: 'canvas', urteil: null, eingereiht: false, generation: 0 });
  const vorher = suchen();
  zv.urteil = 'frei';
  spiegel.beiVideoUrteil(video);
  assert.equal(suchen() - vorher, 1);
});

test('Spiegel: angleichen misst nicht (das Layout wurde vor dem Wechsel abgeglichen)', () => {
  const { video, c, zv, zc, spiegel, suchen } = aufbau({ zaehleSuche: true });
  spiegel.ordne(c, zc);
  const vorher = suchen();
  zv.urteil = 'frei';
  spiegel.angleichen(video);
  assert.equal(suchen() - vorher, 0);
  assert.equal(zc.urteil, 'frei');
});

test('Spiegel: Bindung meldet sich beim Haken (Zeitgeber und Schlange der Leinwand entfallen)', () => {
  const { c, zc, spiegel, protokoll } = aufbau();
  spiegel.ordne(c, zc);
  assert.ok(protokoll.some((p) => p[0] === 'gebunden'));
});

test('Spiegel: faellt die Beziehung beim Abgleich der Nachbarn weg (Video nur mit Ton), wird die Leinwand wie jede Leinwand bewertet (S7)', () => {
  const { video, c, zv, zc, spiegel, protokoll } = aufbau();
  video.readyState = 0; // Masse noch unbekannt: Kandidat
  spiegel.ordne(c, zc);
  assert.equal(spiegel.istSpiegel(c), true);
  video.readyState = 4;
  video.videoWidth = 0;
  video.videoHeight = 0;
  zv.urteil = 'frei';
  spiegel.beiVideoUrteil(video);
  assert.equal(spiegel.istSpiegel(c), false);
  assert.equal(zc.urteil, null);
  assert.equal(namen(protokoll).at(-1), 'bewerte');
});
