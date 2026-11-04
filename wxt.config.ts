import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';
import { manifestMuster, musterAusListe } from './scripts/ausnahmen-muster.mjs';

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

// Standard-Ausnahmeliste als exclude_matches: auf diesen Seiten laeuft der Schleier gar nicht erst (Entscheidung 10, 55).
// Eigene Ausnahmen des Nutzers prueft das Content-Script zur Laufzeit (scripts/ausnahmen-muster.mjs, passtAusnahme).
// Die Muster kommen ueber den Manifest-Hook unten ins Manifest, damit die Liste nicht im Content-Script-Bundle landet.
function standardAusnahmenManifest(): string[] {
  const liste = JSON.parse(readFileSync(new URL('./data/ausnahmen-standard.json', import.meta.url), 'utf8'));
  return manifestMuster(musterAusListe(liste));
}

// Demo-Chibis (Entscheidung 102, src/chibi.ts): suesse SFW-Chibis aus `../02 Assets Mia/chibi/<pose>.webp` kommen beim Bau nach
// `chibi/` in die Erweiterung, nie ins Repo (CLAUDE.md Regel 3). Fehlt der Ordner, faellt die Oberflaeche auf Text zurueck; der Bau warnt.
// Nur Dateien mit bekannter Pose (Liste wie CHIBI_POSEN in src/chibi.ts).
const CHIBI_POSEN_BAU = ['schild', 'sprechblase', 'arme', 'nein', 'zwinkern', 'jubeln', 'schmollen', 'spirale', 'thron'];
function demoChibis(): { absoluteSrc: string; relativeDest: string }[] {
  const ordner = fileURLToPath(new URL('../02 Assets Mia/chibi/', import.meta.url));
  if (!existsSync(ordner)) {
    console.warn('Demo-Chibis: Ordner 02 Assets Mia/chibi fehlt, die Erweiterung zeigt Text statt Chibis.');
    return [];
  }
  return readdirSync(ordner)
    .filter((d) => d.endsWith('.webp') && CHIBI_POSEN_BAU.includes(d.slice(0, -5)))
    .map((d) => ({ absoluteSrc: `${ordner}${d}`, relativeDest: `chibi/${d}` }));
}

