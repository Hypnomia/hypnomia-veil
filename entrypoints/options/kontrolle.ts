// Einstellungsseite, Abschnitt "Mia’s control" (Phase 5, Vertrag Session 9, Orchestrator). Schalter fuer Werbe-Tausch, Blitzwoerter und
// Leerlauf-Spirale; wie der Abschnitt "Adult sites" auch ohne Pack einstellbar (wirkt erst mit Pack und Freischaltung). Die Warnung vor
// Fotosensibilitaet erscheint, solange sie weder im Quiz noch auf der Spirale noch hier bestaetigt wurde.
import {
  BLITZ_HAEUFIGKEITEN,
  LEERLAUF_MAX_MINUTEN,
  LEERLAUF_MIN_MINUTEN,
  aendereEinstellungen,
  beiEinstellungsAenderung,
  ladeEinstellungen,
  type BlitzHaeufigkeit,
  type Einstellungen,
} from '../../src/einstellungen';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import { QUIZ_WARNUNG_SCHLUESSEL, WARNUNG_SPIRALE_SCHLUESSEL } from '../../src/kontrolle/grenzen';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element #${id} fehlt`);
  return e as T;
}

const hinweis = el<HTMLParagraphElement>('kon-pack-hinweis');
const werbung = el<HTMLInputElement>('kon-werbung');
const blitz = el<HTMLSelectElement>('kon-blitz');
const leerlauf = el<HTMLInputElement>('kon-leerlauf');
const minuten = el<HTMLInputElement>('kon-minuten');
const minutenZeile = el<HTMLDivElement>('kon-minuten-zeile');
const warnung = el<HTMLDivElement>('kon-warnung');
const warnungOk = el<HTMLButtonElement>('kon-warnung-ok');

minuten.min = String(LEERLAUF_MIN_MINUTEN);
minuten.max = String(LEERLAUF_MAX_MINUTEN);

let zuletzt: Einstellungen | null = null;
// `erzwingen`: auch das Feld mit Fokus neu zeichnen (nach dem eigenen Speichern, damit die Anzeige den gespeicherten Wert zeigt).
function zeichne(e: Einstellungen, erzwingen = false): void {
  zuletzt = e;
  werbung.checked = e.kontrolle.werbung;
  if (erzwingen || document.activeElement !== blitz) blitz.value = e.kontrolle.blitz;
  leerlauf.checked = e.kontrolle.leerlauf;
  if (erzwingen || document.activeElement !== minuten) minuten.value = String(e.kontrolle.leerlaufMinuten);
  minutenZeile.hidden = !e.kontrolle.leerlauf;
}

function zeichnePack(pack: PackKurz | null): void {
  const mit = (['kontrolle:werbung', 'kontrolle:blitz', 'kontrolle:leerlauf'] as const).some((f) => istFreigeschaltet(pack, f));
  hinweis.textContent = mit
    ? 'I run all of this. You pick how much, and Pause Mia stops it all.'
    : pack
      ? 'Your pack is older than this part. Import a newer Mia Pack to unlock it.'
      : 'These only work with the Mia Pack. Set them now and they’ll be ready.';
}

async function zeichneWarnung(): Promise<void> {
  try {
    const a = await browser.storage.local.get([QUIZ_WARNUNG_SCHLUESSEL, WARNUNG_SPIRALE_SCHLUESSEL]);
    warnung.hidden = a[QUIZ_WARNUNG_SCHLUESSEL] === true || a[WARNUNG_SPIRALE_SCHLUESSEL] === true;
  } catch {
    warnung.hidden = false;
  }
}

werbung.addEventListener('change', () => void aendereEinstellungen((alt) => ({ kontrolle: { ...alt.kontrolle, werbung: werbung.checked } })));
blitz.addEventListener('change', () => {
  const wert = blitz.value as BlitzHaeufigkeit;
  if (!(BLITZ_HAEUFIGKEITEN as readonly string[]).includes(wert)) return;
  void aendereEinstellungen((alt) => ({ kontrolle: { ...alt.kontrolle, blitz: wert } }));
});
leerlauf.addEventListener('change', () => void aendereEinstellungen((alt) => ({ kontrolle: { ...alt.kontrolle, leerlauf: leerlauf.checked } })));
minuten.addEventListener('change', () => {
  const roh = minuten.value.trim();
  const zahl = Number(roh);
  // Leeres oder ungueltiges Feld: alter Wert bleibt (nie still die kuerzeste Zeit). Zahlen ausserhalb der Grenzen begrenzt vervollstaendige();
  // danach zeigt zeichne() den gespeicherten Wert, auch im Feld mit Fokus.
  void aendereEinstellungen((alt) => ({
    kontrolle: { ...alt.kontrolle, leerlaufMinuten: roh !== '' && Number.isFinite(zahl) ? zahl : alt.kontrolle.leerlaufMinuten },
  })).then((neu) => zeichne(neu, true));
});
// Nach dem Verlassen eines Feldes den gespeicherten Stand zeigen (Aenderungen aus anderen Fenstern, die waehrend des Fokus kamen).
for (const feld of [blitz, minuten]) feld.addEventListener('blur', () => zuletzt && zeichne(zuletzt, true));
warnungOk.addEventListener('click', () => {
  void browser.storage.local.set({ [WARNUNG_SPIRALE_SCHLUESSEL]: true }).then(zeichneWarnung, zeichneWarnung);
});

beiEinstellungsAenderung(zeichne);
void ladeEinstellungen().then(zeichne);
void ladePackKurz().then(zeichnePack);
void zeichneWarnung();
browser.storage.onChanged.addListener((aenderungen: Record<string, unknown>, bereich: string) => {
  if (bereich !== 'local') return;
  if (PACK_SPEICHER_SCHLUESSEL in aenderungen) void ladePackKurz().then(zeichnePack);
  if (QUIZ_WARNUNG_SCHLUESSEL in aenderungen || WARNUNG_SPIRALE_SCHLUESSEL in aenderungen) void zeichneWarnung();
});
