begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('06000000-0000-4000-8000-000000000001','ttl-owner@example.test',now()),
 ('06000000-0000-4000-8000-000000000002','ttl-admin@example.test',now()),
 ('06000000-0000-4000-8000-000000000003','ttl-barber@example.test',now()),
 ('06000000-0000-4000-8000-000000000004','ttl-other@example.test',now()),
 ('06000000-0000-4000-8000-000000000005','ttl-invite@example.test',now());
insert into public.businesses(id,slug,name) values
 ('16000000-0000-4000-8000-000000000001','ttl-alpha','TTL A'),
 ('16000000-0000-4000-8000-000000000002','ttl-bravo','TTL B');
insert into public.business_settings(business_id) values('16000000-0000-4000-8000-000000000001'),('16000000-0000-4000-8000-000000000002');
insert into public.business_members(id,business_id,user_id,role) values
 ('26000000-0000-4000-8000-000000000001','16000000-0000-4000-8000-000000000001','06000000-0000-4000-8000-000000000001','owner'),
 ('26000000-0000-4000-8000-000000000002','16000000-0000-4000-8000-000000000001','06000000-0000-4000-8000-000000000002','admin'),
 ('26000000-0000-4000-8000-000000000003','16000000-0000-4000-8000-000000000001','06000000-0000-4000-8000-000000000003','barber'),
 ('26000000-0000-4000-8000-000000000004','16000000-0000-4000-8000-000000000002','06000000-0000-4000-8000-000000000004','owner');
select has_index('app','member_requests','member_requests_created_at','retention index exists');
select ok(not exists(select 1 from unnest(array['anon','authenticated','app_server','service_role']) r
 where has_function_privilege(r,'app.purge_member_requests(integer)','EXECUTE')
 or has_function_privilege(r,'app.lock_member_request(uuid,text,uuid)','EXECUTE')),'all application roles denied maintenance and replay helper');
