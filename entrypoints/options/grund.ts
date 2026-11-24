// Einstellungsseite, Grundeinstellungen (Session 11, Auftrag S, Entscheidung 133): Status und Pause, Stimmung, Zonen, Stil und Strict.
// Dieselben Einstellungen wie im Popup, derselbe Speicher (src/einstellungen.ts); beide Seiten zeigen nach einer Aenderung denselben Stand.
// Texte nur per textContent.
import { STANDARD, beiEinstellungsAenderung, ladeEinstellungen, waehlePreset, type Einstellungen, type VideoModus } from '../../src/einstellungen';
import { HINWEIS_FACE_EIN, HINWEIS_KEIN_GESICHT, HINWEIS_KEINE_WOERTER, HINWEIS_WORT_OHNE_PACK, stimmungsWort } from '../../src/oberflaeche/gemeinsam';
import { waehleStilHinweise, waehleZonenHinweis } from '../../src/oberflaeche/hinweise';
import { beobachteGesichter, type GesichterStand } from '../../src/oberflaeche/gesichter-status';
import { baueKarten } from '../../src/oberflaeche/presets-ansicht';
import { zeigeVorschau } from './vorschau-platz';
import { presetSatz, zonenHinweisTeile } from '../../src/oberflaeche/preset-texte';
import { presetDef } from '../../src/preset-def';
import type { PresetDef } from '../../src/presets';
import { ladeThemen } from '../../src/pack/woerter';
import { speichere } from './grund-speichern';
import { haengeStufenwahl } from './bedienung-stufen';
import { horcheAufVerworfen, zeichneZonenBedienung, zonenVerworfenSichtbar, zonenwahlHandle } from './bedienung-zonen';
import { STIMMUNG_STUFEN, STIMMUNG_TEXTE } from './bedienung-texte';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, kurzAusRoh, type PackKurz } from '../../src/pack/vertrag';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element #${id} fehlt`);
  return e as T;
}

const statusZeile = el<HTMLParagraphElement>('status');
const pauseKnopf = el<HTMLButtonElement>('pause');
// Fund 5 und 29: derselbe Knopf in der klebenden Leiste, gleicher Weg, gleiche Woerter.
const pauseLeiste = el<HTMLButtonElement>('pause-leiste');
const stimmungWert = el<HTMLOutputElement>('stimmung-wert');
const strict = el<HTMLInputElement>('strict');
const videoSchalter = el<HTMLInputElement>('video-zonen');
const augenbalkenSchalter = el<HTMLInputElement>('augenbalken');
const stilHinweis = el<HTMLParagraphElement>('stil-hinweis');
const packHinweisZeile = el<HTMLParagraphElement>('preset-pack-hinweis');
const zonenHinweisZeile = el<HTMLParagraphElement>('zonen-hinweis');
const faceHinweisZeile = el<HTMLParagraphElement>('preset-face-hinweis');
const keinGesichtZeile = el<HTMLParagraphElement>('preset-kein-gesicht');
const wortOhnePackZeile = el<HTMLParagraphElement>('wort-ohne-pack');
const wortBereich = el<HTMLDivElement>('wort-themen');
const wortChips = el<HTMLUListElement>('wort-chips');
const wortHinweis = el<HTMLParagraphElement>('wort-hinweis');
const karten = baueKarten(el<HTMLDivElement>('preset-karten'), {
  name: 'preset',
  praefix: 'preset',
  labelId: 'stil-titel',
  // Wechsel auf ein Preset mit Mias Gesicht schaltet Face ein (waehlePreset); dann steht ein kurzer Hinweis da, bis ein anderes Preset gewaehlt wird.
  beiWahl: (preset) => {
    let faceEin = false;
    void aendere((alt) => {
      const r = waehlePreset(alt, preset);
      faceEin = r.faceEingeschaltet;
      return r.teil;
    }).then((gespeichert) => {
      // Der Hinweis erst nach erfolgreichem Speichern: scheitert es, springt alles zurueck und es steht nichts da
      faceHinweisAn = gespeichert && faceEin;
      if (aktuell) zeichnePreset(aktuell);
    });
  },
});

let pack: PackKurz | null = null;
let aktuell: Einstellungen | null = null;

// ---------- Anzeige ----------

