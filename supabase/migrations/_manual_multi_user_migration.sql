-- Multi-user conversion migration — RUN MANUALLY in the Supabase SQL editor.
-- (Not auto-applied; this repo has no migration-runner wired to `supabase/migrations`.
-- Filed here so it's version-controlled, not because anything executes it automatically.)
--
-- Owner: rjmcnulty@gmail.com — auth.users.id = 8d5499ce-20a6-4515-abec-c3bbea66718a
-- (looked up live via `select id, email from auth.users` before writing this file —
-- verify it still matches your own account before running, in case anything changed.)
--
-- Every existing row in every table touched below belongs to this one owner (the app
-- has been single-user until now), so every backfill below sets user_id to this exact
-- value. Wrapped in one transaction — if anything fails, nothing here takes effect.
--
-- Structured in strict dependency order: (1) add every user_id column + backfill,
-- (2) drop every OLD constraint being replaced, children (FKs) before the parent
-- unique they depend on, (3) add every NEW constraint, parent before children,
-- (4) swap RLS policies. A first attempt at this migration tried to drop
-- accounts_name_key before dropping the 5 child FKs that reference it — Postgres
-- correctly refused ("other objects depend on it"). This version fixes that ordering.

begin;

-- ============================================================================
-- 1. profiles — new table, admin flag
-- ============================================================================

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Self-select only. No insert/update policy at all, on purpose — a profile row
-- (and its is_admin flag) is only ever created/changed by hand via this SQL editor
-- or the Dashboard, alongside provisioning the Auth user. Never client-writable.
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = user_id);

insert into public.profiles (user_id, is_admin)
values ('8d5499ce-20a6-4515-abec-c3bbea66718a', true);

-- ============================================================================
-- 2. Add user_id + backfill to every table. No constraint changes yet.
-- ============================================================================

alter table public.accounts add column user_id uuid references auth.users(id);
update public.accounts set user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';
alter table public.accounts alter column user_id set not null;

alter table public.trades add column user_id uuid references auth.users(id);
update public.trades set user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';
alter table public.trades alter column user_id set not null;

alter table public.deposits add column user_id uuid references auth.users(id);
update public.deposits set user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';
alter table public.deposits alter column user_id set not null;

alter table public.deposit_schedules add column user_id uuid references auth.users(id);
update public.deposit_schedules set user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';
alter table public.deposit_schedules alter column user_id set not null;

alter table public.trade_schedules add column user_id uuid references auth.users(id);
update public.trade_schedules set user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';
alter table public.trade_schedules alter column user_id set not null;

alter table public.account_value_history add column user_id uuid references auth.users(id);
update public.account_value_history set user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';
alter table public.account_value_history alter column user_id set not null;

alter table public.trade_lot_allocations add column user_id uuid references auth.users(id);
update public.trade_lot_allocations set user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';
alter table public.trade_lot_allocations alter column user_id set not null;

alter table public.roth_conversions add column user_id uuid references auth.users(id);
update public.roth_conversions set user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';
alter table public.roth_conversions alter column user_id set not null;

alter table public.ai_conversations add column user_id uuid references auth.users(id);
update public.ai_conversations set user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';
alter table public.ai_conversations alter column user_id set not null;

-- ai_messages has no account/user link of its own; backfill via its parent
-- conversation, which was just backfilled above.
alter table public.ai_messages add column user_id uuid references auth.users(id);
update public.ai_messages set user_id = (
  select c.user_id from public.ai_conversations c where c.id = ai_messages.conversation_id
);
alter table public.ai_messages alter column user_id set not null;

alter table public.ai_usage_log add column user_id uuid references auth.users(id);
update public.ai_usage_log set user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';
alter table public.ai_usage_log alter column user_id set not null;

alter table public.price_targets add column user_id uuid references auth.users(id);
update public.price_targets set user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';
alter table public.price_targets alter column user_id set not null;

alter table public.tax_settings add column user_id uuid references auth.users(id);
update public.tax_settings set user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';
alter table public.tax_settings alter column user_id set not null;

alter table public.watchlist add column user_id uuid references auth.users(id);
update public.watchlist set user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';
alter table public.watchlist alter column user_id set not null;

alter table public.portfolio_value_history add column user_id uuid references auth.users(id);
update public.portfolio_value_history set user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';
alter table public.portfolio_value_history alter column user_id set not null;

-- ============================================================================
-- 3. Drop OLD constraints being replaced — children (FKs) before the parent
--    unique index they depend on, so Postgres never sees a dangling dependent.
-- ============================================================================

alter table public.trades drop constraint trades_account_fkey;
alter table public.deposits drop constraint deposits_account_fkey;
alter table public.deposit_schedules drop constraint deposit_schedules_account_fkey;
alter table public.trade_schedules drop constraint trade_schedules_account_fkey;
alter table public.account_value_history drop constraint account_value_history_account_fkey;

-- Now safe — nothing depends on it any more.
alter table public.accounts drop constraint accounts_name_key;

-- These three don't depend on accounts_name_key at all (their PK/unique is on
-- their own ticker/year/snapshot_date column), just being dropped here so
-- every "drop old / add new" pair reads together with the rest of this file.
alter table public.account_value_history drop constraint account_value_history_pkey;
alter table public.price_targets drop constraint price_targets_pkey;
alter table public.tax_settings drop constraint tax_settings_year_key;
alter table public.watchlist drop constraint watchlist_ticker_key;
alter table public.portfolio_value_history drop constraint portfolio_value_history_pkey;

