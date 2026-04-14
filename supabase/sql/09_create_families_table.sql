-- Safety net: create missing family-centric tables if they do not exist
-- Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'family_role') THEN
    CREATE TYPE family_role AS ENUM ('owner','member');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'category_type') THEN
    CREATE TYPE category_type AS ENUM ('income','expense','transfer');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_kind') THEN
    CREATE TYPE transaction_kind AS ENUM ('income','expense','transfer');
  END IF;
END$$;

-- Families
CREATE TABLE IF NOT EXISTS public.families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Family members
CREATE TABLE IF NOT EXISTS public.family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  role family_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Bank accounts
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name text NOT NULL,
  balance numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Categories
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name text NOT NULL,
  type category_type NOT NULL DEFAULT 'expense',
  affects_loan boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(family_id,name,type)
);

-- Transactions
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid REFERENCES public.families(id) ON DELETE CASCADE,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  amount numeric(14,2),
  type transaction_kind,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  description text,
  date date DEFAULT current_date,
  created_at timestamptz DEFAULT now()
);

-- Ensure required columns exist if table pre-existed
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS family_id uuid;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS bank_account_id uuid;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS assigned_to uuid;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS amount numeric(14,2);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS type transaction_kind;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS category_id uuid;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS date date DEFAULT current_date;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_family_fk'
  ) THEN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_family_fk FOREIGN KEY (family_id) REFERENCES public.families(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_bank_fk'
  ) THEN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_bank_fk FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id) ON DELETE CASCADE;
  END IF;
END$$;
ALTER TABLE public.transactions ALTER COLUMN type TYPE transaction_kind USING type::text::transaction_kind;

-- minimal indexes
CREATE INDEX IF NOT EXISTS idx_families_created_at ON public.families(created_at);
CREATE INDEX IF NOT EXISTS idx_family_members_user ON public.family_members(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_family_date ON public.transactions(family_id, date DESC);

-- Goals
CREATE TABLE IF NOT EXISTS public.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_amount numeric(14,2) NOT NULL,
  current_amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS bank_account_id uuid;
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS target_amount numeric(14,2);
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS current_amount numeric(14,2);
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goals_bank_fk') THEN
    ALTER TABLE public.goals ADD CONSTRAINT goals_bank_fk FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id) ON DELETE CASCADE;
  END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_goals_bank ON public.goals(bank_account_id);

-- Transfers
CREATE TABLE IF NOT EXISTS public.transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid REFERENCES public.families(id) ON DELETE CASCADE,
  source_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  dest_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  amount numeric(14,2),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  description text,
  date date DEFAULT current_date,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS family_id uuid;
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS source_account_id uuid;
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS dest_account_id uuid;
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS amount numeric(14,2);
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS date date DEFAULT current_date;
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfers_family_fk') THEN
    ALTER TABLE public.transfers ADD CONSTRAINT transfers_family_fk FOREIGN KEY (family_id) REFERENCES public.families(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfers_source_fk') THEN
    ALTER TABLE public.transfers ADD CONSTRAINT transfers_source_fk FOREIGN KEY (source_account_id) REFERENCES public.bank_accounts(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfers_dest_fk') THEN
    ALTER TABLE public.transfers ADD CONSTRAINT transfers_dest_fk FOREIGN KEY (dest_account_id) REFERENCES public.bank_accounts(id) ON DELETE CASCADE;
  END IF;
END$$;
CREATE INDEX IF NOT EXISTS idx_transfers_family ON public.transfers(family_id);

-- Recurring transactions
CREATE TABLE IF NOT EXISTS public.recurring_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid REFERENCES public.families(id) ON DELETE CASCADE,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  amount numeric(14,2),
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  frequency text,
  next_execution_date date,
  description text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS family_id uuid;
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS bank_account_id uuid;
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS assigned_to uuid;
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS amount numeric(14,2);
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS category_id uuid;
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS frequency text;
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS next_execution_date date;
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.recurring_transactions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_recurring_family ON public.recurring_transactions(family_id);
