// Testhaken der Live-Vorschau (nur im Testbau, WXT_TESTHAKEN=1; im Release-Bau fallen sie beim Bauen weg, die Spurensuche kennt `data-veil-vorschau`).
//   data-veil-vorschau          am Platz der Vorschau: JSON mit dem Stand (angefordert, gezeigt, Zahl der gezeigten Bilder, Bild, Stil)
//   data-veil-vorschau-kennung  am Wurzelelement: die Kennung, aus der Wort, Gesicht und Sticker gewaehlt werden (V2: die Kennung, die die echte Zensur aus
//                               der Bildadresse nimmt, damit der Test dieselbe Wahl trifft); jede Aenderung zeichnet neu
//   data-veil-vorschau-bremse   am Wurzelelement: `<stil>:<ms>`, die Zeichnung fuer diesen Stil wartet so lange (V8: ein aelteres Ergebnis kommt spaeter an)
export const TESTHAKEN: boolean = import.meta.env.WXT_TESTHAKEN === '1';
export const ATTR_VORSCHAU = TESTHAKEN ? 'data-veil-vorschau' : '';
export const ATTR_VORSCHAU_KENNUNG = TESTHAKEN ? 'data-veil-vorschau-kennung' : '';
export const ATTR_VORSCHAU_BREMSE = TESTHAKEN ? 'data-veil-vorschau-bremse' : '';
