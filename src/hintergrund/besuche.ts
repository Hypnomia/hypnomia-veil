// Pflicht-Besuche, Hintergrund (Auftrag Z2, Session 10, PHASE-5-AUFTRAEGE-SESSION-10.md Abschnitt 7). Die Seite bittet nach ihrem Hinweis um einen
// Besuch (`hintergrund/besuch`); der Hintergrund traut ihr nicht und prueft alle Schutzregeln selbst (src/besuche/plan.ts `besuchAblehnung`):
// Absender oberste Seite, Pack und Freischaltung, Schalter, Pause, eigene Ausnahme, Tab aktiv, Fenster fokussiert und nicht im Vollbild, und
// `besuchZuletzt` mindestens 2 Stunden her (harte Grenze unabhaengig vom Plan der Seite). Erst wird `besuchZuletzt` geschrieben, dann der Tab
// geoeffnet (neben dem Absender, im Vordergrund). Kein neues Recht. Im Testbau oeffnet er `about:blank#veil-besuch` statt der echten Adresse
// (kein Netz in Tests) und meldet die gewaehlte Adresse in der Antwort; `besuch-test { vergiss }` loescht `besuchZuletzt` (nur Testbau).
import { passtAusnahme } from '../../scripts/ausnahmen-muster.mjs';
import links from '../../data/links.json' with { type: 'json' };
import { BESUCH_PLAN_SCHLUESSEL, BESUCH_ZULETZT_SCHLUESSEL, besuchAblehnung, neuerBesuchPlan } from '../besuche/plan';
import { fensterLage, nebenTabEigenschaften } from '../fenster';
import { SPEICHER_SCHLUESSEL, ladeEinstellungen, vervollstaendige } from '../einstellungen';
import type { AntwortBesuch, NachrichtHintergrundBesuch, NachrichtHintergrundBesuchTest } from '../nachrichten';
import { istFreigeschaltet, ladePackKurz } from '../pack/vertrag';

interface Absender {
  tab?: { id?: number; url?: string; windowId?: number; index?: number };
  frameId?: number;
  url?: string;
}

const TESTBAU = import.meta.env.WXT_TESTHAKEN === '1';
const TEST_ADRESSE: string = TESTBAU ? 'about:blank#veil-besuch' : '';