select ok(not (select prosecdef from pg_proc where oid='app.purge_member_requests(integer)'::regprocedure),'maintenance never elevates caller privileges');
select throws_ok('select app.purge_member_requests(0)','PT400','VALIDATION_ERROR','zero batch rejected');
select throws_ok('select app.purge_member_requests(501)','PT400','VALIDATION_ERROR','batch over 500 rejected');
select throws_ok('select app.purge_member_requests(null)','PT400','VALIDATION_ERROR','null batch rejected');
set local role authenticated;
set local "request.jwt.claim.sub"='06000000-0000-4000-8000-000000000002';
set local "request.jwt.claims"='{"aal":"aal2"}';
set local "request.headers"='{"x-request-id":"46000000-0000-4000-8000-000000000001"}';
select is(api.update_member('16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000003','barber','suspended','36000000-0000-4000-8000-000000000001',1)->>'version','2','first operation succeeds');
select throws_ok('select app.purge_member_requests(1)','42501',null,'authenticated cannot run maintenance directly');
reset role;
select ok((select created_at>transaction_timestamp() from app.member_requests where key='36000000-0000-4000-8000-000000000001'),'new record uses server insertion time, not old transaction start');
update app.member_requests set created_at=clock_timestamp()-interval '47 hours 59 minutes' where key='36000000-0000-4000-8000-000000000001';
select set_config('test.created_before',(select created_at::text from app.member_requests where key='36000000-0000-4000-8000-000000000001'),true);
set local role authenticated;
set local "request.headers"='{"x-request-id":"46000000-0000-4000-8000-000000000002"}';
select is(api.update_member('16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000003','barber','suspended','36000000-0000-4000-8000-000000000001',1)->>'version','2','identical replay recognized just inside 48 hours');
select throws_ok($$select api.update_member('16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000003','barber','active','36000000-0000-4000-8000-000000000001',2)$$,'PT409','IDEMPOTENCY_KEY_REUSED','different intention within window is 409');
set local "request.jwt.claim.sub"='06000000-0000-4000-8000-000000000001';
select throws_ok($$select api.update_member('16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000003','barber','suspended','36000000-0000-4000-8000-000000000001',1)$$,'PT412','PRECONDITION_FAILED','same key from another actor cannot claim replay');
set local "request.jwt.claim.sub"='06000000-0000-4000-8000-000000000004';
select throws_ok($$select api.update_member('16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000003','barber','suspended','36000000-0000-4000-8000-000000000001',1)$$,'PT404','NOT_FOUND','same key does not grant cross-tenant authority');
reset role;
select is((select created_at from app.member_requests where key='36000000-0000-4000-8000-000000000001'),current_setting('test.created_before')::timestamptz,'replay does not slide or refresh TTL');
select is((select origin_request_id::text from app.member_requests where key='36000000-0000-4000-8000-000000000001'),'46000000-0000-4000-8000-000000000001','replay preserves original trace');
update app.member_requests set created_at=clock_timestamp()-interval '48 hours' where key='36000000-0000-4000-8000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub"='06000000-0000-4000-8000-000000000002';
select throws_ok($$select api.update_member('16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000003','barber','suspended','36000000-0000-4000-8000-000000000001',1)$$,'PT412','PRECONDITION_FAILED','at or beyond 48 hours old response is not recognized without purge');
reset role;
select is((select count(*) from app.member_requests where key='36000000-0000-4000-8000-000000000001'),1::bigint,'business failure rolls back opportunistic cleanup');
select is((select count(*) from public.audit_logs where business_id='16000000-0000-4000-8000-000000000001'),1::bigint,'expired old request adds no effect/audit');
set local role authenticated;
set local "request.headers"='{"x-request-id":"46000000-0000-4000-8000-000000000003"}';
select is(api.update_member('16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000003','barber','active','36000000-0000-4000-8000-000000000001',2)->>'version','3','expired PK can be reused only as a freshly authorized/versioned command');
reset role;
select is((select origin_request_id::text from app.member_requests where key='36000000-0000-4000-8000-000000000001'),'46000000-0000-4000-8000-000000000003','fresh command has new trace origin');
update app.member_requests set created_at=clock_timestamp()-interval '49 hours' where key='36000000-0000-4000-8000-000000000001';
select is(app.purge_member_requests(1),1,'purge removes expired ledger row only');
set local role authenticated;
select throws_ok($$select api.update_member('16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000003','barber','active','36000000-0000-4000-8000-000000000001',2)$$,'PT412','PRECONDITION_FAILED','same old operation after physical purge still cannot repeat');
select is(api.update_member('16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000003','barber','suspended','36000000-0000-4000-8000-000000000001',3)->>'version','4','fresh version after purge follows normal business rules');
select set_config('test.invitation_id',api.invite_member('16000000-0000-4000-8000-000000000001','ttl-invite@example.test','barber',repeat('v',43),'36000000-0000-4000-8000-000000000002')->>'id',true);
reset role;
update app.member_requests set created_at=clock_timestamp()-interval '49 hours' where key='36000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select api.invite_member('16000000-0000-4000-8000-000000000001','ttl-invite@example.test','barber',repeat('v',43),'36000000-0000-4000-8000-000000000002')$$,'PT409','DUPLICATE_RESOURCE','expired invite request cannot create a second membership');
select is(api.manage_invitation('16000000-0000-4000-8000-000000000001',current_setting('test.invitation_id')::uuid,repeat('w',43),'36000000-0000-4000-8000-000000000003',1)->>'version','2','renew succeeds once');
reset role;
update app.member_requests set created_at=clock_timestamp()-interval '49 hours' where key='36000000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok($$select api.manage_invitation('16000000-0000-4000-8000-000000000001',current_setting('test.invitation_id')::uuid,repeat('w',43),'36000000-0000-4000-8000-000000000003',1)$$,'PT412','PRECONDITION_FAILED','expired renewal cannot rotate again with the old version');
select is(api.manage_invitation('16000000-0000-4000-8000-000000000001',current_setting('test.invitation_id')::uuid,null,'36000000-0000-4000-8000-000000000004',2)->>'version','3','revoke succeeds once');
reset role;
update app.member_requests set created_at=clock_timestamp()-interval '49 hours' where key='36000000-0000-4000-8000-000000000004';
set local role authenticated;
select throws_ok($$select api.manage_invitation('16000000-0000-4000-8000-000000000001',current_setting('test.invitation_id')::uuid,null,'36000000-0000-4000-8000-000000000004',2)$$,'PT412','PRECONDITION_FAILED','expired revoke cannot increment again');
reset role;
select is(app.purge_member_requests(500),3,'expired invite/renew/revoke ledgers purged without deleting the invitation');
set local role authenticated;
select throws_ok($$select api.invite_member('16000000-0000-4000-8000-000000000001','ttl-invite@example.test','barber',repeat('v',43),'36000000-0000-4000-8000-000000000002')$$,'PT409','DUPLICATE_RESOURCE','purged invite still cannot duplicate membership');
select throws_ok($$select api.manage_invitation('16000000-0000-4000-8000-000000000001',current_setting('test.invitation_id')::uuid,repeat('w',43),'36000000-0000-4000-8000-000000000003',1)$$,'PT412','PRECONDITION_FAILED','purged renewal still cannot rotate twice');
select throws_ok($$select api.manage_invitation('16000000-0000-4000-8000-000000000001',current_setting('test.invitation_id')::uuid,null,'36000000-0000-4000-8000-000000000004',2)$$,'PT412','PRECONDITION_FAILED','purged revoke still cannot repeat');
select is(api.manage_invitation('16000000-0000-4000-8000-000000000001',current_setting('test.invitation_id')::uuid,repeat('x',43),'36000000-0000-4000-8000-000000000005',3)->>'version','4','authorized fresh renewal remains possible');
set local "request.jwt.claim.sub"='06000000-0000-4000-8000-000000000005';
set local "request.jwt.claims"='{"aal":"aal1"}';
select is(api.accept_invitation(repeat('x',43),'36000000-0000-4000-8000-000000000006')->>'version','5','accept succeeds once');
select is(api.accept_invitation(repeat('x',43),'36000000-0000-4000-8000-000000000006')->>'version','5','accept recognizes replay within 48 hours');
reset role;
update app.member_requests set created_at=clock_timestamp()-interval '49 hours' where key='36000000-0000-4000-8000-000000000006';
set local role authenticated;
select throws_ok($$select api.accept_invitation(repeat('x',43),'36000000-0000-4000-8000-000000000006')$$,'PT404','NOT_FOUND','expired acceptance cannot activate an already consumed invitation again');
reset role;
select set_config('test.audit_before',(select count(*)::text from public.audit_logs),true);
select set_config('test.invites_before',(select count(*)::text from app.member_invitations),true);
insert into app.member_requests(business_id,user_id,operation,key,request_hash,result,created_at)
 select '16000000-0000-4000-8000-000000000002','06000000-0000-4000-8000-000000000004','batch-probe',gen_random_uuid(),extensions.digest(n::text,'sha256'),'{}',clock_timestamp()-interval '50 hours' from generate_series(1,601) n;
