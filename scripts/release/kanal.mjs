// Reine Eingaben fuer den Release-Bau (Session 14, Auftrag R): Kanal-Schalter fuers Firefox-Manifest und Baudatum.
// wxt.config.ts nutzt die Funktionen, scripts/release/firefox.mjs und die Einheitstests auch. Kein Zugriff auf Dateien oder Netz.

export const KANAELE = ['unlisted', 'amo'];
export const STANDARD_KANAL = 'unlisted';
// Update-Adresse fuer selbst verteilte (unlisted) Pakete. Im AMO-Kanal fehlt sie: der AMO-Linter lehnt sie ab (REGELN-GEPRUEFT O1 h).
export const UPDATE_URL = 'https://raw.githubusercontent.com/Hypnomia/hypnomia-veil/main/updates.json';

// Liest VEIL_KANAL. Nicht gesetzt: unlisted. Gesetzt, aber unbekannt (auch leer): Fehler, der Bau bricht ab.
export function kanalAusUmgebung(umgebung) {
  const wert = umgebung.VEIL_KANAL;
  if (wert === undefined) return STANDARD_KANAL;
  if (!KANAELE.includes(wert)) {
    throw new Error(`VEIL_KANAL="${wert}" ist unbekannt (erlaubt: ${KANAELE.join(', ')})`);
  }
  return wert;
}

// Die beiden Firefox-Bloecke des Manifests (browser_specific_settings). Beide Kanaele sind bis auf update_url gleich.
export function geckoEinstellungen(kanal) {
  if (!KANAELE.includes(kanal)) throw new Error(`Kanal "${kanal}" ist unbekannt (erlaubt: ${KANAELE.join(', ')})`);
  return {
    gecko: {
      id: 'veil@hypnomia',
      strict_min_version: '128.0',
      ...(kanal === 'unlisted' ? { update_url: UPDATE_URL } : {}),
      // Ab Firefox 140 (Android 142) unterstuetzt, bei Firefox 128 nur ignoriert.
      data_collection_permissions: { required: ['none'] },
    },
    gecko_android: { strict_min_version: '128.0' },
  };
}

// Baudatum JJJJ-MM-TT: aus VEIL_BAUDATUM (muss ein echtes Datum sein, sonst Fehler) oder aus der uebergebenen Uhr (Ortszeit wie bisher).
export function baudatumAusUmgebung(umgebung, jetzt = new Date()) {
  const wert = umgebung.VEIL_BAUDATUM;
  if (wert === undefined) {
    return `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}-${String(jetzt.getDate()).padStart(2, '0')}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(wert);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!m || d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw new Error(`VEIL_BAUDATUM="${wert}" ist kein Datum der Form JJJJ-MM-TT`);
  }
  return wert;
}
