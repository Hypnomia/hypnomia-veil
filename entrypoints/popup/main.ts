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
import { STEIGERUNG_SCHLUESSEL, anzeigeStufe, vervollstaendigeStand, type SteigerungStand } from '../../src/steigerung';
import { STUFEN_TEXT, formatiereRest, hatErwachsenFunktionen, posePopup, waehleSatz } from '../../src/oberflaeche/erwachsen';
import { zeigeChibi } from '../../src/oberflaeche/chibi-platz';
import type { Texte } from '../../src/quiz/vertrag';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, wirksamerStil, type PackKurz } from '../../src/pack/vertrag';

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
const packHinweis = el<HTMLParagraphElement>('pack-hinweis');
const packLink = el<HTMLButtonElement>('pack-link');

const erwAn = el<HTMLInputElement>('erw-an');
const erwErsatz = el<HTMLInputElement>('erw-ersatz');
const erwErsatzZeile = el<HTMLLabelElement>('erw-ersatz-zeile');
const erwInhalt = el<HTMLInputElement>('erw-inhalt');
const erwSchalter = el<HTMLDivElement>('erwachsen-schalter');
const erwHinweis = el<HTMLParagraphElement>('erwachsen-hinweis');
const erwPackLink = el<HTMLButtonElement>('erwachsen-pack-link');
const erwChibi = el<HTMLImageElement>('erwachsen-chibi');
const steigerungBlock = el<HTMLDivElement>('steigerung');
const stufeZeile = el<HTMLParagraphElement>('stufe-zeile');
const stufeZeit = el<HTMLParagraphElement>('stufe-zeit');
const stufeText = el<HTMLParagraphElement>('stufe-text');

let stand: SteigerungStand = vervollstaendigeStand(undefined);
let texte: Texte | null = null;
const zufall = Math.random(); // ein Satz je Oeffnen des Popups, kein Flackern bei jeder Aenderung
let chibiPose = '';

let aktuell: Einstellungen | null = null;
let pack: PackKurz | null = null;
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
  if (e.pause) return "Paused on every page. I'll be here when you want me back.";
  if (!seite) return 'Nothing to veil on this page. Everywhere else, I have it covered.';
  if (passtAusnahme(seite, standardMuster)) return 'This site is on my never-touch list: banks, mail, that sort of thing. Nothing is covered here.';
  if (passtAusnahme(seite, e.ausnahmen)) return "You asked me to skip this site, so I'm leaving it alone.";
  return "On watch. I'll keep the pages quiet for you.";
}

function zeichne(e: Einstellungen): void {
  aktuell = e;
  statusZeile.textContent = statusText(e);

  pauseKnopf.textContent = e.pause ? 'Let Mia back in' : 'Pause Mia';
  pauseKnopf.setAttribute('aria-pressed', String(e.pause));

  if (document.activeElement !== stimmung) stimmung.value = e.schwelle.toFixed(2);
  stimmungWert.textContent = e.schwelle.toFixed(2);

  zeichneStil(e);
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
  zeichneErwachsen(e);
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
  packHinweis.textContent = frei
    ? `Mia patch uses ${pack?.bilder ?? 0} of my pictures from your pack.`
    : 'Add the Mia Pack and I can cover things with my own pictures.';
  packLink.textContent = frei ? 'Mia Pack settings' : 'Add the Mia Pack';
}

function zeichneAusnahme(e: Einstellungen): void {
  const muster = seite ? musterFuerSeite(seite) : null;
  if (!seite || !muster) {
    ausnahmeKnopf.textContent = 'Leave this site alone';
    ausnahmeKnopf.disabled = true;
    ausnahmeHinweis.textContent = 'Not available on this page.';
    return;
  }
  if (passtAusnahme(seite, standardMuster)) {
    ausnahmeKnopf.textContent = 'On the never-touch list';
    ausnahmeKnopf.disabled = true;
    ausnahmeHinweis.textContent = `${muster} stays untouched. Banks and the like are always safe from me.`;
    return;
  }
  ausnahmeKnopf.disabled = false;
  if (passtAusnahme(seite, e.ausnahmen)) {
    ausnahmeKnopf.textContent = 'Let Mia back on this site';
    ausnahmeHinweis.textContent = `${muster} is on your list of sites I leave alone.`;
  } else {
    ausnahmeKnopf.textContent = 'Leave this site alone';
    ausnahmeHinweis.textContent = `I'll skip ${muster} from now on. You can undo it here anytime.`;
  }
}

