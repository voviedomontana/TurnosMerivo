begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Harness-only access to pgTAP, rolled back below; not an application grant.
grant usage on schema extensions to app_server;
select no_plan();

select has_table('public', 'businesses', 'tenant root exists');
select has_table('public', 'business_settings', 'settings exist');
select has_table('public', 'users', 'minimal identity profile exists');
select has_table('public', 'business_members', 'minimal membership exists');

insert into auth.users (id, email) values
 ('00000000-0000-4000-8000-000000000001', 'owner-a@example.test'),
 ('00000000-0000-4000-8000-000000000002', 'owner-b@example.test'),
 ('00000000-0000-4000-8000-000000000003', 'multi@example.test'),
 ('00000000-0000-4000-8000-000000000004', 'suspended@example.test'),
 ('00000000-0000-4000-8000-000000000005', 'outsider@example.test');
insert into public.users (id, email)
select id, email from auth.users where email like '%@example.test' on conflict(id) do nothing;

insert into public.businesses (id, slug, name) values
 ('10000000-0000-4000-8000-000000000001', 'test-alpha', 'Alpha'),
 ('10000000-0000-4000-8000-000000000002', 'test-bravo', 'Bravo'),
 ('10000000-0000-4000-8000-000000000003', 'test-closed', 'Closed'),
 ('10000000-0000-4000-8000-000000000004', 'test-suspended', 'Suspended'),
 ('10000000-0000-4000-8000-000000000005', 'test-deleted', 'Deleted');
insert into public.business_settings (business_id) select id from public.businesses
 where id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
 '10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005');
update public.business_settings set public_booking_enabled = false
 where business_id = '10000000-0000-4000-8000-000000000003';
update public.businesses set status = 'suspended'
 where id = '10000000-0000-4000-8000-000000000004';
update public.businesses set deleted_at = now()
 where id = '10000000-0000-4000-8000-000000000005';
insert into public.business_members (business_id, user_id, role, status) values
 ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'owner', 'active'),
 ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'owner', 'active'),
 ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'barber', 'active'),
 ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 'admin', 'active'),
 ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', 'barber', 'suspended');

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
 where oid in ('public.businesses'::regclass, 'public.business_settings'::regclass,
 'public.users'::regclass, 'public.business_members'::regclass)), 'all application tables enable and force RLS');
select ok(not (select rolbypassrls or rolsuper or rolcreaterole or rolcreatedb or rolreplication
 from pg_roles where rolname = 'app_server'), 'technical role has no elevated attributes');
select ok(not pg_has_role('app_server', 'postgres', 'MEMBER'), 'technical role cannot become postgres');
select ok(not pg_has_role('app_server', 'authenticated', 'MEMBER'), 'technical role cannot impersonate sessions');
select ok(not has_schema_privilege('authenticated', 'app_internal', 'USAGE'), 'session cannot access internal schema');
select ok(not has_schema_privilege('anon', 'app_internal', 'USAGE'), 'anon cannot access internal schema');
select ok(not has_function_privilege('app_server', 'app.is_active_member(uuid)', 'EXECUTE'), 'server cannot call membership helper');
select ok(not has_function_privilege('anon', 'app.is_active_member(uuid)', 'EXECUTE'), 'anon cannot call membership helper');
select ok(not has_function_privilege('authenticated', 'app_internal.get_public_business(text)', 'EXECUTE'), 'session cannot call backend operation');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
 lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
 where n.nspname in ('app', 'api', 'app_internal') and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'no PUBLIC execute on application functions');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
 join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('app', 'app_internal') and p.prosecdef), 'definer search_path is empty');

