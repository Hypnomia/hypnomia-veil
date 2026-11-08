// Einstellungsseite, Ordnung (Phase 9, Session 17, Paket B; UX-Funde 4, 8, 14): ordnet die Gruppen, klappt ohne Pack Adult sites, Mia’s control und
// Sound zu, hängt die runden "?"-Knoepfe der Hilfe an und zeigt den Hinweis zu "weniger Bewegung". Laeuft nach den Modulen, die ihre Abschnitte fuellen
// (main.ts importiert dieses Modul zuletzt). Alle Texte nur per textContent.
import { hilfeAdresse, type HilfeAnker } from '../../src/hilfe/anker';
import { TESTHAKEN } from '../../src/schleier/konstanten';
import { ZU_TEXTE } from './ordnung-texte';
import { PACK_SPEICHER_SCHLUESSEL, kurzAusRoh, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';

function neu<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------- Zuklappen ohne Pack (Fund 4) ----------

// Ohne Pack tun diese Karten nichts: Titel, ein Satz Nutzen und "Set them now". Mit Pack ist alles offen wie bisher. Was bei "behalten" steht, bleibt
// immer offen (Calm mode ist Sicherheit).


const ZU: readonly { id: 'erwachsen' | 'kontrolle' | 'ton'; behalten: readonly string[] }[] = [
  { id: 'erwachsen', behalten: [] },
  { id: 'kontrolle', behalten: ['ruhig-zeile', 'ruhig-system'] },
  { id: 'ton', behalten: [] },
];

interface Zu {
  readonly abschnitt: HTMLElement;
  readonly satz: HTMLElement;
  readonly knopf: HTMLButtonElement;
  readonly block: HTMLElement;
  offen: boolean;
}
const zus: Zu[] = [];
let packBekannt = false;
let mitPack = false;

function zeichneZu(z: Zu): void {
  // Bis das Pack gelesen ist, bleibt alles offen (kein Flackern fuer Leute mit Pack, nichts Verborgenes ohne Wissen).
  const zu = packBekannt && !mitPack && !z.offen;
  z.block.hidden = zu;
  z.satz.hidden = !zu;
  z.knopf.hidden = !zu;
  z.knopf.setAttribute('aria-expanded', String(!zu));
  z.abschnitt.dataset.zu = zu ? '1' : '0';
}

for (const { id, behalten } of ZU) {
  const abschnitt = document.getElementById(id);
  const kopf = abschnitt?.firstElementChild;
  if (!abschnitt || !kopf) continue;
  const block = neu('div', 'zu-block');
  block.id = `${id}-block`;
  const inhalt = [...abschnitt.children].filter((k) => k !== kopf && !behalten.includes(k.id));
  block.append(...inhalt);
  const satz = neu('p', 'hinweis zu-satz', ZU_TEXTE[id]);
  satz.id = `${id}-zu-satz`;
  const knopf = neu('button', 'klein zu-knopf', ZU_TEXTE.knopf);
  knopf.id = `${id}-zu-knopf`;
  knopf.type = 'button';
  knopf.setAttribute('aria-controls', block.id);
  abschnitt.append(satz, knopf, block);
  const z: Zu = { abschnitt, satz, knopf, block, offen: false };
  knopf.addEventListener('click', () => {
    z.offen = true;
    zeichneZu(z);
    // Der Fokus bleibt nicht auf dem verschwundenen Knopf: er geht zum ersten sichtbaren Bedienelement der aufgeklappten Karte, sonst auf ihre
    // Ueberschrift (erste Lesung 17, Fund 17: ein Element in einem verborgenen Teil nimmt keinen Fokus, er fiele auf body).
    const ziel = [...block.querySelectorAll<HTMLElement>('input:not([disabled]), select, button:not([disabled])')].find((e) => e.getClientRects().length > 0);
    if (ziel) ziel.focus();
    else if (kopf instanceof HTMLElement) {
      if (!kopf.hasAttribute('tabindex')) kopf.tabIndex = -1;
      kopf.focus();
    }
  });
  zus.push(z);
  zeichneZu(z);
}

// ---------- Reihenfolge (Fund 4) ----------

// Ohne Pack steht die Pack-Karte gleich nach "Covering" (der wichtigste naechste Schritt), mit Pack nach "Sound". Die Chips folgen.
function ordne(): void {
  const stand = document.getElementById('stand');
  const chip = document.querySelector<HTMLAnchorElement>('#sprung a[href="#stand"]');
  const nach = mitPack ? document.getElementById('ton') : document.getElementById('covering');
  const chipNach = document.querySelector<HTMLAnchorElement>(mitPack ? '#sprung a[href="#ton"]' : '#sprung a[href="#covering"]');
  if (stand && nach && stand.previousElementSibling !== nach) nach.after(stand);
  if (chip && chipNach && chip.previousElementSibling !== chipNach) chipNach.after(chip);
}

// Sprung beim Oeffnen (Popup oeffnet "#stand" oder "#neu"): der Browser springt sofort, die Reihenfolge der Karten steht aber erst, wenn das
// Pack gelesen ist; unter Last rutschte der Abschnitt danach aus dem Blick (Session 18, Wackler popup "Fund 7"). In den ersten Sekunden haelt die
// Seite den Anker darum im Blick, bis die Person selbst rollt, tippt oder klickt.
const ANKER_HALTEN_MS = 3000;
let halteAnker = (): void => {};
(() => {
  const id = (() => {
    try {
      return decodeURIComponent(location.hash.slice(1));
    } catch {
      return '';
    }
  })();
  if (!id || !document.getElementById(id)) return;
  const EINGRIFFE = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
  let aus = false;
  const lage = typeof ResizeObserver === 'function' ? new ResizeObserver(() => halteAnker()) : null;
  const ende = (): void => {
    aus = true;
    lage?.disconnect();
    for (const t of EINGRIFFE) removeEventListener(t, ende, true);
  };
  halteAnker = () => {
    if (!aus) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  };
  lage?.observe(document.body);
  for (const t of EINGRIFFE) addEventListener(t, ende, { capture: true, passive: true });
  setTimeout(ende, ANKER_HALTEN_MS);
})();

function setzePack(pack: PackKurz | null): void {
  packBekannt = true;
  mitPack = pack !== null;
  for (const z of zus) zeichneZu(z);
  ordne();
  halteAnker();
  // Testhaken (nur Testbau, ohne Wirkung): die Seite hat gelesen, ob ein Pack da ist, Zuklappen und Reihenfolge stehen.
  if (TESTHAKEN) document.body.setAttribute('data-veil-ordnung', 'bereit');
}

void ladePackKurz().then(setzePack, () => setzePack(null));
browser.storage.onChanged.addListener((aenderungen: Record<string, { newValue?: unknown }>, bereich: string) => {
  if (bereich === 'local' && PACK_SPEICHER_SCHLUESSEL in aenderungen) setzePack(kurzAusRoh(aenderungen[PACK_SPEICHER_SCHLUESSEL]?.newValue));
});

// ---------- Hilfe-Knoepfe (Fund 14) ----------

// Runder "?"-Knopf neben dem Element, oeffnet die Hilfe am Anker in neuem Tab. Das Element und der Knopf stehen in einer Zeile.
const HILFEN: readonly { wo: string; kurz: HilfeAnker; name: string; label?: boolean }[] = [
  { wo: '#erw-titel', kurz: 'adult', name: 'Adult sites' },
  { wo: '#stufe-titel', kurz: 'adult', name: 'How hot do I get?' },
  { wo: '#erw-ersatz-zeile', kurz: 'full-replacement', name: 'Full replacement' },
  { wo: '#erw-inhalt', kurz: 'adult', name: 'Spot adult pages by content', label: true },
  { wo: '#quiz-titel', kurz: 'quiz', name: 'Quiz' },
  { wo: '#stil-titel', kurz: 'pack', name: 'Mia patch' },
  { wo: '#ruhig-zeile', kurz: 'calm', name: 'Calm mode' },
  { wo: '#kon-werbung-zeile', kurz: 'ads', name: 'My ads' },
  { wo: '#kon-zeiten-titel', kurz: 'strict-times', name: 'Strict times' },
];

export function hilfeKnopf(kurz: HilfeAnker, name: string): HTMLAnchorElement {
  const a = neu('a', 'hilfe-rund', '?');
  a.href = hilfeAdresse(kurz);
  a.target = '_blank';
  a.rel = 'noopener';
  a.setAttribute('aria-label', `Help: ${name}`);
  a.title = `Help: ${name}`;
  a.dataset.hilfe = kurz;
  return a;
}

for (const h of HILFEN) {
  let ziel = document.querySelector<HTMLElement>(h.wo);
  if (h.label) ziel = ziel?.closest<HTMLElement>('label') ?? null;
  if (!ziel || !ziel.parentElement) continue;
  const zeile = neu('div', 'mit-hilfe');
  ziel.before(zeile);
  zeile.append(ziel, hilfeKnopf(h.kurz, h.name));
}

// ---------- Weniger Bewegung (Fund 8) ----------

// Meldet das System "weniger Bewegung", wirkt Calm mode schon (ruhigGewuenscht); der Schalter bleibt bedienbar und die Wirkung unveraendert.
const ruhigSystem = document.getElementById('ruhig-system');
if (ruhigSystem && typeof matchMedia === 'function') {
  const anfrage = matchMedia('(prefers-reduced-motion: reduce)');
  const zeige = (): void => {
    ruhigSystem.hidden = !anfrage.matches;
  };
  zeige();
  anfrage.addEventListener?.('change', zeige);
}
