// Einfacher stabiler Hash (FNV-1a) fuer die Wahl eines Pack-Bildes je Schluessel. Eigene Datei ohne Abhaengigkeiten, damit reine Logik
// (src/pack/wahl.ts) in Node getestet werden kann; src/pack/patches.ts gibt ihn weiter unter dem alten Namen heraus.
export function hashe(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
