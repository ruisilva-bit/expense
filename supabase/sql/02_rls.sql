-- Enable RLS
alter table public.accounts enable row level security;
alter table public.account_members enable row level security;
alter table public.transactions enable row level security;
alter table public.goals enable row level security;
alter table public.loans enable row level security;
alter table public.loan_payments enable row level security;

-- helper function
create or replace function public.is_member(acc uuid)
returns boolean
language sql stable as $$
  select exists (
    select 1 from public.account_members
    where account_id = acc and user_id = auth.uid()
  );
$$;

create policy "account read"   on public.accounts for select using (is_member(id));
create policy "account insert" on public.accounts for insert with check (true);
create policy "account update" on public.accounts for update using (
  exists (select 1 from public.account_members m
          where m.account_id=id and m.user_id=auth.uid() and m.role='owner')
);
create policy "account delete" on public.accounts for delete using (
  exists (select 1 from public.account_members m
          where m.account_id=id and m.user_id=auth.uid() and m.role='owner')
);

-- account_members
create policy "member read" on public.account_members for select using (user_id = auth.uid());
create policy "member insert" on public.account_members for insert with check (
  exists (select 1 from public.account_members m
          where m.account_id=account_id and m.user_id=auth.uid() and m.role='owner')
  or not exists (select 1 from public.account_members m where m.account_id = account_id)
);
create policy "member update" on public.account_members for update using (
  exists (select 1 from public.account_members m
          where m.account_id=account_id and m.user_id=auth.uid() and m.role='owner')
);
create policy "member delete" on public.account_members for delete using (
  exists (select 1 from public.account_members m
          where m.account_id=account_id and m.user_id=auth.uid() and m.role='owner')
  or user_id = auth.uid()
);

-- transactions
create policy "txn read" on public.transactions for select using (is_member(account_id));
create policy "txn insert" on public.transactions for insert with check (is_member(account_id));
create policy "txn update" on public.transactions for update using (
  is_member(account_id) and (user_id = auth.uid() or
    exists (select 1 from public.account_members m
            where m.account_id=account_id and m.user_id=auth.uid() and m.role='owner'))
);
create policy "txn delete" on public.transactions for delete using (
  user_id = auth.uid() or
  exists (select 1 from public.account_members m
          where m.account_id=account_id and m.user_id=auth.uid() and m.role='owner')
);

-- goals
create policy "goals read" on public.goals for select using (
  user_id = auth.uid() or (account_id is not null and is_member(account_id))
);
create policy "goals insert" on public.goals for insert with check (
  user_id = auth.uid() and (account_id is null or is_member(account_id))
);
create policy "goals update" on public.goals for update using (user_id = auth.uid());
create policy "goals delete" on public.goals for delete using (user_id = auth.uid());

-- loans
create policy "loans read" on public.loans for select using (is_member(account_id));
create policy "loans insert" on public.loans for insert with check (is_member(account_id));
create policy "loans update" on public.loans for update using (
  exists (select 1 from public.account_members m
          where m.account_id=account_id and m.user_id=auth.uid() and m.role='owner')
);
create policy "loans delete" on public.loans for delete using (
  exists (select 1 from public.account_members m
          where m.account_id=account_id and m.user_id=auth.uid() and m.role='owner')
);

-- loan payments
create policy "loan_payments read" on public.loan_payments for select using (
  exists (select 1 from public.loans l where l.id=loan_id and is_member(l.account_id))
);
create policy "loan_payments insert" on public.loan_payments for insert with check (
  exists (select 1 from public.loans l where l.id=loan_id and is_member(l.account_id))
);
create policy "loan_payments update" on public.loan_payments for update using (
  exists (select 1 from public.loans l
          join public.account_members m on m.account_id=l.account_id
          where l.id=loan_id and m.user_id=auth.uid() and m.role='owner')
);
create policy "loan_payments delete" on public.loan_payments for delete using (
  exists (select 1 from public.loans l
          join public.account_members m on m.account_id=l.account_id
          where l.id=loan_id and m.user_id=auth.uid() and m.role='owner')
);
