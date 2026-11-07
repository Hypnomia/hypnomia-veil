export const KANAELE: string[];
export const STANDARD_KANAL: string;
export const UPDATE_URL: string;
export function kanalAusUmgebung(umgebung: Record<string, string | undefined>): string;
export function geckoEinstellungen(kanal: string): {
  gecko: Record<string, unknown>;
  gecko_android: Record<string, unknown>;
};
export function baudatumAusUmgebung(umgebung: Record<string, string | undefined>, jetzt?: Date): string;
