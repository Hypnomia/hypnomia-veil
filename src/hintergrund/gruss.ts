// Merker der Begruessung auf Erwachsenenseiten (Lesung 17 R2-4). Er liegt im Hintergrund in `storage.session` (fluechtig: nur im Speicher,
// weg mit dem Browser-Neustart), nie in `storage.local`: dort waere er eine dauerhafte, nicht abschaltbare Liste besuchter Erwachsenenseiten.
// Ohne `storage.session` haelt ihn eine Map dieses Hintergrunds. Der Altbestand aus 0.9.0 in `storage.local` wird beim Start des Hintergrunds
// und bei jeder gemerkten Begruessung geloescht.
import { bereinigeGrussMerker, grussFrisch, GRUSS_SPEICHER_SCHLUESSEL, type GrussMerker } from '../meldungen/gruss-merker';
import type { AntwortGruss, NachrichtHintergrundGruss } from '../nachrichten';

let ersatz: GrussMerker = {};

type SitzungsSpeicher = { get(k: string): Promise<Record<string, unknown>>; set(o: Record<string, unknown>): Promise<void> };
function sitzung(): SitzungsSpeicher | null {
  return ((browser.storage as unknown as { session?: SitzungsSpeicher }).session) ?? null;
}

async function liesMerker(jetzt: number): Promise<GrussMerker> {
  const s = sitzung();
  if (!s) return bereinigeGrussMerker(ersatz, jetzt);
  try {
    return bereinigeGrussMerker((await s.get(GRUSS_SPEICHER_SCHLUESSEL))[GRUSS_SPEICHER_SCHLUESSEL], jetzt);
  } catch {
    return bereinigeGrussMerker(ersatz, jetzt);
  }
}

async function schreibeMerker(m: GrussMerker): Promise<void> {
  ersatz = m;
  const s = sitzung();
  if (!s) return;
  try {
    await s.set({ [GRUSS_SPEICHER_SCHLUESSEL]: m });
  } catch {
    // die Map genuegt
  }
}

export async function raeumeAltenGrussMerker(): Promise<void> {
  try {
    await browser.storage.local.remove(GRUSS_SPEICHER_SCHLUESSEL);
  } catch {
    // Speicher nicht erreichbar: beim naechsten Mal
  }
}

export async function bearbeiteGruss(n: NachrichtHintergrundGruss): Promise<AntwortGruss> {
  if (typeof n.host !== 'string' || !n.host || n.host.length > 253) return { ok: false };
  const jetzt = Date.now();
  const m = await liesMerker(jetzt);
  const gezeigt = grussFrisch(m, n.host, jetzt);
  if (n.merken === true) {
    m[n.host] = jetzt;
    await schreibeMerker(bereinigeGrussMerker(m, jetzt));
    await raeumeAltenGrussMerker();
  }
  return { ok: true, gezeigt };
}
