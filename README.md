# Portfolio Tracker

A React + Vite portfolio tracker backed by Supabase. Tracks trades across three accounts
(Robinhood, Traditional IRA, Roth IRA), aggregates KPIs and allocation/P&L charts, and
includes tools for tax-bracket headroom and a 4-year Roth conversion plan. Current market
prices refresh automatically once a day via a scheduled GitHub Actions job, or on demand
from the Prices page, both pulling from Twelve Data. Cash deposits (one-time or recurring,
daily through monthly) are tracked per account, with recurring schedules auto-generating
their deposit records on the same schedule/on-demand pattern as prices.

## Stack

- React 18 + Vite
- [@supabase/supabase-js](https://github.com/supabase/supabase-js) for data
- [Recharts](https://recharts.org/) for the allocation donut and P&L bar chart
- React Router (`HashRouter`) for navigation
- Plain CSS (no framework), dark-navy financial theme
- [Twelve Data](https://twelvedata.com/) for daily stock prices, fetched by a scheduled
  GitHub Actions workflow and by a Supabase Edge Function (on-demand refresh)

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create a Supabase project** at [supabase.com](https://supabase.com) and run the SQL
   schema below in the SQL editor (Project → SQL Editor → New query).

3. **Configure environment variables**

   Copy `.env.example` to `.env` and fill in your project's URL and anon key (Project
   Settings → API):

   ```bash
   cp .env.example .env
   ```

   ```
   VITE_SUPABASE_URL=your_project_url
   VITE_SUPABASE_ANON_KEY=your_anon_key
   ```

   `.env` is gitignored — never commit real credentials.

4. **Run the dev server**

   ```bash
   npm run dev
   ```

5. **Build for production**

   ```bash
   npm run build
   npm run preview
   ```

## Supabase SQL schema

Run the following in the Supabase SQL editor. It creates the six tables the app reads
and writes: `trades`, `tax_settings`, `roth_conversions`, `ticker_prices`,
`deposit_schedules`, and `deposits`.

```sql
-- Extension needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────
-- trades: every buy/sell across all accounts
-- ─────────────────────────────────────────────
create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  account text not null check (account in ('Robinhood', 'Traditional IRA', 'Roth IRA')),
  ticker text not null,
  trade_type text not null check (trade_type in ('BUY', 'SELL')),
  quantity numeric not null,
  price numeric not null,
  trade_date date not null,
  fees numeric not null default 0,
  cost_basis numeric not null default 0,
  market_price numeric not null default 0,
  market_value numeric not null default 0,
  realized_pnl numeric not null default 0,
  unrealized_pnl numeric not null default 0,
  wash_sale_risk text not null default 'OK' check (wash_sale_risk in ('OK', 'Review', 'FLAGGED')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists trades_account_idx on trades (account);
create index if not exists trades_ticker_idx on trades (ticker);

-- ─────────────────────────────────────────────
-- tax_settings: one row per tax year, used by
-- the TaxHeadroom calculator
-- ─────────────────────────────────────────────
create table if not exists tax_settings (
  id uuid primary key default gen_random_uuid(),
  year int not null unique,
  filing_status text not null default 'single' check (filing_status in ('single', 'married_joint')),
  magi_ytd numeric not null default 0,
  target_bracket_ceiling numeric not null default 0,
  notes text,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- roth_conversions: logged conversions used by
-- the 4-year RothProgress tracker. goal_amount
-- is the planned conversion amount for that year.
-- ─────────────────────────────────────────────
create table if not exists roth_conversions (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  amount numeric not null default 0,
  goal_amount numeric not null default 0,
  conversion_date date,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists roth_conversions_year_idx on roth_conversions (year);

-- ─────────────────────────────────────────────
-- ticker_prices: latest daily close per ticker,
-- written once a day by scripts/fetch-prices.mjs
-- (see "Daily price refresh" below). usePortfolio
-- overlays these onto open (BUY) trade rows to
-- compute live market value / unrealized P&L.
-- ─────────────────────────────────────────────
create table if not exists ticker_prices (
  ticker text primary key,
  price numeric not null,
  as_of date,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- deposit_schedules: recurring deposit rules
-- (e.g. "$500/month into Roth IRA"). Materialized
-- into `deposits` by scripts/materialize-deposits.mjs
-- (see "Recurring deposits" below).
-- ─────────────────────────────────────────────
create table if not exists deposit_schedules (
  id uuid primary key default gen_random_uuid(),
  account text not null check (account in ('Robinhood', 'Traditional IRA', 'Roth IRA')),
  amount numeric not null,
  frequency text not null check (frequency in ('daily', 'weekly', 'biweekly', 'monthly')),
  start_date date not null,
  end_date date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists deposit_schedules_account_idx on deposit_schedules (account);

-- ─────────────────────────────────────────────
-- deposits: the actual cash-deposit ledger. Rows
-- with a schedule_id were auto-generated from a
-- deposit_schedules row; NULL schedule_id means a
-- manual one-time deposit.
-- ─────────────────────────────────────────────
create table if not exists deposits (
  id uuid primary key default gen_random_uuid(),
  account text not null check (account in ('Robinhood', 'Traditional IRA', 'Roth IRA')),
  amount numeric not null,
  deposit_date date not null,
  schedule_id uuid references deposit_schedules (id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists deposits_account_idx on deposits (account);
create index if not exists deposits_schedule_idx on deposits (schedule_id);

-- NULL schedule_id values are never considered equal to each other by a
-- unique index, so manual (schedule_id = NULL) deposits are unaffected;
-- this only dedupes auto-generated rows sharing the same schedule + date.
create unique index if not exists deposits_schedule_date_uidx on deposits (schedule_id, deposit_date);

-- ─────────────────────────────────────────────
-- Row Level Security
-- This app uses the anon key directly from the browser. For a
-- single-user setup, enable RLS and allow all operations for now;
-- tighten these policies (e.g. scope to auth.uid()) before sharing
-- the project or adding multi-user auth.
-- ─────────────────────────────────────────────
alter table trades enable row level security;
alter table tax_settings enable row level security;
alter table roth_conversions enable row level security;
alter table ticker_prices enable row level security;
alter table deposit_schedules enable row level security;
alter table deposits enable row level security;

create policy "Allow all on trades" on trades for all using (true) with check (true);
create policy "Allow all on tax_settings" on tax_settings for all using (true) with check (true);
create policy "Allow all on roth_conversions" on roth_conversions for all using (true) with check (true);
create policy "Allow all on ticker_prices" on ticker_prices for all using (true) with check (true);
create policy "Allow all on deposit_schedules" on deposit_schedules for all using (true) with check (true);
create policy "Allow all on deposits" on deposits for all using (true) with check (true);
```

## Daily price refresh

`scripts/fetch-prices.mjs` is a small Node script that:

1. Reads the distinct set of tickers currently in `trades`
2. Fetches their latest price from [Twelve Data](https://twelvedata.com/) (free tier: 800
   calls/day)
3. Upserts them into `ticker_prices`

`.github/workflows/refresh-prices.yml` runs it automatically on weekdays at 21:00 UTC
(shortly after the US market close), and can also be triggered manually from the Actions
tab (`workflow_dispatch`). `usePortfolio` overlays the latest price onto each open (`BUY`)
trade row to compute live `market_value` and `unrealized_pnl` — the underlying `trades`
rows in Supabase are never modified by the job, only `ticker_prices` is.

The **Prices** page (`/prices`) lets you override any ticker's price by hand — useful
right after adding a trade (before the next scheduled run) or for a ticker Twelve Data
doesn't cover. It writes to the same `ticker_prices` table via `useTickerPrices`'s
`updatePrice`, so manual and automatic updates are interchangeable; whichever ran most
recently wins.

To run it locally:

```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_ANON_KEY=your_anon_key \
TWELVE_DATA_API_KEY=your_twelve_data_key \
npm run prices:fetch
```

For the scheduled workflow to run, add `TWELVE_DATA_API_KEY` as a repository secret
(Settings → Secrets and variables → Actions) — it reuses the existing
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` secrets for the Supabase connection. Get a
free API key at [twelvedata.com](https://twelvedata.com/). Never prefix it `VITE_` — that
would bundle it into the client-side JS and expose it publicly.

## On-demand price refresh (Edge Function)

The **Update All Prices** button on the Prices page can't safely call Twelve Data
directly from the browser (same reason as above — the key would leak), and it can't
safely trigger the GitHub Actions workflow either (that would require embedding a GitHub
token client-side, which is worse). Instead it calls a Supabase Edge Function,
`supabase/functions/refresh-prices`, which holds `TWELVE_DATA_API_KEY` as a Supabase
secret and runs the same fetch/upsert logic as `scripts/fetch-prices.mjs`, server-side.

To deploy it (requires the [Supabase CLI](https://supabase.com/docs/guides/cli), run here
via `npx supabase`):

```bash
# One-time: authenticate the CLI and link this repo to your Supabase project.
# `supabase login` opens a browser; in a non-interactive environment, generate a
# personal access token instead at https://supabase.com/dashboard/account/tokens
# and set SUPABASE_ACCESS_TOKEN=<token> before running these commands.
npx supabase login
npx supabase link --project-ref your-project-ref

# Give the function its own copy of the Twelve Data key (separate from the
# GitHub Actions secret — this one lives in Supabase, not GitHub).
npx supabase secrets set TWELVE_DATA_API_KEY=your_twelve_data_key

# Deploy.
npx supabase functions deploy refresh-prices
```

The function is called from the browser via `supabase.functions.invoke('refresh-prices')`
(see `useTickerPrices`'s `refreshAll`) using the public anon/publishable key — no secret
ever reaches the client. Re-run `supabase functions deploy refresh-prices` any time
`supabase/functions/refresh-prices/index.ts` changes.

## Recurring deposits

The Deposits page (`/deposits`) has two parts:

- **Deposit History** — the actual `deposits` ledger. Add a one-time entry directly, or
  let a recurring schedule generate them automatically (see below). The Source column
  shows Manual vs. Recurring.
- **Recurring Schedules** — rules in `deposit_schedules` (account, amount, frequency,
  start/end date). A schedule doesn't create ledger rows by itself; something has to
  *materialize* it.

Materialization works exactly like price refreshing, same two paths:

1. **Scheduled**: `scripts/materialize-deposits.mjs` runs daily via
   `.github/workflows/materialize-deposits.yml` (06:00 UTC, every day — not just
   weekdays, since deposits can be daily). For each active schedule, it walks forward
   from `start_date` in `frequency`-sized steps (clamping monthly to the last day of
   shorter months, e.g. a Jan 31 start lands on Feb 28) up through today, and inserts any
   occurrence dates not already present. It's idempotent — an occurrence already in
   `deposits` (matched on `schedule_id` + `deposit_date`) is silently skipped
   (`upsert` with `ignoreDuplicates`), so re-running it, or having both the cron and a
   manual sync fire close together, never creates duplicates.
2. **On-demand**: the **Sync Now** button on the Deposits page calls the
   `materialize-deposits` Edge Function (`supabase/functions/materialize-deposits`) — the
   same logic, server-side, triggered immediately. Useful right after creating a schedule
   with `start_date` set to today, so you don't have to wait for tomorrow's cron to see
   the first deposit. Deploy/redeploy it the same way as `refresh-prices`:

   ```bash
   npx supabase functions deploy materialize-deposits
   ```

   (No extra secret needed — unlike price refresh, this function only reads/writes
   Supabase, it doesn't call any third-party API.)

To run the script locally:

```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_ANON_KEY=your_anon_key \
npm run deposits:materialize
```

## App structure

```
src/
  lib/
    supabase.js         # Supabase client init
    accounts.js         # Account slug <-> label mapping
  hooks/
    useTrades.js         # Fetch/add/update/delete trades, optionally filtered by account
    useTickerPrices.js    # Latest price per ticker; updatePrice() for manual edits, refreshAll() calls the Edge Function
    useDeposits.js         # Fetch/add/update/delete deposits, optionally filtered by account
    useDepositSchedules.js # CRUD for deposit_schedules; materializeNow() calls the Edge Function
    usePortfolio.js       # KPIs, allocation %, and P&L-by-ticker; overlays live prices onto open lots
  components/
    Layout.jsx            # Sidebar nav + main content outlet
    KPIRow.jsx             # 5 stat cards (invested, mkt value, unrealized, realized, total P&L)
    AllocationDonut.jsx    # Recharts PieChart, market value % by ticker
    PnLBarChart.jsx        # Recharts horizontal BarChart, realized vs unrealized by ticker
    HoldingsTable.jsx      # Sortable table, all trade columns, account badge in All view
    TradeForm.jsx          # Add/edit trade modal, writes directly to Supabase
    TaxHeadroom.jsx        # Headroom calculator, reads/writes tax_settings
    RothProgress.jsx       # 4-year conversion progress from roth_conversions
    TickerPrices.jsx       # Per-ticker price table: inline "Update Price" edits + "Update All Prices" button
    DepositForm.jsx        # Add/edit one-time deposit modal
    DepositScheduleForm.jsx # Add/edit recurring deposit schedule modal
    DepositsTable.jsx      # Deposit ledger table (Manual vs Recurring source badge)
    DepositSchedulesTable.jsx # Recurring schedules table (active/paused status)
  pages/
    Dashboard.jsx          # All Accounts view
    AccountPage.jsx        # Single account view (Robinhood / Traditional IRA / Roth IRA)
    TaxPage.jsx             # Tax headroom + Roth conversion tracker
    TradesPage.jsx          # Full trade log with add/edit/filter
    PricesPage.jsx          # Manual price overrides (/prices)
    DepositsPage.jsx        # Deposit ledger + recurring schedules (/deposits)
scripts/
  fetch-prices.mjs          # Daily job: Twelve Data -> ticker_prices (see "Daily price refresh")
  materialize-deposits.mjs  # Daily job: deposit_schedules -> deposits (see "Recurring deposits")
supabase/
  functions/
    refresh-prices/          # On-demand version of fetch-prices.mjs, called by "Update All Prices"
    materialize-deposits/    # On-demand version of materialize-deposits.mjs, called by "Sync Now"
```

## Deployment

A GitHub Actions workflow at `.github/workflows/deploy.yml` builds the app and deploys it
to GitHub Pages on every push to `main`. In your repo settings, set **Settings → Pages →
Source** to **GitHub Actions**. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as
repository secrets (Settings → Secrets and variables → Actions) so the build step can
inject them. Add `TWELVE_DATA_API_KEY` as well so `.github/workflows/refresh-prices.yml`
can run (see "Daily price refresh" above). `.github/workflows/materialize-deposits.yml`
needs no extra secret beyond the two Supabase ones.
