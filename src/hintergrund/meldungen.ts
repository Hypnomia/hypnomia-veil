// Meldungen im Hintergrund (Auftrag M, Phase 5 Session 10, PHASE-5-AUFTRAEGE-SESSION-10.md Abschnitt 5). Zaehlt aus den Minutenmeldungen
// `steigerung-minute` (`notiereMinute`, von background.ts nach der Steigerung gerufen) und dem Stand der Steigerung, welche Anlaesse faellig
// sind, haelt Zaehler, Abstand und Wartende in storage.local (`meldungStand`, ueberlebt einen Neustart) und schickt hoechstens eine Meldung
// je 10 Minuten ueber alle Tabs als `inhalt/meldung` an Frame 0 des Ziel-Tabs. Alle Aenderungen laufen nacheinander (Lesen, Rechnen, Schreiben).
// Im Testbau sendet der Hintergrund nichts von selbst: nur `meldung-test` (Testhaken) loest eine Auswertung aus.
import { SPEICHER_SCHLUESSEL, ladeEinstellungen, vervollstaendige, type Einstellungen } from '../einstellungen';
import {
  MELDUNG_STAND_SCHLUESSEL,
  kandidaten,
  merkeWartend,
  nachGezeigt,
  klemmeZuletzt,
  neuerTag,
  pruefeStreng,
  pruefeStufe,
  vervollstaendigeStand,
  zaehleMinute,
  type Faellig,
  type MeldungsStand,
  type MinuteEingabe,
} from '../meldungen/logik';
import type { MeldungAnlass, NachrichtHintergrundMeldungTest, NachrichtHintergrundSteigerungMinute, NachrichtInhaltMeldung } from '../nachrichten';
import { istFreigeschaltet, ladePackKurz } from '../pack/vertrag';
import { STEIGERUNG_SCHLUESSEL, vervollstaendigeStand as steigerungStand, wirksameStufe } from '../steigerung';

interface Absender {
  tab?: { id?: number; url?: string };
  frameId?: number;
  url?: string;
}

const TESTBAU = import.meta.env.WXT_TESTHAKEN === '1';

let kette: Promise<unknown> = Promise.resolve();
function nacheinander<T>(arbeit: () => Promise<T>): Promise<T> {
  const lauf = kette.then(arbeit);
  kette = lauf.catch(() => undefined);
  return lauf;
}

async function ladeStand(jetzt: Date): Promise<MeldungsStand> {
  const ablage = await browser.storage.local.get(MELDUNG_STAND_SCHLUESSEL);
  return vervollstaendigeStand(ablage[MELDUNG_STAND_SCHLUESSEL], jetzt);
}

async function speichere(stand: MeldungsStand): Promise<void> {
  await browser.storage.local.set({ [MELDUNG_STAND_SCHLUESSEL]: stand });
}

function erlaubt(e: Einstellungen, frei: boolean): boolean {
  return frei && e.kontrolle.meldungen && !e.pause;
}

const SENDE_FRIST_MS = 8000;
// Liefert true, wenn die Meldung gezeigt wurde oder die Frist ablief (dann kann die Seite noch anzeigen: der Abstand gilt vorsichtshalber).
async function sende(tabId: number, anlass: MeldungAnlass, zahl: number | undefined): Promise<boolean> {
  const n: NachrichtInhaltMeldung = { ziel: 'inhalt', typ: 'meldung', anlass, ...(zahl === undefined ? {} : { zahl }) };
  let frist: ReturnType<typeof setTimeout> | undefined;
  try {
    const stopp = new Promise<void>((ok) => {
      frist = setTimeout(() => ok(), SENDE_FRIST_MS);
    });
    const antwort = (await Promise.race([browser.tabs.sendMessage(tabId, n, { frameId: 0 }), stopp.then(() => 'frist' as const)])) as { gezeigt?: boolean } | 'frist' | undefined;
    return antwort === 'frist' || antwort?.gezeigt === true;
  } catch {
    // Seite ohne Content-Script oder gerade geladen: der Anlass wartet weiter
    return false;
  } finally {
    if (frist) clearTimeout(frist);
  }
}

