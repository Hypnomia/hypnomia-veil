// Prueft kopierte WebP-Dateien (Demo-Chibis, Kern-Bilder) beim Bau auf Metadaten: RIFF-Chunks `EXIF` und `XMP ` duerfen nicht vorkommen
// (CLAUDE.md Regel 1: keine Bild-Metadaten mit Namen oder Geraeten). Reine Funktion auf Bytes, damit sie in Node getestet werden kann.
const VERBOTEN = ['EXIF', 'XMP '];

// Liefert die Namen aller Chunks einer WebP-Datei. Wirft bei einer Datei, die kein sauberes RIFF/WEBP ist.
export function webpChunks(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const text = (von) => String.fromCharCode(b[von], b[von + 1], b[von + 2], b[von + 3]);
  if (b.length < 12 || text(0) !== 'RIFF' || text(8) !== 'WEBP') throw new Error('kein WebP (RIFF/WEBP fehlt)');
  const ansicht = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const namen = [];
  let p = 12;
  while (p + 8 <= b.length) {
    const laenge = ansicht.getUint32(p + 4, true);
    namen.push(text(p));
    p += 8 + laenge + (laenge & 1);
  }
  if (p !== b.length && p < b.length) throw new Error('WebP-Chunks reichen nicht bis zum Dateiende');
  return namen;
}

// Die verbotenen Chunks einer Datei (leer = sauber).
export function findeMetadaten(bytes) {
  return webpChunks(bytes).filter((n) => VERBOTEN.includes(n));
}

// Bricht mit Meldung ab, wenn eine der Dateien (Name -> Bytes) Metadaten traegt oder kein WebP ist.
export function pruefeWebpDateien(dateien) {
  for (const [name, bytes] of dateien) {
    let funde;
    try {
      funde = findeMetadaten(bytes);
    } catch (e) {
      throw new Error(`Bau abgebrochen: ${name} ist nicht lesbar (${e.message})`);
    }
    if (funde.length) throw new Error(`Bau abgebrochen: ${name} enthaelt Metadaten (${funde.map((f) => f.trim()).join(', ')}). Vor dem Kopieren entfernen.`);
  }
}
