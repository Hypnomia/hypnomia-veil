// Tastatur-Schutz (PHASE-4-BAUPLAN Abschnitt 8 Punkt 9): Capture-Listener auf `window`, ab document_start installiert (vor allen Seitenskripten).
// Hat der Fokus einen Riegel (Ziel des Ereignisses ist der Host), stoppt der Listener das Ereignis, bevor Kuerzel der Seite (f, m, Leertaste,
// Pfeile) es sehen, und reicht es an die Tastenlogik des Riegels weiter. Default-Aktionen bleiben (Zeichen tippen, Knopf per Leertaste):
// es wird nie preventDefault gerufen, ausser der Riegel selbst will es. Folge: Listener INNERHALB des Riegels bekommen keine Tasten, alle
// Tastenlogik laeuft ueber `registriereHost`.

type Behandler = (e: KeyboardEvent) => void;
const hosts = new Map<EventTarget, Behandler>();
// Auch Eingabe- und Kompositionsereignisse (`data` enthaelt den getippten Text, sie sind `composed`): die Seite darf keine Antwort mitlesen.
const TASTEN = ['keydown', 'keyup', 'keypress'] as const;
const TYPEN = [...TASTEN, 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend'] as const;
let entferner: (() => void) | null = null;

function schuetze(e: Event): void {
  const behandler = e.target ? hosts.get(e.target) : undefined;
  if (!behandler) return;
  e.stopImmediatePropagation();
  // Von der Seite erzeugte Ereignisse (dispatchEvent) werden nur gestoppt, nie an die Riegel-Logik gereicht.
  if (!e.isTrusted || !(TASTEN as readonly string[]).includes(e.type)) return;
  try {
    behandler(e as KeyboardEvent);
  } catch {
    // Fehler in der Riegel-Logik duerfen die Seite nicht beruehren
  }
}

// Idempotent. `ctx.onInvalidated` raeumt auf (Erweiterung neu geladen oder entfernt).
export function installiereTastaturschutz(ctx?: { onInvalidated(rueckruf: () => void): unknown }): void {
  if (entferner) return;
  for (const t of TYPEN) window.addEventListener(t, schuetze, true);
  entferner = () => {
    for (const t of TYPEN) window.removeEventListener(t, schuetze, true);
    hosts.clear();
    entferner = null;
  };
  try {
    ctx?.onInvalidated(() => entferner?.());
  } catch {
    // ohne Kontext bleibt der Listener bis zum Entladen der Seite
  }
}

export function registriereHost(host: Element, behandler: Behandler): () => void {
  hosts.set(host, behandler);
  return () => {
    hosts.delete(host);
  };
}
