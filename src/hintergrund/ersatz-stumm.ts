// Komplett-Ersatz (Auftrag G): Tab stumm schalten, solange die Galerie steht. Das Anhalten der Medien im Dokument (src/ersatz/medien.ts)
// sieht weder Shadow Roots noch iframes noch Audio ohne Element; der stumme Tab deckt das alles ab. `tabs.update` mit `muted` braucht
// kein Recht `tabs`. Der Stand davor (`mutedInfo.muted`) liegt je Tab in storage.session, damit ein Neustart des Hintergrunds ihn nicht
// vergisst; am Ende kommt genau dieser Stand zurueck (war der Tab schon stumm, bleibt er es).
import type { NachrichtHintergrundErsatzStumm } from '../nachrichten';

interface Absender {
  tab?: { id?: number };
  frameId?: number;
}

const SCHLUESSEL = 'ersatz-stumm-';

function sitzung(): { get(k: string): Promise<Record<string, unknown>>; set(o: Record<string, unknown>): Promise<void>; remove(k: string | string[]): Promise<void> } | null {
  const s = (browser.storage as unknown as { session?: ReturnType<typeof sitzung> }).session;
  return s ?? null;
}

// Verlassen der Seite (Adresse, Zurueck, Link): das Content-Script der alten Seite ist dann weg. Der Tab bekommt eine Marke `abgang`; ist die
// neue Seite geladen (`status: complete`) und hat sich 1,5 s lang kein neues Content-Script mit `an` gemeldet (Galerie auch dort), kommt der
// gemerkte Ton-Stand zurueck. Frueher geht es nicht: Firefox 128 stellt den Ton sonst waehrend der Navigation wieder auf stumm (gemessen).
// Ohne neues Recht: onUpdated meldet `status` auch ohne `tabs`. Aufruf beim Start des Hintergrunds (Listener oben im Skript).
const MARKE = 'ersatz-abgang-';
const NACHFRIST_MS = 1500;

async function markiereAbgang(tabId: number): Promise<void> {
  const speicher = sitzung();
  if (!speicher) return;
  const k = `${SCHLUESSEL}${tabId}`;
  if (typeof (await speicher.get(k))[k] === 'boolean') await speicher.set({ [`${MARKE}${tabId}`]: true });
}

async function schliesseAb(tabId: number): Promise<void> {
  const speicher = sitzung();
  if (!speicher) return;
  const m = `${MARKE}${tabId}`;
  if ((await speicher.get(m))[m] !== true) return;
  await speicher.remove(m);
  await arbeite({ ziel: 'hintergrund', typ: 'ersatz-stumm', an: false }, { tab: { id: tabId }, frameId: 0 });
}

export function starteErsatzStumm(): void {
  browser.tabs.onRemoved.addListener((id) => {
    void sitzung()?.remove([`${SCHLUESSEL}${id}`, `${MARKE}${id}`]).catch(() => undefined);
  });
  browser.tabs.onUpdated.addListener((id, info) => {
    if (info.status === 'loading') kette = kette.then(() => markiereAbgang(id)).catch(() => undefined);
    else if (info.status === 'complete') {
      setTimeout(() => {
        kette = kette.then(() => schliesseAb(id)).catch(() => undefined);
      }, NACHFRIST_MS);
    }
  });
}

// Aenderungen laufen nacheinander (ein schnelles Aus darf ein noch laufendes An nicht ueberholen).
let kette: Promise<unknown> = Promise.resolve();

export function bearbeiteErsatzStumm(n: NachrichtHintergrundErsatzStumm, absender: Absender | undefined): Promise<unknown> {
  const lauf = kette.then(() => arbeite(n, absender));
  kette = lauf.catch(() => undefined);
  return lauf;
}

async function arbeite(n: NachrichtHintergrundErsatzStumm, absender: Absender | undefined): Promise<unknown> {
  const tabId = absender?.tab?.id;
  // Nur die oberste Seite eines Tabs (die Galerie laeuft nie in Rahmen).
  if (typeof tabId !== 'number' || absender?.frameId !== 0) return { ok: false, fehler: 'kein Tab' };
  const speicher = sitzung();
  const schluessel = `${SCHLUESSEL}${tabId}`;
  try {
    if (n.an) {
      await speicher?.remove(`${MARKE}${tabId}`);
      const gemerkt = speicher ? (await speicher.get(schluessel))[schluessel] : undefined;
      if (typeof gemerkt !== 'boolean') {
        const tab = await browser.tabs.get(tabId);
        await speicher?.set({ [schluessel]: tab.mutedInfo?.muted === true });
      }
      await browser.tabs.update(tabId, { muted: true });
    } else if (n.abgang) {
      await markiereAbgang(tabId);
    } else {
      const gemerkt = speicher ? (await speicher.get(schluessel))[schluessel] : undefined;
      // Ohne gemerkten Stand (nie von uns stumm geschaltet) bleibt der Tab, wie er ist.
      if (typeof gemerkt === 'boolean') {
        await speicher?.remove(schluessel);
        await browser.tabs.update(tabId, { muted: gemerkt });
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, fehler: String(e) };
  }
}
