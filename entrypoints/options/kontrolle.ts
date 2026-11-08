// Einstellungsseite, Abschnitt "Mia’s control" (Phase 5, Vertrag Session 9, Orchestrator). Schalter fuer Werbe-Tausch, Blitzwoerter und
// Leerlauf-Spirale; wie der Abschnitt "Adult sites" auch ohne Pack einstellbar (wirkt erst mit Pack und Freischaltung). Die Warnung vor
// Fotosensibilitaet erscheint, solange sie weder im Quiz noch auf der Spirale noch hier bestaetigt wurde.
import { speichere, zeigeSpeicherFehler } from './grund-speichern';
import {
  BLITZ_HAEUFIGKEITEN,
  CURSOR_ARTEN,
  MAX_STRENGE_ZEITEN,
  type CursorArt,
  type StrengeZeit,
  LEERLAUF_MAX_MINUTEN,
  LEERLAUF_MIN_MINUTEN,
  beiEinstellungsAenderung,
  ladeEinstellungen,
  type BlitzHaeufigkeit,
  type Einstellungen,
} from '../../src/einstellungen';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import { QUIZ_WARNUNG_SCHLUESSEL, WARNUNG_SPIRALE_SCHLUESSEL } from '../../src/kontrolle/grenzen';
import { minutenAusText, textAusMinuten } from '../../src/kontrolle/streng';

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
// Session 10
const tabtitel = el<HTMLInputElement>('kon-tabtitel');
const cursor = el<HTMLSelectElement>('kon-cursor');
const meldungen = el<HTMLInputElement>('kon-meldungen');
const besuche = el<HTMLInputElement>('kon-besuche');
const zeitenListe = el<HTMLDivElement>('kon-zeiten');
const zeitNeu = el<HTMLButtonElement>('kon-zeit-neu');

// Wochentage in der Anzeige ab Montag; Werte wie Date.getDay() (0 Sonntag).
const TAGE: readonly { wert: number; name: string }[] = [
  { wert: 1, name: 'Mon' },
  { wert: 2, name: 'Tue' },
  { wert: 3, name: 'Wed' },
  { wert: 4, name: 'Thu' },
  { wert: 5, name: 'Fri' },
  { wert: 6, name: 'Sat' },
  { wert: 0, name: 'Sun' },
];
// Neues Fenster: jeden Tag 21:00 bis 23:00 (die Person stellt es danach ein).
const NEUE_ZEIT: StrengeZeit = { tage: [0, 1, 2, 3, 4, 5, 6], von: 21 * 60, bis: 23 * 60 };

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
  tabtitel.checked = e.kontrolle.tabtitel;
  if (erzwingen || document.activeElement !== cursor) cursor.value = e.kontrolle.cursor;
  meldungen.checked = e.kontrolle.meldungen;
  besuche.checked = e.kontrolle.besuche;
  // Die Liste nur neu bauen, wenn niemand gerade darin arbeitet (sonst verliert ein Zeitfeld den Fokus mitten in der Eingabe).
  if (erzwingen || !zeitenListe.contains(document.activeElement)) zeichneZeiten(e.kontrolle.zeiten);
}

