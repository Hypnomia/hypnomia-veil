// Hintergrund: Chrome Service Worker, Firefox Hintergrundskript (Ereignisseite).
// Beantwortet Nachrichten mit `ziel: 'hintergrund'` (wecke, referer, pause, tab) und das Tastenkuerzel `pause-umschalten`.
// Chrome: legt das Offscreen-Dokument mit dem Erkenner an und setzt Referer per declarativeNetRequest (Sitzungsregeln).
// Firefox: startet den Erkenner im selben Kontext und setzt Referer per webRequest (blocking).
import { aendereEinstellungen } from '../src/einstellungen';
import { fehlerAntwortFuer } from '../src/erkenner/antwort';
import { HINTERGRUND_TYPEN, istFuer, type AntwortTab, type NachrichtHintergrund, type NachrichtInhaltTab } from '../src/nachrichten';
// Phase 4: je Auftrag ein Handler-Modul (Orchestrator verdrahtet, Bauer fuellen nur ihr Modul).
import { bearbeitePackDaten } from '../src/hintergrund/quiz';
import { bearbeiteSteigerung, starteSteigerung } from '../src/hintergrund/steigerung';
import { bearbeiteErsatzStumm, starteErsatzStumm } from '../src/hintergrund/ersatz-stumm';
import { raeumeUmleitungAuf } from '../src/hintergrund/umleitung';

const OFFSCREEN_SEITE = '/offscreen.html' as const;
// Hoechstens so viele Referer-Regeln gleichzeitig, die aelteste fliegt raus.
const MAX_REFERER_REGELN = 50;
// Regel-IDs der Referer-Regeln beginnen hier; neue IDs zaehlen hoch, die kleinste ID ist die aelteste Regel.
const REGEL_ID_START = 1000;
const ERLAUBTE_ARTEN = ['image', 'xmlhttprequest', 'media', 'other'] as const;

// Nur ein Host-Name, nie Pfade oder Ports in den Regeln; ein Referer muss eine http(s)-Adresse sein.
function saubereReferer(host: string, referer: string): { hostname: string; referer: string } | null {
  try {
    const hostname = new URL(`https://${host}`).hostname;
    const r = new URL(referer);
    if (!hostname || (r.protocol !== 'http:' && r.protocol !== 'https:')) return null;
    return { hostname, referer: r.href };
  } catch {
    return null;
  }
}

// Absender einer Nachricht: nur das, was wir lesen (Adresse des Tabs, falls die Nachricht aus einem Tab kommt).
interface AbsenderMitTab {
  tab?: { id?: number; url?: string };
  frameId?: number;
  origin?: string;
  url?: string;
}

// ---------- Tab-Adresse an alle Frames des Tabs ----------
// Die oberste Seite meldet ihre neue Adresse (hintergrund/adresse); der Hintergrund reicht sie als inhalt/tab an alle Frames des Tabs weiter.
// Nur der oberste Frame eines Tabs darf melden: `frameId` muss da und 0 sein (ohne frameId keine Weiterleitung), sonst koennten Frames von
// Fremden Ausnahmen im ganzen Tab ein- und ausschalten. Die Adresse kommt aus dem Absender (sender.url, vom Browser gesetzt), nicht aus
// der Nachricht. Hinkt sender.url nach einem pushState hinterher, darf die gemeldete Adresse den Pfad liefern, aber nur auf demselben
// Ursprung wie sender.url; ein anderer Ursprung in der Nachricht wird verworfen.
function adresseFuerWeiterleitung(absender: AbsenderMitTab | undefined, gemeldet: string): string | null {
  if (typeof absender?.tab?.id !== 'number' || absender.frameId !== 0) return null;
  try {
    const basis = new URL(absender.url ?? '');
    if (basis.protocol !== 'http:' && basis.protocol !== 'https:') return null;
    const gemeldetURL = new URL(gemeldet);
    return gemeldetURL.origin === basis.origin ? gemeldetURL.href : basis.href;
  } catch {
    return null;
  }
}

async function reicheAdresseWeiter(absender: AbsenderMitTab | undefined, url: string): Promise<boolean> {
  const adresse = adresseFuerWeiterleitung(absender, url);
  const tabId = absender?.tab?.id;
  if (adresse === null || typeof tabId !== 'number') return false;
  const nachricht: NachrichtInhaltTab = { ziel: 'inhalt', typ: 'tab', url: adresse };
  // Ohne frameId gehen die Nachrichten an alle Frames; ein Tab ohne Empfaenger meldet einen Fehler, der hier egal ist.
  await browser.tabs.sendMessage(tabId, nachricht).catch(() => {});
  return true;
}

// ---------- Pause ----------
async function schaltePause(an?: boolean): Promise<boolean> {
  // Umkehren innerhalb der Kette: auf dem frisch gelesenen Stand, nicht auf einem vorher gelesenen.
  const neu = await aendereEinstellungen((alt) => ({ pause: an ?? !alt.pause }));
  return neu.pause;
}

