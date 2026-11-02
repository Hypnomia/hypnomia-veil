import { defineConfig } from '@playwright/test';

// Ungewoehnlicher Port, damit kein fremder Server auf dem Standardport getroffen wird.
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47173);

export default defineConfig({
  testDir: './tests/chromium',
  timeout: 60_000,
  reporter: 'list',
  workers: 1,
  webServer: {
    command: 'node tests/fixtures-server.mjs',
    url: `http://127.0.0.1:${port}/hello.html`,
    // Nie einen bereits laufenden Server wiederverwenden: der Test startet seinen eigenen.
    reuseExistingServer: false,
    env: { VEIL_FIXTURE_PORT: String(port) },
  },
});