// ---------- Adult sites ----------

// Schalter nur mit Pack (und passender Freischaltung), sonst ein Hinweis. Die Steigerung nur mit `zensur:steigerung`.
function zeichneErwachsen(e: Einstellungen): void {
  // Drei Lagen: kein Pack (Hinweis und Weg zum Pack), Pack ohne Erwachsenen-Freischaltung (Abschnitt bleibt still), Pack mit Funktionen.
  const mitErw = hatErwachsenFunktionen(pack);
  const mitSteigerung = istFreigeschaltet(pack, 'zensur:steigerung');
  const ohnePack = !pack;
  el<HTMLElement>('erwachsen').hidden = !ohnePack && !mitErw && !mitSteigerung;
  erwSchalter.hidden = !mitErw;
  // Die Saetze zu Adult-site mode nur mit `erwachsen:vorschau`; sonst bleibt der Hinweis verborgen (ausser ohne Pack).
  erwHinweis.hidden = !ohnePack && !istFreigeschaltet(pack, 'erwachsen:vorschau');
  erwPackLink.hidden = !ohnePack;
  erwAn.checked = e.erwachsen.an;
  erwErsatz.checked = e.erwachsen.komplettErsatz;
  erwInhalt.checked = e.erwachsen.erkennenAmInhalt;
  erwAn.closest('label')!.hidden = !istFreigeschaltet(pack, 'erwachsen:vorschau');
  erwErsatzZeile.hidden = !istFreigeschaltet(pack, 'erwachsen:ersatz');
  steigerungBlock.hidden = !mitSteigerung;
  if (ohnePack) {
    erwHinweis.textContent = 'These sites need the Mia Pack. Add it and I’ll look after them properly.';
  } else if (e.pause) {
    erwHinweis.textContent = "Paused, so I'm keeping my hands off these sites too.";
  } else {
    erwHinweis.textContent = e.erwachsen.an ? "I know the usual places. Nothing there gets by me." : 'Adult-site mode is off. I’m leaving these sites alone.';
  }
  zeichneStufe(e);
}

function zeichneStufe(e: Einstellungen): void {
  const hat = istFreigeschaltet(pack, 'zensur:steigerung');
  const a = anzeigeStufe(stand, Date.now());
  const pose = posePopup(e.pause, hat ? a.stufe : 0);
  if (pose !== chibiPose) {
    chibiPose = pose;
    erwChibi.dataset.pose = pose;
    void zeigeChibi(erwChibi, pose, pack);
  }
  // Sekundentakt nur, solange die Steigerung sichtbar ist.
  if (hat && tickerId === null) tickerId = window.setInterval(() => aktuell && zeichneStufe(aktuell), 1000);
  if (!hat && tickerId !== null) {
    clearInterval(tickerId);
    tickerId = null;
  }
  if (!hat) return;
  stufeZeile.textContent = `Level ${a.stufe} of 4`;
  // Pause zaehlt sofort (Einstellungen), nicht erst, wenn der Hintergrund `pauseSeit` geschrieben hat.
  if (a.stufe === 0) stufeZeit.textContent = 'Nothing to count down yet.';
  else if (e.pause || a.pausiert) stufeZeit.textContent = "Paused, so the clock stands still. It picks up where it stopped.";
  else stufeZeit.textContent = `Next level down in ${formatiereRest(a.bisAbsenkungMs ?? 0)}`;
  const gruppe = texte?.gruppen[`stufe${a.stufe}` as 'stufe1'];
  stufeText.textContent = waehleSatz(a.stufe === 0 ? undefined : gruppe, STUFEN_TEXT[a.stufe], zufall);
}
let tickerId: number | null = null;
window.addEventListener('pagehide', () => {
  if (tickerId !== null) clearInterval(tickerId);
  tickerId = null;
});

