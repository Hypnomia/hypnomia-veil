// Hintergrund-Handler fuer die Steigerung der Zensur (Auftrag S, PHASE-4-BAUPLAN Abschnitt 9, Entscheidung 101). Vertrag: src/steigerung.ts
// und NachrichtHintergrundSteigerungMinute/-Uhr in src/nachrichten.ts. Ablage nur storage.local `steigerung`, kein Netzverkehr.
// Aenderungen laufen nacheinander (Lesen, Rechnen, Schreiben), damit zwei Fenster in derselben Minute nicht doppelt zaehlen.
import { SPEICHER_SCHLUESSEL, ladeEinstellungen, vervollstaendige } from '../einstellungen';
import type { NachrichtHintergrundSteigerungMinute, NachrichtHintergrundSteigerungUhr } from '../nachrichten';
import { istFreigeschaltet, ladePackKurz } from '../pack/vertrag';
import {
  STEIGERUNG_SCHLUESSEL,
  klemmeAufJetzt,
  minuteZaehlt,
  setzePause,
  verbucheMinute,
  verschiebeZeit,
  vervollstaendigeStand,
  type SteigerungStand,
} from '../steigerung';

// Spur des Testhakens in storage.local (die Release-Pruefung sucht den Namen, er steht nur im Testbau).
const TESTHAKEN_SCHLUESSEL = 'steigerungUhrVor';

let kette: Promise<unknown> = Promise.resolve();
function nacheinander<T>(arbeit: () => Promise<T>): Promise<T> {
  const lauf = kette.then(arbeit);
  kette = lauf.catch(() => undefined);
  return lauf;
}

async function ladeStand(): Promise<SteigerungStand> {
  const ablage = await browser.storage.local.get(STEIGERUNG_SCHLUESSEL);
  return vervollstaendigeStand(ablage[STEIGERUNG_SCHLUESSEL]);
}

function aendereStand(aenderung: (alt: SteigerungStand) => SteigerungStand): Promise<SteigerungStand> {
  return nacheinander(async () => {
    const alt = await ladeStand();
    const neu = aenderung(alt);
    if (neu !== alt) await browser.storage.local.set({ [STEIGERUNG_SCHLUESSEL]: neu });
    return neu;
  });
}

// Pause verfolgen: Beginn und Ende der Pause im Stand vermerken (Abbau steht waehrend der Pause).
export function starteSteigerung(): void {
  browser.storage.onChanged.addListener((aenderungen, bereich) => {
    if (bereich !== 'local' || !(SPEICHER_SCHLUESSEL in aenderungen)) return;
    const neu = vervollstaendige(aenderungen[SPEICHER_SCHLUESSEL]?.newValue);
    const alt = aenderungen[SPEICHER_SCHLUESSEL]?.oldValue === undefined ? null : vervollstaendige(aenderungen[SPEICHER_SCHLUESSEL]?.oldValue);
    if (alt && alt.pause === neu.pause) return;
    gleichePauseAb().catch((e) => console.warn('Steigerung: Pause vermerken fehlgeschlagen', e));
  });
  // Start des Hintergrunds: Pause-Stand angleichen (z. B. Pause war beim Beenden des Browsers an).
  gleichePauseAb().catch(() => {});
}

// Pause immer innerhalb der Kette frisch lesen: ein vorher gelesener Wert koennte eine spaetere Aenderung ueberschreiben.
function gleichePauseAb(): Promise<SteigerungStand> {
  return nacheinander(async () => {
    const [e, alt] = await Promise.all([ladeEinstellungen(), ladeStand()]);
    const neu = setzePause(alt, e.pause, Date.now());
    if (neu !== alt) await browser.storage.local.set({ [STEIGERUNG_SCHLUESSEL]: neu });
    return neu;
  });
}

// Absender des Testhakens: nur Erweiterungsseiten oder Seiten auf dem Testhost (127.0.0.1, localhost).
interface Absender {
  tab?: { id?: number };
  url?: string;
}
function testAbsenderErlaubt(absender: Absender | undefined): boolean {
  try {
    const adresse = absender?.url ?? '';
    // Kein Origin-Vergleich: Erweiterungsadressen haben je nach Browser den Ursprung "null".
    if (adresse.startsWith(browser.runtime.getURL('/'))) return true;
    const url = new URL(adresse);
    return (url.protocol === 'http:' || url.protocol === 'https:') && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  } catch {
    return false;
  }
}

export async function bearbeiteSteigerung(
  n: NachrichtHintergrundSteigerungMinute | NachrichtHintergrundSteigerungUhr,
  absender?: Absender,
): Promise<unknown> {
  if (n.typ === 'steigerung-uhr') {
    // Testhaken: im Release-Bau faellt der Zweig samt Spur weg.
    if (import.meta.env.WXT_TESTHAKEN !== '1' || !testAbsenderErlaubt(absender)) return { ok: false, fehler: 'nur im Testbau' };
    const vorMs = typeof n.vorMs === 'number' && Number.isFinite(n.vorMs) ? n.vorMs : 0;
    const stand = await aendereStand((s) => verschiebeZeit(s, vorMs));
    await browser.storage.local.set({ [TESTHAKEN_SCHLUESSEL]: vorMs });
    return { ok: true, stand };
  }
  const [pack, einstellungen] = await Promise.all([ladePackKurz(), ladeEinstellungen()]);
  if (!istFreigeschaltet(pack, 'zensur:steigerung') || einstellungen.pause) return { ok: true, gezaehlt: false };
  const zensiert = typeof n.zensiert === 'number' && Number.isFinite(n.zensiert) ? Math.max(0, n.zensiert) : 0;
  if (!minuteZaehlt(n.erwachsen === true, zensiert)) return { ok: true, gezaehlt: false };
  let gezaehlt = false;
  const stand = await aendereStand((s) => {
    const jetzt = Date.now();
    const geklemmt = klemmeAufJetzt(s, jetzt);
    const neu = verbucheMinute(geklemmt, jetzt, Math.random);
    gezaehlt = neu !== geklemmt;
    return neu;
  });
  return { ok: true, gezaehlt, stand };
}
