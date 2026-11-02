begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('04000000-0000-4000-8000-000000000001','am03-owner@example.test',now()),
 ('04000000-0000-4000-8000-000000000002','am03-admin@example.test',now()),
 ('04000000-0000-4000-8000-000000000003','am03-barber@example.test',now()),
 ('04000000-0000-4000-8000-000000000004','am03-invite@example.test',now()),
 ('04000000-0000-4000-8000-000000000005','am03-outsider@example.test',now());
insert into public.businesses(id,slug,name) values('14000000-0000-4000-8000-000000000001','am03-alpha','AM03');
insert into public.business_settings(business_id) values('14000000-0000-4000-8000-000000000001');
insert into public.business_members(id,business_id,user_id,invited_email,role,status) values
 ('24000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000001','04000000-0000-4000-8000-000000000001',null,'owner','active'),
 ('24000000-0000-4000-8000-000000000002','14000000-0000-4000-8000-000000000001','04000000-0000-4000-8000-000000000002',null,'admin','active'),
 ('24000000-0000-4000-8000-000000000003','14000000-0000-4000-8000-000000000001','04000000-0000-4000-8000-000000000003',null,'barber','active'),
 ('24000000-0000-4000-8000-000000000004','14000000-0000-4000-8000-000000000001',null,'am03-invite@example.test','barber','invited'),
 ('24000000-0000-4000-8000-000000000005','14000000-0000-4000-8000-000000000001',null,'am03-admin-invite@example.test','admin','invited');
insert into app.member_invitations(member_id,business_id,token_hash) values
 ('24000000-0000-4000-8000-000000000004','14000000-0000-4000-8000-000000000001',extensions.digest(repeat('f',43),'sha256')),
 ('24000000-0000-4000-8000-000000000005','14000000-0000-4000-8000-000000000001',extensions.digest(repeat('g',43),'sha256'));
