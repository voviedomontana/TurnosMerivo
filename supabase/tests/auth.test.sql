begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('02000000-0000-4000-8000-000000000001','s2-owner-a@example.test',now()),
 ('02000000-0000-4000-8000-000000000002','s2-owner-b@example.test',now()),
 ('02000000-0000-4000-8000-000000000003','s2-admin@example.test',now()),
 ('02000000-0000-4000-8000-000000000004','s2-barber@example.test',now()),
 ('02000000-0000-4000-8000-000000000005','s2-invite@example.test',now()),
 ('02000000-0000-4000-8000-000000000006','s2-other@example.test',now());
insert into public.businesses(id,slug,name) values
 ('12000000-0000-4000-8000-000000000001','s2-alpha','S2 Alpha'),
 ('12000000-0000-4000-8000-000000000002','s2-bravo','S2 Bravo');
insert into public.business_settings(business_id) values
 ('12000000-0000-4000-8000-000000000001'),('12000000-0000-4000-8000-000000000002');
insert into public.business_members(id,business_id,user_id,role) values
 ('22000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','02000000-0000-4000-8000-000000000001','owner'),
 ('22000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000002','02000000-0000-4000-8000-000000000002','owner'),
 ('22000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','02000000-0000-4000-8000-000000000003','admin'),
 ('22000000-0000-4000-8000-000000000004','12000000-0000-4000-8000-000000000001','02000000-0000-4000-8000-000000000004','barber');

