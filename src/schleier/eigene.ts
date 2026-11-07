// Eigene Shadow Roots der Erweiterung (Session 16, Live-Lauf): Galerie, Werbung, Riegel, Meldungen und alle anderen Hosts von VEIL haengen
// ihre geschlossene Wurzel hier an. Der Beobachter des Schleiers (beobachter.ts) betritt solche Wurzeln nicht: vorher prueft er auch Mias
// eigene Bilder darin wie fremde (sichtbar in der Galerie: Mia-Patches auf Mias Vorschau-Bildern). Die Liste lebt nur in der Welt des
// Content-Scripts; eine Seite kann nichts eintragen.
const eigene = new WeakSet<ShadowRoot>();

export function eigeneWurzel(host: Element, init: ShadowRootInit = { mode: 'closed' }): ShadowRoot {
  const wurzel = host.attachShadow(init);
  eigene.add(wurzel);
  return wurzel;
}

export function istEigeneWurzel(wurzel: ShadowRoot): boolean {
  return eigene.has(wurzel);
}
