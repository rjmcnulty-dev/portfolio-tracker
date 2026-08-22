# Portfolio Tracker

A React + Vite portfolio tracker backed by Supabase. Tracks trades across three accounts
(Robinhood, Traditional IRA, Roth IRA), aggregates KPIs and allocation/P&L charts, and
includes tools for tax-bracket headroom and a 4-year Roth conversion plan. Current market
prices refresh automatically once a day via a scheduled GitHub Actions job, or on demand
from the Prices page, both pulling from Twelve Data. Cash deposits and dollar-cost-average
trades (one-time or recurring, daily through monthly) are tracked per account, with
recurring schedules auto-generating their ledger records on the same
scheduled-job/on-demand pattern as prices. Each account's uninvested cash position is
computed live from deposits and trade cash flow. A separate Stock Watch page tracks
tickers you don't hold — price chart (1D through 1Y) with earnings dates marked on it, next
earnings date, and notes.

## Stack

- React 18 + Vite
- [@supabase/supabase-js](https://github.com/supabase/supabase-js) for data
- [Recharts](https://recharts.org/) for the allocation donut, P&L bar chart, and Stock
  Watch price charts
- React Router (`HashRouter`) for navigation
- Plain CSS (no framework), dark-navy financial theme
- [Twelve Data](https://twelvedata.com/) for stock prices (daily refresh + on-demand) and
  Stock Watch price history
- [Finnhub](https://finnhub.io/) for Stock Watch's next-earnings-date lookup

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

Run the following in the Supabase SQL editor. It creates the fourteen tables the app reads
and writes: `accounts`, `trades`, `trade_lot_allocations`, `tax_settings`, `roth_conversions`,
`ticker_prices`, `ticker_price_history`, `price_targets`, `portfolio_value_history`,
`account_value_history`, `deposit_schedules`, `deposits`, `trade_schedules`, and `watchlist`.

```sql
-- Extension needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────
-- accounts: the list of accounts everything else
-- (trades, deposits, schedules) references. Add
-- new ones from the sidebar's "+" button (see
-- "Accounts" below) — no code change needed.
-- ─────────────────────────────────────────────
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into accounts (name, sort_order)
values ('Robinhood', 0), ('Traditional IRA', 1), ('Roth IRA', 2)
on conflict (name) do nothing;

-- ─────────────────────────────────────────────
-- trades: every buy/sell across all accounts
-- ─────────────────────────────────────────────
create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  account text not null references accounts (name) on update cascade,
  ticker text not null,
  trade_type text not null,
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
-- trade_lot_allocations: ties a SELL to the specific
-- BUY lot(s) it closes, so realized P&L is computed
-- from actual matched cost basis instead of a
-- manually typed number. One row per (sell, buy) pair
-- — a sell can span multiple lots, and a lot can be
-- partially closed across multiple sells.
-- ─────────────────────────────────────────────
create table if not exists trade_lot_allocations (
  id uuid primary key default gen_random_uuid(),
  sell_trade_id uuid not null references trades (id) on delete cascade,
  buy_trade_id uuid not null references trades (id),
  quantity numeric not null check (quantity > 0),
  cost_basis numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists trade_lot_allocations_sell_idx on trade_lot_allocations (sell_trade_id);
create index if not exists trade_lot_allocations_buy_idx on trade_lot_allocations (buy_trade_id);

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
-- ticker_price_history: one row per (ticker, day),
-- unlike ticker_prices which only keeps the latest.
-- Written going forward by the same daily job that
-- writes ticker_prices; backfilled once via
-- scripts/backfill-portfolio-history.mjs (it already
-- fetches each ticker's full daily history to compute
-- portfolio value, so this rides along for free). Lets
-- the Daily Gains table compute today-vs-yesterday
-- price moves per ticker without a live API call on
-- every page load (see "Daily gains" below).
-- ─────────────────────────────────────────────
create table if not exists ticker_price_history (
  ticker text not null,
  as_of date not null,
  price numeric not null,
  created_at timestamptz not null default now(),
  primary key (ticker, as_of)
);

create index if not exists ticker_price_history_ticker_idx on ticker_price_history (ticker);

-- ─────────────────────────────────────────────
-- price_targets: your own manually-set price
-- target per ticker (analyst consensus targets
-- aren't available on the free-tier APIs this app
-- uses — see "Performance Evaluator" below). Set
-- from the Prices page; read by the evaluator.
-- ─────────────────────────────────────────────
create table if not exists price_targets (
  ticker text primary key,
  target_price numeric not null,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- portfolio_value_history: one row per day, total
-- account value (cash position + market value of
-- open holdings) across every account that day.
-- Written going forward by scripts/fetch-prices.mjs
-- and the refresh-prices Edge Function's full-refresh
-- path; historical rows before this feature shipped
-- are populated once via
-- scripts/backfill-portfolio-history.mjs (see
-- "Portfolio value history" below).
-- ─────────────────────────────────────────────
create table if not exists portfolio_value_history (
  snapshot_date date primary key,
  total_value numeric not null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- account_value_history: same idea as
-- portfolio_value_history, but one row per
-- (account, day) instead of a single combined
-- total — powers the same chart on each account
-- page. A separate table rather than an 'All'
-- sentinel row in portfolio_value_history because
-- 'All' isn't a real row in `accounts` and would
-- break the account FK below.
-- ─────────────────────────────────────────────
create table if not exists account_value_history (
  account text not null references accounts (name) on update cascade,
  snapshot_date date not null,
  total_value numeric not null,
  created_at timestamptz not null default now(),
  primary key (account, snapshot_date)
);

create index if not exists account_value_history_account_idx on account_value_history (account);

-- ─────────────────────────────────────────────
-- deposit_schedules: recurring deposit rules
-- (e.g. "$500/month into Roth IRA"). Materialized
-- into `deposits` by scripts/materialize-deposits.mjs
-- (see "Recurring deposits" below).
-- ─────────────────────────────────────────────
create table if not exists deposit_schedules (
  id uuid primary key default gen_random_uuid(),
  account text not null references accounts (name) on update cascade,
  amount numeric not null,
  frequency text not null check (frequency in ('daily', 'weekly', 'biweekly', 'monthly')),
  start_date date not null,
  end_date date,
  active boolean not null default true,
  deposit_type text not null default 'Cash Deposit' check (
    deposit_type in ('Cash Deposit', 'Rollover', 'Short Term Capital Gain', 'Long Term Capital Gain', 'Dividend')
  ),
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
  account text not null references accounts (name) on update cascade,
  amount numeric not null,
  deposit_date date not null,
  deposit_type text not null default 'Cash Deposit' check (
    deposit_type in ('Cash Deposit', 'Rollover', 'Short Term Capital Gain', 'Long Term Capital Gain', 'Dividend')
  ),
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
-- trade_schedules: recurring trade rules (e.g.
-- "$200/month into AAPL"). Materialized into
-- `trades` by scripts/materialize-trades.mjs.
-- Purchase price/quantity are computed at
-- materialization time from ticker_prices, not
-- fixed at schedule-creation time. See "Recurring
-- trades" below.
-- ─────────────────────────────────────────────
create table if not exists trade_schedules (
  id uuid primary key default gen_random_uuid(),
  account text not null references accounts (name) on update cascade,
  ticker text not null,
  dollar_amount numeric not null,
  frequency text not null check (frequency in ('daily', 'weekly', 'biweekly', 'monthly')),
  start_date date not null,
  end_date date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists trade_schedules_account_idx on trade_schedules (account);

-- Link auto-generated trades back to the schedule that created them.
alter table trades add column if not exists schedule_id uuid references trade_schedules (id) on delete set null;

create index if not exists trades_schedule_idx on trades (schedule_id);

-- Same NULL-safe dedup logic as deposits_schedule_date_uidx above.
create unique index if not exists trades_schedule_date_uidx on trades (schedule_id, trade_date);

-- ─────────────────────────────────────────────
-- watchlist: tickers you're tracking but don't
-- necessarily hold — Stock Watch page (/watch).
-- Chart data and next-earnings-date aren't stored
-- here; they're fetched live via the
-- watchlist-quote Edge Function on each view.
-- ─────────────────────────────────────────────
create table if not exists watchlist (
  id uuid primary key default gen_random_uuid(),
  ticker text not null unique,
  notes text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- Row Level Security
-- This app uses the anon key directly from the browser. For a
-- single-user setup, enable RLS and allow all operations for now;
-- tighten these policies (e.g. scope to auth.uid()) before sharing
-- the project or adding multi-user auth.
-- ─────────────────────────────────────────────
alter table accounts enable row level security;
alter table trades enable row level security;
alter table trade_lot_allocations enable row level security;
alter table tax_settings enable row level security;
alter table roth_conversions enable row level security;
alter table ticker_prices enable row level security;
alter table ticker_price_history enable row level security;
alter table price_targets enable row level security;
alter table portfolio_value_history enable row level security;
alter table account_value_history enable row level security;
alter table deposit_schedules enable row level security;
alter table deposits enable row level security;
alter table trade_schedules enable row level security;
alter table watchlist enable row level security;

create policy "Allow all on accounts" on accounts for all using (true) with check (true);
create policy "Allow all on trades" on trades for all using (true) with check (true);
create policy "Allow all on trade_lot_allocations" on trade_lot_allocations for all using (true) with check (true);
create policy "Allow all on tax_settings" on tax_settings for all using (true) with check (true);
create policy "Allow all on roth_conversions" on roth_conversions for all using (true) with check (true);
create policy "Allow all on ticker_prices" on ticker_prices for all using (true) with check (true);
create policy "Allow all on ticker_price_history" on ticker_price_history for all using (true) with check (true);
create policy "Allow all on price_targets" on price_targets for all using (true) with check (true);
create policy "Allow all on portfolio_value_history" on portfolio_value_history for all using (true) with check (true);
create policy "Allow all on account_value_history" on account_value_history for all using (true) with check (true);
create policy "Allow all on deposit_schedules" on deposit_schedules for all using (true) with check (true);
create policy "Allow all on deposits" on deposits for all using (true) with check (true);
create policy "Allow all on trade_schedules" on trade_schedules for all using (true) with check (true);
create policy "Allow all on watchlist" on watchlist for all using (true) with check (true);
```

**If you already have a database from before accounts became dynamic**, run this
migration instead of (or in addition to) re-running the block above — it creates
`accounts`, seeds it from your existing data, drops the old fixed-enum CHECK constraints,
and adds the FK in their place:

```sql
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table accounts enable row level security;
create policy "Allow all on accounts" on accounts for all using (true) with check (true);

insert into accounts (name)
values ('Robinhood'), ('Traditional IRA'), ('Roth IRA')
on conflict (name) do nothing;

do $$
declare
  r record;
begin
  for r in
    select conname, conrelid::regclass as tbl
    from pg_constraint
    where contype = 'c'
      and conrelid in ('trades'::regclass, 'deposits'::regclass, 'deposit_schedules'::regclass, 'trade_schedules'::regclass)
      and pg_get_constraintdef(oid) like '%account%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table trades add constraint trades_account_fkey foreign key (account) references accounts (name) on update cascade;
alter table deposits add constraint deposits_account_fkey foreign key (account) references accounts (name) on update cascade;
alter table deposit_schedules add constraint deposit_schedules_account_fkey foreign key (account) references accounts (name) on update cascade;
alter table trade_schedules add constraint trade_schedules_account_fkey foreign key (account) references accounts (name) on update cascade;
```

**If you already have a database from before lot matching**, run this migration to add
`trade_lot_allocations` without re-running the full block above:

```sql
create table if not exists trade_lot_allocations (
  id uuid primary key default gen_random_uuid(),
  sell_trade_id uuid not null references trades (id) on delete cascade,
  buy_trade_id uuid not null references trades (id),
  quantity numeric not null check (quantity > 0),
  cost_basis numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists trade_lot_allocations_sell_idx on trade_lot_allocations (sell_trade_id);
create index if not exists trade_lot_allocations_buy_idx on trade_lot_allocations (buy_trade_id);

alter table trade_lot_allocations enable row level security;
create policy "Allow all on trade_lot_allocations" on trade_lot_allocations for all using (true) with check (true);
```

**If you already have a database from before deposit types**, run this migration to add
`deposit_type` to the existing `deposits` and `deposit_schedules` tables:

```sql
alter table deposits add column if not exists deposit_type text not null default 'Cash Deposit';
alter table deposits add constraint deposits_type_check check (
  deposit_type in ('Cash Deposit', 'Rollover', 'Short Term Capital Gain', 'Long Term Capital Gain', 'Dividend')
);

alter table deposit_schedules add column if not exists deposit_type text not null default 'Cash Deposit';
alter table deposit_schedules add constraint deposit_schedules_type_check check (
  deposit_type in ('Cash Deposit', 'Rollover', 'Short Term Capital Gain', 'Long Term Capital Gain', 'Dividend')
);
```

**If you already have a database from before "Scheduled Buy"**, run the migration below to
allow it as a `trades.trade_type` value, then immediately superseded by the next one — see
"Trade Types" for why.

**If you already have a database from before `trade_types`** (including one that already
ran the "Scheduled Buy" migration above), run this to drop the hardcoded check constraint —
`trade_types` (and its "can't delete a type still in use" check) is what governs valid
values now, so the old constraint only serves to block legitimately adding a custom type:

```sql
alter table trades drop constraint if exists trades_trade_type_check;
```

**If you already have a database from before the portfolio value chart**, run this
migration to add `portfolio_value_history`:

```sql
create table if not exists portfolio_value_history (
  snapshot_date date primary key,
  total_value numeric not null,
  created_at timestamptz not null default now()
);

alter table portfolio_value_history enable row level security;
create policy "Allow all on portfolio_value_history" on portfolio_value_history for all using (true) with check (true);
```

**If you already have a database from before per-account value charts**, run this
migration to add `account_value_history`:

```sql
create table if not exists account_value_history (
  account text not null references accounts (name) on update cascade,
  snapshot_date date not null,
  total_value numeric not null,
  created_at timestamptz not null default now(),
  primary key (account, snapshot_date)
);

create index if not exists account_value_history_account_idx on account_value_history (account);

alter table account_value_history enable row level security;
create policy "Allow all on account_value_history" on account_value_history for all using (true) with check (true);
```

Then run `npm run portfolio:backfill` once (see "Portfolio value history" below) — it
populates both tables in the same pass, so if you already ran it before per-account charts
existed, run it again to fill in `account_value_history` (re-writing `portfolio_value_history`
with the same values is harmless, just wasted API credits).

**If you already have both tables from before the value chart included cash**, the
column that used to be `market_value` (open-holdings value only) is now `total_value`
(cash position + open-holdings value — see "Portfolio value history" below for why).
Rename it and re-run the backfill to recompute the actual values, not just the column name:

```sql
alter table portfolio_value_history rename column market_value to total_value;
alter table account_value_history rename column market_value to total_value;
```

```bash
npm run portfolio:backfill
```

**If you already have a database from before accounts were reorderable**, run this
migration to add `sort_order`, backfilled from each account's existing `created_at` order
so nothing visibly reshuffles until you actually reorder something:

```sql
alter table accounts add column if not exists sort_order integer;

update accounts set sort_order = ranked.rn - 1
from (select id, row_number() over (order by created_at asc) as rn from accounts) ranked
where accounts.id = ranked.id and accounts.sort_order is null;

alter table accounts alter column sort_order set not null;
alter table accounts alter column sort_order set default 0;
```

**If you already have a database from before the Performance Evaluator**, run this
migration to add `price_targets`:

```sql
create table if not exists price_targets (
  ticker text primary key,
  target_price numeric not null,
  updated_at timestamptz not null default now()
);

alter table price_targets enable row level security;
create policy "Allow all on price_targets" on price_targets for all using (true) with check (true);
```

**If you already have a database from before the Daily Gains table**, run this migration
to add `ticker_price_history`, then re-run `npm run portfolio:backfill` once (it now also
backfills this table, using history it already fetches) so "yesterday's price" is available
immediately instead of only after two days of the app running forward:

```sql
create table if not exists ticker_price_history (
  ticker text not null,
  as_of date not null,
  price numeric not null,
  created_at timestamptz not null default now(),
  primary key (ticker, as_of)
);

create index if not exists ticker_price_history_ticker_idx on ticker_price_history (ticker);

alter table ticker_price_history enable row level security;
create policy "Allow all on ticker_price_history" on ticker_price_history for all using (true) with check (true);
```

```bash
npm run portfolio:backfill
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

## Portfolio value history

The **Portfolio Value** chart — Daily/Monthly/Yearly/All Time — appears on the Dashboard
(`/`, all-accounts total) and on each account page (that account's total only). Nothing
computes this on the fly at view time; both tables are written by the same two jobs that
already refresh prices:

- `scripts/fetch-prices.mjs` (the daily scheduled job) upserts today's row(s) right after
  updating `ticker_prices`, using the prices it just fetched — one row into
  `portfolio_value_history` (all accounts combined) and one row per account into
  `account_value_history`.
- The `refresh-prices` Edge Function does the same, but only on a *full* refresh (the
  **Update All Prices** button) — the per-ticker **Auto Update** button on the Prices page
  doesn't have prices for the rest of your holdings, so it can't produce a meaningful
  snapshot and skips writing one.

`total_value` is the whole account, not just open positions — it's **cash position +
market value of holdings**, the same two numbers KPIRow shows separately, added together:

```
total_value = (deposits − cost of open BUY lots + SELL proceeds)   [cash position]
            + Σ (open quantity × that day's price)                  [holdings value]
```

computed once across everything for `portfolio_value_history`, and again per account
(using only that account's deposits/trades) for `account_value_history`.

**Backfilling history from before this feature existed** is a separate, one-time step —
`scripts/backfill-portfolio-history.mjs` fetches each held ticker's full daily price
history from Twelve Data, then replays `deposits` and `trades` in date order to
reconstruct both the running cash position and open holdings (overall and per account) on
every day since your first trade, and writes one row per day up through yesterday into
both tables (today's row always comes from the regular daily job instead, so the two paths
never disagree about "today"). Run it once, after creating both tables:

```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_ANON_KEY=your_anon_key \
TWELVE_DATA_API_KEY=your_twelve_data_key \
npm run portfolio:backfill
```

It's rate-limited the same way as the price-refresh scripts (8 Twelve Data credits/minute),
so it can take a few minutes with more than a handful of tickers. A day where an open
position's ticker has no price data yet (e.g. a brand-new listing) is skipped rather than
written as a misleading $0 — the chart will just have a gap there.

Above the chart, a **Deposits/Withdrawals** row (same shape as the one on the Daily Gains
card — see below, and `useNetDepositsWithdrawals`) sums Deposits, Withdrawals, and Net for
whatever range is currently selected (Daily/Monthly/Yearly/All Time). Next to the big total
value and its Change figure, a **Net Gain/Loss** line is `Change − Net Deposits/Withdrawals`
for that same range — the same "back the cash flows out of Change" idea as the Daily Gains
card's Net Gain/Loss stat, reusing the `change` and `netAmount` already computed for the
header rather than a separate query.

The chart itself is a **stacked area**, not a single line: a **Deposits/Withdrawals** layer
(blue) is the net capital contributed to the account as of each day — all-time, not clipped
to the visible range, so even the Daily view shows the true baseline of money put in — and a
**Net Gain/Loss** layer (green) stacks on top of it, so the combined top edge is still
`total_value`. Net Gain/Loss is `total_value − cumulative net deposits/withdrawals as of that
day`, i.e. investment performance with capital in/out backed out — the same idea as the Daily
Gains card's Net Gain/Loss stat, but as a running series across the whole chart instead of a
single before/after figure. Both layers are computed client-side in `PortfolioValueChart` by
merging the (already-fetched) `deposits` list against `history`; no new query or table. If
Net Gain/Loss goes negative (the account is worth less than was put into it), the top edge
dips below the deposits layer — Recharts renders that correctly, but the fill color doesn't
switch to red for that segment, so lean on the Net Gain/Loss figure or the tooltip to confirm
a dip is really a loss and not just a rendering quirk.

## Daily gains

The **Daily Gains** table on each account page (below that account's Value chart) is a
matrix: one row per held ticker, one column per trading day, each cell showing that
ticker's price-driven $ change for that specific day (hover a cell for its % change) —
`(that day's price − prior day's price) × quantity held before that day's own trades`. The
quantity is **not** today's current holding applied uniformly across every column — it's
replayed from `trades` per day, so shares bought or sold partway through the shown range
are only counted on the days you actually held them. Shares bought on a given day don't
contribute to that day's price-driven gain (their cost basis *is* that day's price, so
there's nothing to have moved yet); shares sold on a given day still count for that day
(you held them going into it) but not after. A **Total** row along the bottom sums every
ticker for each day, and a **Total** column on the right sums each ticker across every
visible day. This is *only* price movement: a deposit or a trade executed that day doesn't
show up here as a gain — the same distinction `portfolio_value_history`'s `total_value`
deliberately blurs (it includes cash) that this table deliberately doesn't.

**Deposits/Withdrawals**, at the very top of the card, sums the `deposits` rows (see
"Recurring deposits" below) whose `deposit_date` falls within the selected range for this
account — Deposits (positive `amount` rows), Withdrawals (negative rows, shown as a positive
magnitude), and their Net. This is the quantified version of the "a deposit explains the gap,
not a bug" caveat below: it's computed by `useNetDepositsWithdrawals`, a plain sum over the
same `deposits` table everything else reads, filtered to the account and date range — no new
table or backend change was needed for it.

**Starting/Ending Account Value**, just below that, is the opposite of the daily cells'
deliberate distinction — it's the account's actual total value (cash + holdings) from
`account_value_history`, the same source `PortfolioValueChart` uses. "Starting" is the
latest snapshot strictly before the selected range begins (the account's value going into
the period); "Ending" is the latest snapshot on or before the range's last day. Because this
*does* include cash, Ending − Starting won't generally match the sum of the price-only
daily cells below it — the Net Deposits/Withdrawals figure above accounts for that gap
(a trade alone doesn't, since it just moves the same dollar amount from cash into holdings
or back, at that day's price — no net effect on `total_value`). Either value can show
"Not available" if that day was skipped during backfill (e.g. a held ticker had no price
data yet).

**Net Gain/Loss**, next to Change, is `Change − Net Deposits/Withdrawals` — the account
value's actual investment performance over the range, with new capital in/out backed out.
It's computed client-side in `DailyGainsTable`, not a separate hook or query. It should track
the table's own **Total** figure below, since both are meant to represent the same
price-driven change; they generally won't match exactly, because they're derived from two
different data sources — Net Gain/Loss from daily `account_value_history` snapshots, Total
from a per-ticker replay of `ticker_price_history` against `trades` — so treat a small
difference as expected, not a bug.

Defaults to the 5 most recent trading days with data; the From/To date inputs switch to an
explicit range, and "Last 5 Days" resets back. The **Week** dropdown is a shortcut to the
same thing — "Last Week," "2 weeks ago," etc. — partitioning the available trading days into
5-day chunks counting back from today, not calendar Mon-Sun weeks (a holiday-shortened week
still counts as one chunk). Columns come from whichever dates actually
have price history for the held tickers (the union across all of them), not a fixed
calendar walk — so a weekend or a gap in one ticker's history doesn't produce an empty
column or misalign the row. Each day's change is computed from that ticker's own full
fetched history, not sliced to the display range first, so the leftmost visible column
still has a valid prior-day reference even when that prior day itself falls outside the
selected range.

`ticker_price_history` (one row per ticker per day, unlike `ticker_prices` which only keeps
the latest) is written going forward by the same daily job that already writes
`ticker_prices` — `scripts/fetch-prices.mjs` and the `refresh-prices` Edge Function, at no
extra API cost, since the price was already being fetched. History from before this feature
shipped comes from `scripts/backfill-portfolio-history.mjs`, which also already fetches each
ticker's full daily history to compute portfolio value, so this rides along there too — see
the migration note under "Supabase SQL schema" for existing databases.

## Performance Evaluator

**Run Performance Evaluator**, on the Dashboard and each account page, opens a modal that
evaluates every open position in that scope (all accounts, or just that one) and suggests
Buy/Hold/Sell for each — a rule of thumb, not investment advice.

Two inputs feed the suggestion:

- **Trend** — SMA20/50/200 position and support/resistance levels, the same technical
  indicators Stock Watch charts already use, computed server-side by
  `supabase/functions/evaluate-performance` from 1 year of daily closes per ticker (Twelve
  Data `time_series`).
- **Price target** — a number **you** set yourself, per ticker, on the Prices page
  (`price_targets` table). Analyst consensus price targets aren't available on the
  free-tier APIs this app uses: Finnhub's `/stock/price-target` 403s on the free tier, and
  Twelve Data's `/price_target` is gated to ultra/enterprise plans (it "works" for the
  symbol `AAPL` specifically — Twelve Data special-cases that one ticker as an always-free
  demo regardless of plan, which is easy to mistake for the endpoint actually being open;
  it isn't, for any other symbol).

`src/lib/performanceEvaluator.js` is the pure function that turns (current price, your
target, SMA20/50/200, support/resistance) into a suggestion — it's intentionally isolated
from the Edge Function (which only fetches/computes raw inputs) so the rule can be read,
audited, or tuned without touching the data-fetching code:

- No target set → **Hold**, trend-only (there's nothing to judge value against yet).
- ≥10% upside to target **and** price above at least 2 of the 3 SMAs → **Buy**.
- Price already ≥5% past target → **Sell**.
- Downtrend (above 0-1 SMAs) and price sitting within 3% of a resistance level → **Sell**.
- Everything else → **Hold**.

Also returns 1/3/6/12-month trailing returns per ticker (shown in the modal alongside the
suggestion) — informational, not an input to the suggestion itself.

Costs 1 Twelve Data credit per held ticker (same 8-credit/minute budget as everywhere
else) — the modal warns and paces itself automatically for portfolios with more than 8
positions, the same rate-limit chunking pattern as the price-refresh jobs.

Deploy/redeploy the same way as the other functions:

```bash
npx supabase functions deploy evaluate-performance
```

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

Each row on the Prices page also has its own **Auto Update** button, which POSTs
`{ ticker }` to the same function — `refreshOne` in `useTickerPrices` — instead of
refreshing every held ticker. A single symbol is always one Twelve Data credit and never
needs to wait out the per-minute chunking delay, so it responds in under a second instead
of the 60s+ a full "Update All Prices" run takes once you're past 8 tickers.

One thing to know: Auto Update and Update All Prices draw from the *same* Twelve Data
per-minute credit budget (8 free-tier credits/minute), because that cap is tracked by
Twelve Data per API key, not per request. Firing off several Auto Updates in quick
succession, or an Auto Update immediately followed by a full refresh, can still trip
"You have run out of API credits for the current minute" — the error surfaces cleanly in
the UI either way, just wait a few seconds and retry.

**A third mode, `{ resnapshotOnly: true }`**: `account_value_history`/`portfolio_value_history`
are only recomputed as a side effect of a price refresh — so adding, editing, or deleting a
trade changes holdings/cash immediately, but the day's account-value snapshot doesn't catch
up until the next scheduled refresh or manual "Update All Prices." In between, anything that
reads those snapshots (the Daily Gains table's banner, `useAccountValueBounds`) silently
shows a stale number — found in practice as a real mismatch between the Daily Gains banner
and its own Total column right after adding a same-day trade. `useTrades.js`'s `addTrade`/
`updateTrade`/`deleteTrade` now fire-and-forget an `invoke('refresh-prices', { body: {
resnapshotOnly: true } })` after every mutation to close that gap. This mode skips Twelve
Data entirely — it reads whatever's already in `ticker_prices` and just re-runs the
cash/holdings-value math — so it costs no API credits and isn't rate-limited, safe to call
after every trade write. It does *not* cover trades inserted directly by
`materialize-trades`/`materialize-deposits` (recurring schedules) — those still wait for the
next scheduled price refresh, which in practice runs the same day.

## Recurring deposits

The Deposits and Withdrawals page (`/deposits`) has two parts:

- **Transaction History** — the actual `deposits` ledger. Add a one-time entry directly, or
  let a recurring schedule generate them automatically (see below). The Source column
  shows Manual vs. Recurring.
- **Recurring Schedules** — rules in `deposit_schedules` (account, amount, frequency,
  start/end date). A schedule doesn't create ledger rows by itself; something has to
  *materialize* it.

**Withdrawals are not a separate table or column.** A withdrawal is a `deposits` (or
`deposit_schedules`) row whose `amount` is stored **negative** — the Transaction Type
(Deposit/Withdrawal) shown in the UI is derived from that sign, not stored on its own. This
was a deliberate choice: every cash-position formula in the app (`usePortfolio`'s
`cashPosition`, `scripts/fetch-prices.mjs`, `refresh-prices`, `backfill-portfolio-history.mjs`,
and `useNetDepositsWithdrawals` above) already does a plain `sum(amount)` over `deposits`,
which nets out correctly with negative values with no changes to any of that math, and no
migration was needed to add the feature. `DepositForm`/`DepositScheduleForm` still take a
plain positive number from the user and apply the sign based on a Deposit/Withdrawal toggle,
rather than making them type a negative amount.

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

## Recurring trades

Same shape as recurring deposits, on the Trade Log page (`/trades`) instead: a
**Recurring Trades** section (rules in `trade_schedules`) sits above the full trade
history. Each schedule is a fixed **dollar amount** per occurrence (e.g. "$200/month into
AAPL"), not a fixed share count — a classic dollar-cost-average setup.

The key difference from deposits: a trade needs a *price*. At materialization time (not
schedule-creation time), the job looks up the ticker's current price from `ticker_prices`
and computes `quantity = dollar_amount / price`, then inserts a `trades` row
(`trade_type` = `'Scheduled Buy'`, `schedule_id` set, `cost_basis` = the fixed dollar
amount). `'Scheduled Buy'` behaves identically to `'BUY'` everywhere that matters (holdings,
cost basis, cash position, eligible SELL lots) — it's a separate value purely so recurring
trades are visually distinguishable from manually entered ones in the Type column. If
there's no cached price yet for that ticker, that schedule is skipped for the run and
picked up automatically next time a price exists — it never blocks other schedules or
errors out the whole batch.

Same two materialization paths as prices/deposits:

1. **Scheduled**: `scripts/materialize-trades.mjs` runs weekdays at 21:30 UTC via
   `.github/workflows/materialize-trades.yml` — 30 minutes after `refresh-prices.yml`
   (21:00 UTC), so trades use same-day closing prices. Weekdays only (unlike deposits'
   daily schedule) since there's no meaningful "trading day" price on weekends. The same
   occurrence-walking and idempotent upsert logic as deposits applies.
2. **On-demand**: the **Sync Now** button next to Recurring Trades calls the
   `materialize-trades` Edge Function (`supabase/functions/materialize-trades`). Deploy it
   the same way:

   ```bash
   npx supabase functions deploy materialize-trades
   ```

   No secret needed — it only reads `ticker_prices` (already populated by the price-refresh
   job) and writes `trades`, no third-party API call of its own.

To run the script locally:

```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_ANON_KEY=your_anon_key \
npm run trades:materialize
```

Auto-generated trades are marked with a Source badge (Recurring vs. Manual) on the Trade
Log table, same as deposits.

## Realized P&L / lot matching

Realized P&L for a SELL isn't typed in — it's computed from the specific BUY lot(s) the
sell closes, tracked in `trade_lot_allocations` (one row per sell/buy pair, since a sell
can span multiple lots and a lot can be partially closed across multiple sells).

When you enter or edit a SELL trade, the form's **Lots to Close** section lists every open
BUY lot for that ticker + account, each annotated with its remaining (unsold) quantity —
a lot that's already been fully closed by a prior sell won't appear. You choose how many
shares to close from each lot; the total must exactly match the sell's quantity. Realized
P&L then auto-computes as proceeds (`quantity * price - fees`) minus the proportional cost
basis of the lot(s) closed, following the same "auto-calculate + Recalculate button"
pattern as Cost Basis — it updates live as you adjust the allocation, but stays manually
editable with an explicit Recalculate action for edge cases.

This also changes what "holdings" and "invested" mean: a BUY lot's contribution to
Holdings, Invested, and unrealized P&L is based on its *remaining* quantity (original
quantity minus whatever's been allocated to sells), not its original quantity — a fully
closed lot drops out of Holdings entirely. The BUY row's own `quantity`/`price`/`cost_basis`
fields are never modified; they stay the accurate historical record of that trade.

A BUY trade that's been allocated to one or more sells can't be deleted directly (the
delete button will show an error telling you to delete the related SELL trade(s) first) —
deleting it out from under an already-computed realized P&L would silently corrupt that
number.

## Trade Types

BUY, SELL, and Scheduled Buy are **core** trade types — permanently protected, since
cost-basis, lot-matching, wash-sale, and cash-position logic throughout the app (client,
several Edge Functions, and two GitHub Actions scripts) all assume those exact strings
exist. Everything else about `trade_type` is DB-backed (`trade_types` table) and editable
from `/admin`'s **Trade Types** tab, so a custom type can be added without a code change.
Run once in the Supabase SQL editor:

```sql
create table if not exists trade_types (
  value text primary key,
  is_core boolean not null default false,
  deducts_cash boolean not null default true,
  created_at timestamptz not null default now()
);
alter table trade_types enable row level security;
create policy "Public read on trade_types" on trade_types for select using (true);
create policy "Authenticated write on trade_types" on trade_types
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

insert into trade_types (value, is_core, deducts_cash) values
  ('BUY', true, true),
  ('SELL', true, false),
  ('Scheduled Buy', true, true)
on conflict (value) do nothing;
```

**If `trades` still has its original `trades_trade_type_check` constraint** (any database
from before this feature), also run this — otherwise adding a custom type from `/admin`
succeeds, but actually *using* it on a trade fails with `violates check constraint
"trades_trade_type_check"`, since that old hardcoded list is still enforced underneath:

```sql
alter table trades drop constraint if exists trades_trade_type_check;
```

Read stays public (anon) since the New/Edit Trade dropdown needs it without a login, same as
`app_config`; writes require `authenticated`. A custom type can't be deleted while any trade
still uses it (checked before the delete, same "friendly error instead of a raw constraint
failure" pattern as deleting an account with trades attached) — core types have no
edit/delete control at all, not just a disabled one.

**Every custom type is a buy-lot type** — it adds shares and tracks cost basis, the same as
BUY. There's no way to add a second SELL-like type from this UI: closing a lot needs the
wash-sale/lot-selection machinery SELL alone has, and generalizing that safely was out of
scope here. The one behavior a custom type *does* configure is **"deducts cash"** — this is
what lets something like **Dividend Reinvestment** be modeled correctly: shares added, cost
basis tracked, but *no* matching cash outflow, since the money came from a dividend that was
never recorded as cash in the first place (recording it as a normal cash-deducting buy would
make Cash Position increasingly, incorrectly negative over time).

**How this is wired up**: `src/lib/tradeTypes.js` keeps a module-level cache — configured
once from `Layout.jsx` (same pattern as the Twelve Data rate limit) — so every existing
`isBuyTrade(tradeType)` call site across the app stayed a plain one-argument function; only
the cash-position formula needed a second flag, `tradeDeductsCash(tradeType)`. Edge Functions
and the two GitHub Actions scripts can't share that in-browser cache (separate deploy units/
processes), so each fetches `trade_types` for itself once per invocation via
`supabase/functions/_shared/tradeTypes.ts` / `scripts/lib/tradeTypes.mjs` — both fall back to
the original hardcoded `['BUY', 'Scheduled Buy']` set if the table is missing or empty, so
this was a zero-downtime migration.

## Cash position

The **Cash Position** KPI (Dashboard and each account page) isn't stored anywhere — it's
computed live in `usePortfolio` from the same `trades` and `deposits` data everything else
uses:

```
cash position = Σ deposits.amount
              − Σ (cash-deducting buy-lot trades: cost_basis)
              + Σ (SELL trades: quantity × price − fees)
```

Deposits add cash; a cash-deducting buy-lot trade (BUY, Scheduled Buy, or a custom type with
"deducts cash" on — see "Trade Types" above) draws it down by that lot's cost basis; a SELL
adds back its proceeds. A buy-lot type with "deducts cash" off (e.g. Dividend Reinvestment)
still adds shares/cost basis to Holdings, just with no cash effect here. It's not clamped at
zero — a negative cash position is a real signal (trades recorded without a matching
deposit), shown in red rather than hidden.

## Stock Watch

The Stock Watch page (`/watch`) tracks tickers independent of whether you actually hold
them — add any symbol, and each gets a card with a price chart, a range toggle (1D / 1W /
1M / 3M / 6M / 1Y), the next earnings date, and a free-text Notes field.

Unlike prices/deposits/trades, nothing here is cached in Supabase or refreshed on a
schedule — `watchlist` only stores the ticker and your notes. Chart data and the earnings
date are fetched live, on demand, whenever a card mounts or you switch its range, via a
single Edge Function: `supabase/functions/watchlist-quote`, called with `{ ticker, range }`
through `useStockQuote`.

That function combines two providers:

- **Twelve Data** `time_series` for the chart. Range maps to interval/outputsize: `1D` →
  5min bars, `1W` → 30min bars, `1M`/`3M`/`6M`/`1Y` → daily bars over 30/90/180/365 days.
- **Finnhub** `calendar/earnings` for earnings report dates — this needed a second
  provider because Twelve Data's forward-looking earnings calendar is a paid-plan feature;
  its free `/earnings` endpoint only returns *past* reports. Finnhub's free tier has a real,
  documented earnings-calendar endpoint, so that's used instead of scraping a finance
  site's HTML (fragile, likely against its ToS) or estimating from historical cadence. One
  call (`from` 2 years back, `to` 6 months out — wide enough to cover every range option's
  history plus the forward lookahead) covers the "Next Earnings" text field, the "Recent
  Earnings" list, and the in-chart markers below at no extra API cost: `nextEarningsDate` is
  the soonest date on or after today, `earningsDates` is whichever of those dates actually
  fall within the currently plotted range, and `recentEarningsDates` is every reported date
  from the trailing 365 days — a fixed window independent of chart range, unlike
  `earningsDates`.
- **Finnhub** `stock/profile2` for company name and float (`floatingShare`, reported in
  millions of shares) — one call gets both, so float rides along for free on a request the
  card was already making.

**Earnings report dates on the chart itself** — a gold dashed vertical line (labeled "E") at
each earnings date within the visible range, toggleable via the "Earnings" chart control like
the moving averages and support/resistance ("Sync All Charts" can broadcast it too). Hovering
a marked date's point shows "Earnings report" in the tooltip alongside the price. Markers only
appear on daily-bar ranges (`1M`/`3M`/`6M`/`1Y`/`20D`/`50D`/`200D`) — Recharts' `ReferenceLine`
needs its `x` to exactly match one of the chart's own x-axis values, and `1D`/`1W`'s
timestamped intraday points (`"2026-08-14 09:30:00"`) never match a plain earnings date
(`"2026-08-14"`), so those ranges simply show no markers rather than a misplaced one — a
reasonable gap since neither range is likely to span an earnings date's own trading day
anyway.

**Recent Earnings**, next to "Next Earnings" on the card, lists every reported earnings date
from the past 365 days (most recent first, e.g. "Jul 24, 2026 · Apr 22, 2026 · ..."), or "None
in the past year" if there aren't any. Unlike the in-chart markers, this doesn't depend on
which range is currently selected — it's always the same trailing-year window.

**Some tickers only ever show a next earnings date, never historical ones** (confirmed on
MU and MAMA, both otherwise-working tickers) — not a bug in the fetch window or date
filtering (verified by temporarily dumping the raw, unfiltered Finnhub response: MU/MAMA's
`earningsCalendar` genuinely only contained future dates, while a control ticker like AAPL's
included a past one). Finnhub's free-tier `calendar/earnings` backfill coverage varies by
symbol and isn't guaranteed for every ticker regardless of company size — there's no request
parameter that recovers data the endpoint doesn't have. "Next Earnings" still works for these
because it only needs one upcoming date, which Finnhub does provide.

**Stochastic Oscillator** is a separate sub-chart below the price chart (not an overlay —
%K/%D oscillate 0-100, incompatible with a dollar price axis), toggleable via the "Stochastic"
chart control like the other indicators ("Sync All Charts" can broadcast it too). %K is where
the close sits within the high/low range of the trailing `kPeriod` bars (0 = at the period
low, 100 = at the period high), smoothed over `kSmoothing` bars — the commonly-charted "slow"
stochastic, less noisy than raw/"fast" %K. %D is a `dPeriod`-bar SMA of %K, a signal line.
Dashed reference lines mark the overbought/oversold thresholds. Defaults (14, 3, 3, overbought
80, oversold 20) are the standard textbook parameters, tunable from `/admin`'s App Settings
like the other Stock Watch indicators (`stochastic_tuning`). Computed client-side in
`computeStochastic` (`src/lib/technicalIndicators.js`) from the high/low/close each chart bar
already has — Twelve Data's `time_series` returns full OHLC by default, `watchlist-quote` just
wasn't reading `high`/`low` until this needed them, so there's no extra API cost.

**On Balance Volume (OBV)** is a second sub-chart, same reasoning as Stochastic — a running
total that adds a bar's volume when it closes higher than the prior bar, subtracts it when
lower, and holds steady on an unchanged close. Unlike Stochastic it isn't bounded (it's a
cumulative sum of daily share volume, so it trends into the millions/billions over a long
series) — only its slope and divergence from the price trend are meaningful, never its
absolute level, so there's no fixed 0-100 axis or overbought/oversold lines the way Stochastic
has. Computed client-side in `computeOBV`, same file, from each bar's `volume` — also already
in Twelve Data's response and also newly read by `watchlist-quote` for this, at no extra API
cost.

Raw OBV is jumpy day to day, so a **Trend** line (a plain `trendPeriod`-bar SMA of OBV — the
standard "OBV signal line," same idea as Stochastic's %D relative to %K) is plotted alongside
it, computed via `smoothPoints` (exported from `technicalIndicators.js`, already used
internally for Stochastic's %K/%D smoothing). An **EMA** line (`emaPeriod`-bar exponential
moving average, via the new `computeEMA` in the same file — weights recent points more heavily
than the SMA-based Trend line does, so it reacts a bit faster to a change in direction) is
plotted alongside both. Both periods are tunable from `/admin`'s App Settings (`obv_tuning`,
default 20 for each — the conventional period), same pattern as every other Stock Watch
indicator's tuning. If you added `obv_tuning` before `emaPeriod` existed, the client falls
back to 20 per-field even if the stored row doesn't have that key yet (`useConfigValue` only
substitutes its default when the whole row is missing, not per-missing-field). **If you already
ran the `obv_tuning` insert below before `emaPeriod` existed**, run this once to add the field
to your existing row so it shows up as an editable field in `/admin` too (a no-op if you're
setting this up fresh — the insert below already includes it):

```sql
update app_config set value = value || '{"emaPeriod":20}'::jsonb where key = 'obv_tuning';
```

Both sub-charts are toggleable per-card via their own chart control ("Stochastic", "OBV"), or
all at once (regardless of how many subcharts exist) via the **Hide All Subcharts** / **Show
All Subcharts** button in the page header — a lighter broadcast than "Sync All Charts" next to
it, since it only flips subchart visibility and leaves each card's own range/MA/levels/
earnings settings alone.

**Filter** (`src/components/WatchlistFilterModal.jsx`), also in the page header, is a checkbox
list of every ticker on the watchlist — unchecking one hides its card from the page without
removing it from the watchlist. Purely a display filter, tracked as a `hiddenTickers` Set in
`StockWatchPage` (empty by default, so a newly-added ticker is always visible immediately
rather than silently starting out hidden) — nothing is persisted, so it resets on reload. A
hidden card's `WatchlistCard` isn't rendered at all rather than CSS-hidden, so it isn't
fetching data it doesn't need to; showing it again re-mounts it fresh (a real reload of that
card's chart, same as if you'd just added the ticker). The header button shows a count when
anything's hidden (e.g. "Filter (2 hidden)"), and hiding every card swaps the grid for a
message linking back to the Filter modal instead of just going blank.

Each card also has its own **Hide** button (next to Expand, just left of Remove) as a
one-click shortcut to hiding that one card — it writes to the exact same `hiddenTickers` Set
the Filter modal does (via an `onHide` callback passed down from `StockWatchPage`), so the two
can never disagree about what's currently hidden.

**Short interest was investigated and isn't available for free.** Neither Twelve Data
(`/statistics`, where it'd live, is 403 on the free tier — pro/ultra/venture/enterprise
only) nor Finnhub (`/stock/short-interest` is 403 free-tier too; `/stock/metric` works but
only has per-share financial ratios, no float or short interest) expose it without a paid
plan. A few other providers (ORTEX, Massive, ValueInvesting.io) advertise free short
interest access, but none were verified against a real ticker — their docs are ambiguous
about whether the free tier includes real per-symbol data or just a sandbox/aggregate view.
Don't build against one without testing a real ticker first and reading the actual response
— "free-looking" in marketing copy isn't the same as free (Twelve Data's own `/price_target`
looked free too, because it special-cases `AAPL` as an always-open demo symbol regardless
of plan; every other symbol 403s).

Deploy/redeploy the same way as the other functions:

```bash
npx supabase secrets set FINNHUB_API_KEY=your_finnhub_key
npx supabase functions deploy watchlist-quote
```

**Rate limit note**: unlike `/price`, Twelve Data's `time_series` costs a credit per
`(ticker, range)` combination with no batching discount, against the same free-tier 8
credits/minute cap used elsewhere in this app. `useStockQuote` caches each combination for
the card's lifetime — reselecting a range you've already viewed is free — and dedupes
React StrictMode's dev-mode double effect-fire (which otherwise silently doubled every
initial chart load in `npm run dev`, though not in the production build). Watching more
than ~8 (ticker, range) combinations within the same minute — e.g. several new tickers, or
clicking through multiple ranges quickly — can still trip Twelve Data's cap; the error
surfaces cleanly in the card, wait a few seconds and retry.

Get a free Finnhub key at [finnhub.io/register](https://finnhub.io/register). Like
`TWELVE_DATA_API_KEY`, never prefix it `VITE_` — it must stay a Supabase secret, not reach
the browser.

## Ticker hover names

Hovering a ticker in the Prices page (`/prices`) table shows the full company name as a
native tooltip, via `supabase/functions/company-names` — a small Finnhub-only Edge
Function (`stock/profile2`, the same lookup `watchlist-quote` uses for Stock Watch cards).
It's batched: `useCompanyNames` sends every currently-displayed ticker in one request when
the page loads, and caches results for the component's lifetime so switching account
filters doesn't refetch names already resolved. No Twelve Data credits are spent — Finnhub's
free tier (60 calls/minute) is generous enough to fetch a whole ticker list at once, unlike
the 8-credit/minute budget the price-refresh jobs have to carefully ration. If a name fails
to resolve, the tooltip just falls back to showing the ticker itself.

Deploy/redeploy the same way as the other functions (reuses the same `FINNHUB_API_KEY`
secret as `watchlist-quote` — no separate key needed):

```bash
npx supabase functions deploy company-names
```

## Accounts

Accounts (Robinhood, Traditional IRA, Roth IRA, and anything you add) live in the
`accounts` table instead of a hardcoded list — click the **+** next to "Accounts" in the
sidebar to add a new one, and it immediately shows up everywhere an account is
selectable: the sidebar nav, every account dropdown (Trade/Deposit/Schedule forms), every
account filter (Trade Log, Deposits, Prices' held-by-account columns), and account routing
(`/account/:slug`, where the slug is the account name lower-cased and hyphenated by
`slugify()` in `src/lib/accounts.js` — not a separate stored column).

`trades.account`, `deposits.account`, `deposit_schedules.account`, and
`trade_schedules.account` are foreign keys to `accounts.name` (`on update cascade`), not a
fixed-enum CHECK constraint like before. `useAccounts` is a plain hook (matching the rest
of the app's hooks, no React Context) called independently wherever the account list is
needed — accounts change rarely and the list is tiny, so the handful of redundant fetches
that implies is a non-issue.

Only **adding** accounts is supported for now — no rename or delete UI yet (deleting one
with existing trades/deposits attached needs a real decision about what happens to that
data, so it's deferred rather than half-built).

## Admin / Auth

`/admin` is a login-gated section for app configuration (business settings now, encrypted
API-key management to follow) — the one part of this app that requires signing in. Every
other route and table is unaffected: this app otherwise has **no authentication anywhere**,
by design (see the "single-user setup" note in the SQL schema section above) — every table's
RLS policy is `using (true)` for the anon role, and the sidebar/every other page works with
no session at all. `/admin` is a deliberate, narrow exception to that.

**One-time setup** — create the single admin user via the Supabase Dashboard (there is no
in-app sign-up flow, intentionally, since this is a single-user app):

1. Supabase Dashboard → **Authentication → Users → Add user**.
2. Enter an email and password, and check **Auto Confirm User** (skips email verification —
   there's no SMTP configured for this project, so a verification email would otherwise never
   arrive).
3. Sign in at `/#/login` with that email/password.

**How the gate works**: `src/hooks/useAuth.js` mirrors `supabase.auth`'s session state (which
`@supabase/supabase-js` already persists to `localStorage` and auto-refreshes by default —
nothing extra configured for that). `src/components/RequireAuth.jsx` is a route-wrapper that
redirects to `/login` when signed out, remembering the page you were headed to so sign-in
returns you there. `src/pages/LoginPage.jsx` is a standalone page (no sidebar) that calls
`supabase.auth.signInWithPassword`. `/admin` itself (`src/pages/AdminPage.jsx`) stays nested
under the normal `Layout` so it keeps the sidebar like every other page.

This protects **who can reach `/admin`'s controls** — it does not change what the anon key
can already do to the database directly (every other table is still `using (true)`, unchanged
by this feature).

### Password reset

`/login` has a **Forgot password?** link — email + `supabase.auth.resetPasswordForEmail`, then
follow the emailed link to set a new one.

**The one non-obvious part**: Supabase's reset link redirects back to the app with an auth
token embedded in the URL *hash* (`#access_token=...`) — but this app's router (`HashRouter`)
also uses the URL hash for routing, so a route like `/#/reset-password` can't reliably match
once Supabase appends its own token onto that same hash. Rather than fight that collision,
`src/hooks/usePasswordRecovery.js` listens for Supabase's `PASSWORD_RECOVERY` auth event
directly (fires correctly regardless of what the resulting URL looks like) and
`src/App.jsx` swaps the entire app over to `src/pages/ResetPasswordPage.jsx` the instant it
fires — no route match involved.

**One-time setup**: Supabase only redirects to allow-listed URLs. Add your app's URL(s) —
e.g. `http://localhost:5173/**` for local dev, plus your deployed URL if you have one — under
Supabase Dashboard → **Authentication → URL Configuration → Redirect URLs**.

**Login hint**: `/login` also shows an optional hint (the `login_hint` row in `app_config`,
below) to jog your memory before you'd need a full reset. It's editable from `/admin`'s App
Settings tab like any other config row — but unlike the rest of that table, it's rendered on
a page that requires no login, so don't put anything in it that gives the password away.

### App settings (`app_config`)

A curated set of business-logic constants — picked from a codebase audit for being either
duplicated across multiple files (the Twelve Data rate limit was independently hardcoded in
5 places) or just plausibly worth tuning without a deploy — live in one table instead, edited
from `/admin`. Run once in the Supabase SQL editor:

```sql
create table if not exists app_config (
  key text primary key,
  value jsonb not null,
  category text not null,
  label text not null,
  description text,
  updated_at timestamptz not null default now()
);
alter table app_config enable row level security;
create policy "Public read on app_config" on app_config for select using (true);
create policy "Authenticated write on app_config" on app_config for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

insert into app_config (key, value, category, label, description) values
  ('twelve_data_rate_limit', '{"maxPerWindow":8,"windowMs":61000}', 'API', 'Twelve Data Rate Limit',
    'Free-tier credits per rolling window. Shared by the client queue, refresh-prices, fetch-prices.mjs, backfill-portfolio-history.mjs, and evaluate-performance.'),
  ('deposit_types', '["Cash Deposit","Rollover","Short Term Capital Gain","Long Term Capital Gain","Dividend"]', 'Deposits', 'Deposit Types',
    'Options offered on the Deposit Type dropdown (one-time and recurring forms).'),
  ('recurring_frequencies', '[{"value":"daily","label":"Daily","stepDays":1},{"value":"weekly","label":"Weekly","stepDays":7},{"value":"biweekly","label":"Biweekly","stepDays":14},{"value":"monthly","label":"Monthly","stepDays":null}]', 'Recurring Schedules', 'Recurring Frequencies',
    'Frequency options for recurring deposits/trades. stepDays drives the materialization day-math (monthly is calendar-month, not a fixed day count).'),
  ('portfolio_value_ranges', '[{"key":"daily","label":"Daily","days":30},{"key":"monthly","label":"Monthly","days":365},{"key":"yearly","label":"Yearly","days":1825},{"key":"all","label":"All Time","days":null}]', 'Charts', 'Portfolio Value Chart Ranges',
    'Lookback-window buttons on the Portfolio Value / [Account] Value cards.'),
  ('moving_average_periods', '[20,50,200]', 'Stock Watch', 'Moving Average Periods',
    'SMA periods drawn on Stock Watch charts and used by the Performance Evaluator''s trend score.'),
  ('support_resistance_tuning', '{"tolerancePct":0.015,"swingWindowPct":0.03,"maxLevelsDefault":2,"proximityPct":0.03}', 'Stock Watch', 'Support/Resistance Tuning',
    'Clustering tolerance and swing-point window for the support/resistance levels drawn on charts, plus how close counts as "near" a level in the Performance Evaluator.'),
  ('stochastic_tuning', '{"kPeriod":14,"kSmoothing":3,"dPeriod":3,"overbought":80,"oversold":20}', 'Stock Watch', 'Stochastic Oscillator Tuning',
    '%K lookback, %K smoothing, and %D signal-line periods for the Stochastic sub-chart, plus the overbought/oversold reference levels drawn on it.'),
  ('obv_tuning', '{"trendPeriod":20,"emaPeriod":20}', 'Stock Watch', 'OBV Trend/EMA Periods',
    'Bars in the SMA-based Trend line and the EMA line plotted alongside raw On Balance Volume.'),
  ('buy_sell_thresholds', '{"buyUpsidePct":10,"buyMinScore":2,"sellUpsidePct":-5,"sellMaxScoreNearResistance":1}', 'Performance Evaluator', 'Buy/Sell Thresholds',
    'Trigger points for the Buy/Sell suggestion: upside % to target and trend score cutoffs.'),
  ('daily_gains_defaults', '{"defaultDayCount":5,"weekSize":5}', 'Daily Gains', 'Daily Gains Defaults',
    'Default number of trading days shown, and the size of a "week" chunk in the Week dropdown.'),
  ('holdings_page_size_options', '{"options":[25,50,100,"All"],"default":25}', 'Trade Log', 'Page Size Options',
    'Rows-per-page choices on the Trade Log table.'),
  ('tax_filing_statuses', '[{"value":"single","label":"Single"},{"value":"married_joint","label":"Married Filing Jointly"}]', 'Tax', 'Filing Statuses',
    'Options on the Tax Headroom filing-status dropdown.'),
  ('login_hint', '""', 'Auth', 'Login Password Hint',
    'Optional hint shown on the sign-in page to help you remember your password. Public/unauthenticated — visible to anyone who visits /login, so don''t put anything that gives the password away.')
on conflict (key) do nothing;
```

**If you already ran the insert above before `login_hint` existed**, run this once to add the row
(a no-op if you're setting this up fresh — the insert above already includes it):

```sql
insert into app_config (key, value, category, label, description) values
  ('login_hint', '""', 'Auth', 'Login Password Hint',
    'Optional hint shown on the sign-in page to help you remember your password. Public/unauthenticated — visible to anyone who visits /login, so don''t put anything that gives the password away.')
on conflict (key) do nothing;
```

Read stays public (anon) since the client, Edge Functions, and scripts all need it without a
login; writes require `authenticated` — the one deliberate RLS-tightening this project adds,
scoped to this new table only (no changes to any of the 14 pre-existing tables' policies).

Explicitly **left out** of this table (audited but not worth the churn): the Watchlist chart's
`RANGES`/`LEVEL_COUNTS` and `watchlist-quote`'s paired `RANGE_PARAMS` (tightly-coupled
display+fetch config — editing one without the other breaks the chart), chart pixel heights,
color palettes, floating-point epsilons, and GitHub Actions cron schedules (not reachable
from a DB table at all).

**Client**: `src/hooks/useAppConfig.js` — `useAppConfig()` fetches every row once (called
independently wherever needed, same pattern as `useAccounts`); `useConfigValue(key, fallback)`
is a convenience for the common single-key case. Every call site keeps its pre-`app_config`
value as that fallback, so a slow or failed fetch never breaks the page — it just behaves as
if nothing had been customized yet.

**Server-side**: only the keys actually duplicated server-side were worth wiring up —
`twelve_data_rate_limit` (`supabase/functions/_shared/config.ts`, used by `refresh-prices` and
`evaluate-performance`; `scripts/lib/config.mjs`, used by `fetch-prices.mjs` and
`backfill-portfolio-history.mjs`) and `recurring_frequencies` (`_shared/config.ts`, used by
`materialize-deposits` and `materialize-trades`). Both are plain reads with the same
hardcoded-value fallback pattern as the client side — no encryption involved, this table isn't
secret.

`/admin`'s **App Settings** tab (`src/pages/AdminConfigPage.jsx`) groups these by `category`,
with a structured form per row rather than raw JSON — it inspects each value's shape at
render time and picks a control accordingly: a number/text input for a primitive, a labeled
field grid for an object, and a repeatable add/remove list for an array (of primitives, or —
for something like `recurring_frequencies` — of objects, rendered as one inline mini-form per
item). This is generic over shape rather than hardcoded per key, so a new `app_config` row
added later still gets a reasonable editor with no UI changes. Shows each row's `updated_at`.

### Encrypted secrets

The Twelve Data and Finnhub API keys can also be set from `/admin`'s **Secrets** tab instead
of (or in addition to) the CLI/GitHub-UI flows described elsewhere in this README — encrypted
at rest, and the browser never sees a saved value again, only whether it's configured and
when it was last updated.

**Threat model, stated plainly**: with no user accounts beyond the one admin (see "Admin /
Auth"), *writing* a secret from `/admin` is genuinely gated — `manage-secret` requires a real
Supabase Auth session, both at the platform level (`verify_jwt = true`) and via an explicit
in-function check (see below — `verify_jwt` alone isn't sufficient, since the public anon key
is itself technically a valid JWT for the project). *Reading* a secret
back in decrypted form is a different, narrower guarantee: nothing reachable from the browser
can ever do that (the `manage-secret` function that the browser calls never decrypts, only
encrypts-and-stores); the only path that decrypts and returns a value,
`reveal-secret`, is gated by possession of the project's own service-role key, which the
GitHub Actions scripts hold (as their own dedicated secret) and the browser never does. That's
the same trust tier every other Edge Function in this app already operates at — this doesn't
add a new class of exposure, it closes off the browser specifically as an attack surface for
these two keys.

**One-time setup** — generate a master encryption key and set it in both places that need to
decrypt (Supabase Edge Functions, and the GitHub Actions scripts):

```bash
# Generates 32 random bytes, base64-encoded.
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```bash
npx supabase secrets set CONFIG_ENCRYPTION_KEY=<the generated value>
```

Then add two **new** GitHub Actions repository secrets (Settings → Secrets and variables →
Actions): `CONFIG_ENCRYPTION_KEY` (the same value) and `SUPABASE_SERVICE_ROLE_KEY` (Project
Settings → API → `service_role` key on the Supabase dashboard — needed so the scripts can call
`reveal-secret`, which only responds to that key).

Run the SQL below once in the Supabase SQL editor:

```sql
create table if not exists app_secrets (
  key text primary key,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);
alter table app_secrets enable row level security;
-- Deliberately no policies at all: only the service-role key (which
-- bypasses RLS, same as every Edge Function's own DB client already does)
-- can touch this table — not even an authenticated admin session can read
-- or write it directly via PostgREST, only through manage-secret/
-- reveal-secret, which control exactly what's ever returned.
```

**Encryption**: AES-256-GCM via Deno's Web Crypto API, in
`supabase/functions/_shared/secrets.ts` — the only code anywhere in this project that
encrypts or decrypts. Ciphertext is stored as `base64(iv) + "." + base64(ciphertext‖tag)`.

**Edge Functions**:
- `manage-secret` (`verify_jwt = true` in `supabase/config.toml`, **plus** an explicit
  `auth.getUser()` check inside the function) — the only function in this project that
  requires a real login. `verify_jwt = true` alone isn't enough: it only rejects a request
  with no valid-for-this-project JWT at all, and the public anon key *is* a valid JWT (same
  signing secret, role `anon`) — so a request carrying just the anon key would otherwise pass
  the platform gate. The function additionally resolves the caller's token against Supabase
  Auth to confirm it's a genuine user session, not just any project-signed token; verified by
  hand while building this (an anon-key-only request got a clean `401 Unauthorized` after this
  check was added, where it hadn't been rejected before). `{action:"save", key, value}`
  encrypts and upserts, returning `{ok, updatedAt, preview}` where `preview` is the last 4
  characters of what was just typed (an echo of input, never a read of stored ciphertext).
  `{action:"status", key}` returns `{isSet, updatedAt}` only — it never decrypts.
- `reveal-secret` (`verify_jwt = false`; manually checks the request's `Authorization` header
  equals `Bearer <service-role key>`, 401s otherwise) — `{key}` decrypts and returns
  `{value}`. Exists only for the GitHub Actions scripts below, so Node never needs its own
  AES-GCM implementation.
- `refresh-prices`, `watchlist-quote`, `evaluate-performance`, `company-names` — each now
  tries the encrypted DB value first (via `_shared/secrets.ts`'s `getDecryptedSecret`,
  in-process, no HTTP round-trip) and falls back to its existing `Deno.env.get(...)` Supabase
  secret if nothing's been saved to `/admin` yet. This makes adopting encrypted secrets
  zero-downtime — every function keeps working exactly as before until you actually set a
  value from `/admin`, at which point the DB value takes over.

**GitHub Actions scripts** (`fetch-prices.mjs`, `backfill-portfolio-history.mjs`): a new
`scripts/lib/secrets.mjs` calls `reveal-secret` (needs `SUPABASE_SERVICE_ROLE_KEY` and
`CONFIG_ENCRYPTION_KEY` set as above), falling back to the existing `TWELVE_DATA_API_KEY`
GitHub secret if either new secret is missing or nothing's been saved yet — same
zero-downtime transition as the Edge Functions.

## AI Companion

A chat page (`/ai-companion`, gated behind the same login as `/admin` — see "Admin / Auth")
that talks to Claude via the Anthropic API, with a snapshot of the current portfolio as
context so it can actually answer questions about holdings/P&L/cash rather than a plain
generic chatbot.

**Setup**: get an API key from [console.anthropic.com](https://console.anthropic.com), then
set it from `/admin`'s Secrets tab (`anthropic_api_key`, added to the same `ALLOWED_KEYS` set
as the Twelve Data/Finnhub keys — see "Encrypted secrets" above; same encryption, same
storage, same never-echoed-back guarantee).

**Why this one requires login, unlike everything else in this app**: every other Edge
Function here is free (or on a fixed-cost external API budget); this one is metered,
pay-per-token, on your own Anthropic account. `supabase/functions/ai-companion/index.ts` uses
`verify_jwt = true` plus the same explicit `auth.getUser()` check as `manage-secret` — a
deliberate cost gate, not just an access-control one.

**Portfolio context**: `src/lib/portfolioContext.js`'s `buildPortfolioContext()` turns the
already-computed `usePortfolio('All')` values (KPIs, holdings, allocation, cash position —
never raw trade rows, to keep token cost down) into a compact JSON snapshot.
`AiCompanionPage.jsx` computes this **once**, the first time portfolio data finishes loading,
and freezes it for the rest of the session — resending the exact same JSON on every turn
matters for prompt caching (below), not just correctness. It's a point-in-time snapshot, not
live data — the system prompt tells the model as much, so it caveats anything time-sensitive
correctly instead of implying it's watching your accounts in real time.

**Prompt caching**: every turn resends the whole growing conversation (standard multi-turn
chat pattern), so caching compounds — `ai-companion` marks the system prompt, the portfolio
context block, and the last message of each request with an `ephemeral` `cache_control`
breakpoint. Each new turn's request repeats the previous turn's prefix verbatim before
appending what's new, so Anthropic can serve that unchanged prefix from cache and only charges
full price for the newly appended tokens. Anthropic requires a minimum prompt size (1024
tokens for Sonnet) before caching actually activates — a short conversation with a small
portfolio may not cross that threshold, which is expected, not a bug. The function returns
Anthropic's `usage` block alongside each reply; `useAiCompanion.js` logs it to the browser
console (`[ai-companion] usage`) so `cache_read_input_tokens` ticking up after the first
couple of turns is easy to confirm.

**Guardrails**: `MAX_MESSAGE_CHARS` (8000), `MAX_MESSAGES` (40, then the client needs a new
conversation), and `MAX_CONTEXT_CHARS` (20000) all return a clean 400 rather than silently
truncating — a stuck retry loop or a huge pasted block can't run up an unbounded bill on a
single request.

**Scoped out on purpose**: streaming responses (real complexity — SSE through an Edge
Function — for mostly cosmetic benefit at single-user scale) and persisted conversation
history (a new table, only worth it if chats need to survive a page refresh; currently
in-memory only, reset by "New Conversation" or a reload).

### Token Usage modal

The page header's **Token Usage** button shows two breakdowns (input/output/cache-write/
cache-read tokens, plus an estimated $ spend) — **This Session** (client-side running total,
reset by "New Conversation" or a reload, same lifetime as the conversation itself) and
**All Time** (summed from every call ever made, across every session/browser/device). Run
once in the Supabase SQL editor:

```sql
create table if not exists ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  web_search_requests integer not null default 0
);
alter table ai_usage_log enable row level security;
create policy "Authenticated read on ai_usage_log" on ai_usage_log for select
  using (auth.role() = 'authenticated');

insert into app_config (key, value, category, label, description) values
  ('ai_companion_pricing', '{"inputPerMTok":3,"outputPerMTok":15,"cacheWritePerMTok":3.75,"cacheReadPerMTok":0.3,"webSearchPerSearch":0.01}', 'AI Companion', 'Token Pricing ($/million tokens)',
    'Estimated cost rates for the Token Usage modal — update if Anthropic changes pricing or you switch models. Not billing-accurate, just an estimate from token counts.')
on conflict (key) do nothing;
```

**If you already ran the block above before `web_search_requests`/`webSearchPerSearch` existed**,
run this once (a no-op if you're setting this up fresh):

```sql
alter table ai_usage_log add column if not exists web_search_requests integer not null default 0;
update app_config set value = value || '{"webSearchPerSearch":0.01}'::jsonb where key = 'ai_companion_pricing';
```

`ai-companion` inserts one row per successful reply via its existing service-role client
(bypasses RLS, same as every other write in that function) — this is why the table has no
insert policy at all; only that function ever writes to it. There's deliberately no anon
read policy either, unlike `app_config` — spend data is scoped to the same login `/ai-companion`
itself requires, not public. `src/hooks/useAiUsageTotal.js` fetches and sums every row
client-side rather than relying on a SQL aggregate, since a personal single-user app's row
count (one per message) stays small enough for years of daily use, and it sidesteps any
question of whether PostgREST aggregates are enabled on this project. `src/lib/
aiUsagePricing.js` holds the shared `estimateCost()`/`sumUsage()` used by both the session and
all-time totals, reading rates from `ai_companion_pricing` (falling back to the same
hardcoded values as the seed row above if that config row doesn't exist yet).

**Not a substitute for the Anthropic console** — this is an estimate computed from token
counts against rates you configure, not a read of your actual account billing. Good for
tracking relative spend and catching a runaway conversation, not for reconciling an invoice.

### Web search

`ai-companion` passes Anthropic's `web_search_20250305` server-side tool on every request
(`max_uses: 5` per reply — a constant in the function, same level as `MODEL`/`MAX_TOKENS`
above it, not an `app_config` row, since this file already hardcodes its own tunables rather
than pulling them from config). Claude decides on its own whether a question needs a search —
the system prompt tells it to use the tool for anything current (market news, a stock's latest
price, general facts) that isn't in the portfolio snapshot, and to never use it to guess at the
user's own holdings or trades, which only ever come from the snapshot.

This is a fully server-side tool: Anthropic runs the search and continues generating in the
same request/response, so no client-side tool-execution loop was needed here. The one code
change this required beyond adding the `tools` array: a web-search reply's `content` array
interleaves `server_tool_use`/`web_search_tool_result` blocks with one or more `text` blocks
(e.g. a short "searching for..." aside before the real answer) — the reply extraction switched
from grabbing the first text block to joining all of them, so the substantive answer after a
search isn't silently dropped.

**Billed separately from tokens** — $10 per 1,000 searches as of when this was built
(`webSearchPerSearch` in `ai_companion_pricing`, see "Token Usage modal" above), which is why
that config row and the `ai_usage_log` table both have a `web_search_requests`/
`webSearchPerSearch` field alongside the token-based ones.

## App structure

```
src/
  lib/
    supabase.js         # Supabase client init
    accounts.js         # slugify() for account name -> URL slug (no longer a static list)
    portfolioContext.js # buildPortfolioContext() — compact snapshot sent to AI Companion, see "AI Companion"
    aiUsagePricing.js   # estimateCost()/sumUsage() shared by session + all-time totals — see "Token Usage modal"
    tradeTypes.js        # isBuyTrade()/tradeDeductsCash() — module-level trade_types cache, see "Trade Types"
  hooks/
    useAccounts.js          # Fetch accounts; addAccount() — see "Accounts"
    useTradeTypes.js        # CRUD for trade_types (add/edit/delete custom types) — see "Trade Types"
    usePasswordRecovery.js  # Detects Supabase's PASSWORD_RECOVERY auth event — see "Password reset"
    useAiCompanion.js       # Chat state + calls ai-companion Edge Function — see "AI Companion"
    useAiUsageTotal.js      # All-time token usage, summed from ai_usage_log — see "Token Usage modal"
    useTrades.js         # Fetch/add/update/delete trades, optionally filtered by account
    useTickerPrices.js    # Latest price per ticker; updatePrice() for manual edits, refreshAll() calls the Edge Function
    useDeposits.js         # Fetch/add/update/delete deposits, optionally filtered by account
    useDepositSchedules.js # CRUD for deposit_schedules; materializeNow() calls the Edge Function
    useTradeSchedules.js   # CRUD for trade_schedules; materializeNow() calls the Edge Function
    useWatchlist.js         # CRUD for watchlist (ticker + notes)
    useStockQuote.js        # Live chart series + next earnings date for one ticker/range, via watchlist-quote
    usePortfolio.js       # KPIs, allocation %, P&L-by-ticker, holdings, and cash position; overlays live prices onto open lots
    useAuth.js               # Mirrors supabase.auth session state — see "Admin / Auth"
    useAppConfig.js          # useAppConfig()/useConfigValue() — reads app_config, see "App settings"
  components/
    RequireAuth.jsx        # Route wrapper: redirects to /login when signed out — see "Admin / Auth"
    Layout.jsx            # Sidebar nav (incl. Add Account) + main content outlet
    AddAccountForm.jsx     # Add-account modal, opened from the sidebar's "+"
    KPIRow.jsx             # 6 stat cards (cash position, invested, mkt value, unrealized, realized, total P&L)
    AllocationDonut.jsx    # Recharts PieChart, market value % by ticker
    PnLBarChart.jsx        # Recharts horizontal BarChart, realized vs unrealized by ticker
    HoldingsSummaryTable.jsx # Per-stock position summary: qty, avg cost, current price, unrealized $/%
    HoldingsTable.jsx      # Sortable table, all trade columns, account badge + Source badge in All view
    TradeForm.jsx          # Add/edit trade modal; Cost Basis auto-calculates from qty * price + fees
    TradeScheduleForm.jsx  # Add/edit recurring trade schedule modal (dollar amount, not share count)
    TradeSchedulesTable.jsx # Recurring trade schedules table (active/paused status)
    TaxHeadroom.jsx        # Headroom calculator, reads/writes tax_settings
    RothProgress.jsx       # 4-year conversion progress from roth_conversions
    TickerPrices.jsx       # Per-ticker price table: inline "Update Price" edits + "Update All Prices" button
    DepositForm.jsx        # Add/edit one-time deposit modal
    DepositScheduleForm.jsx # Add/edit recurring deposit schedule modal
    DepositsTable.jsx      # Deposit/withdrawal ledger table (Manual vs Recurring source badge)
    DepositSchedulesTable.jsx # Recurring schedules table (active/paused status)
    WatchlistCard.jsx       # Stock Watch card: range-toggle chart, next earnings, notes
    WatchlistFilterModal.jsx # Checkbox list to hide/show cards on the Stock Watch page
    TokenUsageModal.jsx     # Session + all-time token usage/spend — see "Token Usage modal"
  pages/
    Dashboard.jsx          # All Accounts view
    AccountPage.jsx        # Single account view, resolved from the URL slug via accounts
    TaxPage.jsx             # Tax headroom + Roth conversion tracker
    TradesPage.jsx          # Recurring trade schedules + full trade log with add/edit/filter
    PricesPage.jsx          # Manual price overrides (/prices)
    DepositsPage.jsx        # Deposit/withdrawal ledger + recurring schedules (/deposits)
    StockWatchPage.jsx      # Watchlist: add ticker, view chart/earnings/notes (/watch)
    LoginPage.jsx            # Standalone (no sidebar) sign-in form + forgot-password — see "Admin / Auth"
    ResetPasswordPage.jsx    # Set-new-password form, shown on PASSWORD_RECOVERY — see "Password reset"
    AdminPage.jsx            # Login-gated app config (/admin) — see "Admin / Auth"
    AdminConfigPage.jsx      # App Settings tab: app_config rows grouped by category, shape-aware form editor
    AdminSecretsPage.jsx     # Secrets tab: masked API key entry (Twelve Data/Finnhub/Anthropic) — see "Encrypted secrets"
    AdminTradeTypesPage.jsx  # Trade Types tab: add/edit/delete custom trade types — see "Trade Types"
    AiCompanionPage.jsx      # Chat with Claude, portfolio-aware (/ai-companion) — see "AI Companion"
scripts/
  fetch-prices.mjs          # Daily job: Twelve Data -> ticker_prices (see "Daily price refresh")
  materialize-deposits.mjs  # Daily job: deposit_schedules -> deposits (see "Recurring deposits")
  materialize-trades.mjs    # Weekday job: trade_schedules + ticker_prices -> trades (see "Recurring trades")
  lib/
    config.mjs               # getConfig() — reads app_config, shared by the scripts above
    secrets.mjs               # getSecret() — calls reveal-secret, see "Encrypted secrets"
    tradeTypes.mjs            # getTradeTypeSets() — reads trade_types, see "Trade Types"
supabase/
  functions/
    _shared/
      config.ts               # getConfig() — Edge Function counterpart of scripts/lib/config.mjs
      secrets.ts               # encrypt/decrypt/getDecryptedSecret — see "Encrypted secrets"
      tradeTypes.ts            # getTradeTypeSets() — Edge Function counterpart of scripts/lib/tradeTypes.mjs
    refresh-prices/          # On-demand version of fetch-prices.mjs, called by "Update All Prices"
    materialize-deposits/    # On-demand version of materialize-deposits.mjs, called by "Sync Now"
    materialize-trades/      # On-demand version of materialize-trades.mjs, called by "Sync Now"
    watchlist-quote/         # Live chart + earnings lookup for Stock Watch (see "Stock Watch")
    manage-secret/            # Save/status for encrypted secrets, called from /admin — see "Encrypted secrets"
    reveal-secret/             # Decrypts a secret for the GitHub Actions scripts — see "Encrypted secrets"
    ai-companion/              # Chat proxy to the Anthropic API, portfolio-aware — see "AI Companion"
```

## Deployment

A GitHub Actions workflow at `.github/workflows/deploy.yml` builds the app and deploys it
to GitHub Pages on every push to `main`. In your repo settings, set **Settings → Pages →
Source** to **GitHub Actions**. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as
repository secrets (Settings → Secrets and variables → Actions) so the build step can
inject them. Add `TWELVE_DATA_API_KEY` as well so `.github/workflows/refresh-prices.yml`
can run (see "Daily price refresh" above). `.github/workflows/materialize-deposits.yml` and
`.github/workflows/materialize-trades.yml` need no extra secret beyond the two Supabase
ones. If you've set up encrypted secrets (see "Encrypted secrets" above), also add
`SUPABASE_SERVICE_ROLE_KEY` and `CONFIG_ENCRYPTION_KEY` — without them, `refresh-prices.yml`
still works fine by falling back to the plain `TWELVE_DATA_API_KEY` secret.
