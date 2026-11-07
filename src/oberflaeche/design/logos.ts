// Plattform-Logos fuer Mias Werbung (Phase 8b, Wunsch der Inhaberin: Werbung offizieller, mit dem Logo der Plattform).
// Quellen: Patreon, Discord, YouTube, X und itch.io als Pfade aus Simple Icons 16.36.0 (CC0 fuer die Pfaddaten; die Zeichen sind Marken
// der Anbieter und stehen hier nur als Hinweis auf Mias eigene Seite dort, wie es deren Markenrichtlinien fuer Creator vorsehen).
// SubscribeStar: Emblem von subscribestar.adult (logo_emblem_adult), mit OpenCV-Konturen nachgezeichnet (Vektor, kein Rasterbild).
// Darstellung als DOM (createElementNS), nie innerHTML.

export type LogoName = 'patreon' | 'subscribestar' | 'discord' | 'youtube' | 'x' | 'itch';

export interface Logo { titel: string; farbe: string; viewBox: string; grund?: 'kreis'; formen: readonly { fill: string; d: string; regel?: 'evenodd' }[] }

export const LOGOS: Record<LogoName, Logo> = {
  patreon: { titel: "Patreon", farbe: '#ff424d', viewBox: '0 0 24 24', formen: [{ fill: '#ffffff', d: "M22.957 7.21c-.004-3.064-2.391-5.576-5.191-6.482-3.478-1.125-8.064-.962-11.384.604C2.357 3.231 1.093 7.391 1.046 11.54c-.039 3.411.302 12.396 5.369 12.46 3.765.047 4.326-4.804 6.068-7.141 1.24-1.662 2.836-2.132 4.801-2.618 3.376-.836 5.678-3.501 5.673-7.031Z" }] },
  discord: { titel: "Discord", farbe: '#5865f2', viewBox: '0 0 24 24', formen: [{ fill: '#ffffff', d: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" }] },
  youtube: { titel: "YouTube", farbe: '#ff0000', viewBox: '0 0 24 24', formen: [{ fill: '#ffffff', d: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" }] },
  "x": { titel: "X", farbe: '#000000', viewBox: '0 0 24 24', formen: [{ fill: '#ffffff', d: "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" }] },
  itch: { titel: "itch.io", farbe: '#fa5c5c', viewBox: '0 0 24 24', formen: [{ fill: '#ffffff', d: "M3.13 1.338C2.08 1.96.02 4.328 0 4.95v1.03c0 1.303 1.22 2.45 2.325 2.45 1.33 0 2.436-1.102 2.436-2.41 0 1.308 1.07 2.41 2.4 2.41 1.328 0 2.362-1.102 2.362-2.41 0 1.308 1.137 2.41 2.466 2.41h.024c1.33 0 2.466-1.102 2.466-2.41 0 1.308 1.034 2.41 2.363 2.41 1.33 0 2.4-1.102 2.4-2.41 0 1.308 1.106 2.41 2.435 2.41C22.78 8.43 24 7.282 24 5.98V4.95c-.02-.62-2.082-2.99-3.13-3.612-3.253-.114-5.508-.134-8.87-.133-3.362 0-7.945.053-8.87.133zm6.376 6.477a2.74 2.74 0 0 1-.468.602c-.5.49-1.19.795-1.947.795a2.786 2.786 0 0 1-1.95-.795c-.182-.178-.32-.37-.446-.59-.127.222-.303.412-.486.59a2.788 2.788 0 0 1-1.95.795c-.092 0-.187-.025-.264-.052-.107 1.113-.152 2.176-.168 2.95v.005l-.006 1.167c.02 2.334-.23 7.564 1.03 8.85 1.952.454 5.545.662 9.15.663 3.605 0 7.198-.21 9.15-.664 1.26-1.284 1.01-6.514 1.03-8.848l-.006-1.167v-.004c-.016-.775-.06-1.838-.168-2.95-.077.026-.172.052-.263.052a2.788 2.788 0 0 1-1.95-.795c-.184-.178-.36-.368-.486-.59-.127.22-.265.412-.447.59a2.786 2.786 0 0 1-1.95.794c-.76 0-1.446-.303-1.948-.793a2.74 2.74 0 0 1-.468-.602 2.738 2.738 0 0 1-.463.602 2.787 2.787 0 0 1-1.95.794h-.16a2.787 2.787 0 0 1-1.95-.793 2.738 2.738 0 0 1-.464-.602zm-2.004 2.59v.002c.795.002 1.5 0 2.373.953.687-.072 1.406-.108 2.125-.107.72 0 1.438.035 2.125.107.873-.953 1.578-.95 2.372-.953.376 0 1.876 0 2.92 2.934l1.123 4.028c.832 2.995-.266 3.068-1.636 3.07-2.03-.075-3.156-1.55-3.156-3.025-1.124.184-2.436.276-3.748.277-1.312 0-2.624-.093-3.748-.277 0 1.475-1.125 2.95-3.156 3.026-1.37-.004-2.468-.077-1.636-3.072l1.122-4.027c1.045-2.934 2.545-2.934 2.92-2.934zM12 12.714c-.002.002-2.14 1.964-2.523 2.662l1.4-.056v1.22c0 .056.56.033 1.123.007.562.026 1.124.05 1.124-.008v-1.22l1.4.055C14.138 14.677 12 12.713 12 12.713z" }] },
  subscribestar: {
    titel: 'SubscribeStar', farbe: '#00968a', viewBox: '0 0 228 228', grund: 'kreis',
    formen: [
      { fill: '#ffffff', regel: 'evenodd', d: "M60 72 L60 105 L61 106 L61 112 L66 128 L72 137 L82 146 L96 152 L106 154 L124 154 L132 152 L132 131 L129 122 L124 117 L111 116 L105 114 L100 109 L98 105 L96 96 L96 72ZM70 12 L69 13 L70 17 L79 29 L90 40 L109 55 L123 69 L128 77 L138 79 L149 85 L159 95 L167 109 L168 114 L170 114 L171 104 L172 103 L172 80 L170 71 L163 55 L151 39 L137 26 L118 11 L111 3 L88 6Z" },
      { fill: '#ff3f80', regel: 'evenodd', d: "M60 115 L60 119 L58 124 L58 133 L57 134 L59 157 L66 174 L75 187 L91 203 L103 212 L117 225 L129 225 L130 224 L140 223 L160 216 L159 212 L153 204 L137 188 L120 175 L107 162 L102 154 L90 151 L82 147 L71 137 L65 128 L62 117ZM97 78 L97 96 L101 109 L107 114 L124 116 L130 122 L132 126 L133 131 L133 157 L171 157 L170 123 L166 109 L158 95 L149 86 L135 79 L119 76 L108 76 L107 77Z" },
    ],
  },
};

const NS = 'http://www.w3.org/2000/svg';

/**
 * Zeichen der Plattform. `auf: 'farbe'` (Standard): weisses Zeichen auf einer runden Plakette in der Markenfarbe; bei SubscribeStar das
 * Original-Emblem. `auf: 'pur'`: Zeichen in der Markenfarbe (oder `fuellung`) ohne Plakette.
 */
export function logoSvg(name: LogoName, groesse: number, auf: 'farbe' | 'pur' = 'farbe', fuellung?: string): SVGSVGElement {
  const l = LOGOS[name];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(groesse));
  svg.setAttribute('height', String(groesse));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.dataset.logo = name; // Lesung S2/R Nr. 5: der Testhaken liest das gezeichnete Logo
  if (l.grund === 'kreis') {
    svg.setAttribute('viewBox', l.viewBox);
    const k = document.createElementNS(NS, 'circle');
    k.setAttribute('cx', '114');
    k.setAttribute('cy', '114');
    k.setAttribute('r', '112');
    k.setAttribute('fill', l.farbe);
    svg.append(k);
    for (const f of l.formen) svg.append(pfad(f.d, f.fill, f.regel));
    return svg;
  }
  if (auf === 'pur') {
    svg.setAttribute('viewBox', l.viewBox);
    for (const f of l.formen) svg.append(pfad(f.d, fuellung ?? l.farbe, f.regel));
    return svg;
  }
  // Plakette: Kreis in Markenfarbe, Zeichen auf 58 % verkleinert und mittig.
  svg.setAttribute('viewBox', '0 0 24 24');
  const k = document.createElementNS(NS, 'circle');
  k.setAttribute('cx', '12');
  k.setAttribute('cy', '12');
  k.setAttribute('r', '12');
  k.setAttribute('fill', l.farbe);
  svg.append(k);
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', 'translate(5.04 5.04) scale(0.58)');
  for (const f of l.formen) g.append(pfad(f.d, f.fill, f.regel));
  svg.append(g);
  return svg;
}

function pfad(d: string, fill: string, regel?: 'evenodd'): SVGPathElement {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', fill);
  if (regel) p.setAttribute('fill-rule', regel);
  return p;
}