// Ziel-Tab: `stufe` geht an den aktiven Tab des zuletzt fokussierten Fensters, alle anderen an den Tab der Minutenmeldung. `erzwinge`
// (Testhaken) schickt immer an den Tab des Absenders.
async function zielTab(anlass: MeldungAnlass, absenderTab: number | undefined, erzwinge: boolean): Promise<number | undefined> {
  if (anlass === 'stufe' && !erzwinge) {
    try {
      const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      if (typeof tabs[0]?.id === 'number') return tabs[0].id;
    } catch {
      // Fallback unten
    }
  }
  return absenderTab;
}

interface Auftrag {
  minute?: MinuteEingabe;
  absenderTab?: number;
  anlass?: Faellig;
  vergiss?: boolean;
  erzwinge?: boolean;
}

export interface Ergebnis {
  gezeigt: boolean;
  anlass?: MeldungAnlass;
  grund?: string;
}

// Eine Auswertung: zaehlen, Anlaesse vormerken, hoechstens eine Meldung senden. Laeuft nur innerhalb der Kette. `nachZaehlen` wird gerufen, sobald
// gezaehlt und gespeichert ist (vor dem Senden, das mehrere Sekunden dauern kann).
async function wertAus(a: Auftrag, nachZaehlen?: () => void): Promise<Ergebnis> {
  const jetzt = new Date();
  const jetztMs = jetzt.getTime();
  let stand: MeldungsStand;
  let liste: Faellig[];
  try {
    const [e, pack] = await Promise.all([ladeEinstellungen(), ladePackKurz()]);
    stand = klemmeZuletzt(neuerTag(await ladeStand(jetzt), jetzt), jetztMs);
    if (a.vergiss) stand = { ...stand, zuletzt: 0 };
    const faellig: Faellig[] = [];
    // Stufe und strenge Zeit werden immer nachgefuehrt (auch bei Pause oder Schalter aus), sonst kaemen danach veraltete Anlaesse.
    if (istFreigeschaltet(pack, 'zensur:steigerung')) {
      const ablage = await browser.storage.local.get(STEIGERUNG_SCHLUESSEL);
      const r = pruefeStufe(stand, wirksameStufe(steigerungStand(ablage[STEIGERUNG_SCHLUESSEL]), jetztMs));
      stand = r.stand;
      faellig.push(...r.faellig);
    }
    {
      const r = pruefeStreng(stand, e.kontrolle.zeiten, istFreigeschaltet(pack, 'kontrolle:zeitplan'), jetzt);
      stand = r.stand;
      faellig.push(...r.faellig);
    }
    if (!erlaubt(e, istFreigeschaltet(pack, 'kontrolle:meldungen'))) {
      // Pause, Schalter aus oder Pack weg: nichts zaehlen, die faelligen Anlaesse verwerfen, nichts wartet weiter
      await speichere({ ...stand, wartend: {} });
      return { gezeigt: false, grund: 'nicht erlaubt' };
    }
    if (a.minute) {
      const r = zaehleMinute(stand, a.minute, jetzt);
      stand = r.stand;
      faellig.push(...r.faellig);
    }
    if (a.anlass) faellig.push(a.anlass);
    stand = merkeWartend(stand, faellig, jetztMs);
    await speichere(stand);
    liste = kandidaten(stand, jetztMs);
  } finally {
    nachZaehlen?.();
  }
  if (liste.length === 0) return { gezeigt: false, grund: Object.keys(stand.wartend).length ? 'abstand' : 'nichts faellig' };
  for (const k of liste) {
    const tab = await zielTab(k.anlass, a.absenderTab, a.erzwinge === true);
    if (typeof tab !== 'number') continue;
    if (await sende(tab, k.anlass, k.zahl)) {
      stand = nachGezeigt(stand, k.anlass, Date.now());
      await speichere(stand);
      return { gezeigt: true, anlass: k.anlass };
    }
  }
  return { gezeigt: false, grund: 'nicht gezeigt' };
}

