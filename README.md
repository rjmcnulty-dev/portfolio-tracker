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
tickers you don't hold — price chart (1D through 1Y), next earnings date, and notes.

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

Run the following in the Supabase SQL editor. It creates the ten tables the app reads
and writes: `accounts`, `trades`, `trade_lot_allocations`, `tax_settings`, `roth_conversions`,
`ticker_prices`, `deposit_schedules`, `deposits`, `trade_schedules`, and `watchlist`.

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
  created_at timestamptz not null default now()
);

insert into accounts (name)
values ('Robinhood'), ('Traditional IRA'), ('Roth IRA')
on conflict (name) do nothing;

-- ─────────────────────────────────────────────
-- trades: every buy/sell across all accounts
-- ─────────────────────────────────────────────
create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  account text not null references accounts (name) on update cascade,
  ticker text not null,
  trade_type text not null check (trade_type in ('BUY', 'SELL', 'Scheduled Buy')),
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

**If you already have a database from before "Scheduled Buy"**, run this migration to
allow it as a `trades.trade_type` value (auto-materialized recurring trades use it instead
of `'BUY'`, purely so they're visually distinguishable — everywhere that cares whether a
trade opened a position treats the two identically):

```sql
alter table trades drop constraint if exists trades_trade_type_check;
alter table trades add constraint trades_trade_type_check check (
  trade_type in ('BUY', 'SELL', 'Scheduled Buy')
);
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

## Cash position

The **Cash Position** KPI (Dashboard and each account page) isn't stored anywhere — it's
computed live in `usePortfolio` from the same `trades` and `deposits` data everything else
uses:

```
cash position = Σ deposits.amount
              − Σ (BUY trades: cost_basis)
              + Σ (SELL trades: quantity × price − fees)
```

Deposits add cash; a BUY draws it down by that lot's cost basis; a SELL adds back its
proceeds. It's not clamped at zero — a negative cash position is a real signal (trades
recorded without a matching deposit), shown in red rather than hidden.

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
- **Finnhub** `calendar/earnings` for the next earnings date — this needed a second
  provider because Twelve Data's forward-looking earnings calendar is a paid-plan feature;
  its free `/earnings` endpoint only returns *past* reports. Finnhub's free tier has a real,
  documented earnings-calendar endpoint, so that's used instead of scraping a finance
  site's HTML (fragile, likely against its ToS) or estimating from historical cadence.

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

## App structure

```
src/
  lib/
    supabase.js         # Supabase client init
    accounts.js         # slugify() for account name -> URL slug (no longer a static list)
  hooks/
    useAccounts.js          # Fetch accounts; addAccount() — see "Accounts"
    useTrades.js         # Fetch/add/update/delete trades, optionally filtered by account
    useTickerPrices.js    # Latest price per ticker; updatePrice() for manual edits, refreshAll() calls the Edge Function
    useDeposits.js         # Fetch/add/update/delete deposits, optionally filtered by account
    useDepositSchedules.js # CRUD for deposit_schedules; materializeNow() calls the Edge Function
    useTradeSchedules.js   # CRUD for trade_schedules; materializeNow() calls the Edge Function
    useWatchlist.js         # CRUD for watchlist (ticker + notes)
    useStockQuote.js        # Live chart series + next earnings date for one ticker/range, via watchlist-quote
    usePortfolio.js       # KPIs, allocation %, P&L-by-ticker, holdings, and cash position; overlays live prices onto open lots
  components/
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
    DepositsTable.jsx      # Deposit ledger table (Manual vs Recurring source badge)
    DepositSchedulesTable.jsx # Recurring schedules table (active/paused status)
    WatchlistCard.jsx       # Stock Watch card: range-toggle chart, next earnings, notes
  pages/
    Dashboard.jsx          # All Accounts view
    AccountPage.jsx        # Single account view, resolved from the URL slug via accounts
    TaxPage.jsx             # Tax headroom + Roth conversion tracker
    TradesPage.jsx          # Recurring trade schedules + full trade log with add/edit/filter
    PricesPage.jsx          # Manual price overrides (/prices)
    DepositsPage.jsx        # Deposit ledger + recurring schedules (/deposits)
    StockWatchPage.jsx      # Watchlist: add ticker, view chart/earnings/notes (/watch)
scripts/
  fetch-prices.mjs          # Daily job: Twelve Data -> ticker_prices (see "Daily price refresh")
  materialize-deposits.mjs  # Daily job: deposit_schedules -> deposits (see "Recurring deposits")
  materialize-trades.mjs    # Weekday job: trade_schedules + ticker_prices -> trades (see "Recurring trades")
supabase/
  functions/
    refresh-prices/          # On-demand version of fetch-prices.mjs, called by "Update All Prices"
    materialize-deposits/    # On-demand version of materialize-deposits.mjs, called by "Sync Now"
    materialize-trades/      # On-demand version of materialize-trades.mjs, called by "Sync Now"
    watchlist-quote/         # Live chart + earnings lookup for Stock Watch (see "Stock Watch")
```

## Deployment

A GitHub Actions workflow at `.github/workflows/deploy.yml` builds the app and deploys it
to GitHub Pages on every push to `main`. In your repo settings, set **Settings → Pages →
Source** to **GitHub Actions**. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as
repository secrets (Settings → Secrets and variables → Actions) so the build step can
inject them. Add `TWELVE_DATA_API_KEY` as well so `.github/workflows/refresh-prices.yml`
can run (see "Daily price refresh" above). `.github/workflows/materialize-deposits.yml` and
`.github/workflows/materialize-trades.yml` need no extra secret beyond the two Supabase
ones.
