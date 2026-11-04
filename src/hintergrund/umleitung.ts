// Hintergrund-Handler fuer den Komplett-Ersatz (Auftrag U, PHASE-4-BAUPLAN Abschnitte 3 und 8 Punkt 7): Umleitung der Listen-Domains
// (src/adapter/liste.ts, alleDomains) auf die Galerie, nur mit Pack (`erwachsen:ersatz`) plus `erwachsen.komplettErsatz` plus nicht Pause,
// Abgleich bei onStartup, onInstalled, storage.onChanged. `starteUmleitung` wird beim Start des Hintergrunds einmal aufgerufen.
//
// Ein Weg fuer beide Browser: eine dynamische declarativeNetRequest-Regel (`main_frame`, `requestDomains` = Listen-Domains plus eigene
// Seiten, `excludedRequestDomains` = Hosts der eigenen Ausnahmen). Die Regel haengt die Originaladresse roh hinter `?ziel=` der Galerie.
// Nie fuer am Inhalt erkannte Seiten: die Regel kennt nur Domains aus der Liste und den eigenen Seiten (alleDomains).
//
// Bekannte Grenzen (bewusst so, nicht behebbar oder nicht gewollt):
// - Fragment (#...): die Regel sieht es nicht, die Galerie bekommt es nicht mit; nach dem Zurueck fehlt das Fragment.
// - POST und andere Methoden: die Umleitung ist ein GET auf die Galerie, die Rueckkehr ebenfalls (Formularinhalt geht verloren).
// - Schon offene Tabs: eine Regel greift nur bei neuen Navigationen; bereits geladene Listen-Seiten bleiben bis zum naechsten Aufruf stehen.
import { zerlegeMuster } from '../../scripts/ausnahmen-muster.mjs';
import { alleDomains } from '../adapter/liste.ts';
import { SPEICHER_SCHLUESSEL, ladeEinstellungen, type Einstellungen } from '../einstellungen.ts';
import type { NachrichtHintergrundUmleitungAbgleich } from '../nachrichten.ts';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, type PackKurz } from '../pack/vertrag.ts';

type Regel = NonNullable<Parameters<typeof browser.declarativeNetRequest.updateDynamicRules>[0]['addRules']>[number];

// Dynamische Regeln haben ihren eigenen ID-Raum (die Referer-Regeln sind Sitzungsregeln ab 1000).
export const UMLEITUNG_REGEL_ID = 1;
export const GALERIE_PFAD = '/galerie.html';
export const GALERIE_ZIEL_PARAMETER = 'ziel';

// Soll die Umleitung gerade gelten? Die einzige Stelle, die das entscheidet (Hintergrund und Galerie fragen sie beide).
export function ersatzAktiv(e: Einstellungen, pack: PackKurz | null | undefined): boolean {
  // Mit lesbaren Vorschau-Bildern (sonst haette die Galerie nichts zu zeigen) und nur bei eingeschaltetem Pornoseiten-Modus.
  return !e.pause && e.erwachsen.an && e.erwachsen.komplettErsatz && istFreigeschaltet(pack, 'erwachsen:ersatz') && (pack?.vorschau ?? 0) > 0;
}

// Eigene Ausnahmen des Nutzers, soweit sie ein reiner Host sind (Muster mit Pfad lassen sich nicht als Domain ausnehmen).
export function ausnahmeHosts(ausnahmen: readonly string[]): string[] {
  const aus = new Set<string>();
  for (const roh of ausnahmen) {
    const z = zerlegeMuster(roh);
    // Fuehrendes www. faellt weg: requestDomains deckt Domain und alle Subdomains (also auch www) ab.
    if (z && !z.pfad) aus.add(z.host.replace(/^www\./, ''));
  }
  return [...aus];
}

function istFirefox(): boolean {
  try {
    return import.meta.env.FIREFOX === true;
  } catch {
    return false; // Node (Einheitstests): wie Chrome
  }
}

// Die Regel fuer den aktuellen Stand der Einstellungen (null: es soll keine geben).
export function baueUmleitungRegel(e: Einstellungen, pack: PackKurz | null | undefined, galerieAdresse: string): Regel | null {
  if (!ersatzAktiv(e, pack)) return null;
  // Zwischenstand bis Session 8 (Entscheidung 107): in Chrome ist die Galerie nur fuer Listen-Domains abrufbar; eigene Seiten wuerden bei
  // jedem Klick auf einer Fehlerseite enden und werden darum dort nicht umgeleitet. Firefox leitet auch eigene Seiten um.
  const domains = alleDomains(istFirefox() ? e.erwachsen.eigeneSeiten : []);
  if (domains.length === 0) return null;
  const ausnahmen = ausnahmeHosts(e.ausnahmen);
  return {
    id: UMLEITUNG_REGEL_ID,
    priority: 1,
    action: { type: 'redirect', redirect: { regexSubstitution: `${galerieAdresse}?${GALERIE_ZIEL_PARAMETER}=\\1` } },
    condition: {
      regexFilter: '^(https?://.*)$',
      requestDomains: domains,
      ...(ausnahmen.length > 0 ? { excludedRequestDomains: ausnahmen } : {}),
      resourceTypes: ['main_frame'],
    },
  };
}

// Aenderungen laufen nacheinander (zwei schnelle Abgleiche duerfen sich nicht ueberholen).
let kette: Promise<unknown> = Promise.resolve();

async function schreibeRegel(): Promise<void> {
  const [e, pack] = await Promise.all([ladeEinstellungen(), ladePackKurz()]);
  const galerie = (browser.runtime.getURL as (pfad: string) => string)(GALERIE_PFAD);
  const regel = baueUmleitungRegel(e, pack, galerie);
  try {
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [UMLEITUNG_REGEL_ID],
      ...(regel ? { addRules: [regel] } : {}),
    });
  } catch (fehler) {
    // Neue Regel abgelehnt: die alte darf nicht stehen bleiben (sie koennte nach Pause oder Schalter aus noch umleiten).
    await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [UMLEITUNG_REGEL_ID] }).catch(() => undefined);
    throw fehler;
  }
}

// Liest den Stand und setzt oder entfernt die Regel. Scheitert es, wird einmal neu gelesen (der Stand kann sich zwischenzeitlich geaendert haben).
export function gleicheUmleitungAb(): Promise<void> {
  const lauf = kette.then(async () => {
    try {
      await schreibeRegel();
    } catch {
      await schreibeRegel();
    }
  });
  kette = lauf.catch(() => undefined);
  return lauf;
}

export function starteUmleitung(): void {
  const abgleich = () => void gleicheUmleitungAb().catch((e) => console.warn('Umleitung: Abgleich fehlgeschlagen', e));
  browser.runtime.onStartup.addListener(abgleich);
  browser.runtime.onInstalled.addListener(abgleich);
  // Einstellungen (Pause, Schalter, eigene Seiten, Ausnahmen) und Pack (importiert, entfernt) aendern die Regel sofort.
  browser.storage.onChanged.addListener((aenderungen, bereich) => {
    if (bereich === 'local' && (SPEICHER_SCHLUESSEL in aenderungen || PACK_SPEICHER_SCHLUESSEL in aenderungen)) abgleich();
  });
  // Jedes Aufwachen des Hintergrunds gleicht ebenfalls ab (der Browser kann Regeln und Stand zwischen den Starts auseinanderlaufen lassen).
  abgleich();
}

export async function bearbeiteUmleitung(_n: NachrichtHintergrundUmleitungAbgleich): Promise<unknown> {
  await gleicheUmleitungAb();
  return { ok: true };
}
