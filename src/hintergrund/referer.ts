// Referer fuer das Nachladen fremder Bilder (Entscheidung 59; Sicherheitspruefung Phase 9 Fund A4, Paket N3 Session 18).
// Der Erkenner laedt ein Bild erst ohne Referer; bei 403 oder Netzfehler setzt der Hintergrund fuer genau diesen Host den Ursprung der
// Seite als Referer und der Erkenner versucht es einmal neu. Grenzen der Regel:
//   - nur der genaue Host, keine Unterdomains (Chrome: requestDomains allein traefe auch cdn.<host>, darum zusaetzlich regexFilter);
//   - nie fuer die Hosts des Versions-Checks und der Release-Seite (auch nicht fuer deren Ober- oder Unterdomains): sonst truege der
//     naechste Versions-Check den Ursprung einer besuchten Seite zu GitHub;
//   - jede Regel haelt REFERER_DAUER_MS ab dem letzten Setzen, danach faellt sie weg (statt bis zum Browserende).
// Chrome: Sitzungsregeln per declarativeNetRequest, Ablaufzeiten in storage.session (ueberleben das Einschlafen des Service Workers);
// beim Start des Hintergrunds und per Uhr werden abgelaufene Regeln entfernt, Regeln ohne bekannte Ablaufzeit gelten als abgelaufen.
// Firefox: eine Tabelle im Hintergrund, der webRequest-Horcher setzt nur unabgelaufene Eintraege.
import { RELEASE_URL, VERSION_URL } from '../version/vertrag.ts';

// Hoechstens so viele Referer-Regeln gleichzeitig, die aelteste fliegt raus.
export const MAX_REFERER_REGELN = 50;
// Regel-IDs der Referer-Regeln: ab REGEL_ID_START, neue IDs zaehlen hoch, die kleinste ID ist die aelteste Regel.
export const REGEL_ID_START = 1000;
const REGEL_ID_ENDE = REGEL_ID_START + 1_000_000;
// Haltezeit einer Regel ab dem letzten Setzen.
export const REFERER_DAUER_MS = 10 * 60 * 1000;
export const ERLAUBTE_ARTEN = ['image', 'xmlhttprequest', 'media', 'other'] as const;
// storage.session: Regel-ID -> Ablaufzeit (ms seit 1970).
export const ABLAUF_SCHLUESSEL = 'refererAblauf';

// Hosts eigener Abrufe und Links der Erweiterung, fuer die nie ein fremder Referer gesetzt wird.
export const EIGENE_HOSTS: readonly string[] = [new URL(VERSION_URL).hostname, new URL(RELEASE_URL).hostname];

function ohnePunkt(h: string): string {
  return h.toLowerCase().replace(/\.+$/, '');
}

// Wahr, wenn eine Regel fuer diesen Host einen eigenen Host treffen koennte: gleich, Oberdomain (requestDomains traefe die Unterdomain)
// oder Unterdomain davon.
export function istEigenerHost(hostname: string): boolean {
  const h = ohnePunkt(hostname);
  if (!h) return false;
  return EIGENE_HOSTS.some((e) => h === e || e.endsWith(`.${h}`) || h.endsWith(`.${e}`));
}

// Nur ein Host-Name, nie Pfade oder Ports in den Regeln; ein Referer muss eine http(s)-Adresse sein; eigene Hosts nie.
export function saubereReferer(host: string, referer: string): { hostname: string; referer: string } | null {
  try {
    const hostname = ohnePunkt(new URL(`https://${host}`).hostname);
    const r = new URL(referer);
    if (!hostname || (r.protocol !== 'http:' && r.protocol !== 'https:')) return null;
    if (istEigenerHost(hostname)) return null;
    return { hostname, referer: r.href };
  } catch {
    return null;
  }
}

// Regulaerer Ausdruck (RE2) fuer genau diesen Host mit beliebigem Port: keine Unterdomain, keine Oberdomain, kein Host im Pfad.
export function hostRegex(hostname: string): string {
  const roh = hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^https?://${roh}(:[0-9]+)?/`;
}

