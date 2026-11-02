// Platzhalter fuer den Schleier (Phase 2). Phase 0: nur ein Marker am Wurzelelement.
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    document.documentElement.dataset.hypnomiaVeil = 'hello';
  },
});