select is(app.purge_member_requests(),500,'default maintenance deletes at most 500 across private ledger');
select is(app.purge_member_requests(7),7,'smaller explicit batch respected');
select is((select count(*) from public.audit_logs),current_setting('test.audit_before')::bigint,'purge never removes audit');
select is((select count(*) from app.member_invitations),current_setting('test.invites_before')::bigint,'purge never removes invitations');
select set_config('test.rows_before_failure',(select count(*)::text from app.member_requests),true);
create temporary sequence purge_failure_counter;
create function pg_temp.fail_second_purge_delete() returns trigger language plpgsql as $$
begin
  if nextval('pg_temp.purge_failure_counter')=2 then raise exception 'PURGE_FIXTURE_FAILURE'; end if;
  return old;
end;
$$;
create trigger test_purge_failure before delete on app.member_requests for each row execute function pg_temp.fail_second_purge_delete();
select throws_ok('select app.purge_member_requests(5)','P0001','PURGE_FIXTURE_FAILURE','failed batch rolls back even after a row was deleted');
select is((select count(*) from app.member_requests),current_setting('test.rows_before_failure')::bigint,'failed batch preserves all ledger rows');
select is((select count(*) from public.audit_logs),current_setting('test.audit_before')::bigint,'failed purge preserves audit');
select is((select count(*) from app.member_invitations),current_setting('test.invites_before')::bigint,'failed purge preserves invitations');
drop trigger test_purge_failure on app.member_requests;
set local role authenticated;
set local "request.jwt.claim.sub"='06000000-0000-4000-8000-000000000001';
set local "request.jwt.claims"='{"aal":"aal2"}';
select is(api.update_member('16000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000003','barber','active','36000000-0000-4000-8000-000000000007',4)->>'version','5','business operations still work after failed purge');
reset role;
select ok((select count(*) from app.member_requests where created_at>clock_timestamp()-interval '48 hours')>0,'recent replay rows survive maintenance');
select * from finish();
rollback;
