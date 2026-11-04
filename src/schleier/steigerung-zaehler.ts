// Reine Teile des Steigerungs-Melders (steigerung-melder.ts): Zaehlung neuer Urteile `zensiert` und die Entscheidung, ob eine Minutenmeldung
// ausgeht. Ohne Browser, damit Einheitstests sie direkt laden koennen.

// Minimaler Teil eines Elements, den die Zaehlung braucht.
export interface UrteilsElement {
  currentSrc?: string;
  tagName: string;
  getAttribute(name: string): string | null;
}

// Inhalt, an dem ein Element als "neu" erkannt wird: Quelle oder Stil.
export function inhaltVon(el: UrteilsElement): string {
  return el.currentSrc || el.getAttribute('src') || el.getAttribute('poster') || el.getAttribute('style') || el.tagName;
}

// Zaehlt neue Urteile `zensiert` seit der letzten Meldung. Eine Neubewertung desselben Inhalts (Stufe, Pack, Schwelle, Ende der Pause)
// zaehlt nicht erneut; ein anderer Inhalt im selben Element (neues Bild) zaehlt.
export class NeueUrteileZaehler {
  private readonly gemeldet = new WeakMap<object, string>();
  private anzahl = 0;

  zensiert(el: UrteilsElement): void {
    const inhalt = inhaltVon(el);
    if (this.gemeldet.get(el) === inhalt) return;
    this.gemeldet.set(el, inhalt);
    this.anzahl++;
  }

  get stand(): number {
    return this.anzahl;
  }

  // Zahl seit der letzten Meldung holen und von vorn beginnen.
  nimm(): number {
    const n = this.anzahl;
    this.anzahl = 0;
    return n;
  }

  verwirf(): void {
    this.anzahl = 0;
  }
}

export interface MinutenLage {
  // Oberste Seite des Tabs (nur sie meldet).
  oberste: boolean;
  // Freischaltung zensur:steigerung.
  frei: boolean;
  pause: boolean;
  // Schleier auf dieser Seite aus (eigene Ausnahme).
  aus: boolean;
  sichtbar: boolean;
}

// Entscheidet eine Minutenmeldung: null = nichts senden (der Zaehler wird dabei verworfen, nichts staut sich auf). Sonst Zahl und Art der Seite.
export function baueMinute(lage: MinutenLage, zaehler: NeueUrteileZaehler, erwachsen: () => boolean): { erwachsen: boolean; zensiert: number } | null {
  if (!lage.oberste || !lage.frei || lage.pause || lage.aus || !lage.sichtbar) {
    zaehler.verwirf();
    return null;
  }
  let istErwachsen = false;
  try {
    istErwachsen = erwachsen();
  } catch {
    // Ausnahme beim Erkennen der Seite: nichts melden, die Zahl nicht stehen lassen
    zaehler.verwirf();
    return null;
  }
  return { erwachsen: istErwachsen, zensiert: zaehler.nimm() };
}
