-- Safe migration: ensure shared category colors are persisted in DB
alter table if exists public.categories
  add column if not exists color text;

update public.categories
set color = null
where color is not null
  and color !~ '^#[0-9a-fA-F]{6}$';

update public.categories
set color = lower(color)
where color is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'categories_color_hex_check'
  ) then
    alter table public.categories
      add constraint categories_color_hex_check
      check (color is null or color ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;