// Fund 6: ein Wort statt der rohen Schwelle, auch als aria-valuetext (die Zahl bleibt im Wert des Reglers).
// Phase 9, Fund 28: bei Mias Standard steht "(my default)" dabei, damit der linke Rand der Skala nicht wie "ganz aufgedreht" wirkt. E4d2: nur bei genau dem
// Standardwert, ein gespeicherter Zwischenwert wie 0.1049 ist nicht Mias Standard (die Anzeige sagt nie mehr, als gespeichert ist).
function zeigeStimmung(schwelle: number): void {
  const wort = stimmungsWort(schwelle) + (Math.abs(schwelle - STANDARD.schwelle) < 1e-9 ? ' (my default)' : '');
  stimmungWert.textContent = wort;
  stimmungWahl.handle?.regler.setAttribute('aria-valuetext', STIMMUNG_TEXTE.exakt.formatiere(schwelle) + ', ' + wort);
}

// F3: Stimmung als Stufen mit Namen, der Regler steht im Aufklapper "Exact value"; das Wort im Kopf der Seite bleibt.
const stimmungWahl = haengeStufenwahl(el('stimmung-ort'), 'stimmung-wahl', {
  titel: STIMMUNG_TEXTE.titel,
  beschriftetDurch: 'stimmung-titel', // W8: die Ueberschrift "Mia’s mood" steht schon darueber
  erklaerung: STIMMUNG_TEXTE.erklaerung,
  liste: STIMMUNG_STUFEN,
  exakt: STIMMUNG_TEXTE.exakt,
  hinweisFuer: () => STIMMUNG_TEXTE.hinweis,
  lies: (e) => e.schwelle,
  schreibe: (_alt, wert) => ({ schwelle: wert }),
  nachAnzeige: (w) => zeigeStimmung(w),
});

function statusText(e: Einstellungen): string {
  return e.pause ? 'Paused on every page. I’ll be here when you want me back.' : 'On watch. I’ll keep the pages quiet for you.';
}

// Preset-Wahl: die Presets mit meinem Gesicht sind ohne Pack gesperrt (Hinweis auf das Pack), mit Pack waehlbar. Angezeigt wird das Preset,
// das wirklich gilt. Darunter der Satz zum Preset, der Pack-Hinweis und die Wort-Themen (nur wenn das Preset Woerter nutzt).
let themen: { id: string; titel: string }[] = [];
let faceHinweisAn = false;
// Stand der Gesichtssuche in den Patch-Bildern (null: unbekannt oder noch nicht fertig).
let gesichter: GesichterStand | null = null;
let beobachtung: (() => void) | null = null;
function beobachteNeu(): void {
  beobachtung?.();
  beobachtung = beobachteGesichter((s) => {
    gesichter = s;
    if (aktuell) zeichnePreset(aktuell);
  });
}


function zeichnePreset(e: Einstellungen): void {
  const frei = istFreigeschaltet(pack, 'stil:mia-patch');
  const mitSticker = istFreigeschaltet(pack, 'zensur:sticker');
  const def = presetDef(e, pack).gilt;
  const gilt = def.id;
  karten.aktualisiere(e.preset, frei, mitSticker);
  // Platz der festen Vorschau (E4d1): derselbe Stil, der wirklich gilt, nur gelesen.
  zeigeVorschau({ einstellungen: e, pack, gesichter });
  stilHinweis.textContent = presetSatz(gilt, frei, gesichter?.fertig ? gesichter.mit : null);
  // E4t W5: ein gewoehnlicher Hinweis je Element (reine Funktion waehleStilHinweise), dazu nie verdraengt der Satz "Face aus, dann gilt mein Gesicht nicht".
  const sh = waehleStilHinweise({
    gilt: def,
    frei,
    mitSticker,
    pack,
    faceAn: e.zonen.face.an,
    faceGeradeEingeschaltet: faceHinweisAn,
    gesichter: gesichter,
    woerterOhneThemen: def.woerter && themen.length === 0,
  });
  const art = sh.gewoehnlich?.art ?? null;
  const ft = sh.nie || (art === 'face-ein' ? HINWEIS_FACE_EIN : '');
  faceHinweisZeile.hidden = ft === '';
  faceHinweisZeile.textContent = ft;
  keinGesichtZeile.hidden = art !== 'kein-gesicht';
  keinGesichtZeile.textContent = art === 'kein-gesicht' ? HINWEIS_KEIN_GESICHT : '';
  const packText = art === 'pack' ? sh.gewoehnlich!.text : '';
  packHinweisZeile.textContent = packText;
  packHinweisZeile.hidden = packText === '';
  zeichneZonenHinweis();
  zeichneWoerter(e, def, art === 'wort-ohne-pack');
}

