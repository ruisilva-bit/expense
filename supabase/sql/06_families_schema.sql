-- New family-centric schema
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'family_role') then
    create type family_role as enum ('owner','member');
  end if;
  if not exists (select 1 from pg_type where typname = 'category_type') then
    create type category_type as enum ('income','expense','transfer');
  end if;
  if not exists (select 1 from pg_type where typname = 'transaction_kind') then
    create type transaction_kind as enum ('income','expense','transfer');
  end if;
end$$;

create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  role family_role not null default 'member',
  created_at timestamptz not null default now()
);

alter table public.family_members add column if not exists family_id uuid;
alter table public.family_members add column if not exists user_id uuid;
alter table public.family_members add column if not exists role family_role;

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  balance numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

-- legacy compatibility
alter table public.bank_accounts add column if not exists family_id uuid;
alter table public.bank_accounts add column if not exists balance numeric(14,2) default 0;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  type category_type not null default 'expense',
  affects_loan boolean not null default false,
  created_at timestamptz not null default now(),
  unique(family_id,name,type)
);

-- Ensure legacy compatibility
alter table public.categories add column if not exists family_id uuid;
alter table public.categories add column if not exists type category_type;
alter table public.categories alter column type type category_type using type::text::category_type;
alter table public.categories add column if not exists affects_loan boolean default false;

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references public.family_members(id) on delete set null,
  amount numeric(14,2) not null,
  type transaction_kind not null,
  category_id uuid references public.categories(id) on delete set null,
  description text,
  date date not null,
  created_at timestamptz not null default now()
);

-- If legacy transactions table exists, ensure columns/types are present
alter table public.transactions add column if not exists family_id uuid;
alter table public.transactions add column if not exists bank_account_id uuid;
alter table public.transactions add column if not exists created_by uuid;
alter table public.transactions add column if not exists assigned_to uuid;
alter table public.transactions add column if not exists category_id uuid;
alter table public.transactions add column if not exists description text;
alter table public.transactions add column if not exists created_at timestamptz default now();
alter table public.transactions add column if not exists date date default current_date;
-- convert type enum if legacy exists
alter table public.transactions alter column type type transaction_kind using type::text::transaction_kind;

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  source_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  dest_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  amount numeric(14,2) not null,
  created_by uuid references auth.users(id) on delete set null,
  description text,
  date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  name text not null,
  target_amount numeric(14,2) not null,
  current_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.goals add column if not exists bank_account_id uuid;

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  total_amount numeric(14,2) not null,
  remaining_amount numeric(14,2) not null,
  monthly_payment numeric(14,2) not null,
  created_at timestamptz not null default now()
);

alter table public.loans add column if not exists family_id uuid;
alter table public.loans add column if not exists remaining_amount numeric(14,2) default 0;

create table if not exists public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  bank_account_id uuid not null references public.bank_accounts(id) on delete cascade,
  assigned_to uuid references public.family_members(id) on delete set null,
  amount numeric(14,2) not null,
  category_id uuid references public.categories(id) on delete set null,
  frequency text not null,
  next_execution_date date not null,
  description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.recurring_transactions add column if not exists family_id uuid;
alter table public.recurring_transactions add column if not exists bank_account_id uuid;

-- Indexes for performance
create index if not exists idx_transactions_family_date on public.transactions(family_id, date desc);
create index if not exists idx_transactions_assigned_to on public.transactions(assigned_to);
create index if not exists idx_transactions_bank on public.transactions(bank_account_id);
create index if not exists idx_family_members_user on public.family_members(user_id);
create index if not exists idx_bank_accounts_family on public.bank_accounts(family_id);
create index if not exists idx_categories_family on public.categories(family_id);
create index if not exists idx_transfers_family on public.transfers(family_id);
create index if not exists idx_recurring_family on public.recurring_transactions(family_id);
