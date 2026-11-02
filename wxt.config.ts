import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

const paket = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Oeffentlicher Chrome-Schluessel (fixiert die Erweiterungs-ID). Fehlt die Datei, bricht der Chrome-Build ab,
// denn ohne key waere die ID nicht stabil. Der Firefox-Build braucht die Datei nicht.
function ladeChromeKey(): string {
  let key = '';
  try {
    key = readFileSync(new URL('./data/chrome-key.pub', import.meta.url), 'utf8').trim();
  } catch {
    // Fehlermeldung unten
  }
  if (!key) {
    throw new Error(
      'data/chrome-key.pub fehlt oder ist leer: der Chrome-Build braucht den oeffentlichen Schluessel ' +
        '(feste Erweiterungs-ID). Datei anlegen oder nur den Firefox-Build ausfuehren (npm run build:firefox).',
    );
  }
  return key;
}

export default defineConfig({
  outDir: '.output',
  // Manifest V3 auch fuer Firefox (WXT nimmt dort sonst MV2).
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'HYPNOMIA VEIL',
    version: paket.version,
    description:
      'Mia takes over your browser. A veil over every image, a censor over what she decides you do not get to see.',
    permissions: ['storage'],
    // Alle Seiten: der Schleier muss ab Phase 2 auf jeder Seite Bilder und Videos verdecken koennen.
    host_permissions: ['<all_urls>'],
    // Chrome: fester key, damit die ID stabil bleibt. Firefox kennt das Feld nicht.
    ...(browser === 'firefox' ? {} : { key: ladeChromeKey() }),
    // Firefox: Add-on-ID, Mindestversion, Pflichtangabe zur Datenerhebung, Update-Adresse.
    // update_url gehoert bei Firefox nach gecko (dort und nur dort wird sie gelesen).
    // data_collection_permissions: ab Firefox 140 (Android 142) unterstuetzt, bei Firefox 128 nur ignoriert.
    // Beim ersten AMO-Upload die Linter-Warnung dazu pruefen.
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'veil@hypnomia',
              strict_min_version: '128.0',
              update_url:
                'https://raw.githubusercontent.com/Hypnomia/hypnomia-veil/main/updates.json',
              data_collection_permissions: { required: ['none'] },
            },
            gecko_android: { strict_min_version: '128.0' },
          },
        }
      : {}),
  }),
});
