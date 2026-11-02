// Adresswechsel der Seite ohne Neuladen erkennen (Einzelseiten-Apps: pushState, replaceState, popstate, hashchange).
// Das Content-Script laeuft in einer isolierten Welt: ein Ueberschreiben von history.pushState in der Seite greift dort nicht.
// Darum zaehlen die Ereignisse, die in der isolierten Welt ankommen: popstate und hashchange, dazu das Navigations-Ereignis
// `currententrychange` der Navigation API (Chrome ab 102, Firefox neuere Versionen), das auch bei pushState und replaceState feuert.
// Wo es keine Navigation API gibt (Firefox 128), fragt ein Takt die Adresse ab (ein Vergleich zweier Zeichenketten, kaum Kosten),
// aber nur bei sichtbarem Tab: im versteckten Tab ruht der Takt, beim Sichtbarwerden wird einmal geprueft.
// Nur die oberste Seite eines Tabs nutzt den Beobachter, und nur, solange es eigene Ausnahmen gibt (siehe schleier.ts).

import { ADRESS_TAKT_MS } from './konstanten';

interface NavigationLike {
  addEventListener(typ: string, rueckruf: () => void): void;
  removeEventListener(typ: string, rueckruf: () => void): void;
}

export class AdressBeobachter {
  private letzte = '';
  private laeuft = false;
  private takt: ReturnType<typeof setInterval> | null = null;
  private navigation: NavigationLike | null = null;

  constructor(
    private readonly lese: () => string,
    private readonly beiWechsel: () => void,
  ) {}

  // Nutzt der Beobachter die Abfrage im Takt (keine Navigation API)? Auch wahr, solange der Tab versteckt ist und der Takt ruht.
  get mitTakt(): boolean {
    return this.laeuft && this.navigation === null;
  }

  // Laeuft gerade ein Takt (Tab sichtbar und keine Navigation API)?
  get taktLaeuft(): boolean {
    return this.takt !== null;
  }

  start(): void {
    if (this.laeuft) return;
    this.laeuft = true;
    this.letzte = this.lese();
    window.addEventListener('popstate', this.pruefe);
    window.addEventListener('hashchange', this.pruefe);
    const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
    if (nav && typeof nav.addEventListener === 'function') {
      this.navigation = nav;
      nav.addEventListener('currententrychange', this.pruefe);
    } else {
      document.addEventListener('visibilitychange', this.beiSichtbarkeit);
      this.planeTakt();
    }
  }

  stopp(): void {
    if (!this.laeuft) return;
    this.laeuft = false;
    window.removeEventListener('popstate', this.pruefe);
    window.removeEventListener('hashchange', this.pruefe);
    document.removeEventListener('visibilitychange', this.beiSichtbarkeit);
    this.navigation?.removeEventListener('currententrychange', this.pruefe);
    this.navigation = null;
    this.stoppeTakt();
  }

  private planeTakt(): void {
    if (this.takt || document.hidden) return;
    this.takt = setInterval(this.pruefe, ADRESS_TAKT_MS);
  }

  private stoppeTakt(): void {
    if (this.takt) clearInterval(this.takt);
    this.takt = null;
  }

  // Versteckter Tab: kein Takt. Sichtbar: einmal pruefen (die Adresse kann sich inzwischen geaendert haben), dann der Takt wieder.
  private readonly beiSichtbarkeit = (): void => {
    if (!this.laeuft) return;
    if (document.hidden) {
      this.stoppeTakt();
      return;
    }
    this.pruefe();
    this.planeTakt();
  };

  private readonly pruefe = (): void => {
    const jetzt = this.lese();
    if (jetzt === this.letzte) return;
    this.letzte = jetzt;
    this.beiWechsel();
  };
}
