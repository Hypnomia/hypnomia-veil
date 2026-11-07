import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';
import { manifestMuster, musterAusListe } from './scripts/ausnahmen-muster.mjs';
import { baudatumAusUmgebung, geckoEinstellungen, kanalAusUmgebung } from './scripts/release/kanal.mjs';
import { pruefeWebpDateien } from './scripts/webp-pruefung.mjs';

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
// `VEIL_CHIBI=<ordner>` waehlt einen anderen Quellordner (wie VEIL_KERN; das Quellcode-Paket fuer Mozilla bringt seine Bilder als extern/chibi mit).
// Nur Dateien mit bekannter Pose (Liste wie CHIBI_POSEN in src/chibi.ts).
const CHIBI_POSEN_BAU = ['schild', 'sprechblase', 'arme', 'nein', 'zwinkern', 'jubeln', 'schmollen', 'spirale', 'thron'];
function demoChibis(): { absoluteSrc: string; relativeDest: string }[] {
  const ordner = process.env.VEIL_CHIBI
    ? `${path.resolve(process.env.VEIL_CHIBI)}/`
    : fileURLToPath(new URL('../02 Assets Mia/chibi/', import.meta.url));
  if (!existsSync(ordner)) {
    // Ein ausdruecklich gesetzter Ordner (VEIL_CHIBI) muss da sein, sonst entstuende still ein Bau ohne Chibis.
    if (process.env.VEIL_CHIBI) throw new Error('Demo-Chibis: VEIL_CHIBI zeigt auf einen Ordner, den es nicht gibt');
    console.warn('Demo-Chibis: Ordner 02 Assets Mia/chibi fehlt, die Erweiterung zeigt Text statt Chibis.');
    return [];
  }
  return readdirSync(ordner)
    .filter((d) => d.endsWith('.webp') && CHIBI_POSEN_BAU.includes(d.slice(0, -5)))
    .sort()
    .map((d) => ({ absoluteSrc: `${ordner}${d}`, relativeDest: `chibi/${d}` }));
}

// Kern-Bilder (Phase 7, Entscheidung 147, src/kern.ts): `../02 Assets Mia/kern/kern-NN.webp` (NN 01 bis 20) kommen beim Bau nach `kern/`,
// nie ins Repo. Fehlt der Ordner, warnt der Bau, die Seiten zeigen dann keinen Rahmen. `VEIL_KERN=<ordner>` waehlt einen anderen Quellordner
// (Tests mit synthetischen Bildern ausserhalb des Repos).
function kernBilder(): { absoluteSrc: string; relativeDest: string }[] {
  const ordner = process.env.VEIL_KERN
    ? `${path.resolve(process.env.VEIL_KERN)}/`
    : fileURLToPath(new URL('../02 Assets Mia/kern/', import.meta.url));
  if (!existsSync(ordner)) {
    console.warn('Kern-Bilder: Ordner 02 Assets Mia/kern fehlt, die Seiten zeigen keine Kern-Bilder.');
    return [];
  }
  const namen = readdirSync(ordner)
    .filter((d) => /^kern-(0[1-9]|1[0-9]|20)\.webp$/.test(d))
    .sort();
  // src/kern.ts sucht der Reihe nach und hoert an der ersten Luecke auf: eine Luecke in der Nummerierung bricht den Bau ab.
  namen.forEach((d, i) => {
    if (d !== `kern-${String(i + 1).padStart(2, '0')}.webp`) throw new Error(`Kern-Bilder: Luecke in der Nummerierung vor ${d} (erwartet kern-01 bis kern-${String(namen.length).padStart(2, '0')})`);
  });
  return namen.map((d) => ({ absoluteSrc: `${ordner}${d}`, relativeDest: `kern/${d}` }));
}