// Absatz unter der Zonenwahl: der Hinweis zu Mias Gesicht sagt, dass etwas NICHT dazukommt, und weicht nie; der zu Censor bars weicht dem Hinweis zu einer verworfenen Handlung.
function zeichneZonenHinweis(): void {
  if (!aktuell) return;
  const t = zonenHinweisTeile(presetDef(aktuell, pack).gilt.id);
  const wahl = waehleZonenHinweis({ verworfen: zonenVerworfenSichtbar(), wahlKeine: false, zensurbalken: t.gewoehnlich !== '' });
  const zh = t.nie || (wahl === 'zensurbalken' ? t.gewoehnlich : '');
  zonenHinweisZeile.hidden = zh === '';
  zonenHinweisZeile.textContent = zh;
}
horcheAufVerworfen(zeichneZonenHinweis);


// Wort-Themen als Chips: nur mit einem Preset mit Woertern und einem Pack mit Wort-Themen. null in den Einstellungen heisst alle Themen.
function zeichneWoerter(e: Einstellungen, def: PresetDef, ohnePackHinweis: boolean): void {
  const zeigen = def.woerter && themen.length > 0;
  // Ohne Pack (oder ohne Wort-Themen) schreibt ein Wort-Preset immer MIA: die Zeile sagt es, wo sonst die Chips stuenden
  wortOhnePackZeile.hidden = !ohnePackHinweis;
  wortOhnePackZeile.textContent = ohnePackHinweis ? HINWEIS_WORT_OHNE_PACK : '';
  wortBereich.hidden = !zeigen;
  if (!zeigen) return;
  const an = (id: string): boolean => e.woerterThemen === null || e.woerterThemen.includes(id);
  if (wortChips.children.length !== themen.length) {
    wortChips.replaceChildren(
      ...themen.map((t) => {
        const li = document.createElement('li');
        li.className = 'wort-chip';
        const label = document.createElement('label');
        const feld = document.createElement('input');
        feld.type = 'checkbox';
        feld.dataset.thema = t.id;
        const text = document.createElement('span');
        text.textContent = t.titel;
        label.append(feld, text);
        li.append(label);
        return li;
      }),
    );
  }
  for (const feld of wortChips.querySelectorAll<HTMLInputElement>('input[data-thema]')) feld.checked = an(feld.dataset.thema!);
  wortHinweis.textContent = themen.every((t) => !an(t.id)) ? HINWEIS_KEINE_WOERTER : '';
}

wortChips.addEventListener('change', () => {
  const gewaehlt = [...wortChips.querySelectorAll<HTMLInputElement>('input[data-thema]')].filter((f) => f.checked).map((f) => f.dataset.thema!);
  // alle Themen gewaehlt: null (alle Themen des Packs, auch spaeter dazukommende)
  const woerterThemen = gewaehlt.length === themen.length ? null : gewaehlt;
  void aendere(() => ({ woerterThemen }));
});

// Themen aus der Pack-Ablage lesen (nach jedem Wechsel des Packs neu).
async function ladeWortThemen(): Promise<void> {
  themen = await ladeThemen().catch(() => []);
  wortChips.replaceChildren();
  beobachteNeu();
  if (aktuell) zeichne(aktuell);
}

// `erzwingen`: auch Regler mit Fokus auf den gespeicherten Stand setzen (nach einem gescheiterten Speichern, Fund 26).
function zeichne(e: Einstellungen, erzwingen = false): void {
  aktuell = e;
  // Nur bei geaendertem Text setzen, sonst sagt der Screenreader (aria-live) bei jedem Klick den Status neu an.
  const status = statusText(e);
  if (statusZeile.textContent !== status) statusZeile.textContent = status;
  for (const knopf of [pauseKnopf, pauseLeiste]) {
    knopf.textContent = e.pause ? 'Let Mia back in' : 'Pause Mia';
    knopf.setAttribute('aria-pressed', String(e.pause));
  }

  stimmungWahl.zeichne(e, erzwingen);
  zeigeStimmung(e.schwelle);

  zeichnePreset(e);
  videoSchalter.checked = e.video === 'zonen';
  augenbalkenSchalter.checked = e.augenbalken;
  strict.checked = e.strict;

  // F1 und F2: Zonenwahl und Kleidungsfrage lesen denselben gespeicherten Stand; nach jedem Zeichnen werden beide neu gezeichnet.
  zeichneZonenBedienung(e, el('zonen-ort'), el('kleidung-ort'), zeichne);
  zonenwahlHandle()?.gruppe.setAttribute('aria-describedby', 'zonen-hinweis');
}

