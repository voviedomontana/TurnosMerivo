begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('05000000-0000-4000-8000-000000000001','trace-owner@example.test',now()),
 ('05000000-0000-4000-8000-000000000002','trace-admin@example.test',now()),
 ('05000000-0000-4000-8000-000000000003','trace-barber@example.test',now()),
 ('05000000-0000-4000-8000-000000000004','trace-other@example.test',now()),
 ('05000000-0000-4000-8000-000000000005','trace-invite@example.test',now());
insert into public.businesses(id,slug,name) values
 ('15000000-0000-4000-8000-000000000001','trace-alpha','Trace A'),
 ('15000000-0000-4000-8000-000000000002','trace-bravo','Trace B');
insert into public.business_settings(business_id) values
 ('15000000-0000-4000-8000-000000000001'),('15000000-0000-4000-8000-000000000002');
insert into public.business_members(id,business_id,user_id,role) values
 ('25000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001','05000000-0000-4000-8000-000000000001','owner'),
 ('25000000-0000-4000-8000-000000000002','15000000-0000-4000-8000-000000000001','05000000-0000-4000-8000-000000000002','admin'),
 ('25000000-0000-4000-8000-000000000003','15000000-0000-4000-8000-000000000001','05000000-0000-4000-8000-000000000003','barber'),
 ('25000000-0000-4000-8000-000000000004','15000000-0000-4000-8000-000000000002','05000000-0000-4000-8000-000000000004','owner');
insert into public.business_members(business_id,invited_email,role,status,created_at)
 select '15000000-0000-4000-8000-000000000001','page-'||n||'@example.test','barber','invited',
 '2026-10-01T10:00:00.123456Z'::timestamptz from generate_series(1,210) n;

select ok(not has_function_privilege('authenticated','app.current_request_id()','EXECUTE'),'trace helper is private');
select ok(not exists(select 1 from unnest(array['anon','app_server','service_role']) r where has_function_privilege(r,'api.list_members_page(uuid,integer,text)','EXECUTE')),'pagination does not expand technical-role grants');
select ok(not has_table_privilege('authenticated','app.member_requests','SELECT'),'replay trace metadata remains private');
select has_index('public','business_members','business_members_page_order','keyset index exists');
set local role authenticated;
set local "request.jwt.claim.sub"='05000000-0000-4000-8000-000000000002';
set local "request.jwt.claims"='{"aal":"aal2"}';
select is(jsonb_array_length(api.list_members('15000000-0000-4000-8000-000000000001')),213,'legacy RPC is never silently truncated');
select is(jsonb_array_length(api.list_members_page('15000000-0000-4000-8000-000000000001')->'data'),50,'default page is 50');
select is(jsonb_array_length(api.list_members_page('15000000-0000-4000-8000-000000000001',200)->'data'),200,'maximum page is 200');
select set_config('test.page_cursor',api.list_members_page('15000000-0000-4000-8000-000000000001',200)->'page'->>'next_cursor',true);
select is(jsonb_array_length(api.list_members_page('15000000-0000-4000-8000-000000000001',200,current_setting('test.page_cursor'))->'data'),13,'second page contains the remainder');
select is(api.list_members_page('15000000-0000-4000-8000-000000000001',200,current_setting('test.page_cursor'))->'page',jsonb_build_object('has_more',false,'next_cursor',null),'terminal page has no cursor');
do $$
declare cursor_value text; response jsonb; seen uuid[]:='{}'; expected uuid[]; loops integer:=0;
begin
  loop
    response:=api.list_members_page('15000000-0000-4000-8000-000000000001',37,cursor_value);
    select seen||coalesce(array_agg((item->>'id')::uuid order by ordinal),'{}'::uuid[]) into seen
      from jsonb_array_elements(response->'data') with ordinality e(item,ordinal);
    loops:=loops+1;
    if loops>10 then raise exception 'Pagination loop did not terminate'; end if;
    exit when not (response->'page'->>'has_more')::boolean;
    cursor_value:=response->'page'->>'next_cursor';
    if cursor_value is null then raise exception 'Missing next cursor'; end if;
  end loop;
  -- Privilege boundary remains explicit: compare only the known fixture size here.
  if cardinality(seen)<>213 or (select count(distinct id) from unnest(seen) id)<>213 then
    raise exception 'Rows skipped or duplicated across tied timestamps';
  end if;
  perform set_config('test.seen',array_to_json(seen)::text,true);
end;
$$;
select is(jsonb_array_length(current_setting('test.seen')::jsonb),213,'all records reachable once with timestamp ties');
select throws_ok($$select api.list_members_page('15000000-0000-4000-8000-000000000001',201)$$,'PT400','VALIDATION_ERROR','limit cannot exceed 200');
select throws_ok($$select api.list_members_page('15000000-0000-4000-8000-000000000001',0)$$,'PT400','VALIDATION_ERROR','limit cannot be zero');
select throws_ok($$select api.list_members_page('15000000-0000-4000-8000-000000000001',null)$$,'PT400','VALIDATION_ERROR','explicit null limit is rejected');
select throws_ok(format('select api.list_members_page(%L,50,%L)','15000000-0000-4000-8000-000000000001',value),'PT400','VALIDATION_ERROR','malformed raw cursor rejected')
 from (values(''),('!'),('a'),(repeat('A',1025))) v(value);
