// Popup: Statuszeile, Pause, Schwelle ("Mia's mood"), Stil, Strict, Zonen und Ausnahme fuer den aktuellen Host.
// Alle Einstellungen laufen ueber src/einstellungen.ts (storage.local); der Schleier reagiert ueber storage.onChanged.
import liste from '../../data/ausnahmen-standard.json';
import { musterAusListe, passtAusnahme, zerlegeMuster } from '../../scripts/ausnahmen-muster.mjs';
import {
  BEDECKBARE_ZONEN,
  SCHWELLE_MAX,
  SCHWELLE_MIN,
  ZONEN,
  aendereEinstellungen,
  beiEinstellungsAenderung,
  ladeEinstellungen,
  type Einstellungen,
  type Stil,
  type Zone,
} from '../../src/einstellungen';

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

const standardMuster: string[] = musterAusListe(liste);

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element ${id} fehlt`);
  return e as T;
}

const statusZeile = el<HTMLParagraphElement>('status');
const pauseKnopf = el<HTMLButtonElement>('pause');
const stimmung = el<HTMLInputElement>('stimmung');
const stimmungWert = el<HTMLOutputElement>('stimmung-wert');
const strict = el<HTMLInputElement>('strict');
const zonenListe = el<HTMLUListElement>('zonen');
const ausnahmeKnopf = el<HTMLButtonElement>('ausnahme');
const ausnahmeHinweis = el<HTMLParagraphElement>('ausnahme-hinweis');
const stilFelder = [...document.querySelectorAll<HTMLInputElement>('input[name="stil"]')];

let aktuell: Einstellungen | null = null;
let seite: URL | null = null;

// ---------- Aktueller Tab ----------

async function leseSeite(): Promise<URL | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url ?? '');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// Muster fuer die eigene Ausnahme: der Host ohne fuehrendes "www." (deckt dann auch Subdomains).
function musterFuerSeite(url: URL): string | null {
  const muster = url.hostname.toLowerCase().replace(/^www\./, '');
  return zerlegeMuster(muster) ? muster : null;
}

// ---------- Anzeige ----------

function statusText(e: Einstellungen): string {
  if (e.pause) return "Paused. That's always allowed. Resume whenever you like, I'll be here.";
  if (!seite) return 'Nothing to veil on this page. Everywhere else, I have it covered.';
  if (passtAusnahme(seite, standardMuster)) return 'This one is on my never-touch list. Nothing is covered here.';
  if (passtAusnahme(seite, e.ausnahmen)) return "I'm leaving this site alone, as you asked.";
  return "On watch. I'll keep the pages quiet for you.";
}

function zeichne(e: Einstellungen): void {
  aktuell = e;
  statusZeile.textContent = statusText(e);

  pauseKnopf.textContent = e.pause ? 'Let Mia back in' : 'Pause Mia';
  pauseKnopf.setAttribute('aria-pressed', String(e.pause));

  if (document.activeElement !== stimmung) stimmung.value = e.schwelle.toFixed(2);
  stimmungWert.textContent = e.schwelle.toFixed(2);

  for (const feld of stilFelder) feld.checked = feld.value === e.stil;
  strict.checked = e.strict;

  for (const zone of ZONEN) {
    const an = document.querySelector<HTMLInputElement>(`input[data-zone="${zone}"]`);
    if (an) an.checked = e.zonen[zone].an;
    const bedeckt = document.querySelector<HTMLInputElement>(`input[data-bedeckt="${zone}"]`);
    if (bedeckt) {
      bedeckt.checked = !!e.zonen[zone].bedeckt;
      bedeckt.disabled = !e.zonen[zone].an;
    }
  }

  zeichneAusnahme(e);
}

function zeichneAusnahme(e: Einstellungen): void {
  const muster = seite ? musterFuerSeite(seite) : null;
  if (!seite || !muster) {
    ausnahmeKnopf.textContent = 'Leave this site alone';
    ausnahmeKnopf.disabled = true;
    ausnahmeHinweis.textContent = 'Nothing to leave alone on this page.';
    return;
  }
  if (passtAusnahme(seite, standardMuster)) {
    ausnahmeKnopf.textContent = 'Already on the never-touch list';
    ausnahmeKnopf.disabled = true;
    ausnahmeHinweis.textContent = `${muster} stays untouched. Banks and the like are always safe from me.`;
    return;
  }
  ausnahmeKnopf.disabled = false;
  if (passtAusnahme(seite, e.ausnahmen)) {
    ausnahmeKnopf.textContent = 'Mia may return here';
    ausnahmeHinweis.textContent = `${muster} is on your list of sites I leave alone.`;
  } else {
    ausnahmeKnopf.textContent = 'Leave this site alone';
    ausnahmeHinweis.textContent = `Adds ${muster} to your list. I'll stay out of it.`;
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
    bedeckt.type = 'checkbox';
    bedeckt.dataset.bedeckt = zone;
    auch.append(bedeckt, document.createTextNode('also covered'));
    zeile.append(auch);
  }
  zonenListe.append(zeile);
}

