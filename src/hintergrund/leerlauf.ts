// Leerlauf-Erkennung fuer die Spirale (Auftrag L, Phase 5, PHASE-5-AUFTRAEGE-SESSION-9.md Abschnitt 5). `starteLeerlauf()` registriert die
// Listener oben im Hintergrundskript (Ereignisseite und Service Worker wachen dafuer auf), `bearbeiteLeerlaufTest()` beantwortet den Testhaken
// `leerlauf-test` (nur WXT_TESTHAKEN, sonst `ok: false`). Kein neues Recht ausser `idle`.
// Ablauf: `browser.idle.setDetectionInterval(Minuten * 60)` (bei jeder Aenderung der Einstellungen neu); wird der Zustand `idle`, schicken wir
// (nur mit Pack, Freischaltung `kontrolle:leerlauf` und Schalter an, ohne Pause) `inhalt/leerlauf { an: true }` an Frame 0 des aktiven Tabs im
// zuletzt fokussierten Fenster; bei `active` oder `locked` `{ an: false }` an genau diesen Tab (gemerkt in storage.session, ueberlebt einen
// Neustart des Hintergrunds). Im Testbau wertet der Hintergrund `browser.idle` nicht aus: `leerlauf-test` spielt den Wechsel vor, Ziel ist der Tab
// des Absenders.
import { ladeEinstellungen, SPEICHER_SCHLUESSEL, vervollstaendige } from '../einstellungen';
import type { NachrichtHintergrundLeerlaufTest, NachrichtInhaltLeerlauf } from '../nachrichten';
import { istFreigeschaltet, ladePackKurz } from '../pack/vertrag';

interface Absender {
  tab?: { id?: number };
  frameId?: number;
}

const TESTBAU = import.meta.env.WXT_TESTHAKEN === '1';
const TAB_SCHLUESSEL = 'leerlauf-tab';

type Sitzung = { get(k: string): Promise<Record<string, unknown>>; set(o: Record<string, unknown>): Promise<void>; remove(k: string | string[]): Promise<void> };
function sitzung(): Sitzung | null {
  return (browser.storage as unknown as { session?: Sitzung }).session ?? null;
}

// Zuletzt gesetzter Erkennungsabstand in Sekunden (der Testhaken meldet ihn).
let letzterAbstand: number | null = null;

async function setzeAbstand(): Promise<number> {
  const e = await ladeEinstellungen();
  const sekunden = e.kontrolle.leerlaufMinuten * 60;
  try {
    browser.idle?.setDetectionInterval(sekunden);
  } catch {
    // ohne idle-API (oder mit ungueltigem Wert) bleibt der Standard des Browsers
  }
  letzterAbstand = sekunden;
  return sekunden;
}

// Zustandswechsel laufen nacheinander (ein schnelles active darf ein noch laufendes idle nicht ueberholen).
let kette: Promise<unknown> = Promise.resolve();

async function schicke(tabId: number, an: boolean): Promise<boolean> {
  const n: NachrichtInhaltLeerlauf = { ziel: 'inhalt', typ: 'leerlauf', an };
  try {
    await browser.tabs.sendMessage(tabId, n, { frameId: 0 });
    return true;
  } catch {
    // Seite ohne Content-Script (Browserseite, Store) oder gerade geladen: nichts zu tun
    return false;
  }
}

// Gibt zurueck, ob eine Nachricht an einen Tab ging.
async function beiZustand(zustand: 'active' | 'idle' | 'locked', vorgabeTab?: number): Promise<boolean> {
  const speicher = sitzung();
  if (zustand !== 'idle') {
    // Ein gemerkter Tab bekommt immer sein `{ an: false }`, auch wenn der Testhaken einen anderen Tab vorgibt.
    const gemerkt = speicher ? (await speicher.get(TAB_SCHLUESSEL))[TAB_SCHLUESSEL] : undefined;
    if (typeof gemerkt === 'number') await speicher?.remove(TAB_SCHLUESSEL);
    const ziele = new Set<number>();
    if (typeof gemerkt === 'number') ziele.add(gemerkt);
    if (typeof vorgabeTab === 'number') ziele.add(vorgabeTab);
    let gesendet = false;
    for (const t of ziele) gesendet = (await schicke(t, false)) || gesendet;
    return gesendet;
  }
  const [e, pack] = await Promise.all([ladeEinstellungen(), ladePackKurz()]);
  if (!e.kontrolle.leerlauf || e.pause || !istFreigeschaltet(pack, 'kontrolle:leerlauf')) return false;
  let tabId = vorgabeTab;
  if (typeof tabId !== 'number') {
    const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    tabId = tabs[0]?.id;
  }
  if (typeof tabId !== 'number') return false;
  const gesendet = await schicke(tabId, true);
  if (gesendet) await speicher?.set({ [TAB_SCHLUESSEL]: tabId });
  return gesendet;
}

// Der erste Abstand nach dem Start des Hintergrunds (der Testhaken wartet darauf).
let bereit: Promise<unknown> = Promise.resolve();

export function starteLeerlauf(): void {
  if (!browser.idle) return;
  // Im Testbau nicht auswerten: sonst faellt die Spirale in fremde Tests.
  if (!TESTBAU) {
    browser.idle.onStateChanged.addListener((zustand) => {
      kette = kette.then(() => beiZustand(zustand)).catch(() => false);
    });
  }
  browser.storage.onChanged.addListener((aenderungen, bereich) => {
    if (bereich !== 'local' || !(SPEICHER_SCHLUESSEL in aenderungen)) return;
    const alt = aenderungen[SPEICHER_SCHLUESSEL]?.oldValue === undefined ? null : vervollstaendige(aenderungen[SPEICHER_SCHLUESSEL]?.oldValue);
    const neu = vervollstaendige(aenderungen[SPEICHER_SCHLUESSEL]?.newValue);
    if (!alt || alt.kontrolle.leerlaufMinuten !== neu.kontrolle.leerlaufMinuten || letzterAbstand === null) void setzeAbstand().catch(() => undefined);
  });
  bereit = setzeAbstand().catch(() => undefined);
}

export async function bearbeiteLeerlaufTest(n: NachrichtHintergrundLeerlaufTest, absender: Absender | undefined): Promise<unknown> {
  if (!TESTBAU) return { ok: false, fehler: 'nur im Testbau' };
  const tabId = absender?.tab?.id;
  if (typeof tabId !== 'number' || absender?.frameId !== 0) return { ok: false, fehler: 'kein Tab' };
  // Nur den zuletzt gesetzten Wert melden (den setzt der Horcher auf die Einstellungen): so prueft der Test diesen Weg wirklich.
  await bereit;
  const abstand = letzterAbstand;
  const lauf = kette.then(() => beiZustand(n.zustand, tabId));
  kette = lauf.catch(() => false);
  try {
    return { ok: true, abstand, gesendet: await lauf };
  } catch (e) {
    return { ok: false, fehler: String(e), abstand };
  }
}
