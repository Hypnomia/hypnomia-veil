// Hintergrund: Mia’s Ledger (Auftrag L, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 5, PHASE-6-BAUPLAN Abschnitt 4). Ablage nur storage.local
// `ledger`, nur Zahlen, nie Adressen oder Titel, kein Netzverkehr. Aenderungen laufen nacheinander (Lesen, Rechnen, Schreiben), damit zwei Tabs
// sich nicht ueberschreiben. Summen (`ledger`) nehme ich nur von Content-Scripts (Absender mit Tab und einer Seitenadresse, nie von
// Erweiterungsseiten); `ledger-loeschen` nur von Erweiterungsseiten (Adresse der Erweiterung). Die Minuten auf Erwachsenenseiten und die
// hoechste Stufe kommen aus `notiereLedgerMinute`, das background.ts nach jeder `steigerung-minute` ruft.
import { ladeEinstellungen } from '../einstellungen';
import { LEDGER_SCHLUESSEL, type Ledger } from '../ledger/vertrag';
import { FEHLER_ABSENDER, FEHLER_SUMME, addiere, geloescht, minuteFaellig, mitStufe, neuerTag, pruefePlus, uhrMinute, vervollstaendigeLedger } from '../ledger/logik';
import type { NachrichtHintergrundLedger, NachrichtHintergrundLedgerLoeschen, NachrichtHintergrundSteigerungMinute } from '../nachrichten';
import { STEIGERUNG_SCHLUESSEL, vervollstaendigeStand as steigerungStand, wirksameStufe } from '../steigerung';

interface Absender {
  id?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number };
}

const TESTBAU = import.meta.env.WXT_TESTHAKEN === '1';
// Uhr-Minute der letzten gezaehlten Erwachsenen-Minute (ueber alle Tabs, ueberlebt das Schlafen des Service Workers).
const MINUTE_SCHLUESSEL = 'ledgerMinute';

let kette: Promise<unknown> = Promise.resolve();
function nacheinander<T>(arbeit: () => Promise<T>): Promise<T> {
  const lauf = kette.then(arbeit);
  kette = lauf.catch(() => undefined);
  return lauf;
}

// Aendert den Stand innerhalb der Kette auf dem frisch gelesenen Wert; schreibt nur bei einer Aenderung (oder wenn noch nichts da ist).
function aendereLedger(aenderung: (alt: Ledger, jetzt: Date) => Ledger): Promise<Ledger> {
  return nacheinander(async () => {
    const jetzt = new Date();
    const ablage = await browser.storage.local.get(LEDGER_SCHLUESSEL);
    const roh = ablage[LEDGER_SCHLUESSEL];
    const alt = vervollstaendigeLedger(roh, jetzt);
    const neu = aenderung(alt, jetzt);
    if (roh === undefined || JSON.stringify(neu) !== JSON.stringify(roh)) {
      await browser.storage.local.set({ [LEDGER_SCHLUESSEL]: neu });
    }
    return neu;
  });
}

function vonErweiterungsseite(absender: Absender | undefined): boolean {
  try {
    return (absender?.url ?? '').startsWith(browser.runtime.getURL('/'));
  } catch {
    return false;
  }
}

// Beim Start: es gibt einen Stand (`seit` = Installation bzw. erster Start) und der Tag ist der heutige.
export function starteLedger(): void {
  aendereLedger((l, jetzt) => neuerTag(l, jetzt)).catch((e) => console.warn('Ledger: Start fehlgeschlagen', e));
}

// Summe aus einem Content-Script. Absender: ein Tab mit Seitenadresse, nie eine Erweiterungsseite.
export async function bearbeiteLedger(n: NachrichtHintergrundLedger, absender?: Absender): Promise<unknown> {
  if (typeof absender?.tab?.id !== 'number' || vonErweiterungsseite(absender)) return { ok: false, fehler: FEHLER_ABSENDER };
  const plus = pruefePlus(n.plus);
  if (!plus) return { ok: false, fehler: FEHLER_SUMME };
  await aendereLedger((alt, jetzt) => addiere(alt, plus, jetzt));
  return { ok: true };
}

// "Clear my ledger": nur von Erweiterungsseiten (Einstellungsseite). Alles 0, `seit` jetzt.
export async function bearbeiteLedgerLoeschen(_n: NachrichtHintergrundLedgerLoeschen, absender?: Absender): Promise<unknown> {
  if (!vonErweiterungsseite(absender)) return { ok: false, fehler: 'nur von der Einstellungsseite' };
  await aendereLedger((_alt, jetzt) => geloescht(jetzt));
  return { ok: true };
}

// Nach jeder `steigerung-minute` (gerufen aus background.ts, nach der Steigerung): eine Minute auf Erwachsenenseiten, hoechstens eine je
// Uhr-Minute ueber alle Tabs, und die hoechste Stufe aus dem gespeicherten Stand der Steigerung. In der Pause zaehlt nichts.
// Gewollt (Orchestrator): `steigerung-minute` kommt nur mit der Pack-Freischaltung `zensur:steigerung`; ohne Pack bleiben
// `erwachsenMinuten` und `hoechsteStufe` darum 0. Vom Absender (Adresse, Tab) wird nichts gespeichert, nur die Zahlen.
export async function notiereLedgerMinute(n: NachrichtHintergrundSteigerungMinute, absender?: Absender): Promise<void> {
  // Betrieb: nur der oberste Frame eines Tabs (wie bei den Meldungen). Testbau (Regel 6, nichts zaehlt von selbst): nur Erweiterungsseiten, damit
  // Tests die Minute gezielt schicken koennen und der Melder-Takt echter Seiten nichts zaehlt.
  if (TESTBAU) {
    if (!vonErweiterungsseite(absender)) return;
  } else if (typeof absender?.tab?.id !== 'number' || absender.frameId !== 0 || vonErweiterungsseite(absender)) return;
  const einstellungen = await ladeEinstellungen();
  if (einstellungen.pause) return;
  const erwachsen = n.erwachsen === true;
  await nacheinander(async () => {
    const jetzt = new Date();
    const ablage = await browser.storage.local.get([LEDGER_SCHLUESSEL, MINUTE_SCHLUESSEL, STEIGERUNG_SCHLUESSEL]);
    const roh = ablage[LEDGER_SCHLUESSEL];
    let l = neuerTag(vervollstaendigeLedger(roh, jetzt), jetzt);
    const letzte = typeof ablage[MINUTE_SCHLUESSEL] === 'number' && Number.isFinite(ablage[MINUTE_SCHLUESSEL]) ? (ablage[MINUTE_SCHLUESSEL] as number) : -1;
    const zaehlt = erwachsen && minuteFaellig(letzte, jetzt.getTime());
    if (zaehlt) l = addiere(l, { erwachsenMinuten: 1 }, jetzt);
    l = mitStufe(l, wirksameStufe(steigerungStand(ablage[STEIGERUNG_SCHLUESSEL]), jetzt.getTime()));
    if (roh === undefined || JSON.stringify(l) !== JSON.stringify(roh) || zaehlt) {
      await browser.storage.local.set({ [LEDGER_SCHLUESSEL]: l, ...(zaehlt ? { [MINUTE_SCHLUESSEL]: uhrMinute(jetzt.getTime()) } : {}) });
    }
  });
}