// ---------- Chrome: Offscreen-Dokument und Referer per DNR ----------
// Prueft und legt an in EINER Kette: wer `getContexts` liest, sieht auch das Ergebnis aller frueheren Aufrufe.
// Sonst koennte ein Aufruf, der vor dem Anlegen gelesen hat, nach dessen Ende ein zweites Dokument anlegen.
let offscreenKette: Promise<void> = Promise.resolve();

async function legeOffscreenAn(): Promise<void> {
  const vorhandene = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (vorhandene.length > 0) return;
  try {
    await browser.offscreen.createDocument({
      url: OFFSCREEN_SEITE,
      reasons: ['BLOBS', 'WORKERS'],
      justification: 'Checking images with a local model, nothing leaves the browser',
    });
  } catch (e) {
    // Zweites Dokument verboten: eines gibt es schon (z. B. von einem anderen Kontext angelegt), dann ist alles gut.
    if (!/single offscreen document/i.test(e instanceof Error ? e.message : String(e))) throw e;
  }
}

function stelleOffscreenSicher(): Promise<void> {
  const lauf = offscreenKette.then(legeOffscreenAn);
  offscreenKette = lauf.catch(() => {});
  return lauf;
}

// Eine Sitzungsregel je Host: alte Regel dieses Hosts ersetzen, bei mehr als MAX_REFERER_REGELN die aelteste entfernen.
async function schreibeRefererRegel(sauber: { hostname: string; referer: string }): Promise<void> {
  const dnr = browser.declarativeNetRequest;
  const vorhandene = (await dnr.getSessionRules()).filter((r) => r.id >= REGEL_ID_START && r.id < REGEL_ID_START + 1_000_000);
  const entfernen = vorhandene
    .filter((r) => r.condition.requestDomains?.includes(sauber.hostname))
    .map((r) => r.id);
  const uebrig = vorhandene.filter((r) => !entfernen.includes(r.id)).sort((a, b) => a.id - b.id);
  // Platz schaffen: nach dem Hinzufuegen darf es hoechstens MAX_REFERER_REGELN geben.
  while (uebrig.length >= MAX_REFERER_REGELN) {
    const aelteste = uebrig.shift();
    if (aelteste) entfernen.push(aelteste.id);
  }
  const neueId = Math.max(REGEL_ID_START - 1, ...vorhandene.map((r) => r.id)) + 1;
  await dnr.updateSessionRules({
    removeRuleIds: entfernen,
    addRules: [
      {
        id: neueId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'referer', operation: 'set', value: sauber.referer }],
        },
        condition: {
          // Nur eigene Abrufe der Erweiterung (kein Tab), nur dieser Host.
          tabIds: [browser.tabs.TAB_ID_NONE],
          requestDomains: [sauber.hostname],
          resourceTypes: [...ERLAUBTE_ARTEN],
        },
      },
    ],
  });
}

// Parallele Anfragen lesen sonst dieselben Regeln und rechnen dieselbe neue ID aus: Aenderungen laufen nacheinander.
// Scheitert eine, wird einmal neu gelesen und wiederholt (die Regeln koennen sich zwischenzeitlich geaendert haben).
let refererKette: Promise<unknown> = Promise.resolve();

function setzeRefererChrome(host: string, referer: string): Promise<boolean> {
  const sauber = saubereReferer(host, referer);
  if (!sauber) return Promise.resolve(false);
  const lauf = refererKette.then(async () => {
    try {
      await schreibeRefererRegel(sauber);
    } catch {
      await schreibeRefererRegel(sauber);
    }
    return true;
  });
  refererKette = lauf.catch(() => {});
  return lauf;
}

// ---------- Firefox: Referer per webRequest ----------
const refererFirefox = new Map<string, string>();

function setzeRefererFirefox(host: string, referer: string): boolean {
  const sauber = saubereReferer(host, referer);
  if (!sauber) return false;
  refererFirefox.delete(sauber.hostname);
  refererFirefox.set(sauber.hostname, sauber.referer);
  while (refererFirefox.size > MAX_REFERER_REGELN) {
    const aeltester = refererFirefox.keys().next().value;
    if (aeltester === undefined) break;
    refererFirefox.delete(aeltester);
  }
  return true;
}

