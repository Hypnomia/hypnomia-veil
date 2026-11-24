export interface BeispielDaten { bilder: { kennung: string; datei: string; sha256: string }[] }
export function pruefeBeispielSatz(
  daten: BeispielDaten,
  lese: (datei: string) => Uint8Array | null,
): { art: 'keine' | 'satz'; bilder: { kennung: string; datei: string; bytes: Uint8Array }[] };
