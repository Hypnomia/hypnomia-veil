// Einheit: Phase 11 E4t, Festlegungen W4 bis W8, W13: ein Hinweis je Element (reine Funktionen ueber alle Zustaende), Warnsatz zu Full replacement (W4, beide Richtungen),
// Kurzzeile des Popups (W6, W13: dieselbe Rechnung wie der Schleier), Stufennamen der Stimmung (W7, eine Quelle) und die Laengen der freigegebenen Hinweise.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STANDARD, vervollstaendige } from '../../src/einstellungen.ts';
import { vervollstaendigeStand } from '../../src/steigerung.ts';
import { PRESETS } from '../../src/presets.ts';
import { presetDef } from '../../src/preset-def.ts';
import { STUFENLISTEN } from '../../src/oberflaeche/bausteine/stufen-daten.ts';
import { abdeckungStand, popupStufe } from '../../src/oberflaeche/abdeckung.ts';
import { ERWACHSEN_TEXTE, KLEIDUNG_ANTWORT_GILT, KLEIDUNG_HEUTE, KLEIDUNG_HEUTE_NICHTS } from '../../src/oberflaeche/bedienung-texte.ts';
import {
  EYE_BAR_TEXT,
  HINWEIS_FACE_AUS,
  HINWEIS_FACE_EIN,
  HINWEIS_KEIN_GESICHT,
  HINWEIS_MIA_PACK_FEHLT,
  HINWEIS_PACK_OHNE_PATCH,
  HINWEIS_PACK_OHNE_STICKER,
  HINWEIS_WORT_OHNE_PACK,
  HINWEIS_ZONEN_MIA,
  HINWEIS_ZONEN_ZENSURBALKEN,
  STIMMUNG_WOERTER,
  stimmungsWort,
} from '../../src/oberflaeche/gemeinsam.ts';
import { ersatzWarnungGilt, gesperrtText, waehleErwachsenHinweis, waehleKleidungHinweis, waehleStilHinweise, waehleZonenHinweis } from '../../src/oberflaeche/hinweise.ts';
import { zonenHinweisTeile } from '../../src/oberflaeche/preset-texte.ts';
import { ABDECKUNG_KURZ, ABDECKUNG_NUR_GRIFF, erwachsenHinweis } from '../../entrypoints/popup/texte.ts';
import { ERW_HINWEIS_AN, ERW_HINWEIS_AUS, ERW_HINWEIS_OHNE_PACK, ERW_HINWEIS_PAUSE } from '../../entrypoints/popup/texte.ts';

const pack = (...f) => ({ id: 't', version: '1.0.0', titel: 'T', freischaltungen: f, bilder: 1, groesse: 1, importiert: 1 });
const ALLE = ['stil:mia-patch', 'zensur:sticker', 'zensur:steigerung', 'kontrolle:zeitplan', 'erwachsen:vorschau', 'erwachsen:ersatz'];

// ---------- Stilwahl (F1, F2) ----------

