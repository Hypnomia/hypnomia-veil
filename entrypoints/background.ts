// Hintergrund: Chrome Service Worker, Firefox Hintergrundskript. Phase 0: nur ein Lebenszeichen.
export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    await browser.storage.local.set({ veilHello: true });
  });
  console.log('HYPNOMIA VEIL background ready');
});
