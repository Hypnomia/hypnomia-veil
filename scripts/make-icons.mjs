// Erzeugt die Platzhalter-Icons (pastellrosa Flaeche, weisser Ring) ohne Fremdbilder oder Abhaengigkeiten.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ziel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(ziel, { recursive: true });

const crcTabelle = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTabelle[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(typ, daten) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const k = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(k));
  return Buffer.concat([laenge, k, crc]);
}
function png(groesse) {
  const zeilen = [];
  const mitte = (groesse - 1) / 2;
  for (let y = 0; y < groesse; y++) {
    const zeile = Buffer.alloc(1 + groesse * 4);
    for (let x = 0; x < groesse; x++) {
      const d = Math.hypot(x - mitte, y - mitte) / (groesse / 2);
      const ring = d > 0.32 && d < 0.6;
      const rgb = ring ? [255, 255, 255] : [247, 168, 200];
      zeile.set([...rgb, 255], 1 + x * 4);
    }
    zeilen.push(zeile);
  }
  const kopf = Buffer.alloc(13);
  kopf.writeUInt32BE(groesse, 0);
  kopf.writeUInt32BE(groesse, 4);
  kopf.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', kopf),
    chunk('IDAT', deflateSync(Buffer.concat(zeilen))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
for (const g of [16, 32, 48, 128]) writeFileSync(path.join(ziel, `${g}.png`), png(g));
console.log('Icons geschrieben:', [16, 32, 48, 128].join(', '));
