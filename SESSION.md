# Session Notes — Portfolio Tracker Scaffold

**Date:** 2026-07-11

## What was requested

Scaffold a React + Vite portfolio tracker app backed by Supabase, with Recharts
visualizations, React Router navigation, plain CSS (dark-navy financial theme), account
tabs (All / Robinhood / Traditional IRA / Roth IRA), a trade log with add/edit/filter, a
tax-bracket headroom calculator, a 4-year Roth conversion tracker, a README with setup
instructions and SQL schema, and a GitHub Actions workflow to deploy to GitHub Pages.

## Environment setup

- Node.js was not installed on this machine. Installed **Node.js 24 LTS via winget**
  (`winget install OpenJS.NodeJS.LTS`) with explicit user approval before proceeding.
- Confirmed `node -v` → v24.18.0, `npm -v` → 11.16.0 after install.

## What was built

- Scaffolded via `npm create vite@latest portfolio-tracker -- --template react`, then
  pinned `react`/`react-dom` to `^18.3.1` (the scaffold defaults to React 19; spec called
  for React 18).
- Installed `@supabase/supabase-js`, `recharts`, `react-router-dom`.
- Full structure per spec:
  - `src/lib/supabase.js` — Supabase client init
  - `src/lib/accounts.js` — account slug ↔ label mapping (Robinhood / Traditional IRA / Roth IRA)
  - `src/hooks/useTrades.js` — fetch/add/update/delete trades, optionally filtered by account
  - `src/hooks/usePortfolio.js` — aggregated KPIs, allocation %, and P&L-by-ticker derived from trades
  - `src/components/` — `Layout`, `KPIRow`, `AllocationDonut`, `PnLBarChart`, `HoldingsTable`,
    `TradeForm`, `TaxHeadroom`, `RothProgress` (with scoped CSS for table/form/tax/roth)
  - `src/pages/` — `Dashboard`, `AccountPage`, `TaxPage`, `TradesPage`
  - `src/App.jsx` — `HashRouter` wiring `/`, `/account/:accountSlug`, `/trades`, `/tax`
    (HashRouter chosen so the GitHub Pages deploy works without server-side rewrite rules)
- `src/index.css` — dark-navy design system using the exact CSS variables specified
  (`--navy-dark`, `--navy-mid`, `--navy-light`, `--gold`, `--green`, `--red`, `--blue`,
  `--surface`, `--text-primary`, `--text-muted`).
- `HoldingsTable`: sortable by column, shows account badge only in the All-accounts view,
  colors the wash-sale-risk cell (red = FLAGGED, yellow = Review, green = OK).
- `.env` and `.env.example` created with placeholder values; `.gitignore` updated to
  exclude `.env*` (added immediately, before other work).
- `README.md` rewritten with setup steps and the full Supabase SQL schema for `trades`,
  `tax_settings`, and `roth_conversions` (including indexes and permissive RLS policies
  with a note to tighten them before multi-user use).
- `.github/workflows/deploy.yml` — builds on push to `main` and deploys `dist/` to GitHub
  Pages, injecting `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` from repo secrets.
- `vite.config.js` — set `base: './'` for relative asset paths on GitHub Pages subpaths.

## Bug found and fixed during verification

`@supabase/supabase-js`'s `createClient` throws synchronously if the URL isn't a valid
HTTP(S) URL. With the placeholder `.env` values (`your_project_url`), the app would have
crashed to a blank white screen on first load. Fixed in `src/lib/supabase.js`: it now
detects unconfigured placeholder values, falls back to a syntactically valid dummy URL,
and logs a `console.warn` instead of throwing — so the app renders normally until real
Supabase credentials are added.

## Verification performed

- `npm install` — clean, 0 vulnerabilities.
- `npm run build` — succeeds (`dist/` produced, ~789 kB JS bundle, only an advisory
  chunk-size warning, no errors).
- `npm run dev` — started cleanly on `http://localhost:5173`.
- Every source module and CSS file was fetched through Vite's dev transform endpoint
  (`curl` against `/src/**`) and returned HTTP 200 with no compile errors in the dev
  server log — used as a proxy for "no console errors" since no browser/screenshot tool
  was available in this environment to visually confirm rendering.
- Re-ran `npm run build` after the `lib/supabase.js` fix to confirm it still builds clean.
- Background dev server stopped after verification.

## Known limitations / follow-ups

- No visual browser check was performed (no browser automation tool available in this
  session) — layout/styling has not been eye-verified, only confirmed to compile and
  serve without errors.
- RLS policies in the SQL schema are permissive (`using (true)`) for single-user use;
  tighten before adding auth or sharing the project.
- Main JS bundle is ~789 kB (225 kB gzipped) — Vite flags this as large; not addressed
  since it wasn't part of the request (could code-split Recharts/routes later if needed).
