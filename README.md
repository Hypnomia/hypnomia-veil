# HYPNOMIA VEIL

Mia takes over your browser. A veil over every image and video, a censor over the parts she decides you do not get to see, and, with the Mia Pack, her face where the porn used to be.

Kink tool for adults (18+). Not a parental control. Over-censoring is part of the fun.

## What this repository is

The free demo of HYPNOMIA VEIL: veil plus zone censoring with blur or pixel. The paid **Mia Pack** (Patreon / SubscribeStar) unlocks the full version: hot images, Mia patch style, porn replacement, quiz gates, ad takeover, control features and sound. The Pack is one file you import in the menu. No account, no key, no server.

- Code: AGPL-3.0, see `LICENSE`
- Mia images, texts, brand: proprietary, see `LIZENZ-MIA-INHALTE.md`
- Links: https://lnk.bio/Hypnomia

## Status

Phase 0 (setup). Nothing to install yet. Follow Patreon for the first release.

## Platforms (planned)

Chrome Desktop, Edge Desktop, Firefox Desktop, Firefox Android (beta). No Safari.

## Privacy

No connection to any Mia server, no analytics. The extension reloads images of the page you are on (needed for detection) and checks GitHub or Mozilla for a new version. Nothing else leaves your browser.

## Development

German documentation and comments; English interface. See `CLAUDE.md` for the working rules.

Prerequisites for `npm test`:

- Node 22 or newer.
- Firefox installed. The test looks for it in the default macOS location; set `VEIL_FIREFOX_BIN` to the Firefox binary to use another one.
- `geckodriver` in your `PATH`. If it is missing, Selenium Manager downloads it on the first run (needs network access).
- Chromium for Playwright: `npm install` fetches it through the `postinstall` step (`npm run test:setup`).

Commands: `npm test` builds both browsers and runs the Chromium and the Firefox test. Both must be green.
