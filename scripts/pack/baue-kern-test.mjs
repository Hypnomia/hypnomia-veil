// Synthetische Kern-Bilder fuer die Tests (Phase 7, Auftrag I3): schreibt kern-01.webp bis kern-NN.webp (farbige Verlaeufe, 600 x 800, ohne Metadaten)
// in einen Ordner ausserhalb des Repos. `VEIL_KERN=<ordner>` laesst den Bau (wxt.config.ts) sie statt der echten Bilder aus `../02 Assets Mia/kern/` kopieren.
//   node scripts/pack/baue-kern-test.mjs <ordner> [anzahl]
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function baueKernTest(ordner, anzahl = 3) {
  const { default: sharp } = await import('sharp');
  await mkdir(ordner, { recursive: true });
  const b = 600;
  const h = 800;
  for (let i = 1; i <= anzahl; i++) {
    const px = Buffer.alloc(b * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < b; x++) {
        const o = (y * b + x) * 3;
        px[o] = (40 + i * 70 + (x * 120) / b) % 256;
        px[o + 1] = (200 - i * 40 + (y * 90) / h) % 256;
        px[o + 2] = (90 + i * 30) % 256;
      }
    }
    await sharp(px, { raw: { width: b, height: h, channels: 3 } })
      .webp({ quality: 80 })
      .toFile(path.join(ordner, `kern-${String(i).padStart(2, '0')}.webp`));
  }
  return ordner;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ordner = process.argv[2];
  if (!ordner) {
    console.error('Aufruf: node scripts/pack/baue-kern-test.mjs <ordner> [anzahl]');
    process.exit(1);
  }
  await baueKernTest(path.resolve(ordner), Number(process.argv[3] ?? 3));
  console.log(`kern-test: Bilder in ${path.relative(process.cwd(), path.resolve(ordner)) || ordner}`);
}
