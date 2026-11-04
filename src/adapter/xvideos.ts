// XVideos und XNXX haben denselben Aufbau: Links auf /video<ziffern>/... (XNXX /video-<kennung>/...), Vorschau als img im Link.
import type { Adapter } from './typen';

export const xvideos: Adapter = {
  name: 'xvideos',
  vorschauLinks: ['a[href^="/video"]', 'a[href*="/video."]', 'div.thumb-inside a', 'div.thumb a'],
  vorschauBilder: ['div.thumb-inside img', 'div.thumb img'],
  hoverVideos: ['a[href^="/video"] video', 'div.thumb-inside video', 'video.thumb-preview'],
  titel: ['h2.page-title', 'div.thumb-under p a'],
  player: ['#video-player-bg', '#html5video'],
};

export const xnxx: Adapter = { ...xvideos, name: 'xnxx' };