test('Stilwahl: hoechstens ein gewoehnlicher Hinweis, Vorrang Sperre, kein Gesicht, Face ein, Wort; Face aus bleibt immer stehen', () => {
  const mia = PRESETS['mia-wort'];
  const klassisch = PRESETS.mosaik;
  const mitWort = PRESETS['mosaik-wort'];
  const gefunden = { fertig: true, gesamt: 3, mit: 0 };
  let faelle = 0;
  for (const gilt of [mia, klassisch, mitWort]) {
    for (const p of [null, pack(), pack('stil:mia-patch'), pack('stil:mia-patch', 'zensur:sticker')]) {
      for (const faceAn of [true, false]) {
        for (const eben of [true, false]) {
          for (const g of [null, gefunden, { fertig: true, gesamt: 3, mit: 2 }, { fertig: false, gesamt: 3, mit: 0 }]) {
            for (const ohneThemen of [true, false]) {
              const frei = !!p && p.freischaltungen.includes('stil:mia-patch');
              const sticker = !!p && p.freischaltungen.includes('zensur:sticker');
              const r = waehleStilHinweise({ gilt, frei, mitSticker: sticker, pack: p, faceAn, faceGeradeEingeschaltet: eben, gesichter: g, woerterOhneThemen: ohneThemen });
              faelle += 1;
              // nie verdraengt: Mias Gesicht gilt, Face steht aus
              assert.equal(r.nie, gilt.gesicht === 'mia-gesicht' && !faceAn ? HINWEIS_FACE_AUS : '');
              // hoechstens ein gewoehnlicher Hinweis, und er ist nie der Satz "Face aus"
              if (r.gewoehnlich) assert.notEqual(r.gewoehnlich.text, HINWEIS_FACE_AUS);
              // D14 nur bei Face an
              if (r.gewoehnlich?.art === 'kein-gesicht') assert.equal(faceAn, true);
              if (r.gewoehnlich?.art === 'face-ein') assert.ok(faceAn && eben && gilt.gesicht === 'mia-gesicht');
              if (r.gewoehnlich?.art === 'wort-ohne-pack') assert.ok(gilt.woerter && (ohneThemen || !p)); // W21: ohne Pack auch ohne Angabe zu Themen
            }
          }
        }
      }
    }
  }
  assert.equal(faelle, 384);
  // W21: kein Pack und ein Stil mit Woertern: "my word is MIA" vor dem allgemeinen Satz zum fehlenden Pack; ohne Woerter bleibt der allgemeine Satz
  const base = { frei: false, mitSticker: false, pack: null, faceAn: true, faceGeradeEingeschaltet: false, gesichter: null, woerterOhneThemen: false };
  assert.equal(waehleStilHinweise({ ...base, gilt: mitWort }).gewoehnlich?.text, HINWEIS_WORT_OHNE_PACK);
  assert.equal(waehleStilHinweise({ ...base, gilt: klassisch }).gewoehnlich?.text, HINWEIS_MIA_PACK_FEHLT);
  // mit Pack (ohne Sperre) bleibt F1: Wort ohne Themen erst ganz am Ende
  const mitPack = { ...base, pack: pack('stil:mia-patch', 'zensur:sticker'), frei: true, mitSticker: true, gilt: mitWort };
  assert.equal(waehleStilHinweise(mitPack).gewoehnlich, null);
  assert.equal(waehleStilHinweise({ ...mitPack, woerterOhneThemen: true }).gewoehnlich?.text, HINWEIS_WORT_OHNE_PACK);
  // Vorrang: die Sperre des Packs vor den uebrigen (mit Pack)
  const sperre = waehleStilHinweise({ gilt: mia, frei: false, mitSticker: false, pack: pack(), faceAn: true, faceGeradeEingeschaltet: true, gesichter: gefunden, woerterOhneThemen: true });
  assert.equal(sperre.gewoehnlich?.art, 'pack');
  assert.ok(sperre.gewoehnlich?.text.includes(HINWEIS_PACK_OHNE_PATCH));
  // dann: Gesicht nicht klar genug, dann Face gerade ein, dann Wort ohne Pack
  const frei = { gilt: mia, frei: true, mitSticker: true, pack: pack('stil:mia-patch', 'zensur:sticker'), faceAn: true, faceGeradeEingeschaltet: true, gesichter: gefunden, woerterOhneThemen: true };
  assert.equal(waehleStilHinweise(frei).gewoehnlich?.text, HINWEIS_KEIN_GESICHT);
  assert.equal(waehleStilHinweise({ ...frei, gesichter: null }).gewoehnlich?.text, HINWEIS_FACE_EIN);
  assert.equal(waehleStilHinweise({ ...frei, gesichter: null, faceGeradeEingeschaltet: false }).gewoehnlich?.text, HINWEIS_WORT_OHNE_PACK);
  assert.equal(waehleStilHinweise({ ...frei, gesichter: null, faceGeradeEingeschaltet: false, woerterOhneThemen: false }).gewoehnlich, null);
  // Face aus: Mias Gesicht bekommt nichts, der Satz steht, und "kein brauchbares Gesicht" schweigt
  const aus = waehleStilHinweise({ ...frei, faceAn: false });
  assert.equal(aus.nie, HINWEIS_FACE_AUS);
  assert.notEqual(aus.gewoehnlich?.art, 'kein-gesicht');
  // Pack ohne Patch und ohne Sticker: beide Saetze der Sperre
  const ohne = waehleStilHinweise({ ...frei, frei: false, mitSticker: false, pack: pack() });
  assert.ok(ohne.gewoehnlich?.text.includes(HINWEIS_PACK_OHNE_PATCH) && ohne.gewoehnlich.text.includes(HINWEIS_PACK_OHNE_STICKER));
});

