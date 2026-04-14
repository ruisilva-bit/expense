-- Enums (safe create)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_type') then
    create type account_type as enum ('personal','joint');
  end if;
  if not exists (select 1 from pg_type where typname = 'member_role') then
    create type member_role as enum ('owner','member');
  end if;
  if not exists (select 1 from pg_type where typname = 'transaction_type') then
    create type transaction_type as enum ('expense','income');
  end if;
end$$;

-- accounts
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type account_type not null default 'personal',
  created_at timestamptz not null default now()
);

-- account_members
create table if not exists public.account_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null default 'member',
  created_at timestamptz not null default now(),
  unique(account_id, user_id)
);

-- transactions
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  type transaction_type not null,
  category text not null,
  description text,
  date date not null,
  split_details jsonb,
  created_at timestamptz not null default now()
);

-- goals
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  name text not null,
  target_amount numeric(12,2) not null check (target_amount > 0),
  current_amount numeric(12,2) not null default 0 check (current_amount >= 0),
  deadline date,
  created_at timestamptz not null default now()
);

-- loans
create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  total_amount numeric(14,2) not null,
  monthly_payment numeric(14,2) not null,
  created_at timestamptz not null default now()
);

-- loan_payments
create table if not exists public.loan_payments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_at date not null,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_account_members_user on public.account_members(user_id);
create index if not exists idx_account_members_account on public.account_members(account_id);
create index if not exists idx_transactions_account_date on public.transactions(account_id, date);
create index if not exists idx_goals_user_account on public.goals(user_id, account_id);
create index if not exists idx_loan_payments_date on public.loan_payments(loan_id, paid_at);
