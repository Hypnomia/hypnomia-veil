// Einheitstests Auftrag E (PHASE-4-BAUPLAN Abschnitt 8): Adapter-Auswahl, Vorschau-Entscheidung, Zaehlung am Inhalt, Zwischenspeicher der
// Vorschau-Bilder. Reine Logik, ohne Browser; Elemente werden durch Attrappen ersetzt.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adapterFuer, istHoverVideo, istVideoLink, istVorschau, registrierbareDomain, VORSCHAU_MIN_KANTE } from '../../src/adapter/index.ts';
import { SEITEN_NAMEN } from '../../src/adapter/liste.ts';
import { INHALT_MAX_SCHLUESSEL, INHALT_MIN_BILDER, InhaltsZaehler, inhaltAusTreffern, zaehltFuerInhalt } from '../../src/adapter/inhalt.ts';
import { beiErwachsenStatus, erwachsenStatus, istErwachsenFuerQuiz, setzeErwachsenStatus } from '../../src/adapter/status.ts';
import { NachtauschMerker, VorschauSpeicher } from '../../src/schleier/vorschau-speicher.ts';

// Attrappe: Element mit Tag, Attributen und Vorfahren-Kette. Ein Selektor trifft, wenn er in `trifft` steht (genaue Zeichenkette).
function el({ trifft = [], vorfahren = [] } = {}) {
  return {
    matches: (s) => trifft.includes(s),
    closest: (s) => vorfahren.find((v) => v.selektor === s)?.knoten ?? null,
  };
}
const link = (href) => ({ getAttribute: (n) => (n === 'href' ? href : null) });

test('Adapter: jeder Seitenname hat einen Adapter mit eigenem Namen, unbekannte fallen auf allgemein', () => {
  for (const n of SEITEN_NAMEN) assert.equal(adapterFuer(n).name, n);
  assert.equal(adapterFuer(null).name, 'allgemein');
  assert.equal(adapterFuer(undefined).name, 'allgemein');
  assert.equal(adapterFuer('gibt-es-nicht').name, 'allgemein');
});

test('Adapter: XVideos und XNXX teilen den Aufbau', () => {
  const a = adapterFuer('xvideos');
  const b = adapterFuer('xnxx');
  assert.deepEqual(a.vorschauLinks, b.vorschauLinks);
  assert.deepEqual(a.hoverVideos, b.hoverVideos);
});

test('Adapter: alle Selektoren sind Texte, die Listen sind nicht leer (ausser Bilder beim Rueckfall)', () => {
  for (const n of SEITEN_NAMEN) {
    const a = adapterFuer(n);
    assert.ok(a.vorschauLinks.length > 0, n);
    for (const s of [...a.vorschauLinks, ...a.vorschauBilder, ...a.hoverVideos]) assert.equal(typeof s, 'string');
  }
});

test('Vorschau: Bild im Link zu einer Videoseite zaehlt, Bild im Link zur Startseite oder ohne Link nicht', () => {
  const a = adapterFuer('pornhub');
  assert.equal(istVorschau(el({ vorfahren: [{ selektor: 'a[href*="/view_video.php"]', knoten: link('/view_video.php?viewkey=x') }] }), a), true);
  assert.equal(istVorschau(el(), a), false);
  const allg = adapterFuer('allgemein');
  assert.equal(istVorschau(el({ vorfahren: [{ selektor: 'a[href]', knoten: link('/') }] }), allg), false);
  assert.equal(istVorschau(el({ vorfahren: [{ selektor: 'a[href]', knoten: link('#') }] }), allg), false);
  assert.equal(istVorschau(el({ vorfahren: [{ selektor: 'a[href]', knoten: link('javascript:void(0)') }] }), allg), false);
  assert.equal(istVorschau(el({ vorfahren: [{ selektor: 'a[href]', knoten: link('/video/12') }] }), allg), true);
});

test('Vorschau: Bild-Selektor des Adapters trifft auch ausserhalb von Links', () => {
  const a = adapterFuer('onlyfans');
  assert.equal(istVorschau(el({ trifft: ['[class*="b-post__media"] img'] }), a), true);
});

test('Vorschau: ein Selektor, den der Browser nicht versteht, legt die anderen nicht lahm', () => {
  const a = { name: 'allgemein', vorschauLinks: ['a[href]'], vorschauBilder: ['!!kaputt'], hoverVideos: [] };
  const e = {
    matches: (s) => {
      if (s === '!!kaputt') throw new SyntaxError('ungueltig');
      return false;
    },
    closest: (s) => (s === 'a[href]' ? link('/video/1') : null),
  };
  assert.equal(istVorschau(e, a), true);
});

