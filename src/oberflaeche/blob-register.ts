// Merkt sich offene Blob-Adressen (`URL.createObjectURL`) und gibt sie frei: einzeln beim Ersetzen, alle beim Verlassen der Seite (pagehide).
// Reine Logik ohne Abhaengigkeiten, damit sie ohne Browser getestet werden kann.
export interface BlobRegister {
  /** Merkt eine Adresse als offen. */
  merke(adresse: string): void;
  /** Gibt eine Adresse frei (nur wenn offen); liefert, ob sie offen war. */
  gibFrei(adresse: string): boolean;
  /** Gibt alle offenen Adressen frei. */
  gibAlleFrei(): void;
  offen(): number;
}

export function neuesBlobRegister(widerrufe: (adresse: string) => void): BlobRegister {
  const offen = new Set<string>();
  return {
    merke: (a) => void offen.add(a),
    gibFrei: (a) => {
      if (!offen.delete(a)) return false;
      widerrufe(a);
      return true;
    },
    gibAlleFrei: () => {
      for (const a of [...offen]) {
        offen.delete(a);
        widerrufe(a);
      }
    },
    offen: () => offen.size,
  };
}
