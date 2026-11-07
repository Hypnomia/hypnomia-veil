// updates.json fuer selbst verteilte Firefox-Pakete (Session 14, Auftrag R): reine Schreibfunktion plus Hilfe fuer die Datei.
// Alte Eintraege bleiben, ein Eintrag mit gleicher Version wird ersetzt. update_hash ist "sha256:" plus Hex der signierten XPI.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export const ADDON_ID = 'veil@hypnomia';

// Liefert eine neue updates.json (Objekt), die Eingabe bleibt unveraendert.
export function traegeUpdateEin(vorhanden, { version, link, hash, id = ADDON_ID }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Version "${version}" ist ungueltig`);
  if (!/^https?:\/\/\S+$/.test(link)) throw new Error(`update_link "${link}" ist keine Adresse`);
  if (!/^sha256:[0-9a-f]{64}$/.test(hash)) throw new Error('update_hash muss "sha256:" plus 64 Hexzeichen sein');
  const neu = structuredClone(vorhanden ?? {});
  neu.addons ??= {};
  neu.addons[id] ??= {};
  const alt = Array.isArray(neu.addons[id].updates) ? neu.addons[id].updates : [];
  const eintrag = { version, update_link: link, update_hash: hash };
  const stelle = alt.findIndex((e) => e.version === version);
  if (stelle >= 0) alt[stelle] = eintrag;
  else alt.push(eintrag);
  neu.addons[id].updates = alt;
  return neu;
}

export function sha256Datei(pfad) {
  return `sha256:${createHash('sha256').update(readFileSync(pfad)).digest('hex')}`;
}

// Liest updates.json, traegt ein und schreibt zurueck (zwei Leerzeichen, Zeilenende am Schluss).
export function schreibeUpdates(dateiPfad, eintrag) {
  const vorhanden = JSON.parse(readFileSync(dateiPfad, 'utf8'));
  const neu = traegeUpdateEin(vorhanden, eintrag);
  writeFileSync(dateiPfad, `${JSON.stringify(neu, null, 2)}\n`);
  return neu;
}
