begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
grant usage on schema extensions to app_server;
select no_plan();
insert into public.businesses(id,slug,name,tax_id) values
('1c000000-0000-4000-8000-000000000001','public-alpha','Public Alpha','PRIVATE-TAX'),
('1c000000-0000-4000-8000-000000000002','public-beta','Private Beta','PRIVATE-OTHER');
insert into public.business_settings(business_id) values('1c000000-0000-4000-8000-000000000001'),('1c000000-0000-4000-8000-000000000002');
insert into public.staff_members(id,business_id,display_name,accepts_online,active) values
('3c000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','Public professional',true,true),
('3c000000-0000-4000-8000-000000000002','1c000000-0000-4000-8000-000000000001','OFFLINE',false,true),
('3c000000-0000-4000-8000-000000000003','1c000000-0000-4000-8000-000000000001','INACTIVE',true,false),
('3c000000-0000-4000-8000-000000000004','1c000000-0000-4000-8000-000000000001','UNLINKED',true,true),
('3c000000-0000-4000-8000-000000000005','1c000000-0000-4000-8000-000000000002','FOREIGN',true,true);
insert into public.services(id,business_id,name,price_cents,duration_minutes) values
('5c000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-000000000001','Public service',100000,30),
('5c000000-0000-4000-8000-000000000002','1c000000-0000-4000-8000-000000000001','HIDDEN',100000,30),
('5c000000-0000-4000-8000-000000000003','1c000000-0000-4000-8000-000000000001','UNASSIGNED SERVICE',100000,30);
insert into public.staff_services(business_id,staff_member_id,service_id,price_override_cents,duration_override_minutes) values
('1c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000001','5c000000-0000-4000-8000-000000000001',200000,45),
('1c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000002','5c000000-0000-4000-8000-000000000001',null,null),
('1c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001',null,null),
('1c000000-0000-4000-8000-000000000001','3c000000-0000-4000-8000-000000000001','5c000000-0000-4000-8000-000000000002',null,null);
update public.services set active=false where id='5c000000-0000-4000-8000-000000000002';
select ok(has_function_privilege('app_server','app_internal.get_public_catalog(text)','EXECUTE'),'only technical backend can invoke public read');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r where has_function_privilege(r,'app_internal.get_public_catalog(text)','EXECUTE')),'no new grants to anonymous/session/service role');
select ok(not has_table_privilege('app_server','public.staff_members','SELECT'),'technical role still has no table reads');
set local role app_server;
select is(app_internal.get_public_catalog('public-alpha')->'business'->>'name','Public Alpha','public business selected by validated slug');
select is(jsonb_array_length(app_internal.get_public_catalog('public-alpha')->'professionals'),1,'only active online associated professional');
select is(jsonb_array_length(app_internal.get_public_catalog('public-alpha')->'professionals'->0->'services'),1,'only active associated services');
select is(app_internal.get_public_catalog('public-alpha')->'professionals'->0->'services'->0->>'price_cents','200000','effective price override');
select is(app_internal.get_public_catalog('public-alpha')->'professionals'->0->'services'->0->>'duration_minutes','45','effective duration override');
select ok(app_internal.get_public_catalog('public-alpha')::text !~ 'PRIVATE|FOREIGN|OFFLINE|INACTIVE|UNLINKED|HIDDEN|UNASSIGNED','no cross-tenant, hidden or private configuration');
select ok(not (app_internal.get_public_catalog('public-alpha')->'professionals'->0 ?|array['member_id','business_id','version','sort_order','active']),'no private professional fields');
select ok(not (app_internal.get_public_catalog('public-alpha')->'professionals'->0->'services'->0 ?|array['buffer_minutes','version','business_id']),'no unnecessary service fields');
select is(app_internal.get_public_catalog('ADMIN'),null::jsonb,'invalid slug remains absent');
select is(app_internal.get_public_catalog('missing-public'),null::jsonb,'missing slug remains absent');
select is(app_internal.get_public_business('public-alpha')->>'name','Public Alpha','original S1 projection remains compatible');
reset role;
update public.staff_members set deleted_at=clock_timestamp() where id='3c000000-0000-4000-8000-000000000001';
set local role app_server;
select is(jsonb_array_length(app_internal.get_public_catalog('public-alpha')->'professionals'),0,'archived professional hidden');
reset role;
update public.staff_members set deleted_at=null where id='3c000000-0000-4000-8000-000000000001';
update public.services set deleted_at=clock_timestamp() where id='5c000000-0000-4000-8000-000000000001';
set local role app_server;
select is(jsonb_array_length(app_internal.get_public_catalog('public-alpha')->'professionals'),0,'archived service removes professional without another public service');
reset role;
update public.business_settings set public_booking_enabled=false where business_id='1c000000-0000-4000-8000-000000000001';
set local role app_server;
select is(app_internal.get_public_catalog('public-alpha'),null::jsonb,'disabled public booking hides catalog');
reset role;
update public.business_settings set public_booking_enabled=true where business_id='1c000000-0000-4000-8000-000000000001';
update public.businesses set status='suspended' where id='1c000000-0000-4000-8000-000000000001';
set local role app_server;
select is(app_internal.get_public_catalog('public-alpha'),null::jsonb,'suspended tenant hidden');
reset role;
update public.businesses set status='active',deleted_at=clock_timestamp() where id='1c000000-0000-4000-8000-000000000001';
set local role app_server;
select is(app_internal.get_public_catalog('public-alpha'),null::jsonb,'deleted tenant hidden');
reset role;
select * from finish();rollback;