// ---------- Zonenwahl (F4) ----------

test('Zonenwahl: Vorrang verworfen, keine Karte passt, Censor bars; der Satz zu Mias Gesicht steht daneben und weicht nie', () => {
  const z = (verworfen, wahlKeine, zensurbalken) => waehleZonenHinweis({ verworfen, wahlKeine, zensurbalken });
  for (const v of [true, false]) for (const w of [true, false]) for (const b of [true, false]) {
    const r = z(v, w, b);
    assert.equal(r, v ? 'verworfen' : w ? 'wahl-keine' : b ? 'zensurbalken' : null);
  }
  // Mias Gesicht: nur `nie`, Censor bars: nur `gewoehnlich`
  assert.deepEqual(zonenHinweisTeile('mia-wort'), { nie: HINWEIS_ZONEN_MIA, gewoehnlich: '' });
  assert.deepEqual(zonenHinweisTeile('zensurbalken'), { nie: '', gewoehnlich: HINWEIS_ZONEN_ZENSURBALKEN });
  assert.deepEqual(zonenHinweisTeile('mosaik'), { nie: '', gewoehnlich: '' });
});

// ---------- Kleidungsfrage (F5) ----------

test('Kleidungsfrage: nur bei gemischtem Stand; "nothing under clothes" bleibt auch bei einer verworfenen Handlung, der gewoehnliche Teil weicht', () => {
  assert.equal(waehleKleidungHinweis({ gemischt: false, namen: [], verworfen: false }), null);
  assert.equal(waehleKleidungHinweis({ gemischt: false, namen: ['Breasts'], verworfen: true }), null);
  assert.equal(waehleKleidungHinweis({ gemischt: true, namen: [], verworfen: false }), `${KLEIDUNG_HEUTE_NICHTS} ${KLEIDUNG_ANTWORT_GILT}`);
  assert.equal(waehleKleidungHinweis({ gemischt: true, namen: [], verworfen: true }), KLEIDUNG_HEUTE_NICHTS);
  assert.equal(waehleKleidungHinweis({ gemischt: true, namen: ['Breasts', 'Feet'], verworfen: false }), `${KLEIDUNG_HEUTE(['Breasts', 'Feet'])} ${KLEIDUNG_ANTWORT_GILT}`);
  assert.equal(waehleKleidungHinweis({ gemischt: true, namen: ['Breasts'], verworfen: true }), null);
});

// ---------- Gruppe der Erwachsenenseiten (F7, F8) und Warnsatz (W4) ----------

test('Erwachsenenseiten: Vorrang verworfen, Satz ohne Pack mit Link (nur Interview), gesperrte Stufen; zwei Wortlaute der Sperre (K10)', () => {
  const packs = [null, pack(), pack('erwachsen:vorschau')];
  for (const p of packs) for (const v of [true, false]) for (const mit of [true, false]) {
    const art = waehleErwachsenHinweis({ verworfen: v, pack: p, mitPackHinweis: mit });
    const soll = v ? 'verworfen' : mit && !p ? 'ohne-pack' : p?.freischaltungen.includes('erwachsen:vorschau') ? null : 'gesperrt';
    assert.equal(art, soll);
  }
  assert.equal(gesperrtText(null), ERWACHSEN_TEXTE.gesperrt);
  assert.equal(gesperrtText(pack()), ERWACHSEN_TEXTE.gesperrtAltesPack);
  assert.notEqual(ERWACHSEN_TEXTE.gesperrt, ERWACHSEN_TEXTE.gesperrtAltesPack);
});