function zeichneZeiten(zeiten: readonly StrengeZeit[]): void {
  zeitenListe.replaceChildren();
  zeiten.forEach((z, i) => {
    const zeile = document.createElement('div');
    zeile.className = 'zeit-zeile';
    zeile.setAttribute('role', 'listitem');
    zeile.dataset.index = String(i);
    // Gezeichneter Stand der Zeile: Aendern und Entfernen wirken nur, wenn die Zeile im Speicher noch genau so aussieht (ein anderes Fenster
    // kann inzwischen eine Zeile entfernt haben, Pruefer-Fund 2).
    zeile.dataset.stand = JSON.stringify(z);
    const nr = i + 1;
    const tage = document.createElement('fieldset');
    tage.className = 'zeit-tage';
    const legende = document.createElement('legend');
    legende.textContent = `Days of strict time ${nr}`;
    tage.append(legende);
    for (const t of TAGE) {
      const lab = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.tag = String(t.wert);
      box.checked = z.tage.includes(t.wert);
      lab.append(box, document.createTextNode(t.name));
      tage.append(lab);
    }
    const von = document.createElement('input');
    von.type = 'time';
    von.className = 'zeit-von';
    von.value = textAusMinuten(z.von);
    von.setAttribute('aria-label', `Strict time ${nr} from`);
    const bis = document.createElement('input');
    bis.type = 'time';
    bis.className = 'zeit-bis';
    bis.value = textAusMinuten(z.bis);
    bis.setAttribute('aria-label', `Strict time ${nr} until`);
    const zwischen = document.createElement('span');
    zwischen.textContent = 'to';
    // Gleiche Zeiten heissen ganzer Tag, ein Ende vor dem Beginn reicht in den naechsten Tag (Pruefer-Fund 9; Entwurf, Texter liest gegen).
    const art = document.createElement('span');
    art.className = 'zeit-art hinweis';
    art.textContent = z.von === z.bis ? 'all day' : z.bis < z.von ? 'until the next day' : '';
    const weg = document.createElement('button');
    weg.type = 'button';
    weg.className = 'klein zeit-weg';
    weg.textContent = 'Remove';
    weg.setAttribute('aria-label', `Remove strict time ${nr}`);
    weg.addEventListener('click', () => {
      void speichere(
        (alt) =>
          JSON.stringify(alt.kontrolle.zeiten[i]) === zeile.dataset.stand
            ? { kontrolle: { ...alt.kontrolle, zeiten: alt.kontrolle.zeiten.filter((_, j) => j !== i) } }
            : {},
        sp,
      ).then((neu) => {
        if (!neu) return;
        // Fokus nicht auf body fallen lassen (Pruefer-Fund 4): auf "Remove" der Zeile, die nachrueckt, sonst auf "Add strict time".
        const naechste = zeitenListe.querySelectorAll<HTMLButtonElement>('.zeit-weg')[Math.min(i, neu.kontrolle.zeiten.length - 1)];
        (naechste ?? zeitNeu).focus();
      });
    });
    zeile.append(tage, von, zwischen, bis, art, weg);
    zeitenListe.append(zeile);
  });
  zeitNeu.hidden = zeiten.length >= MAX_STRENGE_ZEITEN;
}

// Liest eine Zeile der Liste; ungueltige Felder (leer, halb getippt) behalten den alten Wert.
function liesZeile(zeile: HTMLElement, alt: StrengeZeit): StrengeZeit {
  const tage = [...zeile.querySelectorAll<HTMLInputElement>('input[data-tag]')].filter((b) => b.checked).map((b) => Number(b.dataset.tag));
  const von = minutenAusText(zeile.querySelector<HTMLInputElement>('.zeit-von')?.value ?? '');
  const bis = minutenAusText(zeile.querySelector<HTMLInputElement>('.zeit-bis')?.value ?? '');
  return { tage: tage.length ? tage : alt.tage, von: von ?? alt.von, bis: bis ?? alt.bis };
}

// Phase 9: die Werbe-Frage "Show my ads?" lebt jetzt in der Pack-Karte (Paket C); dieser Schalter bleibt der Weg, sie spaeter zu aendern.
function zeichnePack(pack: PackKurz | null): void {
  const mit = (
    ['kontrolle:werbung', 'kontrolle:blitz', 'kontrolle:leerlauf', 'kontrolle:tabtitel', 'kontrolle:cursor', 'kontrolle:meldungen', 'kontrolle:zeitplan', 'kontrolle:besuche'] as const
  ).some((f) => istFreigeschaltet(pack, f));
  // Pack von 0.5.0: die Teile aus Session 10 fehlen still, darum ein eigener Hinweis (Pruefer-Fund 11; Entwurf, Texter liest gegen).
  const teilweise = mit && (['kontrolle:tabtitel', 'kontrolle:cursor', 'kontrolle:meldungen', 'kontrolle:zeitplan', 'kontrolle:besuche'] as const).some(
    (f) => !istFreigeschaltet(pack, f),
  );
  hinweis.textContent = teilweise
    ? 'Some of this needs a newer Mia Pack. Add it in the Mia Pack section to unlock the rest. Pause Mia stops it all.'
    : mit
    ? 'I run all of this. You pick how much, and Pause Mia stops it all.'
    : pack
      ? 'This part needs a newer Mia Pack than yours. Add the newer one in the Mia Pack section to unlock it.'
      : 'Everything below Calm mode needs the Mia Pack. Set it now and it’ll be ready.';
}

