// Mias Saetze im Riegel: Auswahl aus der Pack-Gruppe, eingebauter Entwurfstext als Rueckfall (Texter liest gegen).
import { fuelleSatz, type SatzGruppe, type Texte } from './vertrag.ts';

export const RUECKFALL: Partial<Record<SatzGruppe, string[]>> = {
  start: ['Quiz time, pet. Answer me properly.'],
  richtig: ['Good. Don’t let it go to your head.'],
  falsch: ['Wrong. Try again, I’ve got plenty more.'],
  verweigert: ['Right answer. I’m saying no anyway. Next one.'],
};

export class SatzWahl {
  private texte: Texte | null;
  private zufall: () => number;
  private letzte: Partial<Record<SatzGruppe, number>> = {};
  constructor(texte: Texte | null, zufall: () => number) {
    this.texte = texte;
    this.zufall = zufall;
  }
  // Ein Satz der Gruppe, nicht zweimal derselbe in Folge. Leer, wenn es keine Gruppe gibt.
  hole(gruppe: SatzGruppe, werte: { title?: string; seconds?: number } = {}): string {
    const liste = this.texte?.gruppen[gruppe] ?? RUECKFALL[gruppe] ?? [];
    if (liste.length === 0) return '';
    let i = Math.min(liste.length - 1, Math.floor(this.zufall() * liste.length));
    if (liste.length > 1 && i === this.letzte[gruppe]) i = (i + 1) % liste.length;
    this.letzte[gruppe] = i;
    return fuelleSatz(liste[i]!, werte);
  }
}
