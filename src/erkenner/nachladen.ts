// Bild per Adresse nachladen (fetch ohne Anmeldedaten). Erst ohne Referer; bei 403 oder Netzfehler einmal
// den Referer fuer den Host setzen lassen und wiederholen. Kein anderer Netzverkehr.
// Jeder Abruf hat eine Zeitgrenze (Verbindung und Lesen zusammen) und eine Groessenobergrenze: ein haengender oder endloser
// Bildserver darf keinen Platz der Schranke im Erkenner auf Dauer belegen.
// Private Adressbereiche (Heimnetz, Loopback, Link-Local) laedt der Erkenner nur nach, wenn die anfragende Seite selbst privat ist
// (wie Chromes Private Network Access: oeffentlich nach privat gesperrt, privat nach privat erlaubt). Sonst koennte eine Webseite
// den Erkenner als Bruecke in das Heimnetz benutzen und Bilder von Routern oder Kameras abholen lassen.

// Zeitgrenze je Abruf in Millisekunden (Verbindung bis zum letzten Byte).
export const NACHLADEN_MAX_MS = 9000;
// Groessenobergrenze je Bild in Bytes.
export const NACHLADEN_MAX_BYTES = 25 * 1024 * 1024;

export interface NachladenGrenzen {
  maxMs: number;
  maxBytes: number;
}
const STANDARD_GRENZEN: NachladenGrenzen = { maxMs: NACHLADEN_MAX_MS, maxBytes: NACHLADEN_MAX_BYTES };

export type RefererSetzer = (host: string, referer: string) => Promise<void>;

export interface Nachgeladen {
  ok: true;
  blob: Blob;
}
export interface NachladenFehler {
  ok: false;
  fehler: string;
  status?: number;
  // Zeitgrenze oder Groessenobergrenze: eine Wiederholung mit Referer brachte nichts.
  endgueltig?: boolean;
}

// ---------- Private Adressbereiche ----------

// Namen, die nach Vereinbarung nur im eigenen Netz aufgeloest werden: localhost, *.localhost, *.local, *.internal, *.home.arpa
// und die in Heimnetzen und Firmennetzen ueblichen Endungen *.lan, *.home, *.localdomain, *.intranet, *.corp sowie fritz.box.
// Der Namensstamm selbst zaehlt mit: wer "internal" aufloest, tut es ueber eine Suchdomain im eigenen Netz.
const PRIVATE_NAMEN: readonly string[] = [
  'localhost',
  'local',
  'internal',
  'home.arpa',
  'lan',
  'home',
  'localdomain',
  'intranet',
  'corp',
  'fritz.box',
];
// Namen ohne Punkt (Einlabel-Namen wie "drucker", "localhost6", "ip6-localhost") loest nur das eigene Netz auf; sie gelten als privat.
// Das umfasst auch Hosts, die der URL-Parser nicht als Adresse versteht (zum Beispiel reine Zahlen ueber 2^32).
const NAME_FORM = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;

// Bringt einen Host in die Form des Adressparsers: klein, ohne eckige Klammern, ohne Punkt am Namensende. Zahlenformen wie
// 0x7f.1 oder 2130706433 und Kurzschreibweisen von IPv6 rechnet der URL-Parser auf die kanonische Form um.
function normalisiereHost(roh: string): string {
  let h = roh.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const klammer = h.includes(':') ? `[${h}]` : h;
  try {
    h = new URL(`http://${klammer}/`).hostname;
  } catch {
    // kein gueltiger Host: unveraendert weiterpruefen (ergibt in der Regel "nicht privat")
  }
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  while (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

type Ipv4 = [number, number, number, number];

function ipv4Teile(h: string): Ipv4 | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return null;
  const teile: Ipv4 = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return teile.every((t) => t <= 255) ? teile : null;
}

function istPrivatIpv4(t: Ipv4): boolean {
  const [a, b] = t;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 (Carrier-Grade NAT)
    a === 127 || // 127.0.0.0/8
    (a === 169 && b === 254) || // 169.254.0.0/16
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 192 && b === 0 && t[2] === 0) || // 192.0.0.0/24 (IETF-Protokollzuweisungen)
    (a === 198 && (b === 18 || b === 19)) // 198.18.0.0/15 (Netzwerktests)
  );
}