test('W4: der Warnsatz zu Full replacement steht genau dann, wenn der Ersatz wirken wuerde (komplettErsatz UND an UND Pack mit erwachsen:ersatz)', () => {
  const p = pack('erwachsen:ersatz');
  for (const ersatz of [true, false]) for (const an of [true, false]) for (const pk of [null, pack(), p]) {
    const soll = ersatz && an && pk === p;
    assert.equal(ersatzWarnungGilt({ an, komplettErsatz: ersatz }, pk), soll, `ersatz ${ersatz}, an ${an}, pack ${pk ? pk.freischaltungen : 'keins'}`);
  }
  // in beide Richtungen: ein Zustand, in dem der alte Satz stand (nur gespeichert an) und jetzt verborgen ist, und einer, in dem er steht
  assert.equal(ersatzWarnungGilt({ an: false, komplettErsatz: true }, p), false, 'Adult sites aus: der Ersatz wirkt nicht, kein Warnsatz');
  assert.equal(ersatzWarnungGilt({ an: true, komplettErsatz: true }, pack('erwachsen:vorschau')), false, 'Pack ohne erwachsen:ersatz: kein Warnsatz');
  assert.equal(ersatzWarnungGilt({ an: true, komplettErsatz: true }, p), true);
});

test('Popup: der Hinweis zu den Erwachsenenseiten ist je Zustand genau einer; Pause sagt, dass nichts verdeckt wird, und weicht dem Pack-Satz nur ohne Pack', () => {
  // X2: die Pause geht vor "ohne Pack": ihr Satz sagt, dass nichts verdeckt wird, und weicht nie
  assert.equal(erwachsenHinweis({ ohnePack: true, pause: true, an: true }), ERW_HINWEIS_PAUSE);
  assert.equal(erwachsenHinweis({ ohnePack: true, pause: false, an: true }), ERW_HINWEIS_OHNE_PACK);
  assert.equal(erwachsenHinweis({ ohnePack: false, pause: true, an: true }), ERW_HINWEIS_PAUSE);
  assert.equal(erwachsenHinweis({ ohnePack: false, pause: false, an: true }), ERW_HINWEIS_AN);
  assert.equal(erwachsenHinweis({ ohnePack: false, pause: false, an: false }), ERW_HINWEIS_AUS);
});

// ---------- Kurzzeile des Popups (W6, W13) ----------

const JETZT = new Date(2026, 10, 18, 12, 0, 0); // Mittwoch, 12:00 Ortszeit
const ZEIT_JETZT = { tage: [JETZT.getDay()], von: 0, bis: 0 }; // ganzer Tag, heute: eine strenge Zeit

function einst(teil = {}) {
  const roh = JSON.parse(JSON.stringify(STANDARD));
  const zonen = Object.fromEntries(Object.keys(STANDARD.zonen).map((z) => [z, { ...STANDARD.zonen[z], an: false }]));
  return vervollstaendige({ ...roh, zonen, augenbalken: false, preset: 'mosaik', ...teil });
}
const kurz = (e, p, stand = vervollstaendigeStand(undefined), bekannt = true, packBekannt = true) => {
  const a = abdeckungStand(e, p, stand, bekannt, JETZT, packBekannt);
  return ABDECKUNG_KURZ(a.zonen.map((z) => z), a.balken, a.griff);
};

test('Kurzzeile: "nothing right now" nur ohne Zone, ohne Balken und ohne Griff', () => {
  assert.equal(kurz(einst(), pack(...ALLE)), 'I cover: nothing right now.');
  assert.equal(kurz(einst(), null), 'I cover: nothing right now.');
});

