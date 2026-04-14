-- Refactor migration: make transfers internal-only movements
-- Safe/idempotent and data-preserving.

-- 1) Ensure transaction_kind enum has "transfer" when enum type exists.
do $$
begin
  if exists (select 1 from pg_type where typname = 'transaction_kind') then
    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'transaction_kind'
        and e.enumlabel = 'transfer'
    ) then
      alter type public.transaction_kind add value 'transfer';
    end if;
  end if;
exception
  when duplicate_object then null;
end $$;

-- 2) Convert transfer-tagged rows misclassified as income/expense into transfer.
update public.transactions
set type = 'transfer'
where type::text in ('income', 'expense')
  and coalesce(description, '') ~ '\[transfer:[0-9a-fA-F-]{36}(:(source|dest))?\]';

-- 3) Create missing rows in transfers table from tagged transactions.
with tagged as (
  select
    t.id as transaction_id,
    t.family_id,
    t.bank_account_id,
    abs(coalesce(t.amount, 0)::numeric) as amount,
    t.date,
    t.created_by,
    (regexp_match(coalesce(t.description, ''), '\[transfer:([0-9a-fA-F-]{36})'))[1]::uuid as transfer_id,
    case
      when coalesce(t.description, '') ~ '\[transfer:[0-9a-fA-F-]{36}:source\]' then 'source'
      when coalesce(t.description, '') ~ '\[transfer:[0-9a-fA-F-]{36}:dest\]' then 'dest'
      when lower(coalesce(t.description, '')) like '%transfer to%' then 'source'
      when lower(coalesce(t.description, '')) like '%transfer from%' then 'dest'
      else null
    end as side,
    nullif(trim(regexp_replace(coalesce(t.description, ''), '\s*\[transfer:[0-9a-fA-F-]{36}(:(source|dest))?\]\s*', ' ', 'g')), '') as clean_description
  from public.transactions t
  where coalesce(t.description, '') ~ '\[transfer:[0-9a-fA-F-]{36}(:(source|dest))?\]'
),
aggregated as (
  select
    transfer_id,
    max(family_id) as family_id,
    max(bank_account_id) filter (where side = 'source') as source_account_id,
    max(bank_account_id) filter (where side = 'dest') as dest_account_id,
    max(amount) as amount,
    max(date) as date,
    max(created_by) as created_by,
    max(clean_description) as description
  from tagged
  where transfer_id is not null
  group by transfer_id
)
insert into public.transfers (
  id,
  family_id,
  source_account_id,
  dest_account_id,
  amount,
  created_by,
  description,
  date
)
select
  a.transfer_id,
  a.family_id,
  a.source_account_id,
  a.dest_account_id,
  a.amount,
  a.created_by,
  a.description,
  coalesce(a.date, current_date)
from aggregated a
where a.source_account_id is not null
  and a.dest_account_id is not null
  and not exists (
    select 1
    from public.transfers t
    where t.id = a.transfer_id
  );

-- 4) Backfill transfer side tags for old records that only have [transfer:<id>].
with missing_side as (
  select
    t.id,
    tr.id as transfer_id,
    case
      when t.bank_account_id = tr.source_account_id then 'source'
      when t.bank_account_id = tr.dest_account_id then 'dest'
      else null
    end as side
  from public.transactions t
  join public.transfers tr
    on coalesce(t.description, '') like '%[transfer:' || tr.id::text || ']%'
  where coalesce(t.description, '') ~ '\[transfer:[0-9a-fA-F-]{36}\]'
)
update public.transactions t
set description = replace(
  t.description,
  '[transfer:' || m.transfer_id::text || ']',
  '[transfer:' || m.transfer_id::text || ':' || m.side || ']'
)
from missing_side m
where t.id = m.id
  and m.side is not null;
