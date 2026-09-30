-- Adds a per-user permission gate for the AI Companion feature (it costs
-- real Anthropic API money per use, unlike everything else in /admin's
-- Users tab) — RUN MANUALLY in the Supabase SQL editor, same reasoning as
-- _manual_multi_user_migration.sql.
--
-- New accounts default to false (no access) per product decision — an admin
-- explicitly grants it per user from Admin > Users. The owner is backfilled
-- to true since they're already using the feature.

alter table public.profiles
  add column can_use_ai_companion boolean not null default false;

update public.profiles
set can_use_ai_companion = true
where user_id = '8d5499ce-20a6-4515-abec-c3bbea66718a';

-- Belt-and-suspenders after any raw DDL against this table — a stale
-- PostgREST schema cache caused a very confusing false "can't reach admin"
-- bug earlier in this project's history the first time profiles changed
-- shape outside a proper migration tool.
NOTIFY pgrst, 'reload schema';