test('Kurzzeile: Eye bar an sagt nie "nothing" (auch bei Censor bars als Stil)', () => {
  const t = kurz(einst({ augenbalken: true }), null);
  assert.ok(!/nothing/.test(t) && /black bar over the eyes/.test(t), t);
  const t2 = kurz(einst({ preset: 'zensurbalken' }), null);
  assert.ok(!/nothing/.test(t2) && /black bar over the eyes/.test(t2), t2);
});

test('Kurzzeile W13: eine strenge Zeit hebt die Grundstufe 0 auf 1 und legt Zonen dazu: nie "nothing"; ohne Freischaltung oder in der Pause bleibt es wie es war', () => {
  const streng = { kontrolle: { ...STANDARD.kontrolle, zeiten: [ZEIT_JETZT] } };
  const p = pack('zensur:steigerung', 'kontrolle:zeitplan');
  const e = einst(streng);
  assert.equal(popupStufe(e, p, vervollstaendigeStand(undefined), JETZT).stufe, 1);
  assert.equal(kurz(e, p), ABDECKUNG_NUR_GRIFF);
  // ohne die Freischaltung der Steigerung hebt die strenge Zeit nichts (wie im Schleier)
  // X4: eine strenge Zeit ohne Steigerung: ein Quiz-Deckel liegt ueber dem Hauptvideo, "nothing" waere nicht belegt und C45 behauptet einen Griff, den es nicht gibt: die Zeile bleibt leer
  assert.equal(abdeckungStand(e, pack('kontrolle:zeitplan'), vervollstaendigeStand(undefined), true, JETZT).griff, 'unbekannt');
  assert.equal(kurz(e, pack('kontrolle:zeitplan')), null);
  // sind Zonen an oder gilt der Balken, steht trotzdem die gewohnte Zeile
  assert.equal(kurz(einst({ ...streng, augenbalken: true }), pack('kontrolle:zeitplan')), ABDECKUNG_KURZ([], true));
  assert.equal(kurz(einst({ ...streng, zonen: { ...einst().zonen, feet: { an: true } } }), pack('kontrolle:zeitplan')), 'I cover: feet.');
  // ohne die Freischaltung der Zeiten gilt die Zeit nicht
  assert.equal(kurz(e, pack('zensur:steigerung')), 'I cover: nothing right now.');
  // in der Pause zaehlt die strenge Zeit nicht (popupStufe wie im Popup)
  assert.equal(popupStufe(einst({ ...streng, pause: true }), p, vervollstaendigeStand(undefined), JETZT).stufe, 0);
});

test('Kurzzeile: der Griff aus dem gespeicherten Stand (Stufe 2, nicht abgebaut) legt Zonen dazu; ein nicht lesbarer Stand sagt nie "nothing"', () => {
  const p = pack('zensur:steigerung');
  const stand = vervollstaendigeStand({ stufe: 2, abbauAb: JETZT.getTime() });
  assert.equal(kurz(einst(), p, stand), ABDECKUNG_NUR_GRIFF);
  // Stand nicht gelesen: weder "nothing" noch eine Behauptung, die Zeile bleibt leer (null)
  assert.equal(kurz(einst(), p, vervollstaendigeStand(undefined), false), null);
  // W20: sind Zonen an oder gilt der Balken, steht die gewohnte Zeile trotz `unbekannt`
  const mitZone = einst({ zonen: { ...einst().zonen, breast: { an: true, bedeckt: false } } });
  assert.equal(abdeckungStand(mitZone, p, vervollstaendigeStand(undefined), false, JETZT).griff, 'unbekannt');
  assert.equal(kurz(mitZone, p, vervollstaendigeStand(undefined), false), 'I cover: breast.');
  assert.match(kurz(einst({ augenbalken: true }), p, vervollstaendigeStand(undefined), false), /black bar over the eyes/);
  assert.match(kurz(mitZone, p, vervollstaendigeStand(undefined), false), /^I cover: /);
  // ohne Freischaltung der Steigerung ist der Stand ohne Belang
  assert.equal(kurz(einst(), null, vervollstaendigeStand(undefined), false), 'I cover: nothing right now.');
  // Stufe vollstaendig abgebaut (zwei Tage her): nichts
  const alt = vervollstaendigeStand({ stufe: 1, abbauAb: JETZT.getTime() - 3 * 24 * 3600 * 1000 });
  assert.equal(kurz(einst(), p, alt), 'I cover: nothing right now.');
});