erwAn.addEventListener('change', () => void aendere((alt) => ({ erwachsen: { ...alt.erwachsen, an: erwAn.checked } })));
erwErsatz.addEventListener('change', () => void aendere((alt) => ({ erwachsen: { ...alt.erwachsen, komplettErsatz: erwErsatz.checked } })));
erwInhalt.addEventListener('change', () => void aendere((alt) => ({ erwachsen: { ...alt.erwachsen, erkennenAmInhalt: erwInhalt.checked } })));
erwPackLink.addEventListener('click', () => {
  void browser.runtime.openOptionsPage().then(() => window.close());
});

async function ladeStand(): Promise<void> {
  const a = await browser.storage.local.get(STEIGERUNG_SCHLUESSEL);
  stand = vervollstaendigeStand(a[STEIGERUNG_SCHLUESSEL]);
}

async function ladeTexte(): Promise<void> {
  const kennung = pack ? `${pack.id}|${pack.importiert}` : '';
  if (!pack || (!hatErwachsenFunktionen(pack) && !istFreigeschaltet(pack, 'zensur:steigerung'))) {
    texte = null;
    return;
  }
  let neu: Texte | null = null;
  try {
    const antwort = (await browser.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' })) as { ok?: boolean; daten?: unknown };
    const d = antwort?.daten as Texte | null | undefined;
    neu = d && typeof d === 'object' && 'gruppen' in d ? d : null;
  } catch {
    neu = null;
  }
  // Nur uebernehmen, wenn das Pack in der Zwischenzeit nicht gewechselt hat.
  if (pack && `${pack.id}|${pack.importiert}` === kennung) texte = neu;
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
    auch.append(bedeckt, document.createTextNode('even when clothed'));
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

// Einstellungsseite des Packs oeffnen; das Popup schliesst sich danach von selbst (Firefox) bzw. wir schliessen es.
packLink.addEventListener('click', () => {
  void browser.runtime.openOptionsPage().then(() => window.close());
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
// Das Pack (storage.local.pack) kann sich aendern, waehrend das Popup offen ist (Import auf der Einstellungsseite).
const packHorcher = (aenderungen: Record<string, { newValue?: unknown }>, bereich: string): void => {
  if (bereich === 'local' && STEIGERUNG_SCHLUESSEL in aenderungen) {
    stand = vervollstaendigeStand(aenderungen[STEIGERUNG_SCHLUESSEL]?.newValue);
    if (aktuell) zeichneStufe(aktuell);
  }
  if (bereich !== 'local' || !(PACK_SPEICHER_SCHLUESSEL in aenderungen)) return;
  const neu = aenderungen[PACK_SPEICHER_SCHLUESSEL]?.newValue as PackKurz | undefined;
  pack = neu && typeof neu === 'object' && typeof neu.id === 'string' ? neu : null;
  chibiPose = '';
  texte = null;
  void ladeTexte().then(() => aktuell && zeichneStufe(aktuell));
  if (aktuell) zeichne(aktuell);
};
browser.storage.onChanged.addListener(packHorcher);
window.addEventListener(
  'pagehide',
  () => {
    abmelden();
    browser.storage.onChanged.removeListener(packHorcher);
  },
  { once: true },
);

void (async () => {
  seite = await leseSeite();
  pack = await ladePackKurz().catch(() => null);
  await ladeStand().catch(() => undefined);
  zeichne(await ladeEinstellungen());
  // Pack-Texte danach nachladen, nur die Stufen-Anzeige neu zeichnen.
  void ladeTexte().then(() => aktuell && zeichneStufe(aktuell));
})();
