# Portfolio Tracker

A React + Vite portfolio tracker backed by Supabase. Tracks trades across three accounts
(Robinhood, Traditional IRA, Roth IRA), aggregates KPIs and allocation/P&L charts, and
includes tools for tax-bracket headroom and a 4-year Roth conversion plan.

## Stack

- React 18 + Vite
- [@supabase/supabase-js](https://github.com/supabase/supabase-js) for data
- [Recharts](https://recharts.org/) for the allocation donut and P&L bar chart
- React Router (`HashRouter`) for navigation
- Plain CSS (no framework), dark-navy financial theme

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

Run the following in the Supabase SQL editor. It creates the three tables the app reads
and writes: `trades`, `tax_settings`, and `roth_conversions`.

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
-- Row Level Security
-- This app uses the anon key directly from the browser. For a
-- single-user setup, enable RLS and allow all operations for now;
-- tighten these policies (e.g. scope to auth.uid()) before sharing
-- the project or adding multi-user auth.
-- ─────────────────────────────────────────────
alter table trades enable row level security;
alter table tax_settings enable row level security;
alter table roth_conversions enable row level security;

create policy "Allow all on trades" on trades for all using (true) with check (true);
create policy "Allow all on tax_settings" on tax_settings for all using (true) with check (true);
create policy "Allow all on roth_conversions" on roth_conversions for all using (true) with check (true);
```

## App structure

```
src/
  lib/
    supabase.js         # Supabase client init
    accounts.js         # Account slug <-> label mapping
  hooks/
    useTrades.js         # Fetch/add/update/delete trades, optionally filtered by account
    usePortfolio.js       # KPIs, allocation %, and P&L-by-ticker derived from useTrades
  components/
    Layout.jsx            # Sidebar nav + main content outlet
    KPIRow.jsx             # 5 stat cards (invested, mkt value, unrealized, realized, total P&L)
    AllocationDonut.jsx    # Recharts PieChart, market value % by ticker
    PnLBarChart.jsx        # Recharts horizontal BarChart, realized vs unrealized by ticker
    HoldingsTable.jsx      # Sortable table, all trade columns, account badge in All view
    TradeForm.jsx          # Add/edit trade modal, writes directly to Supabase
    TaxHeadroom.jsx        # Headroom calculator, reads/writes tax_settings
    RothProgress.jsx       # 4-year conversion progress from roth_conversions
  pages/
    Dashboard.jsx          # All Accounts view
    AccountPage.jsx        # Single account view (Robinhood / Traditional IRA / Roth IRA)
    TaxPage.jsx             # Tax headroom + Roth conversion tracker
    TradesPage.jsx          # Full trade log with add/edit/filter
```

## Deployment

A GitHub Actions workflow at `.github/workflows/deploy.yml` builds the app and deploys it
to GitHub Pages on every push to `main`. In your repo settings, set **Settings → Pages →
Source** to **GitHub Actions**. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as
repository secrets (Settings → Secrets and variables → Actions) so the build step can
inject them.
