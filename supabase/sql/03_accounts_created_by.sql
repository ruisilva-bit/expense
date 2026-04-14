-- Add created_by to accounts so creator can see the row for RETURNING and bootstrap membership
alter table public.accounts
  add column if not exists created_by uuid references auth.users(id) default auth.uid();

-- index for quick filtering
create index if not exists idx_accounts_created_by on public.accounts(created_by);
