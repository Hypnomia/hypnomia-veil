// Erwachsenenseiten nach Liste (PHASE-4-BAUPLAN Abschnitte 2 und 8 Punkt 11). Vom Orchestrator geschrieben; gemeinsam fuer Auftrag E
// (Content-Script, Adapter), U (Umleitung, Regel nur fuer Listen-Domains) und O (Oberflaeche). Reine Funktionen, keine Browser-Aufrufe.
// Erkennen am Inhalt ist NICHT hier (Zustand je Seite, Auftrag E in src/adapter/); am Inhalt erkannte Seiten bekommen nur Quiz und
// Freilegen, nie Vorschau-Tausch oder Umleitung.

import liste from '../../data/erwachsenenseiten.json' with { type: 'json' };

// Adapter-Namen. `allgemein`: Seite auf der Liste ohne eigenen Adapter (Rueckfall ohne Selektoren).
export type SeitenName = 'pornhub' | 'xhamster' | 'xvideos' | 'xnxx' | 'onlyfans' | 'fansly' | 'allgemein';
export const SEITEN_NAMEN: readonly SeitenName[] = ['pornhub', 'xhamster', 'xvideos', 'xnxx', 'onlyfans', 'fansly', 'allgemein'];

export interface ListenEintrag {
  seite: SeitenName;
  domains: string[];
}

export const ERWACHSENEN_LISTE: readonly ListenEintrag[] = (liste.seiten as { seite: string; domains: string[] }[])
  .filter((e): e is ListenEintrag => (SEITEN_NAMEN as readonly string[]).includes(e.seite))
  .map((e) => ({ seite: e.seite, domains: e.domains.map((d) => d.toLowerCase()) }));

// Testdomain (Pruefer-Fund 7): nur im Testbau (WXT_TESTHAKEN=1). `<seite>.veil-erwachsen.test` gilt als diese Seite (z. B.
// pornhub.veil-erwachsen.test), jede andere Subdomain als `allgemein`. Die Release-Pruefung sucht die Spur `veil-erwachsen`.
// Im Release-Bau ist der Name eine nie aufloesbare Domain (`.invalid`), der Testname faellt beim Bau weg (konstanter Vergleich).
export const TEST_DOMAIN: string = (() => {
  try {
    return import.meta.env.WXT_TESTHAKEN === '1' ? 'veil-erwachsen.test' : 'kein-testbau.invalid';
  } catch {
    return 'kein-testbau.invalid'; // Node (Einheitstests): kein import.meta.env
  }
})();
function testhakenAn(): boolean {
  try {
    return import.meta.env.WXT_TESTHAKEN === '1';
  } catch {
    return false;
  }
}

// Host aus einer Adresse oder einer Eingabe des Nutzers ("www.Example.com/pfad" -> "example.com"). Ohne gueltigen Host: null.
export function hostAus(eingabe: string): string | null {
  // Ein fuehrendes "*." (Gewohnheit aus Musterlisten) wird abgeschnitten: die Subdomains zaehlen ohnehin mit.
  const t = eingabe.trim().toLowerCase().replace(/^\*\./, '');
  if (!t) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(t) ? t : `https://${t}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.replace(/^www\./, '').replace(/\.$/, '');
    // Nur echte Hostnamen: Labels aus a-z, 0-9 und Bindestrich (nicht am Rand), mindestens zwei Labels, keine leeren (sonst lehnt
    // declarativeNetRequest die ganze Umleitungsregel ab). Punycode (xn--) ist erlaubt, Platzhalter wie "*." nicht.
    const labels = host.split('.');
    const gut = labels.length >= 2 && labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l));
    return gut && host.length <= 253 ? host : null;
  } catch {
    return null;
  }
}

const passt = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

// Adapter fuer eine Adresse: Liste, dann eigene Seiten des Nutzers (`allgemein`), sonst null. `eigeneSeiten`: Einstellungen.erwachsen.
export function seiteFuer(url: string, eigeneSeiten: readonly string[] = []): SeitenName | null {
  const host = hostAus(url);
  if (!host) return null;
  if (testhakenAn() && passt(host, TEST_DOMAIN)) {
    const vorne = host.slice(0, -(TEST_DOMAIN.length + 1)).split('.').pop() ?? '';
    return (SEITEN_NAMEN as readonly string[]).includes(vorne) ? (vorne as SeitenName) : 'allgemein';
  }
  for (const e of ERWACHSENEN_LISTE) if (e.domains.some((d) => passt(host, d))) return e.seite;
  for (const roh of eigeneSeiten) {
    const d = hostAus(roh);
    if (d && passt(host, d)) return 'allgemein';
  }
  return null;
}

// Steht die Adresse auf der Liste oder bei den eigenen Seiten? (Nicht: am Inhalt erkannt.)
export function istErwachsenenseite(url: string, eigeneSeiten: readonly string[] = []): boolean {
  return seiteFuer(url, eigeneSeiten) !== null;
}

// Alle Domains fuer Regeln (Umleitung): Liste plus eigene Seiten plus im Testbau die Testdomain. Nur Hosts, ohne Doppelte.
export function alleDomains(eigeneSeiten: readonly string[] = []): string[] {
  const aus = new Set<string>();
  for (const e of ERWACHSENEN_LISTE) for (const d of e.domains) aus.add(d);
  for (const roh of eigeneSeiten) {
    const d = hostAus(roh);
    if (d) aus.add(d);
  }
  if (testhakenAn()) aus.add(TEST_DOMAIN);
  return [...aus];
}
