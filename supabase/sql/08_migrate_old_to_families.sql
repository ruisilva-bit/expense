-- Migration script to move legacy accounts/account_members/transactions into families model
-- 1) Build family map once
drop table if exists tmp_family_map;
create temporary table tmp_family_map as
  with new_families as (
    insert into public.families (name)
    select distinct name || ' Family' from public.accounts
    returning id, name
  )
  select a.id as old_account_id, f.id as family_id
  from public.accounts a
  join new_families f on f.name = a.name || ' Family';

-- 2) Members
insert into public.family_members (family_id, user_id, name, role)
select fm.family_id,
       am.user_id,
       coalesce(u.email, 'member'),
       (case when am.role='owner' then 'owner' else 'member' end)::family_role
from public.account_members am
join tmp_family_map fm on fm.old_account_id = am.account_id
left join auth.users u on u.id = am.user_id
on conflict do nothing;

-- 3) Bank accounts from old accounts
insert into public.bank_accounts (id, family_id, name, balance)
select a.id, fm.family_id, a.name, 0
from public.accounts a
join tmp_family_map fm on fm.old_account_id = a.id
on conflict do nothing;

-- 4) Categories: create per family distinct category from transactions
insert into public.categories (family_id, name, type)
select distinct fm.family_id,
       t.category,
       (case when t.type = 'income' then 'income'
             when t.type = 'expense' then 'expense'
             else 'transfer' end)::category_type
from public.transactions t
join tmp_family_map fm on fm.old_account_id = t.account_id
where t.category is not null
on conflict do nothing;

-- 5) Transactions
insert into public.transactions (id, family_id, bank_account_id, created_by, assigned_to, amount, type, category_id, description, date)
select t.id,
       fm.family_id,
       t.account_id,
       t.user_id,
       null,
       t.amount,
       (case when t.type = 'income' then 'income'
             when t.type = 'expense' then 'expense'
             else 'transfer' end)::transaction_kind,
       c.id,
       t.description,
       t.date
from public.transactions t
join tmp_family_map fm on fm.old_account_id = t.account_id
left join public.categories c on c.family_id = fm.family_id and c.name = t.category and c.type = (
  case when t.type = 'income' then 'income'
       when t.type = 'expense' then 'expense'
       else 'transfer' end
)::category_type
on conflict do nothing;

-- 6) Goals -> attach to bank accounts
insert into public.goals (id, bank_account_id, name, target_amount, current_amount)
select g.id, coalesce(g.account_id, fm.old_account_id), g.name, g.target_amount, g.current_amount
from public.goals g
left join tmp_family_map fm on fm.old_account_id = g.account_id
on conflict do nothing;

-- Note: loans and loan_payments are not migrated here; manual recreation may be needed.