test('OnlyFans und Fansly: nur Beitragsmedien, keine Links und keine ganzen Karten', () => {
  for (const n of ['onlyfans', 'fansly']) {
    const a = adapterFuer(n);
    assert.ok(!a.vorschauLinks.some((x) => x.startsWith('a[')), `${n}: kein allgemeiner Link`);
    assert.equal(istVorschau(el(), a), false); // Avatar in einem Profil-Link
  }
  assert.equal(istVorschau(el({ vorfahren: [{ selektor: '[class*="b-post__media"]', knoten: link(null) }] }), adapterFuer('onlyfans')), true);
});

test('Hover-Video: nur Videos, die der Adapter nennt', () => {
  const a = adapterFuer('xhamster');
  assert.equal(istHoverVideo(el({ trifft: ['a[href*="/videos/"] video'] }), a), true);
  assert.equal(istHoverVideo(el(), a), false);
});

test('Links: Startseite, Anker, Skript und leer fuehren nicht zu einer Videoseite', () => {
  for (const h of ['', '/', '#', '#oben', 'javascript:void(0)', 'mailto:a@b.c', '  /  ']) assert.equal(istVideoLink(h), false, h);
  for (const h of ['/video/1', 'https://example.test/v/2', null]) assert.equal(istVideoLink(h), true, String(h));
  assert.equal(VORSCHAU_MIN_KANTE, 80);
});

test('Zaehlung am Inhalt: erst ab 12 Bildern, dann mindestens 50 Prozent Treffer', () => {
  const z = new InhaltsZaehler();
  for (let i = 0; i < 11; i++) assert.equal(z.zaehle(`b${i}`, 'treffer'), false, `Bild ${i}`);
  assert.equal(z.amInhalt, false); // 11 Bilder, alle Treffer: noch zu wenige
  assert.equal(z.zaehle('b11', 'treffer'), true);
  assert.equal(z.amInhalt, true);
  assert.equal(INHALT_MIN_BILDER, 12);
});

test('Zaehlung am Inhalt: genau 50 Prozent reichen, 49 Prozent nicht', () => {
  const genau = new InhaltsZaehler();
  for (let i = 0; i < 6; i++) genau.zaehle(`t${i}`, 'treffer');
  for (let i = 0; i < 6; i++) genau.zaehle(`f${i}`, 'frei');
  assert.equal(genau.amInhalt, true); // 6 von 12
  const knapp = new InhaltsZaehler();
  for (let i = 0; i < 5; i++) knapp.zaehle(`t${i}`, 'treffer');
  for (let i = 0; i < 8; i++) knapp.zaehle(`f${i}`, 'frei');
  assert.equal(knapp.amInhalt, false); // 5 von 13
  knapp.zaehle('t5', 'treffer'); // 6 von 14: 42 %
  assert.equal(knapp.amInhalt, false);
});

test('Zaehlung am Inhalt: jedes Bild zaehlt einmal, leere Schluessel nie', () => {
  const z = new InhaltsZaehler();
  for (let i = 0; i < 30; i++) z.zaehle('immer-dasselbe', 'treffer');
  z.zaehle('', 'treffer');
  assert.deepEqual(z.stand, { gesamt: 1, treffer: 1 });
  assert.equal(z.amInhalt, false);
});

test('Zaehlung am Inhalt: Treffer kommen auch spaet, sobald der Anteil stimmt; erkannt bleibt bis zum Neustart', () => {
  const z = new InhaltsZaehler();
  for (let i = 0; i < 12; i++) z.zaehle(`f${i}`, 'frei');
  assert.equal(z.amInhalt, false);
  let erkannt = false;
  for (let i = 0; i < 12 && !erkannt; i++) erkannt = z.zaehle(`t${i}`, 'treffer');
  assert.equal(z.amInhalt, true);
  assert.deepEqual(z.stand, { gesamt: 24, treffer: 12 });
  z.zaehle('noch-ein-freies', 'frei');
  assert.equal(z.amInhalt, true);
  z.neuStart();
  assert.equal(z.amInhalt, false);
  assert.deepEqual(z.stand, { gesamt: 0, treffer: 0 });
});