select throws_ok(format('select api.list_members_page(%L,50,%L)','15000000-0000-4000-8000-000000000001',
 rtrim(translate(replace(encode(convert_to(value::text,'UTF8'),'base64'),E'\n',''),'+/','-_'),'=')),
 'PT400','VALIDATION_ERROR','malformed or cross-tenant structured cursor rejected')
 from (values
 ('null'::jsonb), ('[]'::jsonb), ('{}'::jsonb),
 (jsonb_build_object('v',2,'business_id','15000000-0000-4000-8000-000000000001','id','25000000-0000-4000-8000-000000000003','created_at','2026-10-01T10:00:00Z')),
 (jsonb_build_object('v',1,'business_id','15000000-0000-4000-8000-000000000002','id','25000000-0000-4000-8000-000000000003','created_at','2026-10-01T10:00:00Z')),
 (jsonb_build_object('v',1,'business_id','15000000-0000-4000-8000-000000000001','id','invalid','created_at','2026-10-01T10:00:00Z')),
 (jsonb_build_object('v',1,'business_id','15000000-0000-4000-8000-000000000001','id','25000000-0000-4000-8000-000000000003','created_at','2026-02-30T10:00:00Z')),
 (jsonb_build_object('v',1,'business_id','15000000-0000-4000-8000-000000000001','id','25000000-0000-4000-8000-000000000003','created_at','Infinity')),
 (jsonb_build_object('v',1,'business_id','15000000-0000-4000-8000-000000000001','id','25000000-0000-4000-8000-000000000003','created_at','2026-10-01T10:00:00Z','extra',true))
 ) v(value);
select throws_ok($$select api.list_members_page('15000000-0000-4000-8000-000000000002',50,'bad')$$,'PT404','NOT_FOUND','tenant authorization precedes cursor details');
set local "request.jwt.claims"='{"aal":"aal1"}';
select throws_ok($$select api.list_members_page('15000000-0000-4000-8000-000000000001')$$,'PT403','MFA_REQUIRED','each page enforces MFA');
set local "request.jwt.claims"='{"aal":"aal2"}';
set local "request.headers"='{"x-request-id":"45000000-0000-4000-8000-000000000001"}';
select is(api.update_member('15000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000003','barber','suspended','35000000-0000-4000-8000-000000000001',1)->>'version','2','traced update succeeds');
set local "request.headers"='{"x-request-id":"45000000-0000-4000-8000-000000000002"}';
select is(api.update_member('15000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000003','barber','suspended','35000000-0000-4000-8000-000000000001',1)->>'version','2','new attempt replays original effect');
reset role;
select is((select request_id::text from public.audit_logs where business_id='15000000-0000-4000-8000-000000000001'),'45000000-0000-4000-8000-000000000001','audit uses first HTTP trace, never the key');
select is((select origin_request_id::text from app.member_requests where business_id='15000000-0000-4000-8000-000000000001'),'45000000-0000-4000-8000-000000000001','replay preserves original trace');
select is((select count(*) from public.audit_logs where business_id='15000000-0000-4000-8000-000000000001'),1::bigint,'replay adds no mutation audit');
update public.business_members set status='suspended' where id='25000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select api.list_members_page('15000000-0000-4000-8000-000000000001',50,current_setting('test.page_cursor'))$$,'PT404','NOT_FOUND','permission revoked between pages is enforced');
select throws_ok($$select api.update_member('15000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000003','barber','suspended','35000000-0000-4000-8000-000000000001',1)$$,'PT404','NOT_FOUND','trace does not authorize a replay after revocation');
set local "request.jwt.claim.sub"='05000000-0000-4000-8000-000000000001';
set local "request.headers"='{"x-request-id":"45000000-0000-4000-8000-000000000003"}';
select set_config('test.trace_invite',api.invite_member('15000000-0000-4000-8000-000000000001','trace-invite@example.test','barber',repeat('t',43),'35000000-0000-4000-8000-000000000002')->>'id',true);
set local "request.headers"='{"x-request-id":"45000000-0000-4000-8000-000000000004"}';
select is(api.manage_invitation('15000000-0000-4000-8000-000000000001',current_setting('test.trace_invite')::uuid,repeat('u',43),'35000000-0000-4000-8000-000000000003',1)->>'version','2','lifecycle remains traced');
set local "request.jwt.claim.sub"='05000000-0000-4000-8000-000000000005';
set local "request.jwt.claims"='{"aal":"aal1"}';
set local "request.headers"='{"x-request-id":"45000000-0000-4000-8000-000000000005"}';
select is(api.accept_invitation(repeat('u',43),'35000000-0000-4000-8000-000000000004')->>'version','3','acceptance remains traced');
reset role;
select is((select count(*) from public.audit_logs a join app.member_requests r on r.business_id=a.business_id and r.origin_request_id=a.request_id where a.business_id='15000000-0000-4000-8000-000000000001'),4::bigint,'all four mutation families correlate audit with original request');
select ok(not exists(select 1 from app.member_requests where result::text like '%'||repeat('t',43)||'%' or result::text like '%'||repeat('u',43)||'%'),'tracing never stores invitation secrets in results');
set local "request.headers"='malformed';
select lives_ok('select app.current_request_id()','malformed headers safely generate UUID');
set local "request.headers"='{"x-request-id":"invalid"}';
select isnt(app.current_request_id()::text,'invalid','invalid incoming trace safely generates UUID');
select * from finish();
rollback;