-- ============================================================================
-- 4. Add NEW constraints — parent (accounts) before children (FKs that
--    reference it).
-- ============================================================================

alter table public.accounts add constraint accounts_user_id_name_key unique (user_id, name);

alter table public.trades
  add constraint trades_user_account_fkey
  foreign key (user_id, account) references public.accounts(user_id, name) on update cascade;
alter table public.deposits
  add constraint deposits_user_account_fkey
  foreign key (user_id, account) references public.accounts(user_id, name) on update cascade;
alter table public.deposit_schedules
  add constraint deposit_schedules_user_account_fkey
  foreign key (user_id, account) references public.accounts(user_id, name) on update cascade;
alter table public.trade_schedules
  add constraint trade_schedules_user_account_fkey
  foreign key (user_id, account) references public.accounts(user_id, name) on update cascade;
alter table public.account_value_history
  add constraint account_value_history_user_account_fkey
  foreign key (user_id, account) references public.accounts(user_id, name) on update cascade;

-- account_value_history's PK is (account, snapshot_date) today; becomes
-- (user_id, account, snapshot_date).
alter table public.account_value_history add primary key (user_id, account, snapshot_date);

-- price_targets — ticker IS the primary key today (no separate id column).
-- New composite PK (user_id, ticker).
alter table public.price_targets add primary key (user_id, ticker);

-- tax_settings — id stays the PK; the separate unique(year) constraint
-- becomes unique(user_id, year).
alter table public.tax_settings add constraint tax_settings_user_year_key unique (user_id, year);

-- watchlist — id stays the PK; the separate unique(ticker) constraint becomes
-- unique(user_id, ticker), so two different users can watch the same ticker.
alter table public.watchlist add constraint watchlist_user_ticker_key unique (user_id, ticker);

-- portfolio_value_history — no id column at all; snapshot_date alone is the
-- PK today. New composite PK (user_id, snapshot_date).
alter table public.portfolio_value_history add primary key (user_id, snapshot_date);

-- ============================================================================
-- 5. RLS policy swap — same shape on every table: replace the old blanket
--    "any authenticated user" policy with an owner-only one.
-- ============================================================================

drop policy "Authenticated access on accounts" on public.accounts;
create policy "accounts_owner_all" on public.accounts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy "Authenticated access on trades" on public.trades;
create policy "trades_owner_all" on public.trades for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy "Authenticated access on deposits" on public.deposits;
create policy "deposits_owner_all" on public.deposits for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy "Authenticated access on deposit_schedules" on public.deposit_schedules;
create policy "deposit_schedules_owner_all" on public.deposit_schedules for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy "Authenticated access on trade_schedules" on public.trade_schedules;
create policy "trade_schedules_owner_all" on public.trade_schedules for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy "Authenticated access on account_value_history" on public.account_value_history;
create policy "account_value_history_owner_all" on public.account_value_history for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy "Authenticated access on trade_lot_allocations" on public.trade_lot_allocations;
create policy "trade_lot_allocations_owner_all" on public.trade_lot_allocations for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy "Authenticated access on roth_conversions" on public.roth_conversions;
create policy "roth_conversions_owner_all" on public.roth_conversions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy "Authenticated access on ai_conversations" on public.ai_conversations;
create policy "ai_conversations_owner_all" on public.ai_conversations for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy "Authenticated access on ai_messages" on public.ai_messages;
create policy "ai_messages_owner_all" on public.ai_messages for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ai_usage_log stays READ-ONLY for the client (only the service-role Edge
-- Function ever inserts), just scoped to each user's own rows instead of
-- every row — an audit trail, not something a user should edit/delete.
drop policy "Authenticated read on ai_usage_log" on public.ai_usage_log;
create policy "ai_usage_log_select_own" on public.ai_usage_log for select
  using (auth.uid() = user_id);

drop policy "Authenticated access on price_targets" on public.price_targets;
create policy "price_targets_owner_all" on public.price_targets for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy "Authenticated access on tax_settings" on public.tax_settings;
create policy "tax_settings_owner_all" on public.tax_settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy "Authenticated access on watchlist" on public.watchlist;
create policy "watchlist_owner_all" on public.watchlist for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy "Authenticated access on portfolio_value_history" on public.portfolio_value_history;
create policy "portfolio_value_history_owner_all" on public.portfolio_value_history for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;

-- ============================================================================
-- Post-migration sanity checks — run these separately, AFTER the commit above
-- succeeds, to confirm nothing was left null/orphaned before you consider this
-- done. Every row count below must be 0.
-- ============================================================================
-- select count(*) from public.accounts where user_id is null;
-- select count(*) from public.trades where user_id is null;
-- select count(*) from public.deposits where user_id is null;
-- select count(*) from public.deposit_schedules where user_id is null;
-- select count(*) from public.trade_schedules where user_id is null;
-- select count(*) from public.account_value_history where user_id is null;
-- select count(*) from public.trade_lot_allocations where user_id is null;
-- select count(*) from public.roth_conversions where user_id is null;
-- select count(*) from public.ai_conversations where user_id is null;
-- select count(*) from public.ai_messages where user_id is null;
-- select count(*) from public.ai_usage_log where user_id is null;
-- select count(*) from public.price_targets where user_id is null;
-- select count(*) from public.tax_settings where user_id is null;
-- select count(*) from public.watchlist where user_id is null;
-- select count(*) from public.portfolio_value_history where user_id is null;
-- select * from public.profiles;  -- should show exactly your row, is_admin = true