// IDs, deren Ablaufzeit vorbei ist oder fehlt.
export function abgelaufeneIds(ids: readonly number[], ablauf: Readonly<Record<string, unknown>>, jetzt: number): number[] {
  return ids.filter((id) => {
    const bis = ablauf[String(id)];
    return typeof bis !== 'number' || !Number.isFinite(bis) || bis <= jetzt;
  });
}

// Fruehester Ablauf in der Tabelle oder null.
export function naechsterAblauf(ablauf: Readonly<Record<string, number>>): number | null {
  const werte = Object.values(ablauf).filter((v) => typeof v === 'number' && Number.isFinite(v));
  return werte.length ? Math.min(...werte) : null;
}

// ---------- Chrome ----------
export interface RegelKlein {
  id: number;
  condition: { requestDomains?: string[] };
}
export interface DnrKlein {
  getSessionRules(): Promise<RegelKlein[]>;
  updateSessionRules(o: { removeRuleIds?: number[]; addRules?: unknown[] }): Promise<void>;
}
export interface SitzungKlein {
  get(schluessel: string): Promise<Record<string, unknown>>;
  set(werte: Record<string, unknown>): Promise<void>;
}
export interface RefererChromeUmgebung {
  dnr: DnrKlein;
  sitzung: SitzungKlein;
  tabIdNone: number;
  dauer: () => Promise<number>;
  jetzt?: () => number;
}

export interface RefererChrome {
  setze(host: string, referer: string): Promise<boolean>;
  raeume(): Promise<void>;
}

export function erzeugeRefererChrome(u: RefererChromeUmgebung): RefererChrome {
  const jetzt = u.jetzt ?? (() => Date.now());
  let kette: Promise<unknown> = Promise.resolve();
  let uhr: ReturnType<typeof setTimeout> | undefined;

  // Parallele Anfragen lesen sonst dieselben Regeln und rechnen dieselbe neue ID aus: Aenderungen laufen nacheinander.
  function nacheinander<T>(f: () => Promise<T>): Promise<T> {
    const lauf = kette.then(f);
    kette = lauf.catch(() => {});
    return lauf;
  }

  const eigene = (regeln: RegelKlein[]) => regeln.filter((r) => r.id >= REGEL_ID_START && r.id < REGEL_ID_ENDE);

  async function leseAblauf(): Promise<Record<string, number>> {
    const roh = (await u.sitzung.get(ABLAUF_SCHLUESSEL))[ABLAUF_SCHLUESSEL];
    const aus: Record<string, number> = {};
    if (roh && typeof roh === 'object') {
      for (const [k, v] of Object.entries(roh as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) aus[k] = v;
    }
    return aus;
  }

  function plane(ablauf: Record<string, number>): void {
    if (uhr !== undefined) clearTimeout(uhr);
    uhr = undefined;
    const naechster = naechsterAblauf(ablauf);
    if (naechster === null) return;
    // Der Service Worker kann vorher einschlafen; dann raeumt der naechste Start (raeume beim Start des Hintergrunds).
    uhr = setTimeout(() => void raeume().catch(() => {}), Math.max(0, naechster - jetzt()) + 20);
    // Node (Einheitstests): die Uhr haelt den Prozess nicht offen. Im Browser ist es eine Zahl ohne unref.
    (uhr as unknown as { unref?: () => void }).unref?.();
  }

  // Abgelaufene Regeln (und Regeln ohne bekannte Ablaufzeit) entfernen; liefert die verbleibenden Regeln und Ablaufzeiten.
  async function raeumeIntern(): Promise<{ regeln: RegelKlein[]; ablauf: Record<string, number> }> {
    const regeln = eigene(await u.dnr.getSessionRules());
    const ablaufAlt = await leseAblauf();
    const weg = abgelaufeneIds(
      regeln.map((r) => r.id),
      ablaufAlt,
      jetzt(),
    );
    if (weg.length) await u.dnr.updateSessionRules({ removeRuleIds: weg });
    const bleiben = regeln.filter((r) => !weg.includes(r.id));
    const ablauf: Record<string, number> = {};
    for (const r of bleiben) {
      const bis = ablaufAlt[String(r.id)];
      if (typeof bis === 'number') ablauf[String(r.id)] = bis;
    }
    await u.sitzung.set({ [ABLAUF_SCHLUESSEL]: ablauf });
    return { regeln: bleiben, ablauf };
  }

  function raeume(): Promise<void> {
    return nacheinander(async () => {
      const { ablauf } = await raeumeIntern();
      plane(ablauf);
    });
  }

  // Eine Sitzungsregel je Host: alte Regel dieses Hosts ersetzen, bei mehr als MAX_REFERER_REGELN die aelteste entfernen.
  async function schreibe(sauber: { hostname: string; referer: string }): Promise<void> {
    const { regeln: vorhandene, ablauf } = await raeumeIntern();
    const entfernen = vorhandene.filter((r) => r.condition.requestDomains?.includes(sauber.hostname)).map((r) => r.id);
    const uebrig = vorhandene.filter((r) => !entfernen.includes(r.id)).sort((a, b) => a.id - b.id);
    // Platz schaffen: nach dem Hinzufuegen darf es hoechstens MAX_REFERER_REGELN geben.
    while (uebrig.length >= MAX_REFERER_REGELN) {
      const aelteste = uebrig.shift();
      if (aelteste) entfernen.push(aelteste.id);
    }
    const neueId = Math.max(REGEL_ID_START - 1, ...vorhandene.map((r) => r.id)) + 1;
    const bis = jetzt() + (await u.dauer());
    await u.dnr.updateSessionRules({
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
            // Nur eigene Abrufe der Erweiterung (kein Tab), nur genau dieser Host (regexFilter schliesst Unterdomains aus).
            tabIds: [u.tabIdNone],
            requestDomains: [sauber.hostname],
            regexFilter: hostRegex(sauber.hostname),
            resourceTypes: [...ERLAUBTE_ARTEN],
          },
        },
      ],
    });
    for (const id of entfernen) delete ablauf[String(id)];
    ablauf[String(neueId)] = bis;
    // Faellt der Worker zwischen Regel und Ablaufzeit aus, hat die Regel keine Zeit und gilt beim naechsten Raeumen als abgelaufen.
    await u.sitzung.set({ [ABLAUF_SCHLUESSEL]: ablauf });
    plane(ablauf);
  }

  // Scheitert eine Aenderung, wird einmal neu gelesen und wiederholt (die Regeln koennen sich zwischenzeitlich geaendert haben).
  function setze(host: string, referer: string): Promise<boolean> {
    const sauber = saubereReferer(host, referer);
    if (!sauber) return Promise.resolve(false);
    return nacheinander(async () => {
      try {
        await schreibe(sauber);
      } catch {
        await schreibe(sauber);
      }
      return true;
    });
  }

  return { setze, raeume };
}