export default defineConfig({
  // VEIL_AUSGABE erlaubt einen zweiten Ausgabeordner (z. B. waehrend eine Messung auf .output laeuft).
  outDir: process.env.VEIL_AUSGABE ?? '.output',
  hooks: {
    'build:publicAssets': (_wxt, dateien) => {
      const kopiert = [...demoChibis(), ...kernBilder()];
      // Regel 1: keine EXIF- oder XMP-Chunks in kopierten Bildern, sonst bricht der Bau ab.
      pruefeWebpDateien(kopiert.map((d) => [d.relativeDest, readFileSync(d.absoluteSrc)] as [string, Uint8Array]));
      dateien.push(...kopiert);
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
    excludeSources: [
      'spike/**',
      'tests/**',
      'test-results/**',
      'scripts/annotate/**',
      'scripts/make-icons.mjs',
      'scripts/messung/**',
      'scripts/claude-hooks/**',
      'scripts/hooks/**',
      'scripts/leak-check.sh',
      'scripts/test-all.mjs',
      'scripts/testhaken-spuren.mjs',
      'scripts/pack/**',
      'scripts/release/firefox.mjs',
      'scripts/release/signieren.mjs',
      'scripts/release/signieren.d.mts',
      'scripts/release/updates.mjs',
      'public/ort/**',
      'playwright.config.ts',
      'CLAUDE.md',
      '*.log',
    ],
  },
  // onnxruntime-web: die Variante ohne eingebettetes WASM nehmen. Die Standardvariante buendelt die 15 MB grosse WASM-Datei
  // ein zweites Mal als Asset ins Paket; so liegt sie nur einmal unter ort/ (scripts/kopiere-laufzeit.mjs), die Adresse setzt der Erkenner.
  vite: () => ({
    // Testhaken-Schalter als Konstante, damit der Testhaken-Code im Release-Bundle sicher wegfaellt (nicht nur zur Laufzeit falsch ist).
    // VEIL_BAUDATUM (Session 11, Auftrag V): Baudatum JJJJ-MM-TT fuer die Versionsanzeige; per Umgebung festlegbar, damit ein Nachbau
    // dieselben Bytes ergibt (Session 14, Auftrag R; ungueltig bricht ab).
    define: {
      'import.meta.env.WXT_TESTHAKEN': JSON.stringify(process.env.WXT_TESTHAKEN ?? ''),
      'import.meta.env.VEIL_BAUDATUM': JSON.stringify(baudatumAusUmgebung(process.env)),
    },
    resolve: {
      alias: [
        {
          find: /^onnxruntime-web\/wasm$/,
          replacement: fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', import.meta.url)),
        },
      ],
    },
  }),
  manifest: ({ browser }) => {
    // Unbekannter Kanal bricht jeden Bau ab, nicht nur den fuer Firefox.
    const kanal = kanalAusUmgebung(process.env);
    return {
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
        // Referer-Sitzungsregeln (Umleitung entfaellt seit Session 8, Entscheidung 107; keine web_accessible_resources). WithHostAccess zeigt in Chrome und Firefox keine eigene
        // Installationswarnung (Firefox: nur `declarativeNetRequest` hat den Text "Block content on any page").
        'declarativeNetRequestWithHostAccess',
        // idle (Phase 5, Auftrag L): Leerlauf der Person fuer die Leerlauf-Spirale, ohne Ereignis-Horcher auf jeder Seite; ohne
        // Installationswarnung in Chrome und Firefox.
        'idle',
      ],
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
      // Firefox: Add-on-ID, Mindestversion, Pflichtangabe zur Datenerhebung, Update-Adresse. Der Kanal (VEIL_KANAL, scripts/release/kanal.mjs)
      // entscheidet ueber update_url: unlisted (Standard) hat sie, amo nicht (AMO-Linter lehnt sie ab). Unbekannter Kanal bricht den Bau ab.
      // update_url gehoert bei Firefox nach gecko (dort und nur dort wird sie gelesen).
      // data_collection_permissions: ab Firefox 140 (Android 142) unterstuetzt, bei Firefox 128 nur ignoriert.
      ...(browser === 'firefox' ? { browser_specific_settings: geckoEinstellungen(kanal) } : {}),
    };
  },
});