select ok(not has_function_privilege('authenticated','app.lock_managed_business(uuid)','EXECUTE'),'lock coordinator is private');
select ok(not has_function_privilege('authenticated','app.require_current_invitation(text)','EXECUTE'),'invitation identity helper is private');
select ok(not exists(select 1 from unnest(array['anon','app_server','service_role']) r where has_function_privilege(r,'api.prepare_member_auth_invite(uuid,uuid)','EXECUTE')),'send guard grants do not expand technical roles');
set local role authenticated;
set local "request.jwt.claim.sub"='';
set local "request.jwt.claims"='{"aal":"aal2"}';
select throws_ok($$select api.update_member('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000003','barber','suspended','34000000-0000-4000-8000-000000000001',null)$$,'PT401','UNAUTHENTICATED','identity precedes missing version');
set local "request.jwt.claim.sub"='04000000-0000-4000-8000-000000000005';
select throws_ok($$select api.update_member('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000003','barber','suspended','34000000-0000-4000-8000-000000000001',null)$$,'PT404','NOT_FOUND','tenant authorization precedes missing version');
set local "request.jwt.claim.sub"='04000000-0000-4000-8000-000000000003';
select throws_ok($$select api.prepare_member_auth_invite('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000004')$$,'PT403','FORBIDDEN','barber cannot send even by direct RPC');
set local "request.jwt.claim.sub"='04000000-0000-4000-8000-000000000002';
select throws_ok($$select api.update_member('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','barber','suspended','34000000-0000-4000-8000-000000000001',null)$$,'PT403','FORBIDDEN','target ceiling precedes missing version');
select throws_ok($$select api.manage_invitation('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000005',null,'34000000-0000-4000-8000-000000000001',null)$$,'PT403','FORBIDDEN','invitation ceiling precedes missing version');
select throws_ok($$select api.prepare_member_auth_invite('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000005')$$,'PT403','FORBIDDEN','admin cannot send admin activation');
select is(api.prepare_member_auth_invite('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000004')->>'email','am03-invite@example.test','admin can send only current barber recipient from DB');
select throws_ok($$select api.update_member('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000003','barber','suspended','34000000-0000-4000-8000-000000000001',null)$$,'PT428','PRECONDITION_REQUIRED','authorized new request requires version');
select throws_ok($$select api.update_member('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000003','barber','suspended','34000000-0000-4000-8000-000000000001',9)$$,'PT412','PRECONDITION_FAILED','authorized stale version still 412');
select is(api.update_member('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000003','barber','suspended','34000000-0000-4000-8000-000000000001',1)->>'version','2','authorized write succeeds');
select is(api.update_member('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000003','barber','suspended','34000000-0000-4000-8000-000000000001',1)->>'version','2','exact replay precedes comparison with current version');
select throws_ok($$select api.update_member('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000003','barber','suspended','34000000-0000-4000-8000-000000000001',null)$$,'PT409','IDEMPOTENCY_KEY_REUSED','same key with missing version is a different intention');
select throws_ok($$select api.update_member('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000003','barber','suspended','34000000-0000-4000-8000-000000000001',2)$$,'PT409','IDEMPOTENCY_KEY_REUSED','same key with different version is a different intention');
set local "request.jwt.claim.sub"='04000000-0000-4000-8000-000000000001';
select is(api.prepare_member_auth_invite('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000005')->>'email','am03-admin-invite@example.test','owner can send admin activation');
reset role;
update public.business_members set status='suspended' where id='24000000-0000-4000-8000-000000000002';
set local role authenticated;
set local "request.jwt.claim.sub"='04000000-0000-4000-8000-000000000002';
select throws_ok($$select api.update_member('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000003','barber','suspended','34000000-0000-4000-8000-000000000001',1)$$,'PT404','NOT_FOUND','replay cannot bypass actor revocation');
reset role;
update app.member_invitations set expires_at=clock_timestamp()-interval '1 second' where member_id='24000000-0000-4000-8000-000000000004';
set local role authenticated;
set local "request.jwt.claim.sub"='04000000-0000-4000-8000-000000000001';
select throws_ok($$select api.prepare_member_auth_invite('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000004')$$,'PT404','NOT_FOUND','expired target cannot receive activation');
set local "request.jwt.claim.sub"='04000000-0000-4000-8000-000000000004';
select throws_ok($$select api.accept_invitation(repeat('f',43),'34000000-0000-4000-8000-000000000003')$$,'PT404','NOT_FOUND','expired invitation cannot activate membership');
reset role;
select is((select version from public.business_members where id='24000000-0000-4000-8000-000000000003'),2,'failed/replayed updates do not increment again');
select is((select count(*) from public.audit_logs where business_id='14000000-0000-4000-8000-000000000001'),1::bigint,'failed/replayed updates do not duplicate audit');
select is((select count(*) from app.member_requests where business_id='14000000-0000-4000-8000-000000000001'),1::bigint,'failed requests leave no replay record');
select is((select status from public.business_members where id='24000000-0000-4000-8000-000000000004'),'invited','failed acceptance preserves invitation state');
update app.member_invitations set expires_at=clock_timestamp()+interval '1 day' where member_id='24000000-0000-4000-8000-000000000004';
set local role authenticated;
set local "request.jwt.claim.sub"='04000000-0000-4000-8000-000000000004';
select is(api.accept_invitation(repeat('f',43),'34000000-0000-4000-8000-000000000004')->>'version','2','valid invitation still accepts');
select is(api.accept_invitation(repeat('f',43),'34000000-0000-4000-8000-000000000004')->>'version','2','authorized acceptance replay still works');
reset role;
update app.member_invitations set expires_at=clock_timestamp()-interval '1 second' where member_id='24000000-0000-4000-8000-000000000004';
set local role authenticated;
select throws_ok($$select api.accept_invitation(repeat('f',43),'34000000-0000-4000-8000-000000000004')$$,'PT404','NOT_FOUND','expired token cannot authorize even an acceptance replay');
set local "request.jwt.claim.sub"='04000000-0000-4000-8000-000000000001';
select is(api.manage_invitation('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000005',repeat('j',43),'34000000-0000-4000-8000-000000000005',1)->>'version','2','lifecycle successful write preserved');
select is(api.manage_invitation('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000005',repeat('j',43),'34000000-0000-4000-8000-000000000005',1)->>'version','2','lifecycle exact replay preserved');
select throws_ok($$select api.manage_invitation('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000005',repeat('j',43),'34000000-0000-4000-8000-000000000005',null)$$,'PT409','IDEMPOTENCY_KEY_REUSED','lifecycle missing version with old key is a different intention');
reset role;
update public.business_members set role='owner' where id='24000000-0000-4000-8000-000000000005';
update public.business_members set status='active' where id='24000000-0000-4000-8000-000000000002';
set local role authenticated;
set local "request.jwt.claim.sub"='04000000-0000-4000-8000-000000000002';
select throws_ok($$select api.prepare_member_auth_invite('14000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000005')$$,'PT403','FORBIDDEN','admin cannot send owner activation');
reset role;
select * from finish();
rollback;
