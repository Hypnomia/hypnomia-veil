// Prueft den Satz der Beispielbilder (Phase 11 Etappe 5, V5) gegen `data/beispiel-treffer.json`. Reine Funktion auf Bytes, damit sie in Node getestet
// werden kann; wxt.config.ts ruft sie beim Bau. Gibt `{ art, bilder }` zurueck: `keine` (kein Bild da, der Bau warnt und kopiert nichts) oder `satz`
// (alle vier da und mit passender SHA-256). Wirft bei einem unvollstaendigen Satz oder einer abweichenden Pruefsumme.
import { createHash } from 'node:crypto';

// `daten`: das Objekt der Datendatei (`bilder: [{ kennung, datei, sha256 }]`); `lese(datei)` liefert die Bytes der Quelldatei oder null, wenn es sie nicht gibt.
export function pruefeBeispielSatz(daten, lese) {
  if (!daten || !Array.isArray(daten.bilder) || daten.bilder.length === 0) throw new Error('Beispielbilder: data/beispiel-treffer.json ist leer oder fehlerhaft');
  const bytes = new Map(daten.bilder.map((b) => [b.kennung, lese(b.datei)]));
  const da = daten.bilder.filter((b) => bytes.get(b.kennung) != null);
  if (da.length === 0) return { art: 'keine', bilder: [] };
  if (da.length !== daten.bilder.length) {
    throw new Error(`Beispielbilder: unvollstaendiger Satz, es fehlt ${daten.bilder.filter((b) => !da.includes(b)).map((b) => b.datei).join(', ')}`);
  }
  for (const b of daten.bilder) {
    const summe = createHash('sha256').update(bytes.get(b.kennung)).digest('hex');
    if (summe !== b.sha256) throw new Error(`Beispielbilder: ${b.datei} passt nicht zu data/beispiel-treffer.json (SHA-256 weicht ab), die Treffer gehoeren zu einem anderen Bild`);
  }
  return { art: 'satz', bilder: daten.bilder.map((b) => ({ kennung: b.kennung, datei: b.datei, bytes: bytes.get(b.kennung) })) };
}
