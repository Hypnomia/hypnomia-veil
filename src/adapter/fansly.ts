// Fansly: wie OnlyFans eine Einzelseiten-App. Als Vorschau gelten nur Beitragsmedien, nie die ganze Feed-Karte (darin stehen Avatare).
import type { Adapter } from './typen';

export const fansly: Adapter = {
  name: 'fansly',
  vorschauLinks: ['[class*="post-media"]', '[class*="media-gallery"]'],
  vorschauBilder: ['[class*="post-media"] img', '[class*="media-gallery"] img'],
  hoverVideos: ['[class*="post-media"] video'],
  titel: ['[class*="post-text"]'],
  player: ['[class*="video-player"]'],
};
