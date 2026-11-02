// Typen fuer scripts/ausnahmen-muster.mjs (reines JavaScript, von wxt.config.ts, Tests und Erweiterungscode genutzt).
export interface ZerlegtesMuster { host: string; pfad: string }
export function zerlegeMuster(muster: unknown): ZerlegtesMuster | null;
export function musterAusListe(liste: unknown): string[];
export function manifestMuster(muster: string[]): string[];
export function passtAusnahme(adresse: { hostname?: string; pathname?: string } | null | undefined, muster: string[] | null | undefined): boolean;