export default defineBackground(() => {
  // Firefox: Erkenner im selben Kontext. Dynamischer Import, im Chrome-Build entfaellt der Zweig samt ORT.
  const erkenner = import.meta.env.FIREFOX
    ? import('../src/erkenner').then((m) => {
        m.starteErkenner({ setzeReferer: async (host, referer) => void setzeRefererFirefox(host, referer) });
        return m;
      })
    : null;

  if (import.meta.env.FIREFOX) {
    browser.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        // Nur eigene Abrufe der Erweiterung (tabId -1), nur fuer Hosts mit gesetztem Referer.
        if (details.tabId !== -1) return {};
        let hostname: string;
        try {
          hostname = new URL(details.url).hostname;
        } catch {
          return {};
        }
        const referer = refererFirefox.get(hostname);
        if (!referer) return {};
        const kopf = (details.requestHeaders ?? []).filter((h) => h.name.toLowerCase() !== 'referer');
        kopf.push({ name: 'Referer', value: referer });
        return { requestHeaders: kopf };
      },
      // tabId -1 im Filter: nur eigener Verkehr der Erweiterung laeuft durch den blockierenden Listener,
      // Bilder, Videos und XHR der Seiten in den Tabs bleiben unberuehrt (und wecken die Ereignisseite nicht).
      { urls: ['<all_urls>'], types: ['image', 'media', 'xmlhttprequest', 'other'], tabId: -1 },
      ['blocking', 'requestHeaders'],
    );
  }

  // Lebenszeichen fuer die Hallo-Tests (tests/chromium/hello.spec.ts), nur im Testbau (WXT_TESTHAKEN=1): im Release-Bau faellt es weg.
  if (import.meta.env.WXT_TESTHAKEN === '1') {
    browser.runtime.onInstalled.addListener(() => {
      browser.storage.local.set({ veilHello: true }).catch(() => {});
    });
  }

  // Phase 4: Listener der Handler-Module oben im Skript registrieren (Ereignisseite und Service Worker wachen dafuer auf).
  starteSteigerung();
  // Session 8 (Entscheidung 107): keine Umleitung mehr; eine Regel aus Version 0.4.0 wird beim Start entfernt.
  raeumeUmleitungAuf();
  starteErsatzStumm();

  // Chrome: Offscreen-Dokument bei Installation und Browserstart anlegen.
  if (import.meta.env.CHROME) {
    const anlegen = () => stelleOffscreenSicher().catch((e) => console.warn('Offscreen-Dokument: Anlegen fehlgeschlagen', e));
    browser.runtime.onInstalled.addListener(anlegen);
    browser.runtime.onStartup.addListener(anlegen);
  }

  async function bearbeiteHintergrund(n: NachrichtHintergrund, absender: AbsenderMitTab | undefined): Promise<unknown> {
    switch (n.typ) {
      case 'wecke':
        if (import.meta.env.CHROME) await stelleOffscreenSicher();
        return { ok: true };
      case 'referer': {
        const gesetzt = import.meta.env.FIREFOX ? setzeRefererFirefox(n.host, n.referer) : await setzeRefererChrome(n.host, n.referer);
        return gesetzt ? { ok: true } : { ok: false, fehler: 'ungueltiger Host oder Referer' };
      }
      case 'pause':
        return { ok: true, pause: await schaltePause(typeof n.an === 'boolean' ? n.an : undefined) };
      case 'adresse':
        return (await reicheAdresseWeiter(absender, n.url)) ? { ok: true } : { ok: false, fehler: 'nur die oberste Seite eines Tabs darf melden' };
      case 'tab': {
        // Absender ist das Content-Script; mit Host-Rechten liefert sender.tab.url die Adresse des Tabs.
        const antwort: AntwortTab = { ok: true, url: absender?.tab?.url ?? null };
        return antwort;
      }
      case 'packdaten':
        return bearbeitePackDaten(n);
      case 'steigerung-minute':
      case 'steigerung-uhr':
        return bearbeiteSteigerung(n, absender);
      case 'ersatz-stumm':
        return bearbeiteErsatzStumm(n, absender);
      default:
        return undefined;
    }
  }

  browser.runtime.onMessage.addListener((nachricht: unknown, absender: AbsenderMitTab | undefined, antworte: (antwort: unknown) => void) => {
    // Firefox: der Erkenner lebt in diesem Kontext; Nachrichten fuer ihn hier beantworten.
    if (erkenner && istFuer(nachricht, 'erkenner')) {
      if (nachricht.typ !== 'wecke' && nachricht.typ !== 'status' && nachricht.typ !== 'pruefe' && nachricht.typ !== 'packbild') return undefined;
      erkenner
        .then((m) => m.bearbeiteErkennerNachricht(nachricht, absender))
        .then(
          (antwort) => antworte(antwort),
          (e) => antworte(fehlerAntwortFuer(nachricht, e)),
        );
      return true;
    }
    if (!istFuer(nachricht, 'hintergrund')) return undefined;
    const n = nachricht as NachrichtHintergrund;
    if (!(HINTERGRUND_TYPEN as readonly string[]).includes(n.typ)) return undefined;
    bearbeiteHintergrund(n, absender).then(antworte, (e) => antworte(fehlerAntwortFuer(nachricht, e)));
    return true;
  });

  // Tastenkuerzel (Desktop). Android kennt keine Kuerzel, dort gibt es `commands` nicht.
  browser.commands?.onCommand.addListener((name) => {
    if (name === 'pause-umschalten') schaltePause().catch((e) => console.warn('Pause umschalten fehlgeschlagen', e));
  });
});
