// Merker der Begruessung auf Erwachsenenseiten (Session 17, Fund 10). Er liegt NICHT im sessionStorage der Seite (jedes Seitenskript koennte ihn
// lesen und so die Erweiterung nachweisen oder ihn vorab setzen und die Begruessung unterdruecken), sondern im Speicher des Content-Scripts
// (eigene Welt, fuer die Seite unsichtbar) und im Hintergrund in `storage.session` je Host mit Zeitstempel (Lesung 17 R2-4: fluechtig, nicht
// mehr `storage.local`). Eine Begruessung gilt GRUSS_FRIST_MS lang als gezeigt, tabuebergreifend und auch nach Neuladen, bis zum Neustart des
// Browsers. Die Hilfsfunktionen sind rein und laufen im Einheitstest.

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

// Lesung 17 R2-4: den Merker ueber Tabs und Neuladen haelt der Hintergrund in storage.session (src/hintergrund/gruss.ts), nie storage.local.
async function frageHintergrund(host: string, merken: boolean): Promise<boolean | null> {
  try {
    const a = (await browser.runtime.sendMessage({ ziel: 'hintergrund', typ: 'gruss', host, merken })) as { ok?: boolean; gezeigt?: unknown } | undefined;
    return a?.ok === true && typeof a.gezeigt === 'boolean' ? a.gezeigt : null;
  } catch {
    return null;
  }
}

// Wurde dieser Host in den letzten 30 Minuten begruesst (Speicher des Skripts oder Hintergrund)? Ohne Antwort: nicht noch einmal versuchen,
// lieber still (eine Begruessung ist kein Muss).
export async function grussSchonGezeigt(host: string): Promise<boolean> {
  const jetzt = Date.now();
  const t = imSpeicher.get(host);
  if (t !== undefined && jetzt - t < GRUSS_FRIST_MS) return true;
  return (await frageHintergrund(host, false)) ?? true;
}

export async function merkeGruss(host: string): Promise<void> {
  imSpeicher.set(host, Date.now());
  await frageHintergrund(host, true);
}
