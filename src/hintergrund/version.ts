// Hintergrund: Version und Update-Hinweis (Auftrag V, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 6, PHASE-6-BAUPLAN Abschnitt 5).
// Chrome/Edge: `version { pruefen }` liest `version.json` aus dem oeffentlichen Repo, wenn die letzte Pruefung aelter als 24 Stunden ist
// (`erzwingen`: immer). Ohne Anmeldedaten, ohne Zwischenspeicher, Zeitlimit 10 Sekunden. Beim Browserstart prueft `starteVersion`, wenn faellig.
// Firefox: nie ein Abruf; `erzwingen` fragt `runtime.requestUpdateCheck()`, Fehler gelten als `unbekannt`.
// Testbau: Abruf nur nach `version-test { url }` (Adresse in storage.session), sonst kein Netz; `vergiss` loescht Stand und Adresse.
import type { AntwortVersion, NachrichtHintergrundVersion, NachrichtHintergrundVersionTest } from '../nachrichten';
import { STAND_LEER, istFaellig, istNeuer, pruefeVersionDatei, vervollstaendigeStand } from '../version/logik';
import { VERSION_SCHLUESSEL, VERSION_URL, type VersionStand } from '../version/vertrag';

// Baudatum JJJJ-MM-TT (wxt.config.ts, define).
const BAU_DATUM: string = import.meta.env.VEIL_BAUDATUM ?? '';
const FIREFOX = Boolean(import.meta.env.FIREFOX);
const TESTBAU = import.meta.env.WXT_TESTHAKEN === '1';
const ZEITLIMIT_MS = 10_000;

type Sitzung = { get(k: string): Promise<Record<string, unknown>>; set(o: Record<string, unknown>): Promise<void>; remove(k: string | string[]): Promise<void> };
function sitzung(): Sitzung | null {
  return (browser.storage as unknown as { session?: Sitzung }).session ?? null;
}

async function ladeStand(): Promise<VersionStand> {
  const roh = (await browser.storage.local.get(VERSION_SCHLUESSEL))[VERSION_SCHLUESSEL];
  return vervollstaendigeStand(roh);
}

// Adresse fuer den Abruf: im Release immer die feste Adresse, im Testbau nur die per Testhaken gesetzte (sonst null: kein Netz).
async function abrufAdresse(): Promise<string | null> {
  if (!TESTBAU) return VERSION_URL;
  const s = sitzung();
  if (!s) return null;
  const roh = (await s.get('veil-version-test'))['veil-version-test'];
  return typeof roh === 'string' && roh.length > 0 ? roh : null;
}

// Liest den Antworttext hoechstens bis MAX_BYTES (version.json ist winzig); mehr ist ein Fehler.
const MAX_BYTES = 4096;
async function leseBegrenzt(antwort: Response): Promise<string> {
  const laenge = Number(antwort.headers.get('content-length') ?? 0);
  if (laenge > MAX_BYTES) throw new Error('Antwort zu gross');
  const leser = antwort.body?.getReader();
  if (!leser) throw new Error('Antwort ohne Inhalt');
  const teile: Uint8Array[] = [];
  let summe = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    summe += value.byteLength;
    if (summe > MAX_BYTES) {
      void leser.cancel();
      throw new Error('Antwort zu gross');
    }
    teile.push(value);
  }
  const alle = new Uint8Array(summe);
  let ab = 0;
  for (const t of teile) {
    alle.set(t, ab);
    ab += t.byteLength;
  }
  return new TextDecoder().decode(alle);
}

// Ein Abruf: liefert die Version aus version.json oder wirft. Nie Anmeldedaten, nie Zwischenspeicher.
async function rufeAb(adresse: string): Promise<string> {
  const steuer = new AbortController();
  const frist = setTimeout(() => steuer.abort(), ZEITLIMIT_MS);
  try {
    const antwort = await fetch(adresse, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: steuer.signal });
    if (!antwort.ok) throw new Error(`Status ${antwort.status}`);
    const datei = pruefeVersionDatei(JSON.parse(await leseBegrenzt(antwort)));
    if (!datei) throw new Error('version.json passt nicht zum Vertrag');
    return datei.version;
  } finally {
    clearTimeout(frist);
  }
}

// Gleichzeitige Anfragen (Popup und Einstellungsseite zugleich, Browserstart) teilen sich einen Lauf. Eine erzwungene Anfrage teilt nur einen
// erzwungenen Lauf; laeuft gerade ein nicht erzwungener, wartet sie ihn ab und ruft dann selbst ab ("Check now" ruft immer ab).
let laufend: { erzwungen: boolean; p: Promise<VersionStand> } | null = null;