// ---------- Aenderungen schreiben (immer auf den frisch geladenen Stand aufsetzen) ----------

// Die Funktion wird innerhalb der Kette von aendereEinstellungen auf den frisch gelesenen Stand angewendet (atomar auch gegen
// Hintergrund und Content-Skripte).
async function aendere(teil: (alt: Einstellungen) => Partial<Einstellungen>): Promise<void> {
  zeichne(await aendereEinstellungen(teil));
}

pauseKnopf.addEventListener('click', () => void aendere((alt) => ({ pause: !alt.pause })));

stimmung.min = String(SCHWELLE_MIN);
stimmung.max = String(SCHWELLE_MAX);
// Beim Ziehen nur die Zahl nachfuehren; gespeichert wird erst beim Loslassen (change). Jede Speicherung setzt auf allen Seiten
// alle Urteile zurueck, ein Schreiben im Takt waehrend des Ziehens liesse sie laufend neu pruefen.
stimmung.addEventListener('input', () => {
  stimmungWert.textContent = Number(stimmung.value).toFixed(2);
});
stimmung.addEventListener('change', () => {
  void aendere(() => ({ schwelle: Number(stimmung.value) }));
});

for (const feld of stilFelder) {
  feld.addEventListener('change', () => {
    if (feld.checked) void aendere(() => ({ stil: feld.value as Stil }));
  });
}

strict.addEventListener('change', () => void aendere(() => ({ strict: strict.checked })));

zonenListe.addEventListener('change', (ereignis) => {
  const feld = ereignis.target as HTMLInputElement;
  const zone = (feld.dataset.zone ?? feld.dataset.bedeckt) as Zone | undefined;
  if (!zone) return;
  void aendere((alt) => {
    const z = { ...alt.zonen[zone] };
    if (feld.dataset.zone) z.an = feld.checked;
    else z.bedeckt = feld.checked;
    return { zonen: { ...alt.zonen, [zone]: z } };
  });
});

ausnahmeKnopf.addEventListener('click', () => {
  if (!seite) return;
  const url = seite;
  const muster = musterFuerSeite(url);
  if (!muster) return;
  void aendere((alt) => {
    const steht = passtAusnahme(url, alt.ausnahmen);
    // Entfernen: alle eigenen Muster, die diese Seite treffen. Hinzufuegen: das Host-Muster, ohne Doppelte.
    const ausnahmen = steht
      ? alt.ausnahmen.filter((m) => !passtAusnahme(url, [m]))
      : [...new Set([...alt.ausnahmen, muster])];
    return { ausnahmen };
  });
});

// ---------- Start ----------

el<HTMLSpanElement>('version').textContent = `v${browser.runtime.getManifest().version}`;

const abmelden = beiEinstellungsAenderung(zeichne);
window.addEventListener('pagehide', abmelden, { once: true });

void (async () => {
  seite = await leseSeite();
  zeichne(await ladeEinstellungen());
})();
