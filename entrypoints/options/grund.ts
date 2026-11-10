// Einstellungsseite, Grundeinstellungen (Session 11, Auftrag S, Entscheidung 133): Status und Pause, Stimmung, Zonen, Stil und Strict.
// Dieselben Einstellungen wie im Popup, derselbe Speicher (src/einstellungen.ts); beide Seiten zeigen nach einer Aenderung denselben Stand.
// Texte nur per textContent.
import {
  BEDECKBARE_ZONEN,
  SCHWELLE_MAX,
  SCHWELLE_MIN,
  STANDARD,
  ZONEN,
  beiEinstellungsAenderung,
  ladeEinstellungen,
  waehlePreset,
  type Einstellungen,
  type VideoModus,
  type Zone,
} from '../../src/einstellungen';
import { HINWEIS_FACE_AUS, HINWEIS_FACE_EIN, HINWEIS_KEIN_GESICHT, HINWEIS_KEINE_WOERTER, HINWEIS_WORT_OHNE_PACK, stimmungsWort } from '../../src/oberflaeche/gemeinsam';
import { beobachteGesichter, type GesichterStand } from '../../src/oberflaeche/gesichter-status';
import { baueKarten } from '../../src/oberflaeche/presets-ansicht';
import { packHinweis, presetSatz, zonenHinweis } from '../../src/oberflaeche/preset-texte';
import { PRESETS } from '../../src/presets';
import { ladeThemen } from '../../src/pack/woerter';
import { speichere } from './grund-speichern';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, presetFuerPackKurz, kurzAusRoh, type PackKurz } from '../../src/pack/vertrag';

const ZONEN_NAMEN: Record<Zone, string> = {
  eyes: 'Eyes',
  mouth: 'Mouth',
  face: 'Face',
  head: 'Head',
  breast: 'Breasts',
  genitals: 'Genitals',
  buttocks: 'Buttocks',
  belly: 'Belly',
  feet: 'Feet',
  armpits: 'Armpits',
};

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element #${id} fehlt`);
  return e as T;
}

const statusZeile = el<HTMLParagraphElement>('status');
const pauseKnopf = el<HTMLButtonElement>('pause');
// Fund 5 und 29: derselbe Knopf in der klebenden Leiste, gleicher Weg, gleiche Woerter.
const pauseLeiste = el<HTMLButtonElement>('pause-leiste');
const stimmung = el<HTMLInputElement>('stimmung');
const stimmungWert = el<HTMLOutputElement>('stimmung-wert');
const strict = el<HTMLInputElement>('strict');
const zonenListe = el<HTMLUListElement>('zonen');
const videoSchalter = el<HTMLInputElement>('video-zonen');
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
// Phase 9, Fund 28: bei Mias Standard steht "(my default)" dabei, damit der linke Rand der Skala nicht wie "ganz aufgedreht" wirkt.
function zeigeStimmung(schwelle: number): void {
  const wort = stimmungsWort(schwelle) + (Math.round(schwelle * 100) === Math.round(STANDARD.schwelle * 100) ? ' (my default)' : '');
  stimmungWert.textContent = wort;
  stimmung.setAttribute('aria-valuetext', wort);
}

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
  const gilt = presetFuerPackKurz(e.preset, pack);
  karten.aktualisiere(e.preset, frei);
  stilHinweis.textContent = presetSatz(gilt, frei, gesichter?.fertig ? gesichter.mit : null);
  // Mia-Preset: gerade eingeschaltet (kurz), oder Face steht aus (bewusst oder Altbestand): sagen, was dann gilt
  const mia = PRESETS[gilt].gesicht === 'mia-gesicht';
  const ft = !mia ? '' : faceHinweisAn && e.zonen.face.an ? HINWEIS_FACE_EIN : e.zonen.face.an ? '' : HINWEIS_FACE_AUS;
  faceHinweisZeile.hidden = ft === '';
  faceHinweisZeile.textContent = ft;
  // Pack da, Scan fertig, aber in keinem Patch-Bild ein brauchbares Gesicht: ehrlich sagen
  const keins = frei && PRESETS[gilt].gesicht === 'mia-gesicht' && gesichter?.fertig === true && gesichter.gesamt > 0 && gesichter.mit === 0;
  keinGesichtZeile.hidden = !keins;
  keinGesichtZeile.textContent = keins ? HINWEIS_KEIN_GESICHT : '';
  packHinweisZeile.textContent = packHinweis(frei, pack);
  packHinweisZeile.hidden = frei;
  const zh = zonenHinweis(gilt);
  zonenHinweisZeile.hidden = zh === '';
  zonenHinweisZeile.textContent = zh;
  zeichneWoerter(e, gilt);
}