function pruefeChrome(erzwingen: boolean): Promise<VersionStand> {
  if (laufend && (!erzwingen || laufend.erzwungen)) return laufend.p;
  if (laufend) return laufend.p.catch(() => undefined).then(() => pruefeChrome(erzwingen));
  const lauf: { erzwungen: boolean; p: Promise<VersionStand> } = { erzwungen: erzwingen, p: undefined as unknown as Promise<VersionStand> };
  lauf.p = (async () => {
    const stand = await ladeStand();
    const jetzt = Date.now();
    if (!erzwingen && !istFaellig(stand, jetzt)) return stand;
    const adresse = await abrufAdresse();
    if (!adresse) return stand;
    let neu: VersionStand;
    try {
      neu = { geprueft: jetzt, neueste: await rufeAb(adresse), fehler: false };
    } catch {
      // Still: der bekannte Stand bleibt, die Einstellungsseite sagt "Couldn’t check just now".
      neu = { geprueft: jetzt, neueste: stand.neueste, fehler: true };
    }
    await browser.storage.local.set({ [VERSION_SCHLUESSEL]: neu });
    return neu;
  })().finally(() => {
    if (laufend === lauf) laufend = null;
  });
  laufend = lauf;
  return lauf.p;
}

async function firefoxStatus(): Promise<NonNullable<AntwortVersion['firefoxStatus']>> {
  try {
    const api = (browser.runtime as unknown as { requestUpdateCheck?: () => Promise<{ status?: string } | string> }).requestUpdateCheck;
    if (typeof api !== 'function') return 'unbekannt';
    const roh = await api.call(browser.runtime);
    const status = typeof roh === 'string' ? roh : roh?.status;
    return status === 'update_available' || status === 'no_update' || status === 'throttled' ? status : 'unbekannt';
  } catch {
    return 'unbekannt';
  }
}

export function starteVersion(): void {
  // Chrome: beim Browserstart pruefen, wenn faellig. Nicht im Testbau (dort laeuft nichts von selbst) und nie in Firefox.
  if (FIREFOX || TESTBAU) return;
  browser.runtime.onStartup.addListener(() => {
    pruefeChrome(false).catch(() => {});
  });
}

// Nur Erweiterungsseiten (Popup, Einstellungsseite) duerfen `erzwingen`: ihre Absender-Adresse beginnt mit der Adresse der Erweiterung.
// Ein Content-Script meldet die Adresse der besuchten Seite. Der Tab zaehlt nicht: Popup und Einstellungsseite laufen auch als Tab.
function vonErweiterungsseite(absender?: { url?: string }): boolean {
  try {
    return (absender?.url ?? '').startsWith(browser.runtime.getURL('/'));
  } catch {
    return false;
  }
}

export async function bearbeiteVersion(n: NachrichtHintergrundVersion, absender?: { tab?: { id?: number }; url?: string }): Promise<AntwortVersion> {
  // Von Content-Scripts gilt `erzwingen` als nicht gesetzt (nur `pruefen` mit der 24-Stunden-Grenze).
  const erzwingen = n.erzwingen === true && vonErweiterungsseite(absender);
  const aktuell = browser.runtime.getManifest().version;
  if (FIREFOX) {
    const stand = await ladeStand();
    const antwort: AntwortVersion = {
      ok: true,
      browser: 'firefox',
      aktuell,
      datum: BAU_DATUM,
      neueste: null,
      neuer: false,
      geprueft: stand.geprueft,
      fehler: false,
    };
    if (erzwingen) {
      antwort.firefoxStatus = await firefoxStatus();
      antwort.geprueft = Date.now();
      await browser.storage.local.set({ [VERSION_SCHLUESSEL]: { ...STAND_LEER, geprueft: antwort.geprueft } });
    }
    return antwort;
  }
  // `pruefen` nur von Erweiterungsseiten (Popup, Einstellungsseite); Content-Scripts bekommen den gespeicherten Stand.
  const stand = (n.pruefen || erzwingen) && vonErweiterungsseite(absender) ? await pruefeChrome(erzwingen) : await ladeStand();
  return {
    ok: true,
    browser: 'chrome',
    aktuell,
    datum: BAU_DATUM,
    neueste: stand.neueste,
    neuer: istNeuer(stand.neueste, aktuell),
    geprueft: stand.geprueft,
    fehler: stand.fehler,
  };
}

// Testhaken (nur Testbau): Adresse fuer version.json setzen, Stand und Adresse vergessen.
export async function bearbeiteVersionTest(n: NachrichtHintergrundVersionTest): Promise<unknown> {
  if (!TESTBAU) return { ok: false, fehler: 'nur im Testbau' };
  const s = sitzung();
  if (n.vergiss) {
    await browser.storage.local.remove(VERSION_SCHLUESSEL);
    await s?.remove('veil-version-test');
  }
  if (typeof n.url === 'string') {
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(n.url)) return { ok: false, fehler: 'nur lokale Adressen' };
    await s?.set({ 'veil-version-test': n.url });
  }
  return { ok: true };
}
