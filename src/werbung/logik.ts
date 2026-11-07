// Reine Logik des Werbe-Tausch (Auftrag W, Phase 5): Format-Abgleich, Werbe-Merkmale, stabile Wahl. Kein Browser-Zugriff, laeuft auch in
// Einheitstests (node --experimental-strip-types). Daten stehen in data/werbung.json (nur Erkennungsmerkmale, es wird nichts blockiert).
import daten from '../../data/werbung.json' with { type: 'json' };
import links from '../../data/links.json' with { type: 'json' };
import motive from '../../data/werbung-motive.json' with { type: 'json' };
import type { LogoName } from '../oberflaeche/design/logos';
import { WERBE_FORMATE, formatMasse, type WerbeFormat } from '../pack/vertrag.ts';

// Testdomain (nur im Testbau): `*.veil-werbung.test` gilt als Werbe-Host. Im Release-Bau eine nie aufloesbare Domain; der Testname faellt
// beim Bau weg (konstanter Vergleich), die Release-Pruefung sucht die Spur `veil-werbung`.
export const TEST_WERBE_DOMAIN: string = (() => {
  try {
    return import.meta.env.WXT_TESTHAKEN === '1' ? 'veil-werbung.test' : 'kein-testbau-werbung.invalid';
  } catch {
    return 'kein-testbau-werbung.invalid'; // Node (Einheitstests)
  }
})();

const WERBE_HOSTS: readonly string[] = [...(daten.hosts as string[]).map((h) => h.toLowerCase()), TEST_WERBE_DOMAIN];
const KLASSEN = new Set((daten.klassen as string[]).map((k) => k.toLowerCase()));
const ID_PRAEFIXE = (daten.idPraefixe as string[]).map((p) => p.toLowerCase());
export const KENNUNG_ATTRIBUTE: readonly string[] = daten.attribute as string[];
const KENNZEICHNUNGEN = new Set((daten.kennzeichnungen as string[]).map((k) => k.toLowerCase()));
const NAMEN_MUSTER: RegExp[] = (daten.iframeNamen as string[]).map((m) => new RegExp(m, 'i'));

// ---------- Formate ----------
export const FORMAT_TOLERANZ = 0.1;
export const FORMAT_MIN_TOLERANZ_PX = 4;

function abstand(b: number, h: number, f: WerbeFormat): { passt: boolean; mass: number } {
  const m = formatMasse(f);
  const db = Math.abs(b - m.breite);
  const dh = Math.abs(h - m.hoehe);
  const passt = db <= Math.max(FORMAT_MIN_TOLERANZ_PX, m.breite * FORMAT_TOLERANZ) && dh <= Math.max(FORMAT_MIN_TOLERANZ_PX, m.hoehe * FORMAT_TOLERANZ);
  return { passt, mass: db / m.breite + dh / m.hoehe };
}

// Format, zu dem die Box passt (Breite und Hoehe je hoechstens 10 %, mindestens 4 px Abweichung erlaubt), sonst null; bei mehreren das naechste.
export function formatFuer(breite: number, hoehe: number): WerbeFormat | null {
  if (!Number.isFinite(breite) || !Number.isFinite(hoehe) || breite <= 0 || hoehe <= 0) return null;
  let best: WerbeFormat | null = null;
  let bestMass = Infinity;
  for (const f of WERBE_FORMATE) {
    const a = abstand(breite, hoehe, f);
    if (a.passt && a.mass < bestMass) {
      best = f;
      bestMass = a.mass;
    }
  }
  return best;
}

// ---------- Werbe-Merkmale ----------
export function istWerbeHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  return WERBE_HOSTS.some((w) => h === w || h.endsWith(`.${w}`));
}

// Adresse (auch relativ zu `basis`) gehoert zu einem Werbe-Host? Nur http und https.
export function istWerbeAdresse(adresse: string | null | undefined, basis?: string): boolean {
  if (!adresse) return false;
  try {
    const u = new URL(adresse.trim(), basis);
    return (u.protocol === 'http:' || u.protocol === 'https:') && istWerbeHost(u.hostname);
  } catch {
    return false;
  }
}

export function passtWerbeName(wert: string | null | undefined): boolean {
  if (!wert) return false;
  return NAMEN_MUSTER.some((m) => m.test(wert));
}