test('Zaehlung am Inhalt: Obergrenze der gemerkten Bilder, danach zaehlt nichts Neues', () => {
  const z = new InhaltsZaehler();
  for (let i = 0; i < INHALT_MAX_SCHLUESSEL; i++) z.zaehle(`f${i}`, 'frei');
  assert.equal(z.stand.gesamt, INHALT_MAX_SCHLUESSEL);
  z.zaehle('zu-viel', 'treffer');
  assert.equal(z.stand.gesamt, INHALT_MAX_SCHLUESSEL);
});

test('Status: Aenderungen werden gemeldet, gleiche Werte nicht; Quiz-Frage gilt fuer Liste und Inhalt', () => {
  const gemeldet = [];
  const ab = beiErwachsenStatus((s) => gemeldet.push(s));
  setzeErwachsenStatus({ liste: null, amInhalt: false });
  assert.equal(istErwachsenFuerQuiz(), false);
  setzeErwachsenStatus({ liste: 'pornhub', amInhalt: false });
  setzeErwachsenStatus({ liste: 'pornhub', amInhalt: false });
  assert.equal(istErwachsenFuerQuiz(), true);
  setzeErwachsenStatus({ liste: null, amInhalt: true });
  assert.equal(istErwachsenFuerQuiz(), true);
  assert.deepEqual(erwachsenStatus(), { liste: null, amInhalt: true });
  assert.equal(gemeldet.length, 2);
  ab();
  setzeErwachsenStatus({ liste: null, amInhalt: false });
  assert.equal(gemeldet.length, 2);
});

function antwort(name, laenge = 10) {
  return { ok: true, dataUrl: `data:image/jpeg;base64,${'A'.repeat(laenge)}`, breite: 480, hoehe: 270, name };
}

test('Zwischenspeicher: gleiche Quelle gleichzeitig = ein Abruf, danach sofort', async () => {
  let abrufe = 0;
  const s = new VorschauSpeicher(async (k) => {
    abrufe++;
    return antwort(`bild-${k.length % 2}`);
  });
  const [a, b] = await Promise.all([s.hole('quelle-1'), s.hole('quelle-1')]);
  assert.equal(abrufe, 1);
  assert.equal(a, b);
  assert.equal(s.sofort('quelle-1'), a);
  await s.hole('quelle-1');
  assert.equal(abrufe, 1);
  assert.equal(s.sofort('unbekannt'), null);
});

test('Zwischenspeicher: viele Quellen teilen sich ein Bild, die Data-URL liegt einmal', async () => {
  const s = new VorschauSpeicher(async () => antwort('nur-eins', 1000));
  for (let i = 0; i < 50; i++) await s.hole(`q${i}`);
  assert.equal(s.anzahlBilder, 1);
  assert.equal(s.anzahlBytes, antwort('x', 1000).dataUrl.length);
  assert.equal(s.abrufe, 50);
});

test('Zwischenspeicher: Grenze fuer Bilder, aeltestes fliegt zuerst, seine Quellen werden neu gefragt', async () => {
  let n = 0;
  const s = new VorschauSpeicher(async () => antwort(`bild-${n++}`), { maxBilder: 3, maxBytes: 1e9, maxQuellen: 100 });
  for (let i = 0; i < 5; i++) await s.hole(`q${i}`);
  assert.equal(s.anzahlBilder, 3);
  assert.equal(s.sofort('q0'), null);
  assert.equal(s.sofort('q1'), null);
  assert.notEqual(s.sofort('q4'), null);
});

test('Zwischenspeicher: Grenze fuer Bytes', async () => {
  let n = 0;
  const s = new VorschauSpeicher(async () => antwort(`bild-${n++}`, 400), { maxBilder: 100, maxBytes: 1000, maxQuellen: 100 });
  for (let i = 0; i < 6; i++) await s.hole(`q${i}`);
  assert.ok(s.anzahlBytes <= 1000, `Bytes ${s.anzahlBytes}`);
  assert.ok(s.anzahlBilder <= 2);
});

test('Zwischenspeicher: ok:false ergibt null und wird nicht gemerkt, ein Transportfehler wirft', async () => {
  let abrufe = 0;
  const s = new VorschauSpeicher(async () => {
    abrufe++;
    if (abrufe === 1) throw new Error('weg');
    if (abrufe === 2) return { ok: false, fehler: 'kein Bild' };
    return antwort('da');
  });
  await assert.rejects(s.hole('q'));
  assert.equal(await s.hole('q'), null);
  assert.equal((await s.hole('q'))?.name, 'da');
  assert.equal(abrufe, 3);
});

