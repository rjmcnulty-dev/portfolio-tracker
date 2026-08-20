# Migrating a Supabase/React MVP to ASP.NET Core + SQL

Notes on the general path for converting an app built on this stack (React + Vite,
Supabase Postgres/Auth/Edge Functions, GitHub Actions cron, GitHub Pages) to
C# ASP.NET Core with a SQL backend — written for "vibe coded" MVPs that want to move to a
more traditional enterprise stack later, not specific to this app's schema.

## The core idea: strangler-fig, not a rewrite

Replace one slice of the stack at a time while the app stays shippable throughout, rather
than a big-bang rewrite. The steps below are ordered specifically so the one genuinely hard
part (RLS → application-level authorization) is isolated from everything else, which is
largely mechanical translation.

## 1. Keep the database engine, swap the language first

Supabase is Postgres underneath. Target Npgsql + EF Core against that *same* Postgres
instance rather than also migrating to SQL Server in the same step — Postgres → Postgres is
a `pg_dump`/restore; Postgres → SQL Server means translating `jsonb` columns, RLS policies,
and any Postgres-specific functions, which is a second, separate project. Only move engines
later if there's a concrete reason (team is SQL Server-only, licensing, etc.).

## 2. Port serverless functions to Controllers/minimal APIs

This is the easy, mechanical part. Supabase Edge Functions are already small, single-purpose
serverless functions — each one becomes roughly one ASP.NET Core endpoint (minimal API or a
thin controller action), same request/response shape.

## 3. Redesign RLS as application-level authorization

This is the part that actually changes shape, not just syntax. Postgres RLS policies (e.g.
`using (true)` for public reads, `auth.role() = 'authenticated'` for writes) don't have a
direct EF Core equivalent — they become authorization middleware/policies in the API layer
(`[Authorize]` policies, or a filter that scopes queries per-request). Budget real design time
here; treat it as a redesign, not a port.

## 4. Auth

Supabase Auth → ASP.NET Core Identity, or an external IdP (Auth0, Azure AD B2C). Both are
JWT-based, so the frontend's token handling (attach bearer token, refresh on expiry) barely
changes regardless of which you pick.

## 5. Leave the frontend alone — for now

Point the existing React app at the new C# API instead of the Supabase client SDK, table by
table, rather than rewriting UI and backend at the same time. A full move to Blazor (if
desired at all) is a separate, later decision — don't couple it to the backend migration.

## 6. Cron jobs

GitHub Actions running Node scripts → Quartz.NET, or Azure Functions with timer triggers.
Again close to a 1:1 port — same schedule, same job logic, different runtime.

## 7. Hosting

GitHub Pages only serves static files, so once there's a real C# backend, hosting has to
move too (Azure App Service, AWS, a VM, etc.) — the frontend build output can still be
served as static files from wherever the API lives, or continue to live separately.

## Suggested order of operations

1. Stand up the ASP.NET Core API against the existing Supabase Postgres DB (steps 1–2).
2. Design and implement authorization to replace RLS (step 3) — do this before flipping any
   real traffic over, since it's the part most likely to leak data if rushed.
3. Swap auth (step 4).
4. Migrate the frontend's data calls from the Supabase SDK to the new API, one
   feature/table at a time (step 5) — the app keeps working throughout.
5. Port cron jobs (step 6).
6. Cut over hosting and retire the Supabase project (step 7).