// Wort-Themen als Chips: nur mit einem Preset mit Woertern und einem Pack mit Wort-Themen. null in den Einstellungen heisst alle Themen.
function zeichneWoerter(e: Einstellungen, gilt: ReturnType<typeof presetFuerPackKurz>): void {
  const zeigen = PRESETS[gilt].woerter && themen.length > 0;
  // Ohne Pack (oder ohne Wort-Themen) schreibt ein Wort-Preset immer MIA: die Zeile sagt es, wo sonst die Chips stuenden
  wortOhnePackZeile.hidden = !(PRESETS[gilt].woerter && themen.length === 0);
  wortOhnePackZeile.textContent = wortOhnePackZeile.hidden ? '' : HINWEIS_WORT_OHNE_PACK;
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

  if (erzwingen || document.activeElement !== stimmung) stimmung.value = e.schwelle.toFixed(2);
  zeigeStimmung(e.schwelle);

  zeichnePreset(e);
  videoSchalter.checked = e.video === 'zonen';
  strict.checked = e.strict;

  for (const zone of ZONEN) {
    const an = zonenListe.querySelector<HTMLInputElement>(`input[data-zone="${zone}"]`);
    if (an) an.checked = e.zonen[zone].an;
    const bedeckt = zonenListe.querySelector<HTMLInputElement>(`input[data-bedeckt="${zone}"]`);
    if (bedeckt) {
      bedeckt.checked = !!e.zonen[zone].bedeckt;
      bedeckt.disabled = !e.zonen[zone].an;
    }
  }
}

// ---------- Zonen aufbauen ----------

