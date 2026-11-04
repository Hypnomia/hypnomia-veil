// xHamster: Karten mit Links auf /videos/..., Vorschau als img im Link, Hover-Vorschau als video im Link.
import type { Adapter } from './typen';

export const xhamster: Adapter = {
  name: 'xhamster',
  vorschauLinks: ['a[href*="/videos/"]', 'a.video-thumb__image-container', 'a.video-thumb-info__name'],
  vorschauBilder: ['img.thumb-image-container__image', 'img.video-thumb__image'],
  hoverVideos: ['a[href*="/videos/"] video', 'video.thumb-image-container__video'],
  titel: ['h1', 'a.video-thumb-info__name'],
  player: ['#player-container', '.xp-preload-image'],
};