select is((select count(*) from public.users where email like 's2-%@example.test'),6::bigint,'Auth trigger mirrors identities without trusting metadata');
select ok(not has_table_privilege('authenticated','public.business_members','UPDATE'),'membership DML stays denied');
select ok(not has_table_privilege('service_role','public.audit_logs','SELECT'),'service_role cannot read business audit');
select ok(not has_function_privilege('authenticated','app.manage_member(uuid,text,uuid,text,text,text,text,uuid,integer)','EXECUTE'),'private core is not executable');
select ok(not has_function_privilege('app_server','api.me()','EXECUTE'),'app_server cannot impersonate a user');
select ok(not has_function_privilege('anon','api.accept_invitation(text,uuid)','EXECUTE'),'anonymous cannot accept invitations');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('public.platform_admins'::regclass,'public.audit_logs'::regclass,'app.member_invitations'::regclass,'app.member_requests'::regclass)),'new tables force RLS');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname in ('api','app') and a.grantee=0 and a.privilege_type='EXECUTE'),'no PUBLIC execute');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and n.nspname in ('api','app')),'all definers fix empty search_path');
set local role authenticated;
set local "request.jwt.claim.sub"='02000000-0000-4000-8000-000000000001';
set local "request.jwt.claims"='{"aal":"aal1"}';
select is(current_user::text,'authenticated','security assertions use real API role');
select is(jsonb_array_length(api.me()->'memberships'),1,'aal1 only gets its own selector');
select throws_ok($$select count(*) from public.businesses$$,'42501',null,'private business table reads are denied, including owner aal1');
select throws_ok($$select api.list_members('12000000-0000-4000-8000-000000000001')$$,'PT403','MFA_REQUIRED','SQL directly enforces MFA');
set local "request.jwt.claims"='{"aal":"aal2"}';
select is(jsonb_array_length(api.list_members('12000000-0000-4000-8000-000000000001')),3,'owner sees its team');
select throws_ok($$select api.list_members('12000000-0000-4000-8000-000000000002')$$,'PT404','NOT_FOUND','cross tenant denied uniformly');
select throws_ok($$select api.update_member('12000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','barber','active','32000000-0000-4000-8000-000000000001',1)$$,'PT403','FORBIDDEN','self demotion denied');
select throws_ok($$select api.update_member('12000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000004','admin','active','32000000-0000-4000-8000-000000000001',null)$$,'PT428','PRECONDITION_REQUIRED','version mandatory');
select throws_ok($$select api.update_member('12000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000004','admin','active','32000000-0000-4000-8000-000000000001',9)$$,'PT412','PRECONDITION_FAILED','stale version rejected');
select is(api.invite_member('12000000-0000-4000-8000-000000000001','s2-invite@example.test','barber',repeat('a',43),'32000000-0000-4000-8000-000000000002')->>'status','invited','owner invites barber');
select is(api.invite_member('12000000-0000-4000-8000-000000000001','s2-invite@example.test','barber',repeat('a',43),'32000000-0000-4000-8000-000000000002')->>'version','1','exact authorized replay works');
select throws_ok($$select api.invite_member('12000000-0000-4000-8000-000000000001','s2-invite@example.test','admin',repeat('a',43),'32000000-0000-4000-8000-000000000002')$$,'PT409','IDEMPOTENCY_KEY_REUSED','different intention cannot replay');
select throws_ok($$select api.invite_member('12000000-0000-4000-8000-000000000001','s2-invite@example.test','barber',repeat('b',43),'32000000-0000-4000-8000-000000000003')$$,'PT409','DUPLICATE_RESOURCE','duplicate email rejected');
select set_config('test.invitation_id',api.invite_member('12000000-0000-4000-8000-000000000001','s2-other@example.test','barber',repeat('c',43),'32000000-0000-4000-8000-000000000011')->>'id',true);
select is(api.manage_invitation('12000000-0000-4000-8000-000000000001',current_setting('test.invitation_id')::uuid,repeat('d',43),'32000000-0000-4000-8000-000000000012',1)->>'version','2','renew rotates token and increments version');
select is(api.manage_invitation('12000000-0000-4000-8000-000000000001',current_setting('test.invitation_id')::uuid,repeat('d',43),'32000000-0000-4000-8000-000000000012',1)->>'version','2','renew exact replay does not rotate twice');
select throws_ok($$select api.manage_invitation('12000000-0000-4000-8000-000000000001',current_setting('test.invitation_id')::uuid,repeat('e',43),'32000000-0000-4000-8000-000000000013',1)$$,'PT412','PRECONDITION_FAILED','renew requires current version');
select is(api.manage_invitation('12000000-0000-4000-8000-000000000001',current_setting('test.invitation_id')::uuid,null,'32000000-0000-4000-8000-000000000014',2)->>'status','suspended','unused invitation can be revoked');
set local "request.jwt.claim.sub"='02000000-0000-4000-8000-000000000006';
select throws_ok($$select api.accept_invitation(repeat('c',43),'32000000-0000-4000-8000-000000000015')$$,'PT404','NOT_FOUND','rotated token is unusable');
select throws_ok($$select api.accept_invitation(repeat('d',43),'32000000-0000-4000-8000-000000000015')$$,'PT404','NOT_FOUND','revoked invitation is unusable');
reset role;
update app.member_invitations set expires_at=now()-interval '1 second' where member_id=current_setting('test.invitation_id')::uuid;
set local role authenticated;
set local "request.jwt.claim.sub"='02000000-0000-4000-8000-000000000001';
select is(api.manage_invitation('12000000-0000-4000-8000-000000000001',current_setting('test.invitation_id')::uuid,repeat('e',43),'32000000-0000-4000-8000-000000000016',3)->>'status','invited','revoked or expired invite can be renewed');
reset role;
update app.member_invitations set expires_at=now()-interval '1 second' where member_id=current_setting('test.invitation_id')::uuid;
set local role authenticated;
set local "request.jwt.claim.sub"='02000000-0000-4000-8000-000000000006';
select throws_ok($$select api.accept_invitation(repeat('e',43),'32000000-0000-4000-8000-000000000017')$$,'PT404','NOT_FOUND','expired invitation cannot be accepted');
set local "request.jwt.claim.sub"='02000000-0000-4000-8000-000000000003';
select throws_ok($$select api.invite_member('12000000-0000-4000-8000-000000000001','another@example.test','admin',repeat('b',43),'32000000-0000-4000-8000-000000000004')$$,'PT403','FORBIDDEN','admin cannot create admin');
select throws_ok($$select api.update_member('12000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','barber','active','32000000-0000-4000-8000-000000000004',1)$$,'PT403','FORBIDDEN','admin cannot touch owner');
select is(api.update_member('12000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000004','barber','suspended','32000000-0000-4000-8000-000000000005',1)->>'version','2','admin suspends barber with version increment');
select is(api.update_member('12000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000004','barber','suspended','32000000-0000-4000-8000-000000000005',1)->>'version','2','replay precedes obsolete version check');
set local "request.jwt.claim.sub"='02000000-0000-4000-8000-000000000004';
select throws_ok($$select api.list_members('12000000-0000-4000-8000-000000000001')$$,'PT404','NOT_FOUND','suspended member immediately loses access');
set local "request.jwt.claim.sub"='02000000-0000-4000-8000-000000000006';
select throws_ok($$select api.accept_invitation(repeat('a',43),'32000000-0000-4000-8000-000000000006')$$,'PT404','NOT_FOUND','different verified email cannot steal invitation');
set local "request.jwt.claim.sub"='02000000-0000-4000-8000-000000000005';
set local "request.jwt.claims"='{"aal":"aal1"}';
select is(api.accept_invitation(repeat('a',43),'32000000-0000-4000-8000-000000000006')->>'status','active','matching email accepts invitation');
select is(api.accept_invitation(repeat('a',43),'32000000-0000-4000-8000-000000000006')->>'version','2','accept replay is authorized and idempotent');
select throws_ok($$select api.accept_invitation(repeat('a',43),'32000000-0000-4000-8000-000000000007')$$,'PT404','NOT_FOUND','token cannot be consumed twice');
select throws_ok($$select api.list_members('12000000-0000-4000-8000-000000000001')$$,'PT403','FORBIDDEN','barber cannot read team');
select throws_ok($$update public.business_members set role='owner'$$,'42501',null,'direct escalation denied');
reset role;
select is((select count(*) from public.audit_logs where business_id='12000000-0000-4000-8000-000000000001'),7::bigint,'mutation and audit commit once per operation');
select ok(not exists(select 1 from app.member_requests where result::text like '%'||repeat('a',43)||'%'),'idempotency results contain no invitation secret');
select is((select token_hash from app.member_invitations where accepted_by='02000000-0000-4000-8000-000000000005'),extensions.digest(repeat('a',43),'sha256'),'only hashed invitation is stored');
select throws_ok($$delete from public.audit_logs$$,'23514','Audit records are immutable','audit append-only even in maintenance');
select * from finish();
rollback;
