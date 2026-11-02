-- Sprint 1, approved ADR-022. No authentication flows or scheduling tables.
create extension if not exists citext with schema extensions;

create schema app authorization postgres;
create schema api authorization postgres;
create schema app_internal authorization postgres;

create role app_server nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 5;
alter role app_server set statement_timeout = '5s';
alter role app_server set lock_timeout = '3s';
alter role app_server set idle_in_transaction_session_timeout = '10s';

revoke all on schema app, api, app_internal from public, anon, authenticated, service_role, app_server;
revoke create on schema public from public, anon, authenticated, app_server;
grant usage on schema public to authenticated, app_server;
grant usage on schema app to authenticated;
grant usage on schema app_internal to app_server;

alter default privileges for role postgres in schema app, api, app_internal
  revoke execute on functions from public, anon, authenticated, service_role, app_server;
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role, app_server;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated, service_role, app_server;

create function app.is_valid_business_slug(p_slug text)
returns boolean language sql immutable strict set search_path = '' as $$
  select p_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
    and p_slug not in ('api', 'app', 'admin', 'b');
$$;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique check (app.is_valid_business_slug(slug::text)),
  name text not null check (length(btrim(name)) > 0),
  legal_name text,
  tax_id text,
  phone text,
  address_line text,
  city text,
  region text,
  country char(2) not null default 'AR',
  timezone text not null default 'America/Argentina/Buenos_Aires',
  logo_path text,
  status text not null default 'active' check (status in ('active','suspended','archived')),
  plan_id uuid,
  billing_customer_ref text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.business_settings (
  business_id uuid primary key references public.businesses(id),
  slot_interval_minutes smallint not null default 15 check (slot_interval_minutes in (5,10,15,20,30,60)),
  min_notice_minutes integer not null default 60 check (min_notice_minutes >= 0),
  max_advance_days integer not null default 30 check (max_advance_days between 1 and 365),
  cancellation_cutoff_hours integer not null default 2 check (cancellation_cutoff_hours >= 0),
  reschedule_cutoff_hours integer not null default 2 check (reschedule_cutoff_hours >= 0),
  max_client_reschedules smallint not null default 2 check (max_client_reschedules >= 0),
  auto_confirm boolean not null default true,
  pending_hold_minutes integer not null default 10 check (pending_hold_minutes > 0),
  allow_any_staff boolean not null default true,
  require_email boolean not null default false,
  public_booking_enabled boolean not null default true,
  barber_can_edit_availability boolean not null default false,
  max_active_bookings_per_customer smallint not null default 3 check (max_active_bookings_per_customer > 0),
  reminder_offsets_minutes integer[] not null default '{1440,120}' check (0 < all(reminder_offsets_minutes)),
  locale text not null default 'es-AR',
  currency char(3) not null default 'ARS' check (currency ~ '^[A-Z]{3}$'),
  branding jsonb not null default '{}' check (jsonb_typeof(branding) = 'object'),
  privacy_policy_version text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Global identity is not a tenant table. Populated by maintenance, not an Auth hook.
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email extensions.citext not null unique,
  full_name text,
  phone text,
  avatar_path text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  user_id uuid references public.users(id),
  invited_email extensions.citext,
  role text not null check (role in ('owner','admin','barber')),
  status text not null default 'active' check (status in ('invited','active','suspended')),
  invited_by uuid references public.users(id),
  accepted_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  check (user_id is not null or invited_email is not null),
  check (status <> 'active' or user_id is not null)
);
create unique index business_members_user_unique on public.business_members (business_id, user_id) where user_id is not null;
create index business_members_user_lookup on public.business_members (user_id, business_id) where status = 'active';

create function app.touch_record()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.created_at is distinct from old.created_at
    or (to_jsonb(new)->'id') is distinct from (to_jsonb(old)->'id')
    or (to_jsonb(new)->'business_id') is distinct from (to_jsonb(old)->'business_id') then
    raise exception 'Record identity is immutable' using errcode = '23514';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;
create trigger businesses_touch before update on public.businesses for each row execute function app.touch_record();
create trigger settings_touch before update on public.business_settings for each row execute function app.touch_record();
create trigger users_touch before update on public.users for each row execute function app.touch_record();
create trigger members_touch before update on public.business_members for each row execute function app.touch_record();

create function app.validate_business_timezone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid business timezone' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger business_timezone before insert or update of timezone on public.businesses
  for each row execute function app.validate_business_timezone();

-- Maintenance-only writes still cannot demote/remove the last active owner.
create function app.protect_last_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform 1 from public.businesses where id = old.business_id for update;
  if old.role = 'owner' and old.status = 'active'
    and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active'
      or new.user_id is distinct from old.user_id) then
    if not exists (select 1 from public.business_members
      where business_id = old.business_id and id <> old.id and role = 'owner' and status = 'active') then
      raise exception 'Cannot remove the last active owner' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger protect_owner before update or delete on public.business_members
  for each row execute function app.protect_last_owner();

alter table public.businesses enable row level security;
alter table public.businesses force row level security;
alter table public.business_settings enable row level security;
alter table public.business_settings force row level security;
alter table public.users enable row level security;
alter table public.users force row level security;
alter table public.business_members enable row level security;
alter table public.business_members force row level security;

-- The only authenticated definer helper; returns a boolean, never member data.
-- postgres intentionally bypasses membership RLS to avoid recursive policies.
create function app.is_active_member(p_business_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    join public.users u on u.id = m.user_id
    where m.business_id = p_business_id and m.user_id = auth.uid()
      and m.status = 'active' and u.deleted_at is null
  );
$$;

create policy businesses_member_read on public.businesses for select to authenticated
  using (deleted_at is null and (select app.is_active_member(id)));
create policy settings_member_read on public.business_settings for select to authenticated
  using ((select app.is_active_member(business_id))
    and exists (select 1 from public.businesses b where b.id = business_id));
create policy users_self_read on public.users for select to authenticated
  using (id = (select auth.uid()) and deleted_at is null);
create policy members_self_read on public.business_members for select to authenticated
  using (user_id = (select auth.uid()));

create function app_internal.get_public_business(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'slug', b.slug::text, 'name', b.name, 'timezone', b.timezone,
    'phone', b.phone, 'address_line', b.address_line, 'city', b.city,
    'region', b.region, 'country', b.country, 'logo_path', b.logo_path,
    'locale', s.locale, 'currency', s.currency
  ) from public.businesses b join public.business_settings s on s.business_id = b.id
  where app.is_valid_business_slug(p_slug) and b.slug = p_slug
    and b.status = 'active' and b.deleted_at is null and s.public_booking_enabled;
$$;

-- Maintenance bootstrap, SECURITY INVOKER and no API grants. Does not create members.
create function app.create_business(p_slug text, p_name text)
returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.businesses(slug,name) values (p_slug,p_name)
    on conflict (slug) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.businesses where slug = p_slug;
  end if;
  insert into public.business_settings(business_id) values (v_id) on conflict do nothing;
  return v_id;
end;
$$;

revoke all on public.businesses, public.business_settings, public.users, public.business_members
  from public, anon, authenticated, service_role, app_server;
grant select on public.businesses, public.business_settings, public.users, public.business_members to authenticated;
revoke all on all functions in schema app, api, app_internal
  from public, anon, authenticated, service_role, app_server;
grant execute on function app.is_active_member(uuid) to authenticated;
grant execute on function app_internal.get_public_business(text) to app_server;