test('Kurzzeile: Zonen laut Schaltern, mit Balken dazu; Mias Gesicht liegt bei Face an ueber dem Balken', () => {
  const e = einst({ zonen: { ...einst().zonen, breast: { an: true, bedeckt: false } }, augenbalken: true });
  const a = abdeckungStand(e, null, vervollstaendigeStand(undefined), true, JETZT);
  assert.deepEqual(a.zonen, ['breast']);
  assert.equal(a.balken, true);
  assert.equal(ABDECKUNG_KURZ(['breasts'], true), 'I cover: breasts, plus a black bar over the eyes.');
  const mia = einst({ preset: 'mia-wort', augenbalken: true, zonen: { ...einst().zonen, face: { an: true } } });
  const am = abdeckungStand(mia, pack('stil:mia-patch'), vervollstaendigeStand(undefined), true, JETZT);
  assert.equal(am.balken, false);
  assert.equal(presetDef(mia, pack('stil:mia-patch')).gilt.gesicht, 'mia-gesicht');
});

// ---------- Stufennamen der Stimmung (W7, K9) ----------

test('Stimmung: die Stufennamen sind die Woerter von stimmungsWort (eine Quelle)', () => {
  for (const s of STUFENLISTEN.stimmung.stufen) assert.equal(s.name, stimmungsWort(s.wert));
  assert.deepEqual(STUFENLISTEN.stimmung.stufen.map((s) => s.name), [STIMMUNG_WOERTER[0], STIMMUNG_WOERTER[1], STIMMUNG_WOERTER[3]]);
});

// ---------- Aussagen ueber Deckung: gesicherte Wortlaute ----------

test('Wortlaute: kein Hinweis verspricht "hidden" oder "everything" fuer Vorschau-Clips, und die gewoehnlichen Hinweise bleiben kurz', () => {
  assert.ok(!/hidden|stay hidden/i.test(ERWACHSEN_TEXTE.karten.on.satz));
  assert.match(ERWACHSEN_TEXTE.karten.on.satz, /cover all of it/);
  for (const t of [EYE_BAR_TEXT, HINWEIS_PACK_OHNE_PATCH, HINWEIS_PACK_OHNE_STICKER, HINWEIS_KEIN_GESICHT, HINWEIS_MIA_PACK_FEHLT, HINWEIS_FACE_EIN, HINWEIS_FACE_AUS, HINWEIS_ZONEN_MIA, HINWEIS_ZONEN_ZENSURBALKEN]) {
    assert.ok([...t].length <= 90, `${[...t].length}: ${t}`);
  }
});

// ---------- Einmalige Quelle: statische Texte der Seiten gleich den Konstanten ----------

test('Quelle: Eye bar (Titel und Unterzeile) und die Ueberschriften der Einstellungsseite stehen in index.html wie in den Konstanten des Woerterbuchs', async () => {
  const { readFileSync } = await import('node:fs');
  const g = await import('../../src/oberflaeche/gemeinsam.ts');
  const opt = readFileSync(new URL('../../entrypoints/options/index.html', import.meta.url), 'utf8');
  assert.ok(opt.includes(`<strong>${g.EYE_BAR_TITEL}</strong><small>${g.EYE_BAR_TEXT}</small>`));
  for (const [id, name] of [['stil-titel', g.NAME_STIL], ['stimmung-titel', g.NAME_STIMMUNG], ['zonen-titel', g.NAME_ZONEN], ['erw-titel', g.NAME_ERWACHSEN], ['kon-titel', g.NAME_KONTROLLE], ['kon-zeiten-titel', g.NAME_STRENG]]) {
    assert.ok(opt.includes(`id="${id}">${name}<`), `${id}: ${name}`);
  }
  const pop = readFileSync(new URL('../../entrypoints/popup/index.html', import.meta.url), 'utf8');
  for (const [id, name] of [['stil-titel', g.NAME_STIL], ['stimmung-titel', g.NAME_STIMMUNG], ['zonen-titel', g.NAME_ZONEN], ['erwachsen-titel', g.NAME_ERWACHSEN], ['heiss-titel', g.NAME_HITZE]]) {
    assert.ok(pop.includes(`id="${id}">${name}<`), `Popup ${id}: ${name}`);
  }
  assert.ok(pop.includes(`<strong>${g.NAME_ERWACHSEN}</strong><small>on the sites I know`), 'Popup: der Schalter heisst wie die Ueberschrift (W9)');
});