// Werbe-Kennung eines Elements: Klassen-Token (ganzes Token, nie Teilwort), id mit Praefix, oder eines der Attribute.
export function hatKennung(klassen: string | null | undefined, id: string | null | undefined, hatAttribut: (name: string) => boolean): boolean {
  if (klassen) {
    for (const t of klassen.toLowerCase().split(/\s+/)) if (t && KLASSEN.has(t)) return true;
  }
  if (id) {
    const i = id.toLowerCase();
    if (ID_PRAEFIXE.some((p) => i.startsWith(p))) return true;
  }
  return KENNUNG_ATTRIBUTE.some((a) => hatAttribut(a));
}

// Kurzer Text, der Werbung kennzeichnet (hoechstens 20 Zeichen, getrimmt, Schreibweise egal).
export function istKennzeichnung(text: string | null | undefined): boolean {
  // Erst die Laenge pruefen (ohne den ganzen Text zu bearbeiten): mehr als 40 Zeichen sind nie eine Kennzeichnung.
  if (typeof text !== 'string' || text.length > 40) return false;
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length === 0 || t.length > 20) return false;
  return KENNZEICHNUNGEN.has(t.toLowerCase());
}

// ---------- Stabile Wahl ----------
export function hashText(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Plattformen der Werbe-Motive (data/werbung-motive.json). Je Flaeche stabil gewaehlt: Plattform, darin eine Zeile; der Link kommt aus
// data/links.json unter dem Namen `link` der Plattform. Logo und Knopftext gehoeren immer zur Plattform des Links.
export const PLATTFORMEN = ['patreon', 'subscribestar', 'discord', 'youtube', 'x', 'itch'] as const;
export type Plattform = (typeof PLATTFORMEN)[number];
export type LinkName = keyof typeof links;
export const LINK_NAMEN: readonly string[] = PLATTFORMEN.map((p) => (motive.plattformen as Record<string, { link: string }>)[p]!.link);

export interface Motiv {
  plattform: Plattform;
  name: string; // Name des Links in links.json
  url: string;
  logo: LogoName;
  knopf: string;
  titel: string;
  unter: string;
}

export function linkFuer(schluessel: string): Motiv {
  const plattform = PLATTFORMEN[(hashText(`link|${schluessel}`) >>> 7) % PLATTFORMEN.length]!;
  const p = (motive.plattformen as Record<string, { link: string; logo: string; knopf: string; zeilen: { titel: string; unter: string }[] }>)[plattform]!;
  const z = p.zeilen[(hashText(`zeile|${schluessel}`) >>> 11) % p.zeilen.length]!;
  // Lesung S2/R Nr. 9: nur https-Adressen, sonst Mias Patreon.
  const roh = (links as Record<string, string>)[p.link];
  const url = typeof roh === 'string' && /^https:\/\//.test(roh) ? roh : links.patreon;
  return { plattform, name: p.link, url, logo: p.logo as LogoName, knopf: p.knopf, titel: z.titel, unter: z.unter };
}

// Layout nach Format der Flaeche: Banner (breit und niedrig), Hochformat (hoch und schmal), sonst Rechteck.
export type Layout = 'banner' | 'rechteck' | 'hoch';
export function layoutFuer(breite: number, hoehe: number): Layout {
  if (hoehe >= breite * 1.6) return 'hoch';
  if (breite >= hoehe * 2.5) return 'banner';
  return 'rechteck';
}

export const STANDARD_KENNZEICHNUNG = 'Mia’s ad';

export function kennzeichnungFuer(saetze: readonly string[] | undefined, schluessel: string): string {
  if (!saetze || saetze.length === 0) return STANDARD_KENNZEICHNUNG;
  return saetze[hashText(`satz|${schluessel}`) % saetze.length]!;
}

// Beide Boxen aus Rechtecken: gleiche Lage bis auf `toleranz` Pixel?
export function liegtGleich(a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }, toleranz = 2): boolean {
  return Math.abs(a.left - b.left) <= toleranz && Math.abs(a.top - b.top) <= toleranz && Math.abs(a.width - b.width) <= toleranz && Math.abs(a.height - b.height) <= toleranz;
}
