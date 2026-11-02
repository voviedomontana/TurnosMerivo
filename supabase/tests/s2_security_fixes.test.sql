begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Test harness only; rolled back with all fixtures.
grant usage on schema extensions to app_server;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
 ('03000000-0000-4000-8000-000000000001','fix-owner-a@example.test',now()),
 ('03000000-0000-4000-8000-000000000002','fix-owner-b@example.test',now()),
 ('03000000-0000-4000-8000-000000000003','fix-admin@example.test',now()),
 ('03000000-0000-4000-8000-000000000004','fix-barber@example.test',now());
insert into public.businesses(id,slug,name,tax_id,legal_name,billing_customer_ref) values
 ('13000000-0000-4000-8000-000000000001','fix-alpha','Alpha','PRIVATE-TAX-A','PRIVATE-LEGAL-A','PRIVATE-BILLING-A'),
 ('13000000-0000-4000-8000-000000000002','fix-bravo','Bravo','PRIVATE-TAX-B','PRIVATE-LEGAL-B','PRIVATE-BILLING-B');
insert into public.business_settings(business_id,privacy_policy_version) values
 ('13000000-0000-4000-8000-000000000001','PRIVATE-POLICY-A'),
 ('13000000-0000-4000-8000-000000000002','PRIVATE-POLICY-B');
insert into public.business_members(id,business_id,user_id,role) values
 ('23000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001','03000000-0000-4000-8000-000000000001','owner'),
 ('23000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000002','03000000-0000-4000-8000-000000000002','owner'),
 ('23000000-0000-4000-8000-000000000003','13000000-0000-4000-8000-000000000001','03000000-0000-4000-8000-000000000003','admin'),
 ('23000000-0000-4000-8000-000000000004','13000000-0000-4000-8000-000000000001','03000000-0000-4000-8000-000000000004','barber');

select ok(not exists (
  select 1 from unnest(array['anon','authenticated','app_server','service_role']) r
  cross join unnest(array['businesses','business_settings']) t
  where has_table_privilege(r,'public.'||t,'SELECT')
    or has_any_column_privilege(r,'public.'||t,'SELECT')
),'no application role has table or column SELECT on private configuration');
select ok(not exists (
  select 1 from unnest(array['anon','app_server','service_role']) r
  where has_function_privilege(r,'api.read_business_private(uuid)','EXECUTE')
),'private RPC does not expand anonymous or technical-role capabilities');
select ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','api','app','app_internal') and c.relkind in ('v','m')
),'no alternate application view exposes private tables');
select set_eq($$select p.proname::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='api' and has_function_privilege('authenticated',p.oid,'EXECUTE')$$,
 $$values ('me'),('list_members'),('invite_member'),('update_member'),('accept_invitation'),('manage_invitation'),('read_business_private'),('prepare_member_auth_invite'),('list_members_page'),('write_catalog'),('list_catalog'),('write_customer'),('read_customer'),('list_customers_page'),('list_schedule_staff'),('read_schedule'),('read_calendar_control'),('write_schedule'),('schedule_preview_source'),('manage_appointment'),('read_appointment'),('list_appointments_page'),('appointment_preview_source')$$,
 'executable session RPC surface is explicitly inventoried');

set local role authenticated;
set local "request.jwt.claim.sub"='03000000-0000-4000-8000-000000000004';
set local "request.jwt.claims"='{"aal":"aal1"}';
select throws_ok($$select tax_id,legal_name,billing_customer_ref from public.businesses$$,'42501',null,'barber cannot select private columns');
select throws_ok($$select * from public.businesses$$,'42501',null,'barber cannot select full business');
select throws_ok($$select privacy_policy_version,branding from public.business_settings$$,'42501',null,'barber cannot select settings columns');
select throws_ok($$select * from public.business_settings$$,'42501',null,'barber cannot select full settings');
select throws_ok($$select api.read_business_private('13000000-0000-4000-8000-000000000001')$$,'PT403','FORBIDDEN','barber aal1 denied private RPC');
select is(jsonb_array_length(api.me()->'memberships'),1,'barber selector still works');
select ok(api.me()::text not like '%PRIVATE-%','selector does not leak private fields');
select is((select count(*) from public.users),1::bigint,'self profile still readable');
set local "request.jwt.claims"='{"aal":"aal2"}';
select throws_ok($$select api.read_business_private('13000000-0000-4000-8000-000000000001')$$,'PT403','FORBIDDEN','barber aal2 also denied');
set local "request.jwt.claim.sub"='03000000-0000-4000-8000-000000000003';
set local "request.jwt.claims"='{"aal":"aal1"}';
select throws_ok($$select api.read_business_private('13000000-0000-4000-8000-000000000001')$$,'PT403','MFA_REQUIRED','admin aal1 denied');
set local "request.jwt.claims"='{"aal":"aal2"}';
select is(api.read_business_private('13000000-0000-4000-8000-000000000001')->'business'->>'tax_id','PRIVATE-TAX-A','admin aal2 reads authorized business');
select is(api.read_business_private('13000000-0000-4000-8000-000000000001')->'settings'->>'privacy_policy_version','PRIVATE-POLICY-A','admin aal2 reads authorized settings');
select set_eq($$select jsonb_object_keys(api.read_business_private('13000000-0000-4000-8000-000000000001'))$$,
 $$values ('business'),('settings')$$,'private envelope is fixed');
