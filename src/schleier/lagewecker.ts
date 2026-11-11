// Lagewecker: gemeinsamer Anlass fuer Hosts, die per gemessener Lage auf einem Video liegen (Standbild des Players, Zonen-Leinwand).
// Verschiebt sich ein Video gegen den Bezug seines Hosts, ohne dass sich eine Groesse aendert (die Seite macht den Player zum Bezug, darueber
// waechst Inhalt, ein CSS-Uebergang bewegt den Player), meldet das kein ResizeObserver; der Lage-Takt kaeme bis zu 400 ms spaeter.
//
// Der Wecker wird wach bei einer Mutation der Seite (nicht an eigenen Hosts und nicht an eigenen Markierungen `data-veil...`) und bei Ereignissen,
// die Bewegung ankuendigen (Uebergaenge, Animationen, Bilder laden, Fenstergroesse, Vollbild, Zeiger). Danach bleibt er WACH_MS wach, solange
// am Ende des Fensters noch eine Animation laeuft auch laenger. Solange er wach ist, ruft er je Bild (requestAnimationFrame) seine Abonnenten.
// Diese messen nicht im rAF selbst, sondern holen sich ueber ihren ResizeObserver (unobserve und observe des Videos) einen Rueckruf nach dem
// Layout desselben Bildes und legen dort. Auf einer ruhigen Seite laeuft kein rAF und keine Messung.
//
// Reine Logik ohne Browser-Globale: die Umgebung (Uhr, rAF, Beobachter, Horcher) wird hereingereicht. Die Browser-Umgebung und die gemeinsame
// Instanz stehen in lagewecker-seite.ts. Laeuft so auch in den Einheitstests.

export const WACH_MS = 500;

// Ereignisse, die eine Bewegung ankuendigen (capture, passiv). `load` am Dokument (Bilder laden), `resize` am Fenster.
export const WECK_EREIGNISSE = ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel', 'load', 'fullscreenchange', 'pointerover'] as const;
export const WECK_EREIGNISSE_FENSTER = ['resize', 'visibilitychange'] as const;

// Verzeichnis eigener Hosts (Standbild, Leinwand): ihre Mutationen wecken nicht, sonst weckte jedes eigene Nachlegen den Wecker selbst.
const eigeneHosts = new WeakSet<object>();
export function merkeEigenenHost(host: object): void {
  eigeneHosts.add(host);
}
export function istEigenerHost(n: object | null | undefined): boolean {
  return !!n && eigeneHosts.has(n);
}

// Das Noetige eines MutationRecord (in den Einheitstests als schlichtes Objekt).
export interface MutationSatz {
  type: string;
  target: object;
  attributeName?: string | null;
  addedNodes?: ArrayLike<object>;
  removedNodes?: ArrayLike<object>;
}

// Zaehlt eine Mutation als Anlass? Nicht: Ziel ist ein eigener Host, eigene Markierungen (data-veil..., aendern kein Layout), ein childList-Satz,
// der nur eigene Hosts einfuegt oder entfernt.
export function zaehltMutation(r: MutationSatz, eigen: (n: object) => boolean = istEigenerHost): boolean {
  if (eigen(r.target)) return false;
  if (r.type === 'attributes') return !(r.attributeName ?? '').startsWith('data-veil');
  if (r.type === 'childList') {
    const neu = r.addedNodes ?? [];
    const weg = r.removedNodes ?? [];
    if (neu.length + weg.length === 0) return false;
    for (let i = 0; i < neu.length; i++) if (!eigen(neu[i]!)) return true;
    for (let i = 0; i < weg.length; i++) if (!eigen(weg[i]!)) return true;
    return false;
  }
  return true;
}

export interface WeckerUmgebung {
  jetzt(): number;
  bild(fn: () => void): number;
  bildAb(h: number): void;
  verborgen(): boolean;
  animationLaeuft(): boolean;
  // Mutationen unter `wurzel` (null: das Dokument) beobachten; gibt die Loesung zurueck.
  beobachte(wurzel: object | null, fn: (saetze: readonly MutationSatz[]) => void): () => void;
  // Weck-Ereignisse horchen (null: Dokument und Fenster, sonst die Schattenwurzel); gibt die Loesung zurueck.
  horche(wurzel: object | null, fn: () => void): () => void;
  // Testhaken: Zustand wach oder schlafend (nur bei Wechsel).
  zustand?(wach: boolean): void;
}

export interface Abonnent {
  // false: Erweiterungs-Kontext tot oder Abonnent beendet; dann faellt er heraus.
  lebt(): boolean;
  // Je Bild, solange wach (im rAF): sich einen Rueckruf nach dem Layout holen (ResizeObserver) oder direkt legen.
  jeBild(): void;
}

interface Wurzel {
  zahl: number;
  loesen: () => void;
}