test('Zwischenspeicher: nach leere() wird eine vorher angefragte Antwort nicht mehr abgelegt', async () => {
  let freigabe;
  const s = new VorschauSpeicher(() => new Promise((ok) => (freigabe = () => ok(antwort('alt')))));
  const offen = s.hole('q');
  s.leere();
  freigabe();
  assert.equal((await offen)?.name, 'alt'); // der Aufrufer bekommt sie noch ...
  assert.equal(s.sofort('q'), null); // ... gehalten wird sie nicht
  assert.equal(s.anzahlBilder, 0);
});

test('Treffer am Inhalt: nur unbedeckte Brust, Genitalien oder Po zaehlen, unabhaengig von Zonen und Stil', () => {
  assert.equal(inhaltAusTreffern([{ zone: 'breast', bedeckt: false, weiblich: true }]), 'treffer');
  assert.equal(inhaltAusTreffern([{ zone: 'breast', bedeckt: false }]), 'frei'); // Maennerbrust
  assert.equal(inhaltAusTreffern([{ zone: 'genitals', bedeckt: false }]), 'treffer');
  assert.equal(inhaltAusTreffern([{ zone: 'buttocks', bedeckt: false }]), 'treffer');
  assert.equal(inhaltAusTreffern([{ zone: 'breast', bedeckt: true }]), 'frei');
  assert.equal(inhaltAusTreffern([{ zone: 'face', bedeckt: false }, { zone: 'feet', bedeckt: false }]), 'frei');
  assert.equal(inhaltAusTreffern([]), 'frei');
  assert.equal(inhaltAusTreffern(undefined), 'frei');
});

test('Zaehlung am Inhalt: Videos, Leinwaende, Klassen-Hintergruende, Fehler, Warten und Spiegel zaehlen nie', () => {
  for (const art of ['bild', 'hintergrund']) for (const e of ['frei', 'zensiert', 'zensiertHg', 'verdeckt']) assert.equal(zaehltFuerInhalt(art, e), true, `${art} ${e}`);
  for (const art of ['video', 'canvas', 'klasse']) for (const e of ['frei', 'zensiert', 'verdeckt']) assert.equal(zaehltFuerInhalt(art, e), false, `${art} ${e}`);
  for (const e of ['fehler', 'warte', 'spiegel']) assert.equal(zaehltFuerInhalt('bild', e), false, e);
});

test('Zaehlung am Inhalt mit synthetischen Treffern: nur unbedeckte Treffer fuehren zur Erkennung, Ausfaelle nie', () => {
  const z = new InhaltsZaehler();
  for (let i = 0; i < 40; i++) {
    const art = i % 2 === 0 ? 'bild' : 'video';
    const wertung = inhaltAusTreffern([{ zone: 'breast', bedeckt: true, weiblich: true }]);
    if (zaehltFuerInhalt(art, 'verdeckt')) z.zaehle(`b${i}`, wertung);
  }
  // 20 Bilder (die 20 Videos zaehlen nicht), alle nur bedeckt: kein Treffer
  assert.equal(z.amInhalt, false);
  for (let i = 0; i < 20; i++) z.zaehle(`t${i}`, inhaltAusTreffern([{ zone: 'genitals', bedeckt: false }]));
  assert.equal(z.amInhalt, true);
});

test('Links: absolute Startseite und im Rueckfall fremde Hosts sind keine Videolinks', () => {
  const basis = 'https://www.beispiel.test/liste?seite=2';
  assert.equal(istVideoLink('https://www.beispiel.test/', basis), false);
  assert.equal(istVideoLink('https://beispiel.test', basis), false);
  assert.equal(istVideoLink('/video/12', basis), true);
  assert.equal(istVideoLink('https://werbung.example/aktion/1', basis, true), false);
  assert.equal(istVideoLink('https://werbung.example/aktion/1', basis, false), true);
  assert.equal(istVideoLink('https://beispiel.test/video/1', basis, true), true);
});

