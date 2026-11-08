// Anzeigen auf Erwachsenenseiten erkennen (Entscheidung 193, Live-Lauf 18 B): sie werden wie Vorschaubilder ganz gegen Mia-Bilder getauscht
// bzw. als Video nie gezeigt, statt nur zonenweise zensiert. Merkmale aus der Werbe-Erkennung (data/werbung.json): Werbe-Klassen, -ids und
// -Attribute, ein Link zu einem Werbe-Host, die Aufschrift "Ad", "Anzeige" usw. in der Kachel; dazu Native-Ad-Kaesten, wie Erwachsenenseiten
// sie bauen (xvideos: `msg-native-widget-it`). Gesucht wird am Element und hoechstens ANZEIGE_TIEFE Vorfahren darueber (ueber Shadow-Grenzen).
// Ein Fehlgriff deckt ein harmloses Bild ganz ab (sichere Richtung).
import { hatKennung, istKennzeichnung, istWerbeAdresse } from '../werbung/logik';

export const ANZEIGE_TIEFE = 5;
const AUFSCHRIFT_TIEFE = 3; // die Aufschrift steht in der Kachel, nicht weit oben (sonst zaehlte ein Menuepunkt "Ads" fuer die ganze Seite)
const KINDER_MAX = 12;
const NATIVE = /(^|[-_])native[-_]?(widget|ad|ads|banner|block|unit)([-_]|$)/;

function elternUeberSchatten(n: Element): Element | null {
  if (n.parentElement) return n.parentElement;
  const w = n.getRootNode();
  return w instanceof ShadowRoot ? w.host : null;
}

// Kurze Aufschrift als Textknoten oder als Blatt-Element unter den direkten Kindern.
function hatAufschrift(e: Element): boolean {
  let i = 0;
  for (const k of e.childNodes) {
    if (++i > KINDER_MAX) break;
    if (k.nodeType === 3 && istKennzeichnung((k as Text).data)) return true;
    if (k.nodeType === 1) {
      const c = k as Element;
      const t = c.firstChild;
      if (c.childElementCount === 0 && t && t.nodeType === 3 && c.childNodes.length === 1 && istKennzeichnung((t as Text).data)) return true;
    }
  }
  return false;
}

// Liegt das Element in einem Link auf einen anderen Host (Anzeigen fuehren nach draussen)?
function linktNachDraussen(el: Element, basis?: string): boolean {
  let n: Element | null = el;
  for (let tiefe = 0; n && tiefe <= ANZEIGE_TIEFE; tiefe++, n = elternUeberSchatten(n)) {
    if (n.tagName !== 'A') continue;
    try {
      const u = new URL(n.getAttribute('href') ?? '', basis);
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== new URL(basis ?? location.href).hostname;
    } catch {
      return false;
    }
  }
  return false;
}

export function istAnzeige(el: Element, basis?: string): boolean {
  // Eine Aufschrift ("Ad", "Anzeige") zaehlt nur, wenn das Bild nach draussen verlinkt (Pruefung Runde 8, Nr. 6: sonst traf ein Menuepunkt "Ads"
  // neben dem Logo).
  const draussen = linktNachDraussen(el, basis);
  let n: Element | null = el;
  for (let tiefe = 0; n && tiefe <= ANZEIGE_TIEFE; tiefe++, n = elternUeberSchatten(n)) {
    if (n === document.body || n === document.documentElement) return false;
    if (hatKennung(n.getAttribute('class'), n.getAttribute('id'), (a) => n!.hasAttribute(a))) return true;
    const klassen = (n.getAttribute('class') ?? '').toLowerCase();
    if (klassen && klassen.split(/\s+/).some((t) => NATIVE.test(t))) return true;
    if (n.tagName === 'A' && istWerbeAdresse(n.getAttribute('href'), basis)) return true;
    if (draussen && tiefe > 0 && tiefe <= AUFSCHRIFT_TIEFE && hatAufschrift(n)) return true;
  }
  return false;
}