export class Lagewecker {
  private readonly abos = new Map<Abonnent, readonly object[]>();
  private readonly wurzeln = new Map<object, Wurzel>();
  private loeser: Array<() => void> = [];
  private bis = Number.NEGATIVE_INFINITY;
  private handle: number | null = null;
  private wachJetzt = false;
  // Testhaken und Einheitstests: Anzahl der Anlaesse und der Bilder, in denen die Abonnenten gerufen wurden.
  anlaesse = 0;
  bilder = 0;

  private readonly u: WeckerUmgebung;

  constructor(u: WeckerUmgebung) {
    this.u = u;
  }

  get wach(): boolean {
    return this.wachJetzt;
  }

  get abonnenten(): number {
    return this.abos.size;
  }

  // Meldet einen Abonnenten an. `wurzeln`: Schattenwurzeln, in denen sein Video liegt (werden mitbeobachtet, gezaehlt). Gibt die Abmeldung zurueck.
  melde(a: Abonnent, wurzeln: readonly object[] = []): () => void {
    if (this.abos.has(a)) return () => this.meldeAb(a);
    if (!this.abos.size) this.starte();
    this.abos.set(a, wurzeln);
    for (const w of wurzeln) {
      const da = this.wurzeln.get(w);
      if (da) da.zahl++;
      else {
        const l1 = this.u.beobachte(w, this.beiMutation);
        const l2 = this.u.horche(w, this.anlass);
        this.wurzeln.set(w, { zahl: 1, loesen: () => (l1(), l2()) });
      }
    }
    return () => this.meldeAb(a);
  }

  private meldeAb(a: Abonnent): void {
    const wurzeln = this.abos.get(a);
    if (!wurzeln) return;
    this.abos.delete(a);
    for (const w of wurzeln) {
      const da = this.wurzeln.get(w);
      if (!da) continue;
      if (--da.zahl <= 0) {
        this.wurzeln.delete(w);
        try {
          da.loesen();
        } catch {
          // egal
        }
      }
    }
    if (!this.abos.size) this.loeseAlles();
  }

  private starte(): void {
    this.loeser = [this.u.beobachte(null, this.beiMutation), this.u.horche(null, this.anlass)];
  }

  private loeseAlles(): void {
    for (const l of this.loeser) {
      try {
        l();
      } catch {
        // egal
      }
    }
    this.loeser = [];
    for (const w of this.wurzeln.values()) {
      try {
        w.loesen();
      } catch {
        // egal
      }
    }
    this.wurzeln.clear();
    this.abos.clear();
    this.schlafe();
  }

  // Tote Abonnenten fallen heraus; false, wenn keiner mehr da ist (dann ist alles geloest).
  private pruefeLeben(): boolean {
    for (const a of [...this.abos.keys()]) {
      let lebt = false;
      try {
        lebt = a.lebt();
      } catch {
        lebt = false;
      }
      if (!lebt) this.meldeAb(a);
    }
    return this.abos.size > 0;
  }

  // Mutation: nur Zeitstempel und rAF, keine Messung (kein erzwungenes Layout je Mutation).
  private readonly beiMutation = (saetze: readonly MutationSatz[]): void => {
    for (const r of saetze) {
      if (zaehltMutation(r)) {
        this.anlass();
        return;
      }
    }
  };

  // Ein Anlass: WACH_MS ab jetzt wach, rAF anfordern.
  readonly anlass = (): void => {
    if (!this.abos.size) return;
    if (this.u.verborgen()) return;
    this.anlaesse++;
    this.bis = this.u.jetzt() + WACH_MS;
    if (!this.wachJetzt) {
      this.wachJetzt = true;
      this.u.zustand?.(true);
    }
    this.fordereBild();
  };

  private fordereBild(): void {
    if (this.handle === null) this.handle = this.u.bild(this.jeBild);
  }

  private readonly jeBild = (): void => {
    this.handle = null;
    if (!this.wachJetzt) return;
    if (!this.pruefeLeben()) return;
    if (this.u.verborgen()) return this.schlafe();
    const t = this.u.jetzt();
    if (t >= this.bis) {
      // Ende des Fensters: laeuft noch eine Animation, weitere WACH_MS wach, sonst schlafen.
      let laeuft = false;
      try {
        laeuft = this.u.animationLaeuft();
      } catch {
        laeuft = false;
      }
      if (!laeuft) return this.schlafe();
      this.bis = t + WACH_MS;
    }
    this.bilder++;
    for (const a of [...this.abos.keys()]) {
      try {
        a.jeBild();
      } catch {
        // ein Abonnent stoert die anderen nicht
      }
    }
    this.fordereBild();
  };

  private schlafe(): void {
    if (this.handle !== null) {
      try {
        this.u.bildAb(this.handle);
      } catch {
        // egal
      }
    }
    this.handle = null;
    this.bis = Number.NEGATIVE_INFINITY;
    if (this.wachJetzt) {
      this.wachJetzt = false;
      this.u.zustand?.(false);
    }
  }
}