// Zerlegt eine IPv6-Adresse (ohne Klammern) in acht Gruppen zu je 16 Bit; null, wenn sie keine gueltige Adresse ist.
function ipv6Gruppen(h: string): number[] | null {
  if (!/^[0-9a-f:.]+$/.test(h) || !h.includes(':')) return null;
  let text = h;
  // Eingebettete IPv4-Endung (::ffff:10.0.0.1) in zwei Gruppen umrechnen.
  const punkt = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (punkt) {
    const v4 = ipv4Teile(punkt[2] ?? '');
    if (!v4) return null;
    text = `${punkt[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const doppel = text.split('::');
  if (doppel.length > 2) return null;
  const links = doppel[0] ? doppel[0].split(':') : [];
  const rechts = doppel.length === 2 && doppel[1] ? doppel[1].split(':') : [];
  const fehlend = 8 - links.length - rechts.length;
  if (doppel.length === 2 ? fehlend < 1 : fehlend !== 0) return null;
  const alle = [...links, ...Array<string>(doppel.length === 2 ? fehlend : 0).fill('0'), ...rechts];
  if (alle.length !== 8) return null;
  const zahlen = alle.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return zahlen.some((z) => Number.isNaN(z)) ? null : zahlen;
}

function istPrivatIpv6(g: number[]): boolean {
  const gr = (i: number): number => g[i] ?? 0;
  const nullen = (von: number, bis: number) => g.slice(von, bis).every((x) => x === 0);
  if (nullen(0, 7) && (gr(7) === 0 || gr(7) === 1)) return true; // :: (unbestimmt) und ::1 (Loopback)
  if ((gr(0) & 0xfe00) === 0xfc00) return true; // fc00::/7 (Unique Local)
  if ((gr(0) & 0xffc0) === 0xfe80) return true; // fe80::/10 (Link-Local)
  if (gr(0) === 0x64 && gr(1) === 0xff9b && nullen(2, 6)) return true; // 64:ff9b::/96 (NAT64, kann auf private IPv4 zeigen)
  if (nullen(0, 5) && gr(5) === 0xffff) {
    // ::ffff:a.b.c.d (auf IPv6 abgebildete IPv4-Adresse)
    return istPrivatIpv4([gr(6) >> 8, gr(6) & 255, gr(7) >> 8, gr(7) & 255]);
  }
  return false;
}

// Zeigt dieser Host (Name oder Adresse, mit oder ohne eckige Klammern) in einen privaten Bereich?
// Namen, die per DNS auf private Adressen zeigen, erkennt das nicht (Grenze, siehe SICHERHEITSGRENZEN.md).
export function istPrivaterHost(host: string): boolean {
  const h = normalisiereHost(host);
  if (!h) return false;
  const v4 = ipv4Teile(h);
  if (v4) return istPrivatIpv4(v4);
  const v6 = ipv6Gruppen(h);
  if (v6) return istPrivatIpv6(v6);
  if (!NAME_FORM.test(h)) return false; // kein brauchbarer Host (Muell, Leerzeichen): nicht privat
  if (!h.includes('.')) return true; // Name ohne Punkt
  return PRIVATE_NAMEN.some((n) => h === n || h.endsWith(`.${n}`));
}

export type NachladeEntscheidung = 'erlaubt' | 'privat';

// Entscheidet, ob ein Ziel nachgeladen werden darf: ein privates Ziel nur, wenn die anfragende Seite (referer) selbst privat ist.
// Ein leerer Referer heisst "kein Seitenbezug" (interner Aufruf der Erweiterung, Tests): die Regel greift dann nicht. Die Content-Scripts
// schicken nie einen leeren Referer fuer eine Webseite (siehe refererDerSeite: unbekannter Ursprung wird zu "null", also nicht privat).
// Ein Referer, der keine http(s)-Adresse ist, gilt als oeffentlich.
export function entscheideNachladen(ziel: string | URL, referer: string): NachladeEntscheidung {
  let zielHost: string;
  try {
    zielHost = (typeof ziel === 'string' ? new URL(ziel) : ziel).hostname;
  } catch {
    return 'privat';
  }
  if (!istPrivaterHost(zielHost)) return 'erlaubt';
  if (referer === '') return 'erlaubt';
  try {
    const r = new URL(referer);
    if ((r.protocol === 'http:' || r.protocol === 'https:') && istPrivaterHost(r.hostname)) return 'erlaubt';
  } catch {
    // kein Adresswert: gilt als oeffentlich
  }
  return 'privat';
}

// Absender einer Nachricht an den Erkenner: nur das, was fuer die Herkunft zaehlt.
export interface AbsenderHerkunft {
  tab?: unknown;
  origin?: string;
}

// Herkunft fuer die Netzgrenze. Nachrichten aus einem Tab (Content-Script) tragen ihre Herkunft nicht selbst: fehlt der Referer, gilt
// "null" (oeffentlich); liefert der Browser sender.origin, zaehlt dieser (undurchsichtig oder fremd: "null"/oeffentlich) und nicht der
// behauptete Referer. Ein leerer Referer bleibt nur fuer Absender ohne Tab erlaubt (Erweiterungsseiten, Tests).
export function herkunftFuerEntscheidung(referer: string, absender?: AbsenderHerkunft | null): string {
  if (!absender || absender.tab === undefined || absender.tab === null) return referer;
  if (typeof absender.origin === 'string' && absender.origin !== '') {
    try {
      const o = new URL(absender.origin);
      if (o.protocol === 'http:' || o.protocol === 'https:') return `${o.origin}/`;
    } catch {
      // keine Adresse: gilt als undurchsichtig
    }
    return 'null';
  }
  return referer === '' ? 'null' : referer;
}

// Eine Adresse, die ein Referer-Eintrag sein kann (http oder https). Alles andere (leer, "null") setzt keinen Referer.
function istHttpAdresse(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Liest den Rumpf in Stuecken und bricht ab, sobald die Obergrenze ueberschritten ist.
async function leseBegrenzt(antwort: Response, maxBytes: number): Promise<Blob | 'zugross'> {
  const angekuendigt = Number(antwort.headers.get('content-length'));
  if (Number.isFinite(angekuendigt) && angekuendigt > maxBytes) {
    await antwort.body?.cancel().catch(() => {});
    return 'zugross';
  }
  const leser = antwort.body?.getReader();
  if (!leser) return antwort.blob();
  const stuecke: Uint8Array[] = [];
  let summe = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    summe += value.byteLength;
    if (summe > maxBytes) {
      await leser.cancel().catch(() => {});
      return 'zugross';
    }
    stuecke.push(value);
  }
  return new Blob(stuecke as BlobPart[], { type: antwort.headers.get('content-type') ?? '' });
}

// Abruf von aussen einspritzbar (Tests: Antwort einer Weiterleitung auf eine private Adresse).
export type HoleFunktion = (url: string, init: RequestInit) => Promise<Response>;

export interface NachladenOptionen {
  // Herkunft fuer die Netzgrenze; fehlt sie, zaehlt der Referer.
  herkunft?: string;
  holeFn?: HoleFunktion;
}

async function einmal(
  url: string,
  herkunft: string,
  grenzen: NachladenGrenzen,
  holeFn: HoleFunktion,
): Promise<Nachgeladen | NachladenFehler> {
  const abbruch = new AbortController();
  let abgelaufen = false;
  const uhr = setTimeout(() => {
    abgelaufen = true;
    abbruch.abort();
  }, grenzen.maxMs);
  try {
    let antwort: Response;
    try {
      antwort = await holeFn(url, { credentials: 'omit', cache: 'default', signal: abbruch.signal });
    } catch (e) {
      if (abgelaufen) return { ok: false, fehler: 'fetch: Zeitgrenze', endgueltig: true };
      return { ok: false, fehler: `fetch: ${e instanceof Error ? e.message : String(e)}` };
    }
    // Eine Weiterleitung kann in ein privates Netz fuehren: auch die Endadresse prueft die Regel (den Rumpf liest dann niemand).
    if (antwort.url && entscheideNachladen(antwort.url, herkunft) === 'privat') {
      await antwort.body?.cancel().catch(() => {});
      return { ok: false, fehler: 'privat', endgueltig: true };
    }
    if (!antwort.ok) return { ok: false, fehler: `HTTP ${antwort.status}`, status: antwort.status };
    try {
      const blob = await leseBegrenzt(antwort, grenzen.maxBytes);
      if (blob === 'zugross') return { ok: false, fehler: 'lesen: Bild zu gross', endgueltig: true };
      return { ok: true, blob };
    } catch (e) {
      if (abgelaufen) return { ok: false, fehler: 'lesen: Zeitgrenze', endgueltig: true };
      return { ok: false, fehler: `lesen: ${e instanceof Error ? e.message : String(e)}` };
    }
  } finally {
    clearTimeout(uhr);
  }
}

export async function ladeNach(
  url: string,
  referer: string,
  setzeReferer: RefererSetzer,
  grenzen: NachladenGrenzen = STANDARD_GRENZEN,
  optionen: NachladenOptionen = {},
): Promise<Nachgeladen | NachladenFehler> {
  const herkunft = optionen.herkunft ?? referer;
  const holeFn: HoleFunktion = optionen.holeFn ?? ((u, init) => fetch(u, init));
  let ziel: URL;
  try {
    ziel = new URL(url);
  } catch {
    return { ok: false, fehler: 'ungueltige Adresse' };
  }
  if (ziel.protocol !== 'http:' && ziel.protocol !== 'https:') return { ok: false, fehler: 'nur http und https' };
  // Oeffentliche Seite nach privatem Ziel: abgelehnt, ohne einen Abruf und ohne Wiederholung mit Referer (das Element bleibt verdeckt).
  if (entscheideNachladen(ziel, herkunft) === 'privat') return { ok: false, fehler: 'privat', endgueltig: true };
  const erster = await einmal(url, herkunft, grenzen, holeFn);
  if (erster.ok) return erster;
  // Nur 403 und Netzfehler lohnen eine Wiederholung mit Referer (Zeitgrenze und zu grosse Bilder nicht).
  const lohntSich = !erster.endgueltig && (erster.status === 403 || erster.status === undefined);
  if (!lohntSich || !istHttpAdresse(referer)) return erster;
  try {
    await setzeReferer(ziel.host, referer);
  } catch (e) {
    return { ...erster, fehler: `${erster.fehler}; Referer: ${e instanceof Error ? e.message : String(e)}` };
  }
  return einmal(url, herkunft, grenzen, holeFn);
}

// Daten-Adresse (data:...) in einen Blob wandeln.
export async function blobAusDataUrl(dataUrl: string): Promise<Blob> {
  if (!dataUrl.startsWith('data:')) throw new Error('keine Daten-Adresse');
  const antwort = await fetch(dataUrl);
  return antwort.blob();
}
