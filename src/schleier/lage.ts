// Lage-Hilfen fuer Hosts, die direkt auf der Flaeche eines Videos liegen (Standbild des Players, Zonen-Leinwand). Aus src/player/standbild.ts
// herausgeloest, damit beide dieselbe Rechnung benutzen.

export const Z_DECKEL = 9999; // hoechster z-index eines Hosts: nie ueber Dialoge und Leisten der Seite ausserhalb des Players

export interface MassRechteck {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Legt den Host auf `t` (Rechteck im Fenster, getBoundingClientRect, damit Transform, translate(-50%), Skalierung und fixed stimmen): der
// Bezugspunkt des Hosts wird gemessen, indem er mit bekannter Groesse auf 0/0 liegt. Stimmt die Lage schon, kostet es nur eine Messung.
// `fest`: Host liegt als Geschwister eines festen Videos (position: fixed). Gibt true zurueck, wenn die Lage neu gesetzt wurde.
export function legeAufRechteck(host: HTMLElement, t: MassRechteck, fest: boolean, zwingen = false): boolean {
  const s = host.style;
  const h = host.getBoundingClientRect();
  const nah = (a: number, b: number) => Math.abs(a - b) < 0.5;
  if (!zwingen && nah(t.left, h.left) && nah(t.top, h.top) && nah(t.width, h.width) && nah(t.height, h.height)) return false;
  s.setProperty('position', fest ? 'fixed' : 'absolute', 'important');
  s.setProperty('left', '0', 'important');
  s.setProperty('top', '0', 'important');
  s.setProperty('width', '100px', 'important');
  s.setProperty('height', '100px', 'important');
  const m = host.getBoundingClientRect();
  const sx = m.width > 0 ? m.width / 100 : 1;
  const sy = m.height > 0 ? m.height / 100 : 1;
  s.setProperty('left', `${(t.left - m.left) / sx}px`, 'important');
  s.setProperty('top', `${(t.top - m.top) / sy}px`, 'important');
  s.setProperty('width', `${t.width / sx}px`, 'important');
  s.setProperty('height', `${t.height / sy}px`, 'important');
  return true;
}

// Ist das Video selbst fest positioniert (dann liegt der Host als fixed neben ihm)?
export function istFestPositioniert(v: Element): boolean {
  try {
    return getComputedStyle(v).position === 'fixed';
  } catch {
    return false;
  }
}

function lieseZ(el: Element): number {
  try {
    const n = parseInt(getComputedStyle(el).zIndex, 10);
    return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
}

// z-index eines Hosts, der ein Standbild traegt: um eins ueber dem hoechsten numerischen z-index von Video und (beim Anker) den positionierten
// Nachfahren des Ankers, damit weder ein Video mit eigenem z-index noch eine Poster-Ebene des Players darueber malt. Ein Video ohne z-index ergibt 0.
// `deckt` ist der Anker (oder das Video selbst), `host` wird ausgenommen.
export function zIndexFuerStandbild(v: HTMLVideoElement, deckt: Element, host: Element): number {
  let z = 0;
  const lies = (el: Element): void => {
    const n = lieseZ(el);
    if (n > z) z = n;
  };
  lies(v);
  if (deckt !== v) {
    // Nur Nachfahren, deren Rechteck die Videoflaeche schneidet (Poster-Ebenen, Huellen): Bedienleisten daneben und Teile der Seite zaehlen nicht.
    let vr: DOMRect;
    try {
      vr = v.getBoundingClientRect();
    } catch {
      return Math.min(z + 1, Z_DECKEL);
    }
    let i = 0;
    for (const el of deckt.querySelectorAll('*')) {
      if (el === host || el === v) continue;
      if (++i > 400) break;
      const r = el.getBoundingClientRect();
      if (r.right <= vr.left || r.left >= vr.right || r.bottom <= vr.top || r.top >= vr.bottom) continue;
      lies(el);
    }
    // Auch Vorfahren des Videos bis zum Anker (positionierte Huellen mit z-index).
    for (let p: Element | null = v.parentElement; p && p !== deckt; p = p.parentElement) lies(p);
  }
  return Math.min(z + 1, Z_DECKEL);
}

// z-index des Hosts der Zonen-Leinwand: gleich dem des Videos (kein eigener Wert: "auto"), damit die Bedienleisten der Seite darueber bleiben.
// Hat das Video einen numerischen z-index, bekommt der Host denselben; er steht im DOM direkt dahinter und malt deshalb ueber dem Video.
export function zIndexFuerLeinwand(v: HTMLVideoElement): string {
  const n = lieseZ(v);
  return Number.isFinite(n) ? String(n) : 'auto';
}