-- Verified-session fixture for existing S1 read assertions; S2 tests cover aal1 separately.
set local "request.jwt.claims" = '{"aal":"aal2"}';
set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000001';
select is(current_user::text, 'authenticated', 'assertions run as the actual non-bypass API role');
select throws_ok($$select count(*) from public.businesses$$, '42501', null, 'private table reads require the authorized projection');
select throws_ok($$select count(*) from public.business_settings$$, '42501', null, 'private table reads require the authorized projection');
select is((select count(*) from public.users), 1::bigint, 'profile is self-only');
select is((select count(*) from public.business_members), 1::bigint, 'membership list is self-only without recursive RLS');
select throws_ok($$select count(*) from public.businesses where slug='test-bravo'$$, '42501', null, 'private table reads require the authorized projection');
select ok(app.is_active_member('10000000-0000-4000-8000-000000000001'), 'membership helper accepts own active membership');
select ok(not app.is_active_member('10000000-0000-4000-8000-000000000002'), 'membership helper rejects another tenant');
select throws_ok($$insert into public.businesses (slug,name) values ('illegal','Illegal')$$, '42501', null, 'session cannot create tenants directly');
select throws_ok($$update public.businesses set name='Changed'$$, '42501', null, 'session cannot update even its own tenant directly');
select throws_ok($$delete from public.business_settings$$, '42501', null, 'session cannot delete settings');
select throws_ok($$update public.business_members set role='owner'$$, '42501', null, 'session cannot promote itself');
select throws_ok($$insert into public.business_members(business_id,user_id,role) values ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','owner')$$, '42501', null, 'session cannot add itself to another tenant');
select throws_ok($$select app_internal.get_public_business('test-alpha')$$, '42501', null, 'session cannot invoke internal function directly');
select throws_ok($$select app.create_business('new-tenant','New')$$, '42501', null, 'session cannot invoke maintenance bootstrap');

set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000002';
select throws_ok($$select slug::text from public.businesses$$, '42501', null, 'private table reads require the authorized projection');
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000003';
select throws_ok($$select count(*) from public.businesses$$, '42501', null, 'private table reads require the authorized projection');
select is((select count(*) from public.business_members), 2::bigint, 'multi-member sees only its memberships');
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000004';
select throws_ok($$select count(*) from public.businesses$$, '42501', null, 'private table reads require the authorized projection');
select throws_ok($$select count(*) from public.business_settings$$, '42501', null, 'private table reads require the authorized projection');
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000005';
select throws_ok($$select count(*) from public.businesses$$, '42501', null, 'private table reads require the authorized projection');
set local "request.jwt.claim.sub" = '';
select throws_ok($$select count(*) from public.businesses$$, '42501', null, 'private table reads require the authorized projection');
reset role;

update public.business_members set status='suspended'
 where user_id='00000000-0000-4000-8000-000000000003'
 and business_id='10000000-0000-4000-8000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000003';
select throws_ok($$select count(*) from public.businesses$$, '42501', null, 'private table reads require the authorized projection');
reset role;

set local role anon;
select throws_ok($$select * from public.businesses$$, '42501', null, 'anon cannot query tenant tables');
select throws_ok($$select app_internal.get_public_business('test-alpha')$$, '42501', null, 'anon cannot execute internal public read');
reset role;

set local role app_server;
select is(current_user::text, 'app_server', 'backend assertions run with restricted role');
select throws_ok($$select * from public.businesses$$, '42501', null, 'backend cannot read tables directly');
select throws_ok($$insert into public.businesses(slug,name) values ('bad-server','Bad')$$, '42501', null, 'backend cannot write tables');
select is(app_internal.get_public_business('test-alpha')->>'name', 'Alpha', 'backend can read allowed public business');
select ok(not (app_internal.get_public_business('test-alpha') ? 'tax_id'), 'public read does not return fiscal data');
select ok(not (app_internal.get_public_business('test-alpha') ? 'max_active_bookings_per_customer'), 'public read does not return internal settings');
select is(app_internal.get_public_business('test-closed'), null::jsonb, 'disabled booking is not public');
select is(app_internal.get_public_business('test-suspended'), null::jsonb, 'suspended tenant is not public');
select is(app_internal.get_public_business('test-deleted'), null::jsonb, 'deleted tenant is not public');
select is(app_internal.get_public_business('not-found'), null::jsonb, 'missing tenant has same absent result');
select is(app_internal.get_public_business('ADMIN'), null::jsonb, 'invalid slug cannot bypass backend validation');
reset role;

select throws_ok($$insert into public.businesses(slug,name) values ('api','Reserved')$$, '23514', null, 'reserved slug is rejected in database');
select throws_ok($$insert into public.businesses(slug,name) values ('Mixed-Case','Invalid')$$, '23514', null, 'database rejects uppercase slugs');
select throws_ok($$insert into public.businesses(slug,name,timezone) values ('bad-zone','Invalid','Invalid/Zone')$$, '23514', null, 'database validates IANA timezone');
select throws_ok($$insert into public.business_settings(business_id) values ('90000000-0000-4000-8000-000000000001')$$, '23503', null, 'settings cannot reference a missing tenant');
select throws_ok($$update public.business_members set role='barber' where user_id='00000000-0000-4000-8000-000000000001'$$, 'PT409', 'LAST_OWNER', 'maintenance cannot remove the last active owner');
select throws_ok($$update public.business_settings set slot_interval_minutes=7 where business_id='10000000-0000-4000-8000-000000000001'$$, '23514', null, 'invalid slot policy is rejected');
select is(app.create_business('bootstrap-test','Bootstrap'), app.create_business('bootstrap-test','Bootstrap'), 'maintenance bootstrap is idempotent');
select is((select count(*) from public.business_settings s join public.businesses b on b.id=s.business_id where b.slug='bootstrap-test'), 1::bigint, 'bootstrap creates exactly one settings row');
select is((select version from public.business_settings where business_id='10000000-0000-4000-8000-000000000003'), 2, 'maintenance update increments version once');
select throws_ok($$update public.business_members set business_id='10000000-0000-4000-8000-000000000002' where user_id='00000000-0000-4000-8000-000000000003' and business_id='10000000-0000-4000-8000-000000000001'$$, '23514', null, 'even maintenance cannot move a membership across tenants');
create table app.membership_reference_probe (
  business_id uuid, member_id uuid,
  foreign key (business_id,member_id) references public.business_members(business_id,id)
);
select throws_ok($$insert into app.membership_reference_probe select '10000000-0000-4000-8000-000000000002',id from public.business_members where user_id='00000000-0000-4000-8000-000000000001'$$, '23503', null, 'composite membership reference rejects a different tenant');
select lives_ok($$insert into app.membership_reference_probe select business_id,id from public.business_members where user_id='00000000-0000-4000-8000-000000000001'$$, 'composite membership reference accepts its actual tenant');

select ok(not exists (
  select 1 from unnest(array['anon','app_server','service_role']) r
  cross join unnest(array['businesses','business_settings','users','business_members']) t
  where has_table_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
), 'non-session application roles have no table privileges');
select ok(not exists (
  select 1 from unnest(array['businesses','business_settings','users','business_members']) t
  where has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
), 'session table privileges are read-only across every base table');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('app','api','app_internal') and p.prosecdef), 42::bigint, 'the S1/S2 and security-fix catalogued definer capabilities exist');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('app','api','app_internal') and p.proowner <> 'postgres'::regrole), 'application functions retain their reviewed owner');

-- Probe actual future-object defaults, not just the ACLs of today's functions.
create function app.default_acl_probe() returns integer language sql as $$select 1$$;
select ok(not exists(select 1 from pg_proc p,
 lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where p.oid='app.default_acl_probe()'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'), 'future application functions do not inherit PUBLIC execute');
create table public.default_acl_probe(id integer);
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role','app_server']) r
 where has_table_privilege(r, 'public.default_acl_probe', 'SELECT,INSERT,UPDATE,DELETE')), 'future public tables require explicit application grants');

select * from finish();
rollback;