// Alle Adressen der Marke (ohne den Kommentarschluessel).
function besuchsAdressen(): string[] {
  return Object.entries(links as Record<string, unknown>)
    .filter(([k, v]) => k !== 'LIES-MICH' && typeof v === 'string' && /^https:\/\//.test(v))
    .map(([, v]) => v as string);
}

// Anfragen laufen nacheinander: zwei Fenster, die gleichzeitig fragen, duerfen nicht beide die 2-Stunden-Grenze passieren.
let kette: Promise<unknown> = Promise.resolve();

export function bearbeiteBesuch(n: NachrichtHintergrundBesuch, absender?: Absender): Promise<AntwortBesuch> {
  const lauf = kette.then(() => arbeite(n, absender));
  kette = lauf.catch(() => undefined);
  return lauf.catch((e): AntwortBesuch => ({ ok: false, grund: `fehler: ${String(e).slice(0, 120)}` }));
}

async function arbeite(_n: NachrichtHintergrundBesuch, absender?: Absender): Promise<AntwortBesuch> {
  const tabId = absender?.tab?.id;
  const [e, pack, gespeichert] = await Promise.all([ladeEinstellungen(), ladePackKurz(), browser.storage.local.get(BESUCH_ZULETZT_SCHLUESSEL)]);
  const zuletztRoh = gespeichert[BESUCH_ZULETZT_SCHLUESSEL];
  const zuletzt = typeof zuletztRoh === 'number' ? zuletztRoh : null;
  const jetzt = Date.now();

  // Zustand des Tabs und seines Fensters aus dem Browser, nie aus der Nachricht.
  let tab: { id?: number; active?: boolean; windowId?: number; index?: number } | null = null;
  let fensterFokus = false;
  let vollbild = false;
  if (typeof tabId === 'number') {
    try {
      tab = await browser.tabs.get(tabId);
    } catch {
      tab = null;
    }
    // Fenster-Lage getrennt vom Tab: ein Fehler beim Fenster verwirft den Tab nicht (Android hat kein `browser.windows`, siehe fenster.ts).
    if (tab && typeof tab.windowId === 'number') {
      const lage = await fensterLage(tab.windowId);
      fensterFokus = lage.fokus;
      vollbild = lage.vollbild;
    }
  }
  let ausnahme = false;
  try {
    const u = new URL(absender?.tab?.url ?? '');
    ausnahme = passtAusnahme({ hostname: u.hostname, pathname: u.pathname }, e.ausnahmen);
  } catch {
    ausnahme = false;
  }
  const grund = besuchAblehnung({
    frameNull: absender?.frameId === 0,
    tabBekannt: tab !== null && typeof tab.windowId === 'number',
    packFrei: istFreigeschaltet(pack, 'kontrolle:besuche'),
    schalterAn: e.kontrolle.besuche === true,
    pause: e.pause === true,
    ausnahme,
    tabAktiv: tab?.active === true,
    fensterFokus,
    fensterVollbild: vollbild,
    zuletzt,
    jetzt,
  });
  if (grund) {
    // Wert aus der Zukunft (Uhr ging zurueck): als jetzt neu schreiben, damit die Sperre hoechstens 2 Stunden dauert.
    if (grund === 'zu-frueh' && zuletzt !== null && zuletzt > jetzt) await browser.storage.local.set({ [BESUCH_ZULETZT_SCHLUESSEL]: jetzt });
    return { ok: false, grund };
  }

  const adressen = besuchsAdressen();
  if (adressen.length === 0) return { ok: false, grund: 'keine-adresse' };
  const url = adressen[Math.min(adressen.length - 1, Math.floor(Math.random() * adressen.length))]!;

  // Zuerst merken, danach oeffnen: geht das Oeffnen schief, kommt der alte Stand zurueck (kein Besuch verloren, keiner doppelt).
  await browser.storage.local.set({ [BESUCH_ZULETZT_SCHLUESSEL]: jetzt });
  try {
    const neu = await browser.tabs.create(
      nebenTabEigenschaften(TESTBAU ? TEST_ADRESSE : url, { tabId, windowId: tab!.windowId, index: tab!.index }),
    );
    return { ok: true, url, tabId: typeof neu.id === 'number' ? neu.id : null };
  } catch (fehler) {
    try {
      if (zuletzt === null) await browser.storage.local.remove(BESUCH_ZULETZT_SCHLUESSEL);
      else await browser.storage.local.set({ [BESUCH_ZULETZT_SCHLUESSEL]: zuletzt });
    } catch {
      // Speicher weg: dann bleibt die Sperre eben stehen
    }
    return { ok: false, grund: `oeffnen: ${String(fehler).slice(0, 120)}` };
  }
}

export async function bearbeiteBesuchTest(n: NachrichtHintergrundBesuchTest, absender?: Absender): Promise<unknown> {
  if (!TESTBAU) return { ok: false, fehler: 'nur im Testbau' };
  if (typeof absender?.tab?.id !== 'number' || absender.frameId !== 0) return { ok: false, fehler: 'kein Tab' };
  try {
    const vorher = (await browser.storage.local.get(BESUCH_ZULETZT_SCHLUESSEL))[BESUCH_ZULETZT_SCHLUESSEL];
    if (n.vergiss === true) await browser.storage.local.remove(BESUCH_ZULETZT_SCHLUESSEL);
    return { ok: true, vorher: typeof vorher === 'number' ? vorher : null };
  } catch (e) {
    return { ok: false, fehler: String(e) };
  }
}

// Beim Wechsel des Schalters von aus auf an beginnt der Plan sofort "ab jetzt" (kein Besuch gleich nach dem Einschalten), auch wenn in keinem Tab
// ein Content-Script laeuft. Idempotent; background.ts ruft es oben im Skript (Listener muessen beim Aufwachen sofort stehen).
let gestartet = false;
export function starteBesuche(): void {
  if (gestartet) return;
  gestartet = true;
  browser.storage.onChanged.addListener((aenderungen, bereich) => {
    if (bereich !== 'local' || !(SPEICHER_SCHLUESSEL in aenderungen)) return;
    const alt = vervollstaendige(aenderungen[SPEICHER_SCHLUESSEL]?.oldValue);
    const neu = vervollstaendige(aenderungen[SPEICHER_SCHLUESSEL]?.newValue);
    if (neu.kontrolle.besuche && !alt.kontrolle.besuche) {
      void browser.storage.local.set({ [BESUCH_PLAN_SCHLUESSEL]: neuerBesuchPlan(Date.now(), Math.random()) }).catch(() => undefined);
    }
  });
}
