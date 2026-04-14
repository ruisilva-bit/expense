-- Enable RLS
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.transfers enable row level security;
alter table public.goals enable row level security;
alter table public.loans enable row level security;
alter table public.recurring_transactions enable row level security;

-- Helper: membership check
create or replace function public.is_family_member(fid uuid)
returns boolean language sql stable as $$
  select exists(
    select 1 from public.family_members fm where fm.family_id = fid and fm.user_id = auth.uid()
  );
$$;

-- families
create policy "families select" on public.families for select using (is_family_member(id));
create policy "families insert" on public.families for insert with check (auth.uid() is not null);
create policy "families update" on public.families for update using (is_family_member(id));
create policy "families delete" on public.families for delete using (is_family_member(id));

-- family_members
create policy "family_members select" on public.family_members for select using (is_family_member(family_id));
create policy "family_members insert" on public.family_members for insert with check (
  is_family_member(family_id)
  or not exists (select 1 from public.family_members fm where fm.family_id = family_id)
);
create policy "family_members update" on public.family_members for update using (is_family_member(family_id));
create policy "family_members delete" on public.family_members for delete using (is_family_member(family_id));

-- bank_accounts
create policy "bank_accounts select" on public.bank_accounts for select using (is_family_member(family_id));
create policy "bank_accounts insert" on public.bank_accounts for insert with check (is_family_member(family_id));
create policy "bank_accounts update" on public.bank_accounts for update using (is_family_member(family_id));
create policy "bank_accounts delete" on public.bank_accounts for delete using (is_family_member(family_id));

-- categories
create policy "categories select" on public.categories for select using (is_family_member(family_id));
create policy "categories insert" on public.categories for insert with check (is_family_member(family_id));
create policy "categories update" on public.categories for update using (is_family_member(family_id));
create policy "categories delete" on public.categories for delete using (is_family_member(family_id));

-- transactions
create policy "transactions select" on public.transactions for select using (is_family_member(family_id));
create policy "transactions insert" on public.transactions for insert with check (is_family_member(family_id));
create policy "transactions update" on public.transactions for update using (is_family_member(family_id));
create policy "transactions delete" on public.transactions for delete using (is_family_member(family_id));

-- transfers
create policy "transfers select" on public.transfers for select using (is_family_member(family_id));
create policy "transfers insert" on public.transfers for insert with check (is_family_member(family_id));
create policy "transfers update" on public.transfers for update using (is_family_member(family_id));
create policy "transfers delete" on public.transfers for delete using (is_family_member(family_id));

-- goals
create policy "goals select" on public.goals for select using (
  exists(select 1 from public.bank_accounts ba where ba.id = bank_account_id and is_family_member(ba.family_id))
);
create policy "goals insert" on public.goals for insert with check (
  exists(select 1 from public.bank_accounts ba where ba.id = bank_account_id and is_family_member(ba.family_id))
);
create policy "goals update" on public.goals for update using (
  exists(select 1 from public.bank_accounts ba where ba.id = bank_account_id and is_family_member(ba.family_id))
);
create policy "goals delete" on public.goals for delete using (
  exists(select 1 from public.bank_accounts ba where ba.id = bank_account_id and is_family_member(ba.family_id))
);

-- loans
create policy "loans select" on public.loans for select using (is_family_member(family_id));
create policy "loans insert" on public.loans for insert with check (is_family_member(family_id));
create policy "loans update" on public.loans for update using (is_family_member(family_id));
create policy "loans delete" on public.loans for delete using (is_family_member(family_id));

-- recurring
create policy "recurring select" on public.recurring_transactions for select using (is_family_member(family_id));
create policy "recurring insert" on public.recurring_transactions for insert with check (is_family_member(family_id));
create policy "recurring update" on public.recurring_transactions for update using (is_family_member(family_id));
create policy "recurring delete" on public.recurring_transactions for delete using (is_family_member(family_id));