test('Links: Profile, Kategorien, Suchseiten und Kanaele sind keine Videolinks, echte Videolinks bleiben', () => {
  const basis = 'https://www.beispiel.test/liste';
  for (const h of ['/model/figur', '/models', '/pornstar/figur/videos', '/pornstars/', '/channels/x', '/channel/x', '/categories', '/category/hd', '/search?q=a', '/search/hd', '/tags/a', '/users' + '/b', '/de/pornstars/figur', '/video/search?search=a', 'https://www.beispiel.test/model/figur']) {
    assert.equal(istVideoLink(h, basis), false, h);
    assert.equal(istVideoLink(h), false, `${h} ohne Basis`);
  }
  for (const h of ['/video12345/titel', '/videos/titel-1', '/view_video.php?viewkey=ph1', '/video/12', '/de/videos/abc', '/searchlight/1', '/models-und-mehr/1', '/gif/5']) {
    assert.equal(istVideoLink(h, basis), true, h);
  }
  // Im Aufbau des Adapters: ein Link auf ein Profil macht sein Bild nicht zur Vorschau, ein Bild ueber vorschauBilder bleibt eine.
  const a = adapterFuer('xhamster');
  const profil = el({ vorfahren: [{ selektor: 'a[href*="/videos/"]', knoten: link('/videos/x/model/figur') }] });
  assert.equal(istVorschau(profil, a, 'https://xhamster.test/'), true); // Pfad beginnt nicht mit /model
  const nurProfil = el({ vorfahren: [{ selektor: 'a.video-thumb__image-container', knoten: link('/pornstars/figur') }] });
  assert.equal(istVorschau(nurProfil, a, 'https://xhamster.test/'), false);
  const bild = el({ trifft: ['img.video-thumb__image'], vorfahren: [{ selektor: 'a.video-thumb__image-container', knoten: link('/pornstars/figur') }] });
  assert.equal(istVorschau(bild, a, 'https://xhamster.test/'), true);
});

test('Links: gleiche registrierbare Domain zaehlt im Rueckfall als eigener Host', () => {
  assert.equal(registrierbareDomain('de.seite.com'), 'seite.com');
  assert.equal(registrierbareDomain('www.seite.com'), 'seite.com');
  assert.equal(registrierbareDomain('seite.com'), 'seite.com');
  assert.equal(registrierbareDomain('a.b.seite.co.uk'), 'seite.co.uk');
  assert.equal(registrierbareDomain('seite.co.uk'), 'seite.co.uk');
  assert.equal(registrierbareDomain('127.0.0.1'), '127.0.0.1');
  assert.equal(registrierbareDomain('localhost'), 'localhost');
  const basis = 'https://de.seite.com/liste';
  assert.equal(istVideoLink('https://seite.com/video/1', basis, true), true);
  assert.equal(istVideoLink('https://www.seite.com/video/1', basis, true), true);
  assert.equal(istVideoLink('https://cdn.seite.com/video/1', basis, true), true);
  assert.equal(istVideoLink('https://anderseite.com/video/1', basis, true), false);
  assert.equal(istVideoLink('https://seite.com.werbung.example/video/1', basis, true), false);
  assert.equal(istVideoLink('https://x.seite.co.uk/video/1', 'https://www.seite.co.uk/', true), true);
  assert.equal(istVideoLink('https://y.co.uk/video/1', 'https://www.seite.co.uk/', true), false);
});

test('Nachtausch: der Merker liefert nur Eintraege mit gleicher Generation, einmal, und leert sich', () => {
  const m = new NachtauschMerker(3);
  const e1 = {};
  const e2 = {};
  const e3 = {};
  const e4 = {};
  const z1 = { generation: 1 };
  const z2 = { generation: 1 };
  m.merke(e1, z1);
  m.merke(e2, z2);
  m.merke(e1, z1); // doppelt: ein Eintrag
  assert.equal(m.anzahl, 2);
  z2.generation++; // inzwischen neu bewertet
  m.merke(e3, { generation: 5 });
  m.merke(e4, { generation: 1 }); // Grenze 3 erreicht: nicht aufgenommen
  assert.equal(m.anzahl, 3);
  const liste = m.nimm();
  assert.deepEqual(liste.map(([e]) => e), [e1, e3]);
  assert.equal(m.anzahl, 0);
  assert.deepEqual(m.nimm(), []);
  m.merke(e1, z1);
  m.leere();
  assert.equal(m.anzahl, 0);
});

test('Status: eingesetzte Vorschauen zaehlen nicht als zensiert, sondern getrennt', async () => {
  const { zaehleZustaende } = await import('../../src/schleier/zaehlung.ts');
  const z = zaehleZustaende([
    { urteil: 'zensiert', ersetzt: { stile: [] } },
    { urteil: 'zensiert', ersetzt: { stile: [] } },
    { urteil: 'zensiert' },
    { urteil: 'frei' },
    { urteil: 'verdeckt' },
    { urteil: null },
  ]);
  assert.deepEqual(z, { gesamt: 6, offen: 1, frei: 1, zensiert: 1, verdeckt: 1, ersetzt: 2 });
  assert.deepEqual(zaehleZustaende([]), { gesamt: 0, offen: 0, frei: 0, zensiert: 0, verdeckt: 0, ersetzt: 0 });
});
