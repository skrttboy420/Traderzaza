-- =============================================================================
-- Provision a profile when an account is created
--
-- 0001_init.sql defines `users`, `user_settings` and `watchlists`, all keyed on
-- auth.users(id), but nothing creates those rows. That left a gap the app would
-- have had to paper over: the client would need three inserts immediately after
-- signup, each of which can fail independently, leaving an account that exists
-- in auth.users with no settings row and no obvious way to notice.
--
-- A trigger closes it properly. Signup becomes one atomic operation — if the
-- profile cannot be written the account is not created either — and it holds
-- for accounts made any other way too: the dashboard, the admin API, a seed
-- script. Client code then never has to know that provisioning is a thing.
--
-- Accounts are username-only (see apps/web/src/lib/supabase.ts). The username
-- is the local part of a synthetic `<username>@traderzaza.invalid` address and
-- is also passed in user_metadata at signup; this reads the metadata first and
-- falls back to splitting the address, so a user created without metadata still
-- gets a sensible display name instead of a null.
-- =============================================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
-- security definer because the trigger fires in the context of the signup
-- request, which has no rights on public.users. search_path is pinned for the
-- usual reason: a definer function that resolves names through the caller's
-- search_path is a privilege-escalation hole.
security definer
set search_path = public
as $$
declare
  resolved_username text;
  resolved_locale app_locale;
begin
  resolved_username := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  if resolved_username is null then
    resolved_username := split_part(new.email, '@', 1);
  end if;

  -- The app defaults to Thai (§65) and that is the column default too, but an
  -- account created while the user was reading in English should keep English.
  begin
    resolved_locale := coalesce(
      nullif(new.raw_user_meta_data ->> 'locale', '')::app_locale,
      'th'::app_locale
    );
  exception when invalid_text_representation then
    resolved_locale := 'th'::app_locale;
  end;

  insert into users (id, email, display_name, locale)
  values (new.id, new.email, resolved_username, resolved_locale)
  -- on conflict do nothing rather than an error: re-running this migration, or
  -- a backfill that races the trigger, must not break signup.
  on conflict (id) do nothing;

  insert into user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  -- A default watchlist so the first screen the user opens is not empty. The
  -- six instruments are the ones the engine is tuned for (§3).
  insert into watchlists (user_id, name, symbols, is_default)
  values (
    new.id,
    'default',
    array['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSDT', 'ETHUSDT'],
    true
  )
  on conflict (user_id, name) do nothing;

  return new;
end;
$$;

comment on function handle_new_user is
  'Creates the users / user_settings / watchlists rows for a new auth.users row. See 0002_auth_profile.sql.';

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function handle_new_user();

-- -----------------------------------------------------------------------------
-- Keep the mirrored email in step
--
-- users.email is a copy, and a copy that can go stale is worse than no copy.
-- Supabase lets an address change (the admin API can rewrite it), so mirror the
-- update rather than letting the two drift apart silently.
-- -----------------------------------------------------------------------------

create or replace function handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update users set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function handle_user_email_change();

-- -----------------------------------------------------------------------------
-- Backfill
--
-- For accounts that already exist from before this migration. Same statements
-- the trigger runs, so an account provisioned either way is identical.
-- -----------------------------------------------------------------------------

insert into users (id, email, display_name)
select
  au.id,
  au.email,
  coalesce(
    nullif(trim(au.raw_user_meta_data ->> 'username'), ''),
    split_part(au.email, '@', 1)
  )
from auth.users au
on conflict (id) do nothing;

insert into user_settings (user_id)
select id from users
on conflict (user_id) do nothing;

insert into watchlists (user_id, name, symbols, is_default)
select
  id,
  'default',
  array['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSDT', 'ETHUSDT'],
  true
from users
on conflict (user_id, name) do nothing;
