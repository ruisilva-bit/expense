-- Ensure account_members.user_id defaults to current auth user
alter table public.account_members
  alter column user_id set default auth.uid();
