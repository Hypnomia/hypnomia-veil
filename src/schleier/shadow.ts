// Shadow Roots: Wurzel eines Elements finden (offen und geschlossen) und dieselbe Schleier-CSS wie im Dokument hineinlegen.

import schleierCss from '../../entrypoints/content/style.css?inline';

// Schwache Verweise: abgehaengte Wurzeln sollen nicht durch diese Liste am Leben bleiben.
const stile = new Set<WeakRef<HTMLStyleElement>>();
const versorgt = new WeakSet<ShadowRoot>();

// Offene Wurzel direkt, geschlossene ueber die Erweiterungs-API (Chrome: dom.openOrClosedShadowRoot, Firefox: Eigenschaft am Element).
export function wurzelVon(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  try {
    const dom = (browser as unknown as { dom?: { openOrClosedShadowRoot?: (e: Element) => ShadowRoot | null } }).dom;
    if (dom?.openOrClosedShadowRoot) return dom.openOrClosedShadowRoot(el) ?? null;
    const eigenschaft = (el as unknown as { openOrClosedShadowRoot?: ShadowRoot | null }).openOrClosedShadowRoot;
    if (eigenschaft) return eigenschaft;
  } catch {
    // kein Zugriff (z. B. Element aus fremdem Kontext)
  }
  return null;
}

// Legt die CSS einmal je Wurzel an. Gibt true zurueck, wenn die Wurzel neu war.
export function versorgeWurzel(wurzel: ShadowRoot, aus: boolean): boolean {
  if (versorgt.has(wurzel)) return false;
  versorgt.add(wurzel);
  const stil = document.createElement('style');
  stil.textContent = schleierCss;
  stil.media = aus ? 'not all' : '';
  wurzel.prepend(stil);
  stile.add(new WeakRef(stil));
  return true;
}

// Pause und Ausnahmen: die CSS in den Wurzeln abschalten bzw. wieder einschalten (html[data-veil-seite] reicht nicht in Wurzeln).
export function schalteWurzelStile(aus: boolean): void {
  for (const ref of stile) {
    const stil = ref.deref();
    if (!stil) {
      stile.delete(ref);
      continue;
    }
    stil.media = aus ? 'not all' : '';
  }
}

// Verweise auf Stile geloeschter Wurzeln loswerden (die Wurzel ist weg, der Stil auch).
export function raeumeWurzelStileAuf(): void {
  for (const ref of stile) if (!ref.deref()) stile.delete(ref);
}

// Aufraeumen beim Abbau: eingelegte Stile entfernen.
export function entferneWurzelStile(): void {
  for (const ref of stile) ref.deref()?.remove();
  stile.clear();
}