for (const zone of ZONEN) {
  const zeile = document.createElement('li');
  const name = document.createElement('label');
  name.className = 'schalter';
  const an = document.createElement('input');
  an.type = 'checkbox';
  an.setAttribute('role', 'switch');
  an.dataset.zone = zone;
  const regler = document.createElement('span');
  regler.className = 'regler';
  regler.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = ZONEN_NAMEN[zone];
  name.append(an, regler, text);
  zeile.append(name);
  if (BEDECKBARE_ZONEN.has(zone)) {
    const auch = document.createElement('label');
    auch.className = 'auch';
    auch.title = 'Also cover this when it is under clothing';
    const bedeckt = document.createElement('input');
    bedeckt.setAttribute('aria-label', `${ZONEN_NAMEN[zone]}: even when clothed`);
    bedeckt.type = 'checkbox';
    bedeckt.dataset.bedeckt = zone;
    auch.append(bedeckt, document.createTextNode('even when clothed'));
    zeile.append(auch);
  }
  zonenListe.append(zeile);
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

stimmung.min = String(SCHWELLE_MIN);
stimmung.max = String(SCHWELLE_MAX);
// Beim Ziehen nur die Zahl nachfuehren; gespeichert wird erst beim Loslassen (jede Speicherung setzt auf allen Seiten die Urteile zurueck).
stimmung.addEventListener('input', () => {
  zeigeStimmung(Number(stimmung.value));
});
// Wert beim Ereignis festhalten: ein Zeichnen aus einer fremden Aenderung darf ihn nicht mehr ueberschreiben, bevor geschrieben wird.
stimmung.addEventListener('change', () => {
  const wert = Number(stimmung.value);
  void aendere(() => ({ schwelle: wert }));
});

videoSchalter.addEventListener('change', () => {
  const video: VideoModus = videoSchalter.checked ? 'zonen' : 'ganz';
  void aendere(() => ({ video }));
});

strict.addEventListener('change', () => {
  const an = strict.checked;
  void aendere(() => ({ strict: an }));
});

zonenListe.addEventListener('change', (ereignis) => {
  const feld = ereignis.target as HTMLInputElement;
  const zone = (feld.dataset.zone ?? feld.dataset.bedeckt) as Zone | undefined;
  if (!zone) return;
  const an = feld.checked;
  const istAn = !!feld.dataset.zone;
  void aendere((alt) => {
    const z = { ...alt.zonen[zone] };
    if (istAn) z.an = an;
    else z.bedeckt = an;
    return { zonen: { ...alt.zonen, [zone]: z } };
  });
});

// ---------- Start ----------

// Fund 4 und 6: die klebende Leiste (auch mit Fehlersatz oder auf zwei Zeilen) verdeckt nichts, was angesprungen oder fokussiert wird.
const leiste = document.getElementById('leiste');
if (leiste && typeof ResizeObserver !== 'undefined') {
  const setzePolster = (): void => {
    document.documentElement.style.scrollPaddingTop = `${Math.ceil(leiste.getBoundingClientRect().height) + 8}px`;
  };
  new ResizeObserver(setzePolster).observe(leiste);
  setzePolster();
}

// Runde 3, N6: der Pause-Knopf der Leiste nur, wenn der grosse Knopf oben nicht im Bild ist (zwei gleiche Knoepfe auf einmal verwirren).
// N5: der Chip des Abschnitts, der gerade oben unter der Leiste steht, traegt aria-current="true".
if (typeof IntersectionObserver !== "undefined") {
  // Lesung Runde 3, Nr. 2 und 6: verborgen nur, solange der grosse Knopf GANZ im Bild ist (sonst waere Pause in einem schmalen
  // Scrollbereich kaum erreichbar); hat der kleine Knopf den Fokus, wandert er auf den grossen.
  new IntersectionObserver(
    (e) => {
      const ganz = (e[e.length - 1]?.intersectionRatio ?? 1) >= 0.99;
      if (ganz && document.activeElement === pauseLeiste) pauseKnopf.focus();
      pauseLeiste.hidden = ganz;
    },
    { threshold: [0, 0.5, 0.99, 1] },
  ).observe(pauseKnopf);
  const chips = [...document.querySelectorAll<HTMLAnchorElement>("#sprung a[href^=\"#\"]")];
  let gewaehlterChip: HTMLAnchorElement | null = null;
  for (const a of chips) a.addEventListener('click', () => { gewaehlterChip = a; });
  const markiere = (): void => {
    const oben = (leiste?.getBoundingClientRect().bottom ?? 0) + 12;
    let aktuellerChip: HTMLAnchorElement | null = null;
    for (const a of chips) {
      const ziel = document.getElementById(a.getAttribute("href")!.slice(1));
      // Lesung Runde 3, Nr. 3: leere oder verborgene Abschnitte (noch nicht gefuellt, vor dem Einstieg) zaehlen nicht.
      if (!ziel || ziel.hidden || ziel.getClientRects().length === 0) continue;
      if (ziel.getBoundingClientRect().top <= oben) aktuellerChip = a;
    }
    // Phase 9: ganz unten kann der angeklickte Abschnitt nicht mehr bis unter die Leiste steigen (letzte Karten sind kurz); dann gilt er trotzdem.
    const amEnde = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    if (gewaehlterChip && amEnde) {
      const z = document.getElementById(gewaehlterChip.getAttribute("href")!.slice(1));
      if (z && z.getBoundingClientRect().top < window.innerHeight - 40) aktuellerChip = gewaehlterChip;
    } else if (!amEnde) gewaehlterChip = null;
    // Ganz oben steht noch kein Abschnitt unter der Leiste: dann gilt der erste sichtbare Chip (genau einer ist immer markiert).
    aktuellerChip ??= chips.find((a) => !a.hidden && a.getClientRects().length > 0) ?? null;
    for (const a of chips) {
      if (a === aktuellerChip) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
  };
  let geplant = false;
  window.addEventListener("scroll", () => {
    if (geplant) return;
    geplant = true;
    requestAnimationFrame(() => {
      geplant = false;
      markiere();
    });
  }, { passive: true });
  markiere();
  // Die Abschnitte Ton, Ledger und About fuellen ihre Module erst nach diesem; jede Groessenaenderung der Seite markiert neu.
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => markiere()).observe(document.body);
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
