// Wartet auf ein Versprechen, aber hoechstens `grenzeMs`: danach gilt der Rueckfall. Fehler des Versprechens zaehlen wie der Rueckfall.
// Reine Logik ohne Abhaengigkeiten (ohne Browser testbar). Der Zeitgeber wird immer aufgeraeumt.
export function mitZeitgrenze<T>(versprechen: Promise<T>, grenzeMs: number, rueckfall: T): Promise<T> {
  return new Promise<T>((fertig) => {
    const zeitgeber = setTimeout(() => fertig(rueckfall), Math.max(0, grenzeMs));
    versprechen.then(
      (w) => {
        clearTimeout(zeitgeber);
        fertig(w);
      },
      () => {
        clearTimeout(zeitgeber);
        fertig(rueckfall);
      },
    );
  });
}
