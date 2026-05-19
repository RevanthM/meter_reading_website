# Capturing screenshots for the user manual

Images live in `docs/user-manual/images/` and are referenced from `docs/USER_MANUAL.md`.

## Automated capture

```bash
npm run dev:all          # terminal 1 — API :3001, Vite :5173
npm run manual:screenshots
```

The script uses a **mock Anica session** in the browser so you do not need to log in manually. For a real login session instead:

```bash
npx playwright codegen http://localhost:5173/login \
  --save-storage=docs/user-manual/.auth-state.json
# Sign in, close browser, then:
AUTH_STATE=docs/user-manual/.auth-state.json npm run manual:screenshots
```

Add `docs/user-manual/.auth-state.json` to `.gitignore` (already listed).

## Manual capture

Use **1280×900** (or wider). Save PNGs using filenames in Appendix B of the user manual.

## Build PDF

From `meter_reading_website/`:

```bash
npm run manual:pdf
```

Outputs:

- `docs/AMR_Portal_User_Manual.pdf` — A4, margins, cover page, clickable table of contents, PDF bookmarks
- `docs/AMR_Portal_User_Manual.html` — same content for browser preview