// ---------- Firefox ----------
export interface RefererFirefox {
  setze(host: string, referer: string): Promise<boolean>;
  // Referer fuer einen Host, falls gesetzt und nicht abgelaufen (abgelaufene Eintraege fliegen dabei raus).
  fuer(hostname: string): string | null;
}

export function erzeugeRefererFirefox(u: { dauer: () => Promise<number>; jetzt?: () => number }): RefererFirefox {
  const jetzt = u.jetzt ?? (() => Date.now());
  const tabelle = new Map<string, { referer: string; bis: number }>();

  async function setze(host: string, referer: string): Promise<boolean> {
    const sauber = saubereReferer(host, referer);
    if (!sauber) return false;
    const bis = jetzt() + (await u.dauer());
    const t = jetzt();
    for (const [h, e] of tabelle) if (e.bis <= t) tabelle.delete(h);
    tabelle.delete(sauber.hostname);
    tabelle.set(sauber.hostname, { referer: sauber.referer, bis });
    while (tabelle.size > MAX_REFERER_REGELN) {
      const aeltester = tabelle.keys().next().value;
      if (aeltester === undefined) break;
      tabelle.delete(aeltester);
    }
    return true;
  }

  function fuer(hostname: string): string | null {
    const h = ohnePunkt(hostname);
    const e = tabelle.get(h);
    if (!e) return null;
    if (e.bis <= jetzt()) {
      tabelle.delete(h);
      return null;
    }
    return e.referer;
  }

  return { setze, fuer };
}
