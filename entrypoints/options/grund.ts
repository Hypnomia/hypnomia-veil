// Einstellungsseite, Grundeinstellungen (Session 11, Auftrag S, Entscheidung 133): Status und Pause, Stimmung, Zonen, Stil und Strict.
// Dieselben Einstellungen wie im Popup, derselbe Speicher (src/einstellungen.ts); beide Seiten zeigen nach einer Aenderung denselben Stand.
// Texte nur per textContent.
import {
  BEDECKBARE_ZONEN,
  SCHWELLE_MAX,
  SCHWELLE_MIN,
  ZONEN,
  beiEinstellungsAenderung,
  ladeEinstellungen,
  type Einstellungen,
  type Stil,
  type Zone,
} from '../../src/einstellungen';
import { HINWEIS_PACK_OHNE_PATCH, stimmungsWort } from '../../src/oberflaeche/gemeinsam';
import { speichere } from './grund-speichern';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, wirksamerStil, kurzAusRoh, type PackKurz } from '../../src/pack/vertrag';

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
const stilFelder = [...document.querySelectorAll<HTMLInputElement>('input[name="stil"]')];
const stilHinweis = el<HTMLParagraphElement>('stil-hinweis');

let pack: PackKurz | null = null;
let aktuell: Einstellungen | null = null;

// ---------- Anzeige ----------

// Fund 6: ein Wort statt der rohen Schwelle, auch als aria-valuetext (die Zahl bleibt im Wert des Reglers).
function zeigeStimmung(schwelle: number): void {
  const wort = stimmungsWort(schwelle);
  stimmungWert.textContent = wort;
  stimmung.setAttribute('aria-valuetext', wort);
}

function statusText(e: Einstellungen): string {
  return e.pause ? 'Paused on every page. I’ll be here when you want me back.' : 'On watch. I’ll keep the pages quiet for you.';
}

// Stilwahl: Mia patch ist ohne Pack gesperrt (Hinweis auf das Pack), mit Pack waehlbar. Angezeigt wird der Stil, der wirklich gilt.
function zeichneStil(e: Einstellungen): void {
  const frei = istFreigeschaltet(pack, 'stil:mia-patch');
  const gilt = wirksamerStil(e.stil, pack);
  for (const feld of stilFelder) {
    feld.checked = feld.value === gilt;
    if (feld.value === 'mia-patch') {
      feld.disabled = !frei;
      feld.closest('label')?.classList.toggle('gesperrt', !frei);
    }
  }
  stilHinweis.textContent = frei
    ? `Mia patch uses ${pack?.bilder ?? 0} of my pictures from your Mia Pack.`
    : pack
      ? HINWEIS_PACK_OHNE_PATCH
      : 'Mia patch needs the Mia Pack. Add it further down and I can cover things with my own pictures.';
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

  zeichneStil(e);
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
async function aendere(teil: (alt: Einstellungen) => Partial<Einstellungen>): Promise<void> {
  // Bei Erfolg normal zeichnen (ein Regler mit Fokus laesst sich bei schneller Tastenfolge nicht zurueckstellen), beim Scheitern erzwungen.
  const neu = await speichere(teil, (e) => zeichne(e, true), false);
  if (neu) zeichne(neu);
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

for (const feld of stilFelder) {
  feld.addEventListener('change', () => {
    const stil = feld.value as Stil;
    if (feld.checked) void aendere(() => ({ stil }));
  });
}

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
  const markiere = (): void => {
    const oben = (leiste?.getBoundingClientRect().bottom ?? 0) + 12;
    let aktuellerChip: HTMLAnchorElement | null = null;
    for (const a of chips) {
      const ziel = document.getElementById(a.getAttribute("href")!.slice(1));
      // Lesung Runde 3, Nr. 3: leere oder verborgene Abschnitte (noch nicht gefuellt, vor dem Einstieg) zaehlen nicht.
      if (!ziel || ziel.hidden || ziel.getClientRects().length === 0) continue;
      if (ziel.getBoundingClientRect().top <= oben) aktuellerChip = a;
    }
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
  zeichne(await ladeEinstellungen());
})();