// ---------- Aenderungen schreiben (immer auf den frisch geladenen Stand aufsetzen) ----------

// Fund 26: scheitert das Speichern, steht der Fehlersatz in der Leiste und alles springt auf den gespeicherten Stand zurueck.
async function aendere(teil: (alt: Einstellungen) => Partial<Einstellungen>): Promise<boolean> {
  // Bei Erfolg normal zeichnen (ein Regler mit Fokus laesst sich bei schneller Tastenfolge nicht zurueckstellen), beim Scheitern erzwungen.
  const neu = await speichere(teil, (e) => zeichne(e, true), false);
  if (neu) zeichne(neu);
  return !!neu;
}

// Pause wie im Popup: der Hintergrund schaltet (Zeitstempel fuer die Steigerung), die Seite zeichnet ueber den Speicher-Hoerer.
function pausiere(): void {
  // Absolut senden: der Ersatzweg setzt denselben Zielwert und schaltet nie doppelt um.
  const an = !(aktuell?.pause ?? false);
  void browser.runtime.sendMessage({ ziel: 'hintergrund', typ: 'pause', an }).catch(() => aendere(() => ({ pause: an })));
}
pauseKnopf.addEventListener('click', pausiere);
pauseLeiste.addEventListener('click', pausiere);

videoSchalter.addEventListener('change', () => {
  const video: VideoModus = videoSchalter.checked ? 'zonen' : 'ganz';
  void aendere(() => ({ video }));
});

// Eye bar (E4c): ein eigener Schalter unter dem Stilraster, kein Stil. Er aendert nur sich selbst; Stil und Zonen-Schalter bleiben, wie sie sind.
augenbalkenSchalter.addEventListener('change', () => {
  const an = augenbalkenSchalter.checked;
  void aendere(() => ({ augenbalken: an }));
});

strict.addEventListener('change', () => {
  const an = strict.checked;
  void aendere(() => ({ strict: an }));
});

// ---------- Start ----------

// Fund 4 und 6: die klebende Leiste (auch mit Fehlersatz oder auf zwei Zeilen) verdeckt nichts, was angesprungen oder fokussiert wird.
// E4f (F1): die Leiste hat keine Hoehe im Fluss, die Hoehe der Karte darin (0, solange sie verborgen ist) ist die Hoehe der klebenden Leiste.
// J10: der Beobachter des grossen Pause-Knopfs (unten) wird neu angelegt, wenn sich die stabile Hoehe der Karte aendert.
let beobachtePause: (abzug: number) => void = () => {};
const leiste = document.querySelector<HTMLElement>('#leiste .leiste-karte');
if (leiste && typeof ResizeObserver !== 'undefined') {
  // E4d1: schmal klebt die Reiterzeile unter der Leiste; beide zusammen verdecken nichts, was angesprungen oder fokussiert wird.
  const reiterLeiste = document.getElementById('sprung');
  // Die Karte erscheint erst, wenn die Seite gescrollt hat (Pause ausser Bild). Reiterzeile und Polster rechnen darum immer mit ihrer Hoehe: mindestens die
  // Hoehe der Karte mit dem Pause-Knopf (Fingerziel, Polster, Rand, wie --leiste-hoehe in reiter.css), mehr, wenn sie mit Fehlersatz hoeher ist. So bewegt
  // sich die Reiterzeile nicht, wenn die Karte erscheint, und ein Sprung zu einem Element scrollt nie so weit, dass die Karte danach etwas verdeckt.
  const fingerziel = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--v-fingerziel')) || 44;
  const karteGrund = fingerziel + 18;
  const setzePolster = (): void => {
    // J1: steht ein Fehlersatz, ist die Karte ohne die kleine Pause nur so hoch wie der Satz (die leere Zeile entfaellt), mit ihr eine Zeile (Fingerziel plus 8 px Abstand) hoeher.
    // Gerechnet wird immer mit der hoeheren Karte: die kleine Pause erscheint beim Scrollen, und Sprung, Fokus und Polster duerfen sich dabei nicht verschieben.
    const meldung = document.getElementById('speicher-meldung');
    const meldungDa = !!meldung && !meldung.hidden;
    const zeile = leiste.querySelector<HTMLElement>('.leiste-zeile');
    const zeileHoehe = pauseLeiste.hidden || !zeile ? fingerziel : zeile.getBoundingClientRect().height;
    const extra = zeileHoehe + 8;
    const jetzt = Math.ceil(leiste.getBoundingClientRect().height);
    const voll = jetzt + (meldungDa && pauseLeiste.hidden ? extra : 0);
    const karteHoehe = Math.max(voll, karteGrund);
    document.documentElement.style.setProperty('--leiste-hoehe', `${karteHoehe}px`);
    // J11: oben haelt die Seite nur so viel Platz frei, wie die Karte dort (ohne kleine Pause) hoch ist; waechst die Karte beim Scrollen, liegt sie nur ueber dem Inhalt, nichts springt.
    const oben = meldungDa ? Math.max(0, jetzt - (pauseLeiste.hidden ? 0 : extra)) : 0;
    document.documentElement.style.setProperty('--karte-platz', `${oben}px`);
    // Ohne Fehlersatz liegt die Karte nur da, wenn der kleine Knopf sichtbar ist: dann ist der grosse nicht ganz im Bild, es gibt nichts abzuziehen.
    beobachtePause(meldungDa ? karteHoehe : 0);
    const reiterKlebt = !!reiterLeiste && getComputedStyle(reiterLeiste).position === 'sticky' && matchMedia('(max-width: 600px)').matches;
    const reiterHoehe = reiterKlebt ? Math.ceil(reiterLeiste.getBoundingClientRect().height) : 0;
    // E4f (F4, H-f): Sprungziele und Fokus rutschen nicht unter die klebenden Elemente. Als `scroll-margin-top` (style.css) statt als `scroll-padding-top` der Seite:
    // Firefox gilt ein Element, das noch im Fenster liegt, sonst als sichtbar und scrollt nicht, auch wenn Karte oder Reiterzeile darauf liegt.
    document.documentElement.style.setProperty('--polster-oben', `${karteHoehe + reiterHoehe + 8}px`);
  };
  const polsterBeobachter = new ResizeObserver(setzePolster);
  polsterBeobachter.observe(leiste);
  if (reiterLeiste) polsterBeobachter.observe(reiterLeiste);
  setzePolster();
}

