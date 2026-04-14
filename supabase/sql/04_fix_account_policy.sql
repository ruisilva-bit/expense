-- Update account read policy to allow creator visibility
alter policy "account read" on public.accounts
  using (is_member(id) or created_by = auth.uid());