test('X3: ist das Pack nicht gelesen, ist der Griff unbekannt und die Kurzzeile sagt nie "nothing" (leer, ausser Zonen oder Balken)', () => {
  const e = einst();
  assert.equal(abdeckungStand(e, null, vervollstaendigeStand(undefined), true, JETZT, false).griff, 'unbekannt');
  assert.equal(kurz(e, null, vervollstaendigeStand(undefined), true, false), null);
  assert.equal(kurz(einst({ augenbalken: true }), null, vervollstaendigeStand(undefined), true, false), ABDECKUNG_KURZ([], true));
  assert.equal(kurz(einst({ zonen: { ...e.zonen, feet: { an: true } } }), null, vervollstaendigeStand(undefined), true, false), 'I cover: feet.');
  // gelesen und kein Pack: wie bisher
  assert.equal(kurz(e, null, vervollstaendigeStand(undefined), true, true), 'I cover: nothing right now.');
});

// ---------- X6: Wortlaute, die als Literal in einer index.html und als Konstante stehen ----------

test('X6: statische Texte der index.html gleich den Konstanten (woertlich)', async () => {
  const { readFileSync } = await import('node:fs');
  const { STIMMUNG_HINWEIS } = await import('../../src/oberflaeche/bedienung-texte.ts');
  const { TEXT } = await import('../../src/einstieg/texte.ts');
  const opt = readFileSync(new URL('../../entrypoints/options/index.html', import.meta.url), 'utf8');
  const pop = readFileSync(new URL('../../entrypoints/popup/index.html', import.meta.url), 'utf8');
  const VIDEO = 'On: just the naughty bits, in your cover style (a bit more battery). Off: the whole video.';
  const ERSATZ = 'Careful: listed and your own sites show my gallery instead. Pause me, or put a site on my list of sites I leave alone, to see the real one.';
  const INHALT = 'only for quiz and reveal; no thumbnail swaps or gallery on pages I spot this way';
  const STRICT = TEXT.strictText; // hide each page until I’ve checked it (a little slower)
  const RUHIG = TEXT.ruhigText;
  for (const [name, html] of [['Einstellungsseite', opt], ['Popup', pop]]) {
    assert.ok(html.includes(`<small>${VIDEO}</small>`), `${name}: A82`);
    assert.ok(html.includes(`<small>${INHALT}</small>`), `${name}: A94`);
    assert.ok(html.includes(`<strong>Strict</strong><small>${STRICT}</small>`), `${name}: A88`);
  }
  assert.ok(pop.includes(`<p class="hinweis">${STIMMUNG_HINWEIS}</p>`), 'Popup: A33 (Stimmungshinweis)');
  assert.ok(opt.includes(`<small>${ERSATZ}</small>`) && pop.includes(`<small>${ERSATZ}</small>`), 'A92 in beiden');
  assert.ok(opt.includes(`<small>${RUHIG}</small>`), 'Calm mode: Unterzeile gleich TEXT.ruhigText (A99/B26)');
  // das Literal von A33 steht im Popup nur dort; die Konstante ist die Quelle der Einstellungsseite und des Interviews
  assert.equal(TEXT.i4Text, STIMMUNG_HINWEIS, 'A33 gleich B28');
});
