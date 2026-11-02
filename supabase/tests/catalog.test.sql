begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('07000000-0000-4000-8000-000000000001','cat-owner@example.test',now()),('07000000-0000-4000-8000-000000000002','cat-admin@example.test',now()),
 ('07000000-0000-4000-8000-000000000003','cat-barber@example.test',now()),('07000000-0000-4000-8000-000000000004','cat-other@example.test',now());
insert into public.businesses(id,slug,name) values('17000000-0000-4000-8000-000000000001','cat-alpha','Catalog A'),('17000000-0000-4000-8000-000000000002','cat-bravo','Catalog B');
insert into public.business_settings(business_id) values('17000000-0000-4000-8000-000000000001'),('17000000-0000-4000-8000-000000000002');
insert into public.business_members(id,business_id,user_id,role) values
 ('27000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','07000000-0000-4000-8000-000000000001','owner'),
 ('27000000-0000-4000-8000-000000000002','17000000-0000-4000-8000-000000000001','07000000-0000-4000-8000-000000000002','admin'),
 ('27000000-0000-4000-8000-000000000003','17000000-0000-4000-8000-000000000001','07000000-0000-4000-8000-000000000003','barber'),
 ('27000000-0000-4000-8000-000000000004','17000000-0000-4000-8000-000000000002','07000000-0000-4000-8000-000000000004','owner');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('public.staff_members'::regclass,'public.services'::regclass,'public.staff_services'::regclass,'app.catalog_requests'::regclass)),'all catalog tables force RLS');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role','app_server']) r cross join unnest(array['public.staff_members','public.services','public.staff_services','app.catalog_requests']) t where has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),'no direct application table grants');
select ok(not exists(select 1 from unnest(array['anon','service_role','app_server']) r where has_function_privilege(r,'api.list_catalog(uuid,boolean)','EXECUTE') or has_function_privilege(r,'api.write_catalog(uuid,text,uuid,text,jsonb,uuid,integer)','EXECUTE')),'no technical or anonymous catalog capabilities');
set local role authenticated;
set local "request.jwt.claim.sub"='07000000-0000-4000-8000-000000000003';
set local "request.jwt.claims"='{"aal":"aal1"}';
select is(api.list_catalog('17000000-0000-4000-8000-000000000001')->'services','[]'::jsonb,'barber aal1 reads own catalog');
select throws_ok($$select api.write_catalog('17000000-0000-4000-8000-000000000001','service','37000000-0000-4000-8000-000000000001','create','{}','57000000-0000-4000-8000-000000000001',null)$$,'PT403','FORBIDDEN','barber cannot mutate even with malformed body');
set local "request.jwt.claim.sub"='07000000-0000-4000-8000-000000000001';
select throws_ok($$select api.list_catalog('17000000-0000-4000-8000-000000000001')$$,'PT403','MFA_REQUIRED','privileged reads require MFA');
set local "request.jwt.claims"='{"aal":"aal2"}';
select is(api.write_catalog('17000000-0000-4000-8000-000000000001','service','37000000-0000-4000-8000-000000000001','create','{"name":" Corte ","price_cents":123450,"duration_minutes":30,"buffer_minutes":10}','57000000-0000-4000-8000-000000000001',null)->>'version','1','create service with integer cents');
select is(api.write_catalog('17000000-0000-4000-8000-000000000001','service','37000000-0000-4000-8000-000000000001','create','{"name":"Corte","price_cents":123450,"duration_minutes":30,"buffer_minutes":10}','57000000-0000-4000-8000-000000000001',null)->>'version','1','normalized exact replay does not duplicate service');
select throws_ok($$select api.write_catalog('17000000-0000-4000-8000-000000000001','service','37000000-0000-4000-8000-000000000001','create','{"name":"Otro","price_cents":123450,"duration_minutes":30,"buffer_minutes":10}','57000000-0000-4000-8000-000000000001',null)$$,'PT409','IDEMPOTENCY_KEY_REUSED','changed intention cannot replay');
select throws_ok($$select api.write_catalog('17000000-0000-4000-8000-000000000001','service','37000000-0000-4000-8000-000000000003','create','{"name":"CORTE","price_cents":0,"duration_minutes":5}','57000000-0000-4000-8000-000000000003',null)$$,'PT409','DUPLICATE_RESOURCE','live normalized service names unique');
select throws_ok($$select api.write_catalog('17000000-0000-4000-8000-000000000001','service','37000000-0000-4000-8000-000000000001','update','{"name":"Corte","price_cents":100,"duration_minutes":30}','57000000-0000-4000-8000-000000000004',null)$$,'PT428','PRECONDITION_REQUIRED','missing resource version after authorization');
select throws_ok($$select api.write_catalog('17000000-0000-4000-8000-000000000001','service','37000000-0000-4000-8000-000000000001','update','{"name":"Corte","price_cents":100,"duration_minutes":30}','57000000-0000-4000-8000-000000000004',9)$$,'PT412','PRECONDITION_FAILED','stale version rejected');
select throws_ok(format('select api.write_catalog(%L,%L,%L,%L,%L::jsonb,%L,null)','17000000-0000-4000-8000-000000000001','service','37000000-0000-4000-8000-000000000003','create',value::text,'57000000-0000-4000-8000-000000000003'),'PT400','VALIDATION_ERROR','invalid service bound/type rejected') from (values
 ('{"name":"Test","price_cents":-1,"duration_minutes":30}'::jsonb),('{"name":"Test","price_cents":1,"duration_minutes":4}'),('{"name":"Test","price_cents":1,"duration_minutes":481}'),('{"name":"Test","price_cents":1,"duration_minutes":30,"buffer_minutes":121}'),('{"name":"Test","price_cents":1,"duration_minutes":30,"role":"owner"}')) v(value);