export function starteMeldungen(): void {
  // Pause an oder Schalter aus: wartende Anlaesse verfallen sofort (sonst taucht nach der Pause Altes auf).
  browser.storage.onChanged.addListener((aenderungen, bereich) => {
    if (bereich !== 'local' || !(SPEICHER_SCHLUESSEL in aenderungen)) return;
    const neu = vervollstaendige(aenderungen[SPEICHER_SCHLUESSEL]?.newValue);
    if (neu.pause || !neu.kontrolle.meldungen) {
      nacheinander(async () => {
        const jetzt = new Date();
        const stand = await ladeStand(jetzt);
        if (Object.keys(stand.wartend).length > 0) await speichere({ ...stand, wartend: {} });
      }).catch(() => undefined);
    }
  });
}

export function notiereMinute(n: NachrichtHintergrundSteigerungMinute, absender?: Absender): Promise<void> {
  // Im Testbau wertet der Hintergrund die Minuten nicht von selbst aus (sonst fallen Meldungen in fremde Tests).
  if (TESTBAU) return Promise.resolve();
  // Nur Frame 0 eines Tabs.
  if (absender?.frameId !== 0 || typeof absender.tab?.id !== 'number') return Promise.resolve();
  const zensiert = typeof n.zensiert === 'number' && Number.isFinite(n.zensiert) ? Math.max(0, Math.floor(n.zensiert)) : 0;
  const minute: MinuteEingabe = { erwachsen: n.erwachsen === true, zensiert };
  // Das Promise ist nach dem Zaehlen erfuellt; das Senden (bis zu mehrere Sekunden) laeuft danach in der Kette weiter.
  return new Promise<void>((fertig) => {
    nacheinander(() => wertAus({ minute, absenderTab: absender.tab?.id }, fertig)).then(
      () => fertig(),
      (e) => {
        console.warn('Meldungen: Auswertung fehlgeschlagen', e);
        fertig();
      },
    );
  });
}

function testAbsenderErlaubt(absender: Absender | undefined): boolean {
  try {
    const adresse = absender?.url ?? '';
    if (adresse.startsWith(browser.runtime.getURL('/'))) return true;
    const url = new URL(adresse);
    return (url.protocol === 'http:' || url.protocol === 'https:') && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  } catch {
    return false;
  }
}

// Testhaken. Mit `anlass`: der Anlass ist sofort faellig, Ziel ist der Tab des Absenders (Abstand gilt, `vergiss` vergisst ihn). Ohne
// `anlass`: die regulaere Auswertung einmal; `zahl` zaehlt dabei als zensierte Bilder einer Minute (nur Testbau).
export async function bearbeiteMeldungTest(n: NachrichtHintergrundMeldungTest, absender?: Absender): Promise<unknown> {
  if (!TESTBAU || !testAbsenderErlaubt(absender)) return { ok: false, fehler: 'nur im Testbau' };
  const tabId = absender?.tab?.id;
  if (typeof tabId !== 'number' || absender?.frameId !== 0) return { ok: false, fehler: 'kein Tab' };
  // Mit `anlass` geht die Meldung an den Tab des Absenders; die regulaere Auswertung (ohne `anlass`) waehlt den Ziel-Tab wie im Betrieb.
  const auftrag: Auftrag = { absenderTab: tabId, vergiss: n.vergiss === true, erzwinge: !!n.anlass };
  if (n.anlass) auftrag.anlass = typeof n.zahl === 'number' ? { anlass: n.anlass, zahl: n.zahl } : { anlass: n.anlass };
  else auftrag.minute = { erwachsen: false, zensiert: typeof n.zahl === 'number' ? n.zahl : 0 };
  try {
    const ergebnis = await nacheinander(() => wertAus(auftrag));
    return { ok: true, ...ergebnis };
  } catch (e) {
    return { ok: false, fehler: String(e) };
  }
}
