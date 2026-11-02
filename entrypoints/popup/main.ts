// Popup Phase 0: zeigt nur die Version aus dem Manifest.
const feld = document.getElementById('version');
if (feld) {
  feld.textContent = `v${browser.runtime.getManifest().version}`;
}