async function zeichneWarnung(): Promise<void> {
  try {
    const a = await browser.storage.local.get([QUIZ_WARNUNG_SCHLUESSEL, WARNUNG_SPIRALE_SCHLUESSEL]);
    warnung.hidden = a[QUIZ_WARNUNG_SCHLUESSEL] === true || a[WARNUNG_SPIRALE_SCHLUESSEL] === true;
  } catch {
    warnung.hidden = false;
  }
}

// Fund 26: Speichern ueber die gemeinsame Stelle, bei Fehler Satz in der Leiste und zurueck auf den gespeicherten Stand.
function sp(e: Einstellungen): void {
  zeichne(e, true);
}
werbung.addEventListener('change', () => {
  const wert = werbung.checked;
  // Wer den Schalter selbst bedient, hat geantwortet: die Frage verschwindet.
  void speichere((alt) => ({ kontrolle: { ...alt.kontrolle, werbung: wert, werbungGefragt: true } }), sp);
});
blitz.addEventListener('change', () => {
  const wert = blitz.value as BlitzHaeufigkeit;
  if (!(BLITZ_HAEUFIGKEITEN as readonly string[]).includes(wert)) return;
  void speichere((alt) => ({ kontrolle: { ...alt.kontrolle, blitz: wert } }), sp);
});
leerlauf.addEventListener('change', () => {
  const wert = leerlauf.checked;
  void speichere((alt) => ({ kontrolle: { ...alt.kontrolle, leerlauf: wert } }), sp);
});
minuten.addEventListener('change', () => {
  const roh = minuten.value.trim();
  const zahl = Number(roh);
  // Leeres oder ungueltiges Feld: alter Wert bleibt (nie still die kuerzeste Zeit). Zahlen ausserhalb der Grenzen begrenzt vervollstaendige();
  // danach zeigt zeichne() den gespeicherten Wert, auch im Feld mit Fokus.
  void speichere(
    (alt) => ({
      kontrolle: { ...alt.kontrolle, leerlaufMinuten: roh !== '' && Number.isFinite(zahl) ? zahl : alt.kontrolle.leerlaufMinuten },
    }),
    sp,
  );
});
// Nach dem Verlassen eines Feldes den gespeicherten Stand zeigen (Aenderungen aus anderen Fenstern, die waehrend des Fokus kamen).
for (const feld of [blitz, minuten, cursor]) feld.addEventListener('blur', () => zuletzt && zeichne(zuletzt, true));
tabtitel.addEventListener('change', () => {
  const wert = tabtitel.checked;
  void speichere((alt) => ({ kontrolle: { ...alt.kontrolle, tabtitel: wert } }), sp);
});
cursor.addEventListener('change', () => {
  const wert = cursor.value as CursorArt;
  if (!(CURSOR_ARTEN as readonly string[]).includes(wert)) return;
  void speichere((alt) => ({ kontrolle: { ...alt.kontrolle, cursor: wert } }), sp);
});
meldungen.addEventListener('change', () => {
  const wert = meldungen.checked;
  void speichere((alt) => ({ kontrolle: { ...alt.kontrolle, meldungen: wert } }), sp);
});
besuche.addEventListener('change', () => {
  const wert = besuche.checked;
  void speichere((alt) => ({ kontrolle: { ...alt.kontrolle, besuche: wert } }), sp);
});
// Eine Zeile speichern: nur, wenn sie im Speicher noch so aussieht wie gezeichnet; sonst nichts aendern und neu zeichnen. Der letzte Tag
// laesst sich nicht abwaehlen (ohne Tag gilt der alte Stand).
function speichereZeile(zeile: HTMLElement): void {
  const i = Number(zeile.dataset.index);
  if (!Number.isInteger(i)) return;
  let veraltet = false;
  void speichere((alt) => {
    const z = alt.kontrolle.zeiten[i];
    if (!z || JSON.stringify(z) !== zeile.dataset.stand) {
      veraltet = true;
      return {};
    }
    const zeiten = alt.kontrolle.zeiten.map((x, j) => (j === i ? liesZeile(zeile, x) : x));
    return { kontrolle: { ...alt.kontrolle, zeiten } };
  }, sp, false).then((neu) => {
    if (!neu) return;
    if (veraltet) return zeichne(neu, true);
    const z = neu.kontrolle.zeiten[i];
    if (!z) return;
    zeile.dataset.stand = JSON.stringify(z);
    // Haken auf den gespeicherten Stand (z. B. letzter Tag wieder an) und Hinweis zur Art; der Fokus bleibt im Feld.
    for (const b of zeile.querySelectorAll<HTMLInputElement>('input[data-tag]')) b.checked = z.tage.includes(Number(b.dataset.tag));
    const art = zeile.querySelector<HTMLElement>('.zeit-art');
    if (art) art.textContent = z.von === z.bis ? 'all day' : z.bis < z.von ? 'until the next day' : '';
  });
}
// Wochentage speichern sofort; Zeitfelder erst beim Verlassen des Feldes (Chrome meldet `change` schon fuer jedes getippte Teilfeld, sonst
// entstuenden kurzlebige strenge Zeiten in allen Tabs, Pruefer-Fund 3).
zeitenListe.addEventListener('change', (ereignis) => {
  const ziel = ereignis.target as HTMLInputElement | null;
  if (ziel?.type !== 'checkbox') return;
  const zeile = ziel.closest<HTMLElement>('.zeit-zeile');
  if (zeile) speichereZeile(zeile);
});
zeitenListe.addEventListener('focusout', (ereignis) => {
  const ziel = ereignis.target as HTMLInputElement | null;
  const zeile = ziel?.type === 'time' ? ziel.closest<HTMLElement>('.zeit-zeile') : null;
  if (zeile) speichereZeile(zeile);
  else if (!zeitenListe.contains(ereignis.relatedTarget as Node | null) && zuletzt) zeichne(zuletzt, true);
});
zeitNeu.addEventListener('click', () => {
  void speichere(
    (alt) => ({
      kontrolle: { ...alt.kontrolle, zeiten: alt.kontrolle.zeiten.length >= MAX_STRENGE_ZEITEN ? alt.kontrolle.zeiten : [...alt.kontrolle.zeiten, NEUE_ZEIT] },
    }),
    sp,
  ).then((neu) => {
    if (!neu) return;
    // Fokus auf das erste Zeitfeld der neuen Zeile (Pruefer-Fund 4).
    zeitenListe.querySelector<HTMLInputElement>('.zeit-zeile:last-child .zeit-von')?.focus();
  });
});
warnungOk.addEventListener('click', () => {
  // Runde 3, N3: nach dem Bestaetigen verschwindet der Knopf; der Fokus geht zur Auswahl der Blitzwoerter, die die Warnung betrifft.
  void browser.storage.local.set({ [WARNUNG_SPIRALE_SCHLUESSEL]: true }).then(async () => {
    await zeichneWarnung();
    if (warnung.hidden) el<HTMLSelectElement>('kon-blitz').focus();
  }, () => {
    zeigeSpeicherFehler();
    return zeichneWarnung();
  });
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