select set_eq($$select jsonb_object_keys(api.read_business_private('13000000-0000-4000-8000-000000000001')->'business')$$,
 $$values ('id'),('slug'),('name'),('legal_name'),('tax_id'),('phone'),('address_line'),('city'),('region'),('country'),('timezone'),('logo_path'),('status'),('plan_id'),('billing_customer_ref'),('version')$$,
 'business projection has exactly the authorized columns');
select set_eq($$select jsonb_object_keys(api.read_business_private('13000000-0000-4000-8000-000000000001')->'settings')$$,
 $$values ('business_id'),('slot_interval_minutes'),('min_notice_minutes'),('max_advance_days'),('cancellation_cutoff_hours'),('reschedule_cutoff_hours'),('max_client_reschedules'),('auto_confirm'),('pending_hold_minutes'),('allow_any_staff'),('require_email'),('public_booking_enabled'),('barber_can_edit_availability'),('max_active_bookings_per_customer'),('reminder_offsets_minutes'),('locale'),('currency'),('branding'),('privacy_policy_version'),('version')$$,
 'settings projection has exactly the authorized columns');
select throws_ok($$select api.read_business_private('13000000-0000-4000-8000-000000000002')$$,'PT404','NOT_FOUND','admin cannot read other tenant');
select throws_ok($$select tax_id from public.businesses$$,'42501',null,'admin must also use the projection');
select ok(api.list_members('13000000-0000-4000-8000-000000000001')::text not like '%PRIVATE-%','team projection has no private configuration');
set local "request.jwt.claim.sub"='03000000-0000-4000-8000-000000000001';
set local "request.jwt.claims"='{"aal":"aal1"}';
select is(jsonb_array_length(api.me()->'memberships'),1,'owner aal1 selector remains available for MFA flow');
select throws_ok($$select api.read_business_private('13000000-0000-4000-8000-000000000001')$$,'PT403','MFA_REQUIRED','owner aal1 denied private data');
set local "request.jwt.claims"='{"aal":"aal2"}';
select is(api.read_business_private('13000000-0000-4000-8000-000000000001')->'business'->>'billing_customer_ref','PRIVATE-BILLING-A','owner aal2 allowed');
select throws_ok($$select api.read_business_private('13000000-0000-4000-8000-000000000002')$$,'PT404','NOT_FOUND','owner cannot read other tenant');
reset role;

update public.business_members set status='suspended' where id='23000000-0000-4000-8000-000000000003';
set local role authenticated;
set local "request.jwt.claim.sub"='03000000-0000-4000-8000-000000000003';
select throws_ok($$select api.read_business_private('13000000-0000-4000-8000-000000000001')$$,'PT404','NOT_FOUND','suspended admin denied');
reset role;
update public.business_members set status='active' where id='23000000-0000-4000-8000-000000000003';
update public.businesses set status='suspended' where id='13000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select api.read_business_private('13000000-0000-4000-8000-000000000001')$$,'PT404','NOT_FOUND','suspended business denied');
reset role;
update public.businesses set status='active' where id='13000000-0000-4000-8000-000000000001';
set local role anon;
select throws_ok($$select api.read_business_private('13000000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous denied private RPC');
reset role;
set local role app_server;
select ok(app_internal.get_public_business('fix-alpha')::text not like '%PRIVATE-%','public projection contains no private configuration');
select is(app_internal.get_public_business('fix-alpha')->>'name','Alpha','existing public capability works');
reset role;

select throws_ok($$delete from public.business_members where id='23000000-0000-4000-8000-000000000001'$$,'PT409','LAST_OWNER','cannot delete last owner');
select throws_ok($$update public.business_members set status='suspended' where id='23000000-0000-4000-8000-000000000001'$$,'PT409','LAST_OWNER','cannot suspend last owner');
select throws_ok($$update public.business_members set role='barber' where id='23000000-0000-4000-8000-000000000001'$$,'PT409','LAST_OWNER','cannot demote last owner');
select is((select role||':'||status||':'||version::text from public.business_members where id='23000000-0000-4000-8000-000000000001'),'owner:active:1','failed owner operations roll back data and version');
select throws_ok($$update public.business_settings set slot_interval_minutes=7 where business_id='13000000-0000-4000-8000-000000000001'$$,'23514',null,'other CHECK keeps 23514');
select is((select slot_interval_minutes::integer from public.business_settings where business_id='13000000-0000-4000-8000-000000000001'),15,'failed CHECK rolls back value');
select is((select version from public.business_settings where business_id='13000000-0000-4000-8000-000000000001'),1,'failed CHECK rolls back trigger version');
select throws_ok($$update public.businesses set timezone='Invalid/Zone' where id='13000000-0000-4000-8000-000000000001'$$,'23514','Invalid business timezone','timezone trigger remains distinct');
select throws_ok($$update public.business_members set business_id='13000000-0000-4000-8000-000000000002' where id='23000000-0000-4000-8000-000000000004'$$,'23514','Record identity is immutable','identity trigger remains distinct');
select is((select business_id::text from public.business_members where id='23000000-0000-4000-8000-000000000004'),'13000000-0000-4000-8000-000000000001','failed move rolls back tenant');
select is((select count(*) from public.audit_logs),0::bigint,'failed operations leave no audit effects');

select * from finish();
rollback;
