// Allgemeiner Rueckfall fuer Listenseiten ohne eigenen Adapter und fuer eigene Seiten des Nutzers: jedes Bild in einem Link zaehlt als
// Vorschaubild (die Groessengrenze von 80 px und der Ausschluss von Links auf die Startseite halten Logos und Symbole heraus).
import type { Adapter } from './typen';

export const allgemein: Adapter = {
  name: 'allgemein',
  vorschauLinks: ['a[href]'],
  vorschauBilder: [],
  hoverVideos: ['a[href] video'],
};