select is(api.write_catalog('17000000-0000-4000-8000-000000000001','staff','47000000-0000-4000-8000-000000000001','create','{"display_name":"Profesional sin cuenta","assignments":[{"service_id":"37000000-0000-4000-8000-000000000001","price_override_cents":0,"duration_override_minutes":5}]}','57000000-0000-4000-8000-000000000005',null)->>'version','1','professional without account and overrides supported');
select is(api.write_catalog('17000000-0000-4000-8000-000000000001','staff','47000000-0000-4000-8000-000000000002','create','{"display_name":"Profesional vinculado","member_id":"27000000-0000-4000-8000-000000000003"}','57000000-0000-4000-8000-000000000006',null)->>'version','1','optional account linked within tenant');
select throws_ok($$select api.write_catalog('17000000-0000-4000-8000-000000000001','staff','47000000-0000-4000-8000-000000000003','create','{"display_name":"Duplicado","member_id":"27000000-0000-4000-8000-000000000003"}','57000000-0000-4000-8000-000000000007',null)$$,'PT409','DUPLICATE_RESOURCE','one live professional per membership');
select throws_ok($$select api.write_catalog('17000000-0000-4000-8000-000000000001','staff','47000000-0000-4000-8000-000000000003','create','{"display_name":"Cruce","member_id":"27000000-0000-4000-8000-000000000004"}','57000000-0000-4000-8000-000000000007',null)$$,'PT404','NOT_FOUND','cross-tenant membership denied');
reset role;
select is((select count(*) from public.users where id::text like '07000000-%'),4::bigint,'staff creation never creates auth profiles');
select throws_ok($$insert into public.staff_members(id,business_id,member_id,display_name) values(gen_random_uuid(),'17000000-0000-4000-8000-000000000002','27000000-0000-4000-8000-000000000001','Invalid')$$,'23503',null,'FK prevents cross-tenant profile even as maintenance');
select throws_ok($$insert into public.staff_services(business_id,staff_member_id,service_id) values('17000000-0000-4000-8000-000000000002','47000000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000001')$$,'23503',null,'composite FK blocks cross-business associations');
update public.business_members set status='suspended' where id='27000000-0000-4000-8000-000000000003';
select ok((select active from public.staff_members where id='47000000-0000-4000-8000-000000000002'),'suspending login does not deactivate professional');
set local role authenticated;
select is(api.write_catalog('17000000-0000-4000-8000-000000000001','staff','47000000-0000-4000-8000-000000000002','update','{"display_name":"Profesional vinculado","member_id":"27000000-0000-4000-8000-000000000003"}','57000000-0000-4000-8000-000000000008',1)->>'version','2','existing suspended-account link can remain without granting login');
select is(api.write_catalog('17000000-0000-4000-8000-000000000001','service','37000000-0000-4000-8000-000000000001','archive','{}','57000000-0000-4000-8000-000000000009',1)->>'version','2','archive is versioned');
select is(jsonb_array_length(api.list_catalog('17000000-0000-4000-8000-000000000001')->'services'),0,'archive hidden from current catalog');
select is(jsonb_array_length(api.list_catalog('17000000-0000-4000-8000-000000000001',true)->'services'),1,'archive remains recoverable');
reset role;
select is((select count(*) from public.staff_services where business_id='17000000-0000-4000-8000-000000000001'),1::bigint,'archiving service never deletes assignments');
set local role authenticated;
select is(api.write_catalog('17000000-0000-4000-8000-000000000001','service','37000000-0000-4000-8000-000000000001','restore','{}','57000000-0000-4000-8000-000000000010',2)->>'version','3','restore keeps stable identity');
reset role;
update app.catalog_requests set created_at=clock_timestamp()-interval '49 hours' where key='57000000-0000-4000-8000-000000000005';
set local role authenticated;
select throws_ok($$select api.write_catalog('17000000-0000-4000-8000-000000000001','staff','47000000-0000-4000-8000-000000000001','create','{"display_name":"Profesional sin cuenta","assignments":[{"service_id":"37000000-0000-4000-8000-000000000001","price_override_cents":0,"duration_override_minutes":5}]}','57000000-0000-4000-8000-000000000005',null)$$,'PT409','DUPLICATE_RESOURCE','expired create replay cannot create a duplicate profile with same stable id');
set local "request.jwt.claim.sub"='07000000-0000-4000-8000-000000000004';
select throws_ok($$select api.list_catalog('17000000-0000-4000-8000-000000000001')$$,'PT404','NOT_FOUND','cross-business catalog unreadable');
reset role;
update public.business_members set status='active' where id='27000000-0000-4000-8000-000000000003';
set local role authenticated;
set local "request.jwt.claim.sub"='07000000-0000-4000-8000-000000000003';
set local "request.jwt.claims"='{"aal":"aal1"}';
select ok(not exists(select 1 from jsonb_array_elements(api.list_catalog('17000000-0000-4000-8000-000000000001')->'staff') s where s->>'member_id' is not null),'barber projection never reveals account links');
select throws_ok('select * from public.staff_members','42501',null,'barber cannot bypass RPC projection');
reset role;
select is((select version from public.services where id='37000000-0000-4000-8000-000000000001'),3,'failed operations never increment version');
select is((select count(*) from public.audit_logs where business_id='17000000-0000-4000-8000-000000000001'),6::bigint,'audit once per successful write, never per replay or rejected attempt');
select ok(not exists(select 1 from public.audit_logs where business_id='17000000-0000-4000-8000-000000000001' and after_data::text like '%Profesional%'),'audit metadata omits personal profile content');
select ok(not has_function_privilege('authenticated','app.purge_catalog_requests(integer)','EXECUTE'),'catalog maintenance is private');
select throws_ok('select app.purge_catalog_requests(501)','PT400','VALIDATION_ERROR','catalog purge batch bounded at 500');
select is(app.purge_catalog_requests(500),1,'purge removes expired catalog replay only');
select is((select count(*) from public.audit_logs where business_id='17000000-0000-4000-8000-000000000001'),6::bigint,'purge preserves audit');
select is((select count(*) from public.staff_members where business_id='17000000-0000-4000-8000-000000000001'),2::bigint,'purge preserves profiles and stable identity');
select * from finish();
rollback;
