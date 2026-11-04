// Pornhub: Vorschaubilder sitzen in Links auf view_video.php (oder /video/...), Hover-Vorschau ist ein video in derselben Karte.
import type { Adapter } from './typen';

export const pornhub: Adapter = {
  name: 'pornhub',
  vorschauLinks: ['a[href*="/view_video.php"]', 'a[href*="viewkey="]', 'a[href^="/video/"]', 'a[href*="/gif/"]'],
  vorschauBilder: ['img.thumb', 'img.js-videoThumb', 'img[data-mediumthumb]', 'img[data-thumb_url]'],
  hoverVideos: ['video.js-videoThumb', 'video.thumbVideo', 'a[href*="/view_video.php"] video', 'a[href*="viewkey="] video'],
  titel: ['span.title a', 'h1.title'],
  player: ['#player', '.mhp1138_videoWrapper'],
};
