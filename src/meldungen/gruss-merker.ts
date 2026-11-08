// Merker der Begruessung auf Erwachsenenseiten (Session 17, Fund 10). Er liegt NICHT im sessionStorage der Seite (jedes Seitenskript koennte ihn
// lesen und so die Erweiterung nachweisen oder ihn vorab setzen und die Begruessung unterdruecken), sondern im Speicher des Content-Scripts
// (eigene Welt, fuer die Seite unsichtbar) und in `storage.local` je Host mit Zeitstempel. Eine Begruessung gilt GRUSS_FRIST_MS lang als gezeigt,
// tabuebergreifend und auch nach Neuladen. Die Hilfsfunktionen sind rein und laufen im Einheitstest.

export const GRUSS_FRIST_MS = 30 * 60 * 1000;
export const GRUSS_SPEICHER_SCHLUESSEL = 'grussMerker';
export const GRUSS_HOSTS_MAX = 100;

export type GrussMerker = Record<string, number>;

// Nur Zahlen je Host-Name; alles andere (und Abgelaufenes) faellt heraus.
export function bereinigeGrussMerker(roh: unknown, jetzt: number): GrussMerker {
  const aus: GrussMerker = {};
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return aus;
  for (const [host, t] of Object.entries(roh as Record<string, unknown>)) {
    if (typeof t === 'number' && Number.isFinite(t) && t <= jetzt && jetzt - t < GRUSS_FRIST_MS) aus[host] = t;
  }
  const alt = Object.entries(aus).sort((a, b) => b[1] - a[1]).slice(0, GRUSS_HOSTS_MAX);
  return Object.fromEntries(alt);
}

export const grussFrisch = (merker: GrussMerker, host: string, jetzt: number): boolean => {
  const t = merker[host];
  return typeof t === 'number' && t <= jetzt && jetzt - t < GRUSS_FRIST_MS;
};

const imSpeicher = new Map<string, number>();

// Wurde dieser Host in den letzten 30 Minuten begruesst (Speicher des Skripts oder storage.local)?
export async function grussSchonGezeigt(host: string): Promise<boolean> {
  const jetzt = Date.now();
  const t = imSpeicher.get(host);
  if (t !== undefined && jetzt - t < GRUSS_FRIST_MS) return true;
  try {
    const a = await browser.storage.local.get(GRUSS_SPEICHER_SCHLUESSEL);
    return grussFrisch(bereinigeGrussMerker(a[GRUSS_SPEICHER_SCHLUESSEL], jetzt), host, jetzt);
  } catch {
    return false;
  }
}

export async function merkeGruss(host: string): Promise<void> {
  const jetzt = Date.now();
  imSpeicher.set(host, jetzt);
  try {
    const a = await browser.storage.local.get(GRUSS_SPEICHER_SCHLUESSEL);
    const neu = bereinigeGrussMerker(a[GRUSS_SPEICHER_SCHLUESSEL], jetzt);
    neu[host] = jetzt;
    await browser.storage.local.set({ [GRUSS_SPEICHER_SCHLUESSEL]: bereinigeGrussMerker(neu, jetzt) });
  } catch {
    // Speicher nicht erreichbar: der Merker im Skript genuegt fuer diesen Seitenaufruf
  }
}
