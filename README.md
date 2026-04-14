# Expense Tracker (Supabase + Next.js)

Multi-user expense tracking with families, bank accounts, and shared members. Uses Supabase Auth/DB/RLS and Next.js 16 + Tailwind.

## Stack
- Next.js App Router, TypeScript, RSC-first
- Tailwind CSS v4
- Supabase Auth, Postgres, RLS
- Supabase Edge Functions (`create-transaction`, `recurring-runner`)
- Recharts for charts

## Setup
1. Install deps
```bash
npm install
```
2. Environment (`.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_URL=...            # optional fallback
SUPABASE_ANON_KEY=...       # optional fallback
```
3. Database migrations (run in order)
```
01_schema.sql
02_rls.sql
03_accounts_created_by.sql
04_fix_account_policy.sql
05_account_members_default.sql
06_families_schema.sql
07_families_rls.sql
08_migrate_old_to_families.sql
```
4. Edge functions
```bash
supabase functions deploy create-transaction
supabase functions deploy recurring-runner
```
Schedule `recurring-runner` via Supabase cron to run daily.

## Notable features
- Family model with real/fictitious members, bank accounts, categories, recurring transactions
- Step-based transaction wizard (IN/OUT/TRANSFER → member → account → amount → category)
- Dashboard with totals, per-member/category charts, pagination, EUR formatting
- Persistent auth (Supabase JS with localStorage, auto refresh)
- RLS strictly scoped by family membership

## Performance
- Server components for data fetching
- Pagination on transactions (20/page)
- Indexes on family_id/account_id/date/etc
- Loading skeletons for dashboard

## Currency
- Stored as numeric; formatted as EUR using `Intl.NumberFormat('pt-PT', 'EUR')`

## CRUD status
- Families, members, bank accounts, categories, transactions created via UI; goals/loans tables exist (UI minimal) and can be extended.

## Background jobs
- `recurring-runner` materializes due recurring transactions and advances next date.

