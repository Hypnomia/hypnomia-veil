export const SCHLUESSEL_DATEI: string;
export function leseSchluessel(datei?: string): { issuer: string; secret: string };
export function schwaerze(text: string, werte: string[]): string;
export function signierArgumente(o: { quellordner: string; ausgabeordner: string; kanal?: string; quellzip?: string | null }): string[];
export function signiere(o: { quellordner: string; ausgabeordner: string; kanal?: string; quellzip?: string | null; webExt?: string; schluesselDatei?: string }): Promise<number>;
export function zeilenSchwaerzer(ziel: { write(t: string): unknown }, werte: string[]): { schreibe(d: string | Uint8Array): void; ende(): void };
export function signierUmgebung(basis: Record<string, string | undefined>, issuer: string, secret: string): Record<string, string | undefined>;
