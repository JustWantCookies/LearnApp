# LearnApp

A personal, offline-first learning app for iPhone: read open-licensed textbooks, answer questions, and let spaced repetition decide what comes back. A PWA (Progressive Web App) hosted on GitHub Pages, with no backend, no accounts and no analytics.

Book content is **never** in this repository. Packs are built on the desktop, AirDropped to the phone, and stored only in the phone's IndexedDB.

## Layout

```
docs/            GitHub Pages site (the app). Plain ES modules, no build step.
  js/            main, router, db, packs, reader, quiz, scheduler, exportImport, views/
  vendor/        DOMPurify (pinned, hash in vendor/README.md)
  sample/        tiny self-written sample pack (safe to commit)
  tests.html     unit tests, run in the browser
tools/           desktop ingestion (Python): EPUB/HTML → pack JSON, validation
schema/          JSON Schema for packs
.githooks/       pre-commit guard that blocks book content
```

## One-time setup

```bash
git config core.hooksPath .githooks
```

```bash
pip install beautifulsoup4 pillow jsonschema
```

## Run locally

```bash
python3 -m http.server 8765 --directory docs
```

Open http://localhost:8765. Tests run at http://localhost:8765/tests.html, or in Node:

```bash
node docs/tests/node.mjs
```

## Deploy (GitHub Pages)

1. Push `main`.
2. In the repository, open **Settings → Pages → Deploy from a branch → `main` / `/docs`**.
3. The site appears at `https://<user>.github.io/LearnApp/`.
4. On the iPhone, open the site in Safari and use **Share → Add to Home Screen**. Always launch the app from that icon, because the home-screen app gets more durable storage.
5. On every release, bump `CACHE` in `docs/sw.js`. The app then shows an "Update available" banner.

## Content workflow

See [tools/README.md](tools/README.md). In short:

```bash
python3 tools/ingest_epub.py ../../Content/BOOK.epub --book tools/books/osu-ap2e.json --chapter 1 --out ../../Content/packs
```

AirDrop `osu-ap2e-ch1-v1.json` to the phone, then **Library → Import pack**.

## Security model

- **Content never reaches git.** It is caught at three layers: `.gitignore`, the pre-commit hook (blocks `.epub/.pdf/.zip`, generated pack names, files over 1 MB, embedded base64 images), and keeping sources and packs outside the repo (`../../Content`).
- **Pack HTML is untrusted.** Every section passes DOMPurify with the tag allowlist from SPEC §5.1. Images can only come from the pack's own `media/` (stored as blobs). Element ids are prefixed, external links open with `noopener noreferrer`, and in-page links are handled by the reader, not the router.
- **CSP** in `index.html`: `script-src 'self'`, `img-src 'self' blob:`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. With no inline scripts or styles, the app makes no requests anywhere else. `<meta name="referrer" content="no-referrer">` keeps the app's URL out of external-link referrers.
- **Imports are data only.** Packs, grades and backups go through `JSON.parse` plus validation, never `eval` or `innerHTML`. Everything user-visible is set via `textContent`.
- **Ingestion refuses** packs without a license or attribution, and any ND-licensed source. Paths outside the source folder are ignored (no path traversal), and covers and logos are skipped.
- **GitHub account:** use 2FA (passkey or authenticator app), a ruleset on `main` that blocks force-push and deletion, and secret-scanning push protection.

## Deviations from SPEC.md

- **Packs are a single `.json` file** with images embedded as base64 in `media` (no `.zip`, no fflate). This removes the zip-specific risks (path traversal, zip bombs). Images are converted to Blobs on import.
- An extra `seen` store records which sections were opened. New questions only unlock after reading (SPEC §6).
- `explain` items may carry a `reference` answer, and sections may carry a `summary`. Both are optional fields that older app versions ignore.
- The review sheet opens on its own screen with **Copy** and **Save** buttons. It is built before the tap, so iOS allows the clipboard write.