function galerieMatchesChrome(): string[] {
  const liste = JSON.parse(readFileSync(new URL('./data/erwachsenenseiten.json', import.meta.url), 'utf8'));
  const domains: string[] = (liste.seiten ?? []).flatMap((e: { domains?: string[] }) => e.domains ?? []);
  const muster = domains.flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`]);
  if (process.env.WXT_TESTHAKEN === '1') muster.push('*://*.veil-erwachsen.test/*');
  return [...new Set(muster)];
}

export default defineConfig({
  // VEIL_AUSGABE erlaubt einen zweiten Ausgabeordner (z. B. waehrend eine Messung auf .output laeuft).
  outDir: process.env.VEIL_AUSGABE ?? '.output',
  hooks: {
    'build:publicAssets': (_wxt, dateien) => {
      dateien.push(...demoChibis());
    },
    'build:manifestGenerated': (_wxt, manifest) => {
      // Gilt fuer jedes Content-Script (Schleier und Haken fuer Shadow Roots in der Seitenwelt): auf der Ausnahmeliste laeuft keins.
      const skripte = manifest.content_scripts ?? [];
      const finde = (datei: string) => skripte.find((cs) => (cs.js ?? []).includes(datei));
      const schleier = finde('content-scripts/content.js');
      const haken = finde('content-scripts/wurzel-haken.js');
      if (!schleier) throw new Error('Manifest-Hook: Content-Script des Schleiers nicht gefunden');
      if (!haken) throw new Error('Manifest-Hook: Haken fuer Shadow Roots nicht gefunden');
      // Beide muessen auf denselben Seiten und in denselben Frames laufen, sonst fehlte der Haken dort, wo der Schleier arbeitet.
      for (const feld of ['matches', 'all_frames', 'match_about_blank', 'match_origin_as_fallback', 'run_at'] as const) {
        const wert = (cs: object) => JSON.stringify((cs as Record<string, unknown>)[feld]);
        if (wert(schleier) !== wert(haken)) {
          throw new Error(`Manifest-Hook: Schleier und Haken unterscheiden sich in ${feld}`);
        }
      }
      const ausnahmen = standardAusnahmenManifest();
      for (const cs of skripte) cs.exclude_matches = ausnahmen;
    },
  },
  // Manifest V3 auch fuer Firefox (WXT nimmt dort sonst MV2).
  manifestVersion: 3,
  // Quellcode-Zip fuer Mozilla: Spike-, Test- und Werkzeugdateien gehoeren nicht hinein,
  // nur das, was zum Nachbauen der Erweiterung noetig ist.
  zip: {
    excludeSources: ['spike/**', 'tests/**', 'scripts/annotate/**', 'scripts/make-icons.mjs', '*.log'],
  },
  // onnxruntime-web: die Variante ohne eingebettetes WASM nehmen. Die Standardvariante buendelt die 15 MB grosse WASM-Datei
  // ein zweites Mal als Asset ins Paket; so liegt sie nur einmal unter ort/ (scripts/kopiere-laufzeit.mjs), die Adresse setzt der Erkenner.
  vite: () => ({
    // Testhaken-Schalter als Konstante, damit der Testhaken-Code im Release-Bundle sicher wegfaellt (nicht nur zur Laufzeit falsch ist).
    define: { 'import.meta.env.WXT_TESTHAKEN': JSON.stringify(process.env.WXT_TESTHAKEN ?? '') },
    resolve: {
      alias: [
        {
          find: /^onnxruntime-web\/wasm$/,
          replacement: fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', import.meta.url)),
        },
      ],
    },
  }),
  manifest: ({ browser }) => ({
    name: 'HYPNOMIA VEIL',
    version: paket.version,
    description:
      'Mia takes over your browser. A veil over every image, a censor over what she decides you do not get to see.',
    // storage: Einstellungen. offscreen (Chrome): Erkenner als unsichtbare Nebenseite. declarativeNetRequest (Chrome) bzw.
    // webRequest + webRequestBlocking (Firefox): Referer fuer das Nachladen fremder Bilder (Entscheidung 59).
    permissions: [
      'storage',
      // unlimitedStorage: das Mia Pack liegt in IndexedDB und ist groesser als die Grenze von storage.local (Entscheidung 25).
      'unlimitedStorage',
      // declarativeNetRequestWithHostAccess statt declarativeNetRequest: reicht mit <all_urls> und spart eine Installationswarnung.
      ...(browser === 'firefox' ? ['webRequest', 'webRequestBlocking'] : ['offscreen']),
      // Phase 4, Umleitung (Auftrag U): dynamische Regel in beiden Browsern. WithHostAccess zeigt in Chrome und Firefox keine eigene
      // Installationswarnung (Firefox: nur `declarativeNetRequest` hat den Text "Block content on any page").
      'declarativeNetRequestWithHostAccess',
    ],
    // Komplett-Ersatz (Phase 4, Auftrag U), Zwischenstand bis Session 8 (Entscheidung 107: die Galerie kommt dann in die Seite, keine
    // Webseite soll VEIL erkennen koennen). Chrome: nur die Listen-Domains (im Testbau zusaetzlich die Testdomain); Adresszeile und Links in
    // Listen-Seiten gehen, Links von fremden Seiten und eigene Seiten per Link enden in der Fehlerseite. `use_dynamic_url` scheitert mit der
    // DNR-Umleitung (gemessen). Firefox: die Adresse ist je Installation zufaellig, dort darf es `*://*/*` bleiben.
    web_accessible_resources: [{ resources: ['galerie.html'], matches: browser === 'firefox' ? ['*://*/*'] : galerieMatchesChrome() }],
    // Alle Seiten: der Schleier muss auf jeder Seite Bilder und Videos verdecken und fremde Bilder nachladen koennen.
    host_permissions: ['<all_urls>'],
    // onnxruntime-web braucht WebAssembly in Erweiterungsseiten (Entscheidung 58).
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // Pause per Tastenkuerzel (Entscheidung 17, Desktop). Android kennt keine Kuerzel, dort bleibt das Menue.
    commands: {
      'pause-umschalten': {
        suggested_key: { default: 'Alt+Shift+M' },
        description: 'Pause or resume Mia',
      },
    },
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
