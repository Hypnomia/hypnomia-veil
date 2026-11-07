// Motive des Gestaltungs-Systems "Sakura Glas" (Phase 8b): Mias Spiral-Augen als Marke und der Funkel-Stern.
// Reines DOM ueber createElementNS (nie innerHTML), funktioniert in Erweiterungsseiten und in geschlossenen Shadow Roots.
// Drehen nur ueber die Klasse `v-dreht` (langsamer Zyklus, aus bei prefers-reduced-motion und im Ruhig-Modus durch den Aufrufer).

const NS = 'http://www.w3.org/2000/svg';

// Zwei Arme einer archimedischen Spirale, um eine halbe Drehung versetzt (wie im Entwurf A).
function arm(versatz: number): string {
  const teile: string[] = [];
  for (let t = 0; t <= 5.2 * Math.PI; t += 0.18) {
    const r = 3 + t * 2.45;
    const x = r * Math.cos(t + versatz);
    const y = r * Math.sin(t + versatz);
    teile.push(`${teile.length ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return teile.join(' ');
}
const ARM_A = arm(0);
const ARM_B = arm(Math.PI);

function el<K extends keyof SVGElementTagNameMap>(name: K, attr: Record<string, string>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attr)) e.setAttribute(k, v);
  return e;
}

/** Ein Spiral-Auge (Kreis, zwei Arme rosa und lavendel, Pupille, Lichtpunkt). */
export function spiralAuge(groesse: number, dreht = false): SVGSVGElement {
  const svg = el('svg', { viewBox: '-50 -50 100 100', width: String(groesse), height: String(groesse), 'aria-hidden': 'true', focusable: 'false' });
  svg.classList.add('v-auge');
  const g = el('g', {});
  if (dreht) g.classList.add('v-dreht');
  g.append(
    el('circle', { r: '48', fill: '#ffffff' }),
    el('circle', { r: '46.5', fill: 'none', stroke: '#ffb3d3', 'stroke-width': '3' }),
    el('path', { d: ARM_A, fill: 'none', stroke: '#e2559a', 'stroke-width': '6', 'stroke-linecap': 'round' }),
    el('path', { d: ARM_B, fill: 'none', stroke: '#8f6be8', 'stroke-width': '6', 'stroke-linecap': 'round' }),
    el('circle', { r: '4', fill: '#43283c' }),
  );
  svg.append(g, el('circle', { cx: '-14', cy: '-20', r: '7', fill: '#ffffff', opacity: '0.85' }));
  return svg;
}

/** Augenpaar als Markenzeichen (zwei Spiral-Augen nebeneinander). */
export function augenpaar(groesse: number, dreht = false): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'v-augenpaar';
  s.setAttribute('aria-hidden', 'true');
  s.append(spiralAuge(groesse, dreht), spiralAuge(groesse, dreht));
  return s;
}

/** Vierzackiger Funkel-Stern; Farbe ueber `currentColor`, Animation ueber die Klasse `v-funkel` des Aufrufers. */
export function funkelStern(groesse: number): SVGSVGElement {
  const svg = el('svg', { viewBox: '0 0 24 24', width: String(groesse), height: String(groesse), 'aria-hidden': 'true', focusable: 'false' });
  svg.classList.add('v-funkel');
  svg.append(el('path', { d: 'M12 0c.9 6.2 5.8 11.1 12 12-6.2.9-11.1 5.8-12 12-.9-6.2-5.8-11.1-12-12C6.2 11.1 11.1 6.2 12 0z', fill: 'currentColor' }));
  return svg;
}