// Runde 3, N6: der Pause-Knopf der Leiste nur, wenn der grosse Knopf oben nicht im Bild ist (zwei gleiche Knoepfe auf einmal verwirren).
// (E4d1: die Markierung des Chips unter der Leiste entfaellt, der gewaehlte Reiter traegt aria-selected, reiter.ts.)
if (typeof IntersectionObserver !== "undefined") {
  // Lesung Runde 3, Nr. 2 und 6: verborgen nur, solange der grosse Knopf GANZ im Bild ist (sonst waere Pause in einem schmalen
  // Scrollbereich kaum erreichbar); hat der kleine Knopf den Fokus, wandert er auf den grossen.
  // J10: bei stehendem Fehlersatz heisst "im Bild" ganz unterhalb der festen Karte (stabile Hoehe `--leiste-hoehe`), nicht nur im Fenster; sonst gaebe es einen Scrollweg, auf dem der grosse
  // Knopf unter der Karte liegt und die kleine Pause verborgen ist.
  let pauseBeobachter: IntersectionObserver | null = null;
  let beobachtetHoehe = -1;
  beobachtePause = (abzug: number): void => {
    if (abzug === beobachtetHoehe) return;
    beobachtetHoehe = abzug;
    pauseBeobachter?.disconnect();
    pauseBeobachter = new IntersectionObserver(
      (e) => {
        const ganz = (e[e.length - 1]?.intersectionRatio ?? 1) >= 0.99;
        if (ganz && document.activeElement === pauseLeiste) pauseKnopf.focus();
        pauseLeiste.hidden = ganz;
      },
      { threshold: [0, 0.5, 0.99, 1], rootMargin: `-${abzug}px 0px 0px 0px` },
    );
    pauseBeobachter.observe(pauseKnopf);
  };
  beobachtePause(0);
}

const abmelden = beiEinstellungsAenderung(zeichne);
const horcher = (aenderungen: Record<string, { newValue?: unknown }>, bereich: string): void => {
  if (bereich !== 'local' || !(PACK_SPEICHER_SCHLUESSEL in aenderungen)) return;
  pack = kurzAusRoh(aenderungen[PACK_SPEICHER_SCHLUESSEL]?.newValue);
  void ladeWortThemen();
  if (aktuell) zeichne(aktuell);
};
browser.storage.onChanged.addListener(horcher);
window.addEventListener(
  'pagehide',
  () => {
    abmelden();
    browser.storage.onChanged.removeListener(horcher);
  },
  { once: true },
);

void (async () => {
  pack = await ladePackKurz().catch(() => null);
  themen = await ladeThemen().catch(() => []);
  beobachteNeu();
  zeichne(await ladeEinstellungen());
})();
