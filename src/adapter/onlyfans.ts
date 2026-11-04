// OnlyFans: Beitraege in einer Einzelseiten-App. Als Vorschau gelten nur Beitragsmedien (Foto- und Videoflaechen der Beitraege), nie die ganze
// Beitragskarte oder allgemeine Links: Avatare und Profilbilder bleiben beim normalen Schleier.
import type { Adapter } from './typen';

export const onlyfans: Adapter = {
  name: 'onlyfans',
  vorschauLinks: ['[class*="b-post__media"]', '[class*="b-photos"]'],
  vorschauBilder: ['[class*="b-post__media"] img', '[class*="b-photos"] img'],
  hoverVideos: ['[class*="b-post__media"] video'],
  titel: ['[class*="b-post__text"]'],
  player: ['[class*="video-wrapper"]'],
};
