-- PB-02..05: isolated-development public flow. All application tables remain private.
create table app.public_booking_runtime(id boolean primary key default true check(id),disposable boolean not null default false);
insert into app.public_booking_runtime(id,disposable) values(true,false);
create table app.public_attempts(id uuid primary key,business_id uuid not null references public.businesses(id),secret_hash bytea not null check(octet_length(secret_hash)=32),expires_at timestamptz not null,revoked_at timestamptz,created_at timestamptz not null default clock_timestamp(),unique(business_id,id));
create table app.public_quotes(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id),staff_id uuid not null,service_id uuid not null,versions jsonb not null,from_date date not null,days smallint not null,expires_at timestamptz not null default clock_timestamp()+interval '10 minutes',foreign key(business_id,staff_id) references public.staff_members(business_id,id),foreign key(business_id,service_id) references public.services(business_id,id),unique(business_id,id));
create table app.public_manage_tokens(business_id uuid not null,appointment_id uuid not null,generation integer not null check(generation>0),token_hash bytea not null check(octet_length(token_hash)=32),expires_at timestamptz not null,revoked_at timestamptz,envelope jsonb not null,issued_by_attempt uuid not null,created_at timestamptz not null default clock_timestamp(),primary key(business_id,appointment_id,generation),foreign key(business_id,appointment_id) references public.appointments(business_id,id),foreign key(business_id,issued_by_attempt) references app.public_attempts(business_id,id));
create table app.public_booking_requests(business_id uuid not null,authority_id uuid not null,operation text not null check(operation in ('create','cancel','reschedule','rotate')),key uuid not null,request_hash bytea not null,result jsonb not null,appointment_id uuid not null,generation integer not null,created_at timestamptz not null default clock_timestamp(),origin_request_id uuid not null,primary key(business_id,authority_id,operation,key),foreign key(business_id,appointment_id) references public.appointments(business_id,id));
create table app.public_rate_buckets(scope text not null,identity_hash bytea not null,bucket timestamptz not null,used integer not null check(used>0),primary key(scope,identity_hash,bucket));
create table app.public_challenges(nonce uuid primary key,expires_at timestamptz not null);
alter table app.public_booking_runtime enable row level security;alter table app.public_booking_runtime force row level security;
alter table app.public_attempts enable row level security;alter table app.public_attempts force row level security;
alter table app.public_quotes enable row level security;alter table app.public_quotes force row level security;
alter table app.public_manage_tokens enable row level security;alter table app.public_manage_tokens force row level security;
alter table app.public_booking_requests enable row level security;alter table app.public_booking_requests force row level security;
alter table app.public_rate_buckets enable row level security;alter table app.public_rate_buckets force row level security;
alter table app.public_challenges enable row level security;alter table app.public_challenges force row level security;
revoke all on app.public_booking_runtime,app.public_attempts,app.public_quotes,app.public_manage_tokens,app.public_booking_requests,app.public_rate_buckets,app.public_challenges from public,anon,authenticated,app_server,service_role;
create unique index public_one_token_generation on app.public_manage_tokens(business_id,appointment_id) where revoked_at is null;
create unique index public_unique_token_hash on app.public_manage_tokens(token_hash);
create table app.public_privacy_ack(business_id uuid not null,appointment_id uuid primary key,customer_id uuid not null,notice_version text not null,accepted_at timestamptz not null default clock_timestamp(),foreign key(business_id,appointment_id) references public.appointments(business_id,id),foreign key(business_id,customer_id) references public.customers(business_id,id));
alter table app.public_privacy_ack enable row level security;alter table app.public_privacy_ack force row level security;
revoke all on app.public_privacy_ack from public,anon,authenticated,app_server,service_role;
alter table public.appointments alter column created_by drop not null;
alter table public.appointments add column creator_type text not null default 'user',add column creator_attempt_id uuid;
alter table public.appointments add constraint appointment_creator check((creator_type='user' and created_by is not null and creator_attempt_id is null) or (creator_type='public' and created_by is null and creator_attempt_id is not null)),add foreign key(business_id,creator_attempt_id) references app.public_attempts(business_id,id);
create unique index public_one_created_intent on public.appointments(business_id,creator_attempt_id) where creator_attempt_id is not null;
alter table public.appointment_events alter column actor_user_id drop not null,alter column actor_member_id drop not null;
alter table public.appointment_events add column actor_type text not null default 'user',add column actor_attempt_id uuid;
alter table public.appointment_events add constraint appointment_event_actor check((actor_type='user' and actor_user_id is not null and actor_member_id is not null and actor_attempt_id is null) or (actor_type='public' and actor_user_id is null and actor_member_id is null and actor_attempt_id is not null)),add foreign key(business_id,actor_attempt_id) references app.public_attempts(business_id,id);
alter table public.audit_logs drop constraint audit_logs_actor_type_check;
alter table public.audit_logs add constraint audit_logs_actor_type_check check(actor_type in ('user','platform_admin','system','integration','public'));
alter table public.audit_logs add column actor_attempt_id uuid,add foreign key(business_id,actor_attempt_id) references app.public_attempts(business_id,id),add constraint audit_public_actor check((actor_type='public' and actor_user_id is null and actor_attempt_id is not null) or (actor_type<>'public' and actor_attempt_id is null));
alter table public.customers drop constraint customers_source_check;
alter table public.customers add constraint customers_source_check check(source in ('admin_api','public_booking'));

create function app.require_disposable_public() returns void language plpgsql stable set search_path='' as $$begin
 if not coalesce((select disposable from app.public_booking_runtime where id),false) then raise exception 'PUBLIC_BOOKING_DISABLED' using errcode='PT503';end if;
end;$$;
create function app.public_business(p_slug text,p_lock boolean default false) returns public.businesses language plpgsql volatile set search_path='' as $$
declare v public.businesses;begin
 perform app.require_disposable_public();
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'TRANSACTION_ISOLATION_UNSUPPORTED' using errcode='PT409';end if;
 if app_internal.get_public_business(p_slug) is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;
 if p_lock then select * into v from public.businesses where slug=p_slug for update;else select * into v from public.businesses where slug=p_slug;end if;
 perform app.require_disposable_public();
 if app_internal.get_public_business(p_slug) is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;return v;
end;$$;
create function app.public_attempt(p_business uuid,p_id uuid,p_secret text) returns app.public_attempts language plpgsql stable set search_path='' as $$
declare v app.public_attempts;begin
 select * into v from app.public_attempts where business_id=p_business and id=p_id and revoked_at is null and expires_at>clock_timestamp() and secret_hash=extensions.digest(p_secret,'sha256');
 if v.id is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;return v;
end;$$;
create function app.public_manage(p_business uuid,p_id uuid,p_token text) returns app.public_manage_tokens language plpgsql stable set search_path='' as $$
declare v app.public_manage_tokens;begin
 select * into v from app.public_manage_tokens where business_id=p_business and appointment_id=p_id and revoked_at is null and expires_at>clock_timestamp() and token_hash=extensions.digest(p_token,'sha256') order by generation desc limit 1;
 if v.appointment_id is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;return v;
end;$$;
create function app_internal.public_runtime_ready() returns boolean language sql stable security definer set search_path='' as $$select coalesce((select disposable from app.public_booking_runtime where id),false);$$;
create function app_internal.public_quota(p_scope text,p_identity text,p_nonce uuid default null,p_expires timestamptz default null) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare v_used integer;v_limit integer;begin
 perform app.require_disposable_public();
 if p_scope not in ('read','issue','write') or p_identity is null or length(p_identity)>200 then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 if p_scope='write' then
  if p_nonce is null or p_expires is null or p_expires<=clock_timestamp() or p_expires>clock_timestamp()+interval '3 minutes' then return false;end if;
  insert into app.public_challenges(nonce,expires_at) values(p_nonce,p_expires) on conflict do nothing;if not found then return false;end if;
 end if;
 v_limit:=case p_scope when 'read' then 100 when 'issue' then 10 else 20 end;
 insert into app.public_rate_buckets(scope,identity_hash,bucket,used) values(p_scope,extensions.digest(p_identity,'sha256'),date_trunc('minute',clock_timestamp()),1)
 on conflict(scope,identity_hash,bucket) do update set used=app.public_rate_buckets.used+1 returning used into v_used;
 return v_used<=v_limit;
end;$$;
create function app_internal.public_issue_attempt(p_slug text,p_id uuid,p_secret text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v public.businesses;begin
 v:=app.public_business(p_slug,false);
 if p_id is null or p_secret is null or p_secret !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 insert into app.public_attempts(id,business_id,secret_hash,expires_at) values(p_id,v.id,extensions.digest(p_secret,'sha256'),clock_timestamp()+interval '48 hours');
 return jsonb_build_object('id',p_id,'expires_at',(select expires_at from app.public_attempts where id=p_id),'privacy_policy_version',(select privacy_policy_version from public.business_settings where business_id=v.id),'require_email',(select require_email from public.business_settings where business_id=v.id));
end;$$;

create or replace function app.guard_appointment() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_APPOINTMENT' using errcode='PT409';end if;
 if tg_op='UPDATE' then
  if (new.id,new.business_id,new.customer_id,new.staff_member_id,new.service_id,new.created_at,new.created_by,new.creator_type,new.creator_attempt_id,new.service_name_snapshot,new.price_cents_snapshot,new.currency,new.duration_minutes_snapshot,new.buffer_minutes_snapshot) is distinct from (old.id,old.business_id,old.customer_id,old.staff_member_id,old.service_id,old.created_at,old.created_by,old.creator_type,old.creator_attempt_id,old.service_name_snapshot,old.price_cents_snapshot,old.currency,old.duration_minutes_snapshot,old.buffer_minutes_snapshot) then raise exception 'IMMUTABLE_SNAPSHOT' using errcode='PT409';end if;
  if old.status='cancelled' then raise exception 'IMMUTABLE_APPOINTMENT' using errcode='PT409';end if;
 end if;
 new.ends_at:=((new.starts_at at time zone 'UTC')+make_interval(mins=>new.duration_minutes_snapshot)) at time zone 'UTC';
 new.blocked_until:=((new.ends_at at time zone 'UTC')+make_interval(mins=>new.buffer_minutes_snapshot)) at time zone 'UTC';
 if new.status='cancelled' then new.cancelled_at:=clock_timestamp();else new.cancelled_at:=null;end if;return new;
end;$$;
create function app.schedule_snapshot(p_business_id uuid,p_staff_id uuid,p_service_id uuid,p_from text,p_days integer default 1) returns jsonb language plpgsql stable set search_path='' as $$
declare v_actor public.business_members;v_staff public.staff_members;v_service public.services;v_link public.staff_services;v_zone text;v_today date;v_from date;v_date date;v_settings public.business_settings;v_intervals jsonb;v_global public.schedule_exceptions;v_own public.schedule_exceptions;v_days jsonb:='[]';v_resolved jsonb;v_candidates jsonb;v_item jsonb;v_start timestamptz;v_end timestamptz;v_warning text;v_now timestamptz:=clock_timestamp();
begin

 select * into v_staff from public.staff_members where business_id=p_business_id and id=p_staff_id;
 select * into v_service from public.services where business_id=p_business_id and id=p_service_id and active and deleted_at is null;
 select * into v_link from public.staff_services where business_id=p_business_id and staff_member_id=p_staff_id and service_id=p_service_id;
 if not v_staff.active or v_service.id is null or v_link.service_id is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;
 select timezone,(v_now at time zone timezone)::date into v_zone,v_today from public.businesses where id=p_business_id;
 select * into v_settings from public.business_settings where business_id=p_business_id;
 v_from:=app.schedule_date(p_from);
 if p_days is null or p_days<1 or p_days>7 or v_from<v_today or v_from+p_days-1>v_today+v_settings.max_advance_days then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 for v_date in select generate_series(v_from::timestamp,(v_from+p_days-1)::timestamp,interval '1 day')::date loop
  select * into v_global from public.schedule_exceptions where business_id=p_business_id and staff_member_id is null and local_date=v_date and deleted_at is null;
  select * into v_own from public.schedule_exceptions where business_id=p_business_id and staff_member_id=p_staff_id and local_date=v_date and deleted_at is null;
  if v_global.kind='closed' or v_own.kind='closed' then v_intervals:='[]';
  elsif v_own.id is not null then v_intervals:=v_own.intervals;
  elsif v_global.id is not null then v_intervals:=v_global.intervals;
  else
   select coalesce(jsonb_agg(jsonb_build_object('start_minute',h.start_minute,'end_minute',h.end_minute) order by h.start_minute),'[]') into v_intervals from public.working_hours h where h.business_id=p_business_id and h.weekday=extract(isodow from v_date) and h.plan_id=(select p.id from public.staff_working_plans p where p.business_id=p_business_id and p.staff_member_id=p_staff_id and p.superseded_at is null and p.effective_from<=v_date order by p.effective_from desc limit 1);
  end if;
  v_resolved:='[]';v_warning:=null;
  for v_item in select value from jsonb_array_elements(v_intervals) loop
   v_start:=app.schedule_instant(v_date,(v_item->>'start_minute')::integer,v_zone);v_end:=app.schedule_instant(v_date,(v_item->>'end_minute')::integer,v_zone);
   if v_start is null or v_end is null or v_end<=v_start then v_warning:='INVALID_LOCAL_INTERVAL';else v_resolved:=v_resolved||jsonb_build_array(jsonb_build_object('start',v_start,'end',v_end));end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('start',t,'label',to_char(t at time zone v_zone,'HH24:MI')) order by t),'[]') into v_candidates from (
   select t,row_number() over(partition by t at time zone v_zone order by t) n from jsonb_array_elements(v_resolved) a cross join lateral generate_series((a->>'start')::timestamptz,(a->>'end')::timestamptz-interval '1 minute',interval '1 minute') t
   where (extract(hour from t at time zone v_zone)::integer*60+extract(minute from t at time zone v_zone)::integer)%v_settings.slot_interval_minutes=0
  ) c where n=1;
  v_days:=v_days||jsonb_build_array(jsonb_build_object('date',v_date,'intervals',v_resolved,'candidates',v_candidates,'warning',v_warning));
 end loop;
 return jsonb_build_object('mode','schedule_preview','can_book',false,'occupancy_checked',true,'timezone',v_zone,'now',v_now,'staff_id',p_staff_id,'staff_version',v_staff.version,'service_id',p_service_id,'service_version',v_service.version,'global_version',coalesce((select version from app.calendar_controls where business_id=p_business_id),1),'settings_version',v_settings.version,'business_version',(select version from public.businesses where id=p_business_id),'occupied',coalesce((select jsonb_agg(jsonb_build_object('start',o.starts_at,'end',o.blocked_until)) from app.appointment_occupancy o where o.business_id=p_business_id and o.staff_member_id=p_staff_id and o.released_at is null and o.starts_at<((v_from+p_days)::timestamp at time zone v_zone)+interval '26 hours' and o.blocked_until>(v_from::timestamp at time zone v_zone)-interval '26 hours'),'[]'),'duration_minutes',coalesce(v_link.duration_override_minutes,v_service.duration_minutes),'buffer_minutes',v_service.buffer_minutes,'min_notice_minutes',v_settings.min_notice_minutes,'price_cents',coalesce(v_link.price_override_cents,v_service.price_cents),'days',v_days,'blocks',coalesce((select jsonb_agg(jsonb_build_object('start',starts_at,'end',ends_at)) from public.time_blocks where business_id=p_business_id and (staff_member_id is null or staff_member_id=p_staff_id) and deleted_at is null and ends_at>v_now),'[]'));
end;$$;

create or replace function api.schedule_preview_source(p_business_id uuid,p_staff_id uuid,p_service_id uuid,p_from text,p_days integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform app.require_schedule_staff(p_business_id,p_staff_id);return app.schedule_snapshot(p_business_id,p_staff_id,p_service_id,p_from,p_days);
end;$$;

create function app.apply_appointment_change(p_business_id uuid,p_action text,p_id uuid,p_customer uuid,p_staff uuid,p_service uuid,p_start timestamptz,p_reason text,p_actor_user uuid,p_actor_member uuid,p_attempt uuid) returns jsonb language plpgsql volatile set search_path='' as $$
declare v_old public.appointments;v_new public.appointments;v_service public.services;v_link public.staff_services;v_actor public.business_members;v_result jsonb;v_before jsonb;v_event uuid;v_event_type text;v_generation integer;v_trace uuid:=app.current_request_id();
begin
 if p_attempt is null then
  v_actor:=app.require_member(p_business_id,true);if v_actor.id is distinct from p_actor_member or auth.uid() is distinct from p_actor_user then raise exception 'FORBIDDEN' using errcode='PT403';end if;
 elsif p_actor_user is not null or p_actor_member is not null or not exists(select 1 from app.public_attempts where id=p_attempt and business_id=p_business_id) then raise exception 'FORBIDDEN' using errcode='PT403';end if;
 select * into v_old from public.appointments where business_id=p_business_id and id=p_id;
 select * into v_service from public.services where business_id=p_business_id and id=p_service;
 select * into v_link from public.staff_services where business_id=p_business_id and staff_member_id=p_staff and service_id=p_service;
 if p_action='create' then
  insert into public.appointments(id,business_id,customer_id,staff_member_id,service_id,starts_at,ends_at,blocked_until,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,buffer_minutes_snapshot,created_by,creator_type,creator_attempt_id)
   values(p_id,p_business_id,p_customer,p_staff,p_service,p_start,p_start,p_start,v_service.name,coalesce(v_link.price_override_cents,v_service.price_cents),coalesce(v_link.duration_override_minutes,v_service.duration_minutes),v_service.buffer_minutes,p_actor_user,case when p_attempt is null then 'user' else 'public' end,p_attempt) returning * into v_new;v_event_type:='created';
 else
  v_before:=jsonb_build_object('status',v_old.status,'version',v_old.version,'starts_at',v_old.starts_at,'ends_at',v_old.ends_at,'blocked_until',v_old.blocked_until);
  update app.appointment_occupancy set released_at=clock_timestamp() where business_id=p_business_id and appointment_id=p_id and released_at is null;
  if p_action='reschedule' then update public.appointments set starts_at=p_start where business_id=p_business_id and id=p_id returning * into v_new;v_event_type:='rescheduled';
  else update public.appointments set status='cancelled' where business_id=p_business_id and id=p_id returning * into v_new;v_event_type:='cancelled';end if;
 end if;
 if p_action<>'cancel' then
  select coalesce(max(generation),0)+1 into v_generation from app.appointment_occupancy where business_id=p_business_id and appointment_id=p_id;
  insert into app.appointment_occupancy(business_id,appointment_id,staff_member_id,generation,starts_at,blocked_until) values(p_business_id,p_id,p_staff,v_generation,v_new.starts_at,v_new.blocked_until);
 end if;
 v_result:=jsonb_build_object('id',p_id,'business_id',p_business_id,'status',v_new.status,'version',v_new.version,'starts_at',v_new.starts_at,'ends_at',v_new.ends_at,'blocked_until',v_new.blocked_until);
 insert into public.appointment_events(business_id,appointment_id,version,event_type,actor_user_id,actor_member_id,reason,before_data,after_data,request_id,actor_type,actor_attempt_id) values(p_business_id,p_id,v_new.version,v_event_type,p_actor_user,p_actor_member,p_reason,v_before,v_result,v_trace,case when p_attempt is null then 'user' else 'public' end,p_attempt) returning id into v_event;
 insert into app.appointment_outbox(business_id,event_id,appointment_id,version,event_type,payload) values(p_business_id,v_event,p_id,v_new.version,v_event_type,jsonb_build_object('appointment_id',p_id,'event_id',v_event,'version',v_new.version));
 insert into public.audit_logs(business_id,actor_type,actor_user_id,action,entity_type,entity_id,before_data,after_data,request_id,actor_attempt_id) values(p_business_id,case when p_attempt is null then 'user' else 'public' end,p_actor_user,'appointment.'||v_event_type,'appointment',p_id,v_before,v_result,v_trace,p_attempt);
 return v_result;
end;$$;

create or replace function api.manage_appointment(p_business_id uuid,p_action text,p_id uuid,p_data jsonb,p_key uuid,p_expected integer default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor public.business_members;v_old public.appointments;v_new public.appointments;v_staff public.staff_members;v_service public.services;v_customer public.customers;v_link public.staff_services;v_previous app.appointment_requests;v_context jsonb;v_actual jsonb;v_hash bytea;v_canonical jsonb;v_start timestamptz;v_customer_id uuid;v_staff_id uuid;v_service_id uuid;v_reason text;v_result jsonb;v_before jsonb;v_event uuid;v_event_type text;v_generation integer;v_constraint text;v_trace uuid:=app.current_request_id();
begin
 v_actor:=app.require_member(p_business_id,true);
 if p_id is null or p_key is null or p_action is null or p_action not in ('create','reschedule','cancel') or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 if p_action='create' then
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('customer_id','staff_id','service_id','starts_at','context_versions')) then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
  if p_expected is not null then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
  v_customer_id:=(p_data->>'customer_id')::uuid;v_staff_id:=(p_data->>'staff_id')::uuid;v_service_id:=(p_data->>'service_id')::uuid;
  if v_customer_id is null or v_staff_id is null or v_service_id is null then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 else
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('starts_at','context_versions','reason') or (p_action='cancel' and k<>'reason')) then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
  if p_data ? 'reason' and jsonb_typeof(p_data->'reason') not in ('string','null') then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;v_reason:=app.schedule_reason(p_data->>'reason');
 end if;
 if p_action<>'cancel' then
  if jsonb_typeof(p_data->'starts_at') is distinct from 'string' or p_data->>'starts_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
  v_start:=(p_data->>'starts_at')::timestamptz;if not isfinite(v_start) then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
  v_context:=app.appointment_context(p_data->'context_versions',p_action);
 else v_context:='{}';end if;
 v_canonical:=jsonb_build_object('customer_id',v_customer_id,'staff_id',v_staff_id,'service_id',v_service_id,'starts_at',case when v_start is not null then to_char(v_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,'context',v_context,'reason',v_reason,'expected',p_expected);
 v_actor:=app.lock_managed_business(p_business_id);
 v_hash:=extensions.digest(jsonb_build_array(1,p_business_id,auth.uid(),p_action,p_id,v_canonical)::text,'sha256');
 select * into v_previous from app.appointment_requests where business_id=p_business_id and user_id=auth.uid() and operation=p_action and key=p_key for update;
 if v_previous.key is not null and v_previous.created_at<=clock_timestamp()-interval '48 hours' then delete from app.appointment_requests where business_id=p_business_id and user_id=auth.uid() and operation=p_action and key=p_key;v_previous:=null;end if;
 if p_action<>'create' then
  select * into v_old from public.appointments where business_id=p_business_id and id=p_id;
  if v_old.id is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;v_staff_id:=v_old.staff_member_id;v_customer_id:=v_old.customer_id;v_service_id:=v_old.service_id;
 end if;
 select * into v_staff from public.staff_members where business_id=p_business_id and id=v_staff_id for update;
 select * into v_customer from public.customers where business_id=p_business_id and id=v_customer_id for update;
 if v_staff.id is null or v_customer.id is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;
 if p_action<>'create' then select * into v_old from public.appointments where business_id=p_business_id and id=p_id for update;end if;
 if v_previous.key is not null then
  if not exists(select 1 from public.appointments where business_id=p_business_id and id=p_id) then raise exception 'NOT_FOUND' using errcode='PT404';end if;
  if v_previous.request_hash<>v_hash then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='PT409';end if;return v_previous.result;
 end if;
 if p_action='create' then
  if exists(select 1 from public.appointments where id=p_id) then raise exception 'DUPLICATE_RESOURCE' using errcode='PT409';end if;
 else
  if p_expected is null then raise exception 'PRECONDITION_REQUIRED' using errcode='PT428';end if;
  if p_expected<>v_old.version then raise exception 'PRECONDITION_FAILED' using errcode='PT412';end if;
 end if;
 select * into v_service from public.services where business_id=p_business_id and id=v_service_id;
 if p_action<>'cancel' then
  if v_service.id is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;
  v_actual:=jsonb_build_object('staff',v_staff.version,'service',v_service.version,'customer',v_customer.version,'calendar',coalesce((select version from app.calendar_controls where business_id=p_business_id),1),'settings',(select version from public.business_settings where business_id=p_business_id),'business',(select version from public.businesses where id=p_business_id));
  perform app.check_appointment_context(v_context,v_actual);
 end if;
 if p_action<>'create' and (v_old.status<>'confirmed' or v_old.starts_at<=clock_timestamp()) then raise exception 'APPOINTMENT_STATE_CONFLICT' using errcode='PT409';end if;
 if p_action<>'cancel' then
  if not v_staff.active or v_staff.deleted_at is not null or not v_service.active or v_service.deleted_at is not null or (p_action='create' and v_customer.deleted_at is not null) then raise exception 'RESOURCE_STATE_CONFLICT' using errcode='PT409';end if;
  select * into v_link from public.staff_services where business_id=p_business_id and staff_member_id=v_staff_id and service_id=v_service_id;
  if v_link.service_id is null then raise exception 'SERVICE_NOT_AVAILABLE' using errcode='PT409';end if;
  if not app.appointment_time_allowed(p_business_id,v_staff_id,v_start,case when p_action='create' then coalesce(v_link.duration_override_minutes,v_service.duration_minutes) else v_old.duration_minutes_snapshot end,case when p_action='create' then v_service.buffer_minutes else v_old.buffer_minutes_snapshot end,true) then raise exception 'TIME_NOT_ALLOWED' using errcode='PT409';end if;
 end if;
 v_result:=app.apply_appointment_change(p_business_id,p_action,p_id,v_customer_id,v_staff_id,v_service_id,v_start,v_reason,auth.uid(),v_actor.id,null);
 insert into app.appointment_requests(business_id,user_id,operation,key,request_hash,result,origin_request_id) values(p_business_id,auth.uid(),p_action,p_key,v_hash,v_result,v_trace);return v_result;
exception
 when exclusion_violation then get stacked diagnostics v_constraint=constraint_name;if v_constraint='appointment_occupancy_no_overlap' then raise exception 'SLOT_TAKEN' using errcode='PT409';else raise;end if;
 when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR' using errcode='PT400';
end;$$;

create or replace function api.read_appointment(p_business_id uuid,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;begin
 perform app.require_member(p_business_id,true);
 select jsonb_build_object('id',a.id,'business_id',a.business_id,'customer_id',a.customer_id,'customer_name',c.full_name,'phone_raw',c.phone_raw,'customer_version',c.version,'staff_id',a.staff_member_id,'staff_name',s.display_name,'service_id',a.service_id,'service_name',a.service_name_snapshot,'price_cents',a.price_cents_snapshot,'currency',a.currency,'duration_minutes',a.duration_minutes_snapshot,'buffer_minutes',a.buffer_minutes_snapshot,'starts_at',a.starts_at,'ends_at',a.ends_at,'blocked_until',a.blocked_until,'status',a.status,'version',a.version,'cancelled_at',a.cancelled_at,'timezone',b.timezone,'now',clock_timestamp(),
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'version',e.version,'event_type',e.event_type,'reason',e.reason,'created_at',e.created_at,'actor_user_id',e.actor_user_id,'actor_type',e.actor_type) order by e.version) from public.appointment_events e where e.business_id=a.business_id and e.appointment_id=a.id),'[]')) into v
 from public.appointments a join public.customers c on c.business_id=a.business_id and c.id=a.customer_id join public.staff_members s on s.business_id=a.business_id and s.id=a.staff_member_id join public.businesses b on b.id=a.business_id where a.business_id=p_business_id and a.id=p_id;
 if v is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;return v;
end;$$;
create function app_internal.public_availability(p_slug text,p_staff uuid,p_service uuid,p_from text,p_days integer default 1,p_appointment uuid default null,p_token text default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_business public.businesses;v_source jsonb;v_quote uuid;v public.appointments;v_cap app.public_manage_tokens;
begin
 v_business:=app.public_business(p_slug,false);
 if p_appointment is not null then
  v_cap:=app.public_manage(v_business.id,p_appointment,p_token);select * into v from public.appointments where business_id=v_business.id and id=p_appointment;
  if v.status<>'confirmed' or v.starts_at<=clock_timestamp() then raise exception 'APPOINTMENT_STATE_CONFLICT' using errcode='PT409';end if;
  p_staff:=v.staff_member_id;p_service:=v.service_id;
 end if;
 if not exists(select 1 from public.staff_members where business_id=v_business.id and id=p_staff and active and deleted_at is null and accepts_online) then raise exception 'NOT_FOUND' using errcode='PT404';end if;
 v_source:=app.schedule_snapshot(v_business.id,p_staff,p_service,p_from,p_days);
 if p_appointment is not null then
  v_source:=v_source||jsonb_build_object('duration_minutes',v.duration_minutes_snapshot,'buffer_minutes',v.buffer_minutes_snapshot,'price_cents',v.price_cents_snapshot,'occupied',coalesce((select jsonb_agg(jsonb_build_object('start',starts_at,'end',blocked_until)) from app.appointment_occupancy where business_id=v_business.id and staff_member_id=p_staff and released_at is null and appointment_id<>p_appointment),'[]'));
 end if;
 insert into app.public_quotes(business_id,staff_id,service_id,versions,from_date,days) values(v_business.id,p_staff,p_service,jsonb_build_object('staff',v_source->'staff_version','service',v_source->'service_version','calendar',v_source->'global_version','settings',v_source->'settings_version','business',v_source->'business_version'),app.schedule_date(p_from),p_days) returning id into v_quote;
 return jsonb_build_object('quote_id',v_quote,'timezone',v_source->'timezone','price_cents',v_source->'price_cents','duration_minutes',v_source->'duration_minutes','slots',coalesce((
  select jsonb_agg(jsonb_build_object('date',d->>'date','start',c->>'start','end',to_char(((c->>'start')::timestamptz+make_interval(mins=>(v_source->>'duration_minutes')::integer)) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'label',c->>'label') order by (c->>'start')::timestamptz)
  from jsonb_array_elements(v_source->'days')d cross join lateral jsonb_array_elements(d->'candidates')c
  where (c->>'start')::timestamptz>=clock_timestamp()+make_interval(mins=>(v_source->>'min_notice_minutes')::integer)
  and exists(select 1 from jsonb_array_elements(d->'intervals')i where (i->>'start')::timestamptz<=(c->>'start')::timestamptz and (c->>'start')::timestamptz+make_interval(mins=>(v_source->>'duration_minutes')::integer)<=(i->>'end')::timestamptz)
  and not exists(select 1 from jsonb_array_elements((v_source->'blocks')||(v_source->'occupied'))b where (c->>'start')::timestamptz<(b->>'end')::timestamptz and (b->>'start')::timestamptz<(c->>'start')::timestamptz+make_interval(mins=>(v_source->>'duration_minutes')::integer+(v_source->>'buffer_minutes')::integer))
 ),'[]'));
end;$$;

create function app.public_validate_quote(p_business uuid,p_quote uuid,p_staff uuid,p_service uuid,p_start timestamptz) returns void language plpgsql stable set search_path='' as $$
declare q app.public_quotes;v_actual jsonb;v_date date;
begin
 select * into q from app.public_quotes where business_id=p_business and id=p_quote and staff_id=p_staff and service_id=p_service and expires_at>clock_timestamp();
 if q.id is null then raise exception 'PRECONDITION_FAILED' using errcode='PT412';end if;
 select (p_start at time zone timezone)::date into v_date from public.businesses where id=p_business;
 if v_date<q.from_date or v_date>=q.from_date+q.days then raise exception 'PRECONDITION_FAILED' using errcode='PT412';end if;
 v_actual:=jsonb_build_object('staff',(select version from public.staff_members where business_id=p_business and id=p_staff),'service',(select version from public.services where business_id=p_business and id=p_service),'calendar',coalesce((select version from app.calendar_controls where business_id=p_business),1),'settings',(select version from public.business_settings where business_id=p_business),'business',(select version from public.businesses where id=p_business));
 if q.versions is distinct from v_actual then raise exception 'PRECONDITION_FAILED' using errcode='PT412';end if;
end;$$;
create function app.public_token_envelope(p_envelope jsonb,p_expires timestamptz) returns void language plpgsql immutable set search_path='' as $$begin
 if p_expires is null or not isfinite(p_expires) or jsonb_typeof(p_envelope) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_envelope))<>4 or exists(select 1 from jsonb_each(p_envelope) e where e.key not in ('key_id','nonce','tag','ciphertext') or jsonb_typeof(e.value)<>'string')
 or p_envelope->>'key_id' !~ '^[A-Za-z0-9_-]{1,32}$' or p_envelope->>'nonce' !~ '^[A-Za-z0-9_-]{16}$' or p_envelope->>'tag' !~ '^[A-Za-z0-9_-]{22}$' or p_envelope->>'ciphertext' !~ '^[A-Za-z0-9_-]{58}$' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
end;$$;
create function app_internal.public_create(p_slug text,p_attempt uuid,p_secret text,p_id uuid,p_key uuid,p_data jsonb,p_token text,p_expires timestamptz,p_envelope jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare b public.businesses;cap app.public_attempts;old app.public_booking_requests;v_hash bytea;s public.staff_members;v_service public.services;v_settings public.business_settings;v_link public.staff_services;v_customer uuid:=gen_random_uuid();v_payload jsonb;v_start timestamptz;v_result jsonb;v_token app.public_manage_tokens;v_constraint text;
begin
 b:=app.public_business(p_slug,false);cap:=app.public_attempt(b.id,p_attempt,p_secret);
 if p_id is null or p_key is null or jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data)k where k not in ('staff_id','service_id','starts_at','quote_id','customer','privacy_policy_version')) then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 if p_data->>'starts_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;v_start:=(p_data->>'starts_at')::timestamptz;
 if v_start is null or not isfinite(v_start) then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 v_payload:=app.customer_payload(p_data->'customer');
 if v_payload->>'full_name' is null or v_payload->>'phone_raw' is null or (p_data->'customer') ? 'private_notes' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 b:=app.public_business(p_slug,true);cap:=app.public_attempt(b.id,p_attempt,p_secret);
 v_hash:=extensions.digest(jsonb_build_array(1,b.id,p_attempt,p_id,p_data-'starts_at',to_char(v_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'sha256');
 select * into old from app.public_booking_requests where business_id=b.id and authority_id=p_attempt and operation='create' and key=p_key for update;
 if old.key is not null and old.created_at>clock_timestamp()-interval '48 hours' then
  if old.request_hash<>v_hash then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='PT409';end if;
  select * into v_token from app.public_manage_tokens where business_id=b.id and appointment_id=old.appointment_id and generation=old.generation and revoked_at is null and expires_at>clock_timestamp();
  if v_token.appointment_id is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;
  return old.result||jsonb_build_object('envelope',v_token.envelope,'token_expires_at',v_token.expires_at,'generation',v_token.generation);
 end if;
 if exists(select 1 from public.appointments where id=p_id) then raise exception 'DUPLICATE_RESOURCE' using errcode='PT409';end if;
 if exists(select 1 from public.appointments where business_id=b.id and creator_attempt_id=p_attempt) then raise exception 'ATTEMPT_ALREADY_USED' using errcode='PT409';end if;
 if old.key is not null then delete from app.public_booking_requests where business_id=b.id and authority_id=p_attempt and operation='create' and key=p_key;end if;
 select * into s from public.staff_members where business_id=b.id and id=(p_data->>'staff_id')::uuid for update;
 select * into v_service from public.services where business_id=b.id and id=(p_data->>'service_id')::uuid;
 select * into v_link from public.staff_services where business_id=b.id and staff_member_id=s.id and service_id=v_service.id;
 if s.id is null or not s.active or s.deleted_at is not null or not s.accepts_online or v_service.id is null or not v_service.active or v_service.deleted_at is not null or v_link.service_id is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;
 select * into v_settings from public.business_settings where business_id=b.id;
 if not v_settings.auto_confirm then raise exception 'PUBLIC_CREATION_UNSUPPORTED' using errcode='PT409';end if;
 if v_settings.privacy_policy_version is null then raise exception 'PRIVACY_NOTICE_UNAVAILABLE' using errcode='PT503';end if;
 if p_data->>'privacy_policy_version' is distinct from v_settings.privacy_policy_version or (v_settings.require_email and v_payload->>'email' is null) then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 perform app.public_validate_quote(b.id,(p_data->>'quote_id')::uuid,s.id,v_service.id,v_start);
 if not app.appointment_time_allowed(b.id,s.id,v_start,coalesce(v_link.duration_override_minutes,v_service.duration_minutes),v_service.buffer_minutes,true) then raise exception 'TIME_NOT_ALLOWED' using errcode='PT409';end if;
 if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' or p_expires is distinct from v_start+interval '24 hours' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;perform app.public_token_envelope(p_envelope,p_expires);
 insert into public.customers(id,business_id,full_name,phone_raw,email,instagram_handle,phone_status,source) values(v_customer,b.id,v_payload->>'full_name',v_payload->>'phone_raw',v_payload->>'email',v_payload->>'instagram_handle',v_payload->>'phone_status','public_booking');
 v_result:=app.apply_appointment_change(b.id,'create',p_id,v_customer,s.id,v_service.id,v_start,null,null,null,p_attempt);
 insert into app.public_manage_tokens(business_id,appointment_id,generation,token_hash,expires_at,envelope,issued_by_attempt) values(b.id,p_id,1,extensions.digest(p_token,'sha256'),p_expires,p_envelope,p_attempt);
 insert into app.public_privacy_ack(business_id,appointment_id,customer_id,notice_version) values(b.id,p_id,v_customer,v_settings.privacy_policy_version);
 insert into app.public_booking_requests(business_id,authority_id,operation,key,request_hash,result,appointment_id,generation,origin_request_id) values(b.id,p_attempt,'create',p_key,v_hash,v_result,p_id,1,app.current_request_id());
 return v_result||jsonb_build_object('envelope',p_envelope,'token_expires_at',p_expires,'generation',1);
exception
 when exclusion_violation then get stacked diagnostics v_constraint=constraint_name;if v_constraint='appointment_occupancy_no_overlap' then raise exception 'SLOT_TAKEN' using errcode='PT409';else raise;end if;
 when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR' using errcode='PT400';
end;$$;
create function app_internal.public_read(p_slug text,p_id uuid,p_token text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare b public.businesses;cap app.public_manage_tokens;v jsonb;
begin
 b:=app.public_business(p_slug,false);cap:=app.public_manage(b.id,p_id,p_token);
 select jsonb_build_object('id',a.id,'business_id',b.id,'business_name',b.name,'service_name',a.service_name_snapshot,'staff_name',s.display_name,'price_cents',a.price_cents_snapshot,'duration_minutes',a.duration_minutes_snapshot,'starts_at',a.starts_at,'ends_at',a.ends_at,'status',a.status,'version',a.version,'timezone',b.timezone,'now',clock_timestamp(),'generation',cap.generation,'token_expires_at',cap.expires_at,
  'can_cancel',a.status='confirmed' and a.starts_at>clock_timestamp()+make_interval(hours=>t.cancellation_cutoff_hours),
  'can_reschedule',a.status='confirmed' and a.starts_at>clock_timestamp()+make_interval(hours=>t.reschedule_cutoff_hours) and (select count(*) from public.appointment_events where business_id=b.id and appointment_id=p_id and actor_type='public' and event_type='rescheduled')<t.max_client_reschedules)
 into v from public.appointments a join public.staff_members s on s.business_id=a.business_id and s.id=a.staff_member_id join public.business_settings t on t.business_id=a.business_id where a.business_id=b.id and a.id=p_id;
 if v is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;return v;
end;$$;
create function app_internal.public_change(p_slug text,p_id uuid,p_token text,p_action text,p_key uuid,p_expected integer,p_data jsonb,p_expires timestamptz default null,p_envelope jsonb default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare b public.businesses;cap app.public_manage_tokens;v public.appointments;s public.staff_members;t public.business_settings;v_service public.services;v_old app.public_booking_requests;v_start timestamptz;v_hash bytea;v_reason text;v_result jsonb;v_constraint text;
begin
 b:=app.public_business(p_slug,false);cap:=app.public_manage(b.id,p_id,p_token);
 if p_key is null or p_action is null or p_action not in ('cancel','reschedule') or jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data)k where k not in ('reason','starts_at','quote_id') or (p_action='cancel' and k<>'reason')) then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 if p_data ? 'reason' and jsonb_typeof(p_data->'reason') not in ('string','null') then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;v_reason:=app.schedule_reason(p_data->>'reason');
 if p_action='reschedule' then
  if p_data->>'starts_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;v_start:=(p_data->>'starts_at')::timestamptz;
  if v_start is null or not isfinite(v_start) then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 end if;
 b:=app.public_business(p_slug,true);cap:=app.public_manage(b.id,p_id,p_token);
 v_hash:=extensions.digest(jsonb_build_array(1,b.id,p_id,cap.generation,p_action,p_expected,p_data-'starts_at',case when v_start is not null then to_char(v_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end)::text,'sha256');
 select * into v_old from app.public_booking_requests where business_id=b.id and authority_id=cap.issued_by_attempt and operation=p_action and key=p_key for update;
 if v_old.key is not null and v_old.created_at>clock_timestamp()-interval '48 hours' then
  if v_old.generation<>cap.generation or v_old.appointment_id<>p_id then raise exception 'NOT_FOUND' using errcode='PT404';end if;
  if v_old.request_hash<>v_hash then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='PT409';end if;return v_old.result;
 end if;
 if v_old.key is not null then delete from app.public_booking_requests where business_id=b.id and authority_id=cap.issued_by_attempt and operation=p_action and key=p_key;end if;
 select * into v from public.appointments where business_id=b.id and id=p_id;
 select * into s from public.staff_members where business_id=b.id and id=v.staff_member_id for update;
 perform 1 from public.customers where business_id=b.id and id=v.customer_id for update;
 select * into v from public.appointments where business_id=b.id and id=p_id for update;
 if p_expected is null then raise exception 'PRECONDITION_REQUIRED' using errcode='PT428';end if;
 if p_expected<>v.version then raise exception 'PRECONDITION_FAILED' using errcode='PT412';end if;
 if v.status<>'confirmed' or v.starts_at<=clock_timestamp() then raise exception 'APPOINTMENT_STATE_CONFLICT' using errcode='PT409';end if;
 select * into t from public.business_settings where business_id=b.id;
 if (p_action='cancel' and v.starts_at<=clock_timestamp()+make_interval(hours=>t.cancellation_cutoff_hours)) or (p_action='reschedule' and (v.starts_at<=clock_timestamp()+make_interval(hours=>t.reschedule_cutoff_hours) or (select count(*) from public.appointment_events where business_id=b.id and appointment_id=p_id and actor_type='public' and event_type='rescheduled')>=t.max_client_reschedules)) then raise exception 'POLICY_WINDOW_CLOSED' using errcode='PT409';end if;
 if p_action='reschedule' then
  select * into v_service from public.services where business_id=b.id and id=v.service_id and active and deleted_at is null;
  if not s.active or s.deleted_at is not null or not s.accepts_online or v_service.id is null or not exists(select 1 from public.staff_services where business_id=b.id and staff_member_id=s.id and service_id=v.service_id) then raise exception 'RESOURCE_STATE_CONFLICT' using errcode='PT409';end if;
  perform app.public_validate_quote(b.id,(p_data->>'quote_id')::uuid,s.id,v.service_id,v_start);
  if not app.appointment_time_allowed(b.id,s.id,v_start,v.duration_minutes_snapshot,v.buffer_minutes_snapshot,true) then raise exception 'TIME_NOT_ALLOWED' using errcode='PT409';end if;
  if p_expires is distinct from v_start+interval '24 hours' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;perform app.public_token_envelope(p_envelope,p_expires);
 end if;
 v_result:=app.apply_appointment_change(b.id,p_action,p_id,v.customer_id,s.id,v.service_id,v_start,v_reason,null,null,cap.issued_by_attempt);
 if p_action='reschedule' then update app.public_manage_tokens set expires_at=p_expires,envelope=p_envelope where business_id=b.id and appointment_id=p_id and generation=cap.generation and revoked_at is null and expires_at>clock_timestamp();if not found then raise exception 'NOT_FOUND' using errcode='PT404';end if;end if;
 v_result:=v_result||jsonb_build_object('token_expires_at',case when p_action='reschedule' then p_expires else cap.expires_at end);
 insert into app.public_booking_requests(business_id,authority_id,operation,key,request_hash,result,appointment_id,generation,origin_request_id) values(b.id,cap.issued_by_attempt,p_action,p_key,v_hash,v_result,p_id,cap.generation,app.current_request_id());return v_result;
exception
 when exclusion_violation then get stacked diagnostics v_constraint=constraint_name;if v_constraint='appointment_occupancy_no_overlap' then raise exception 'SLOT_TAKEN' using errcode='PT409';else raise;end if;
 when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR' using errcode='PT400';
end;$$;
create function app.rotate_public_capability(p_business uuid,p_id uuid,p_token text,p_expires timestamptz,p_envelope jsonb) returns integer language plpgsql volatile set search_path='' as $$
declare v app.public_manage_tokens;n integer;begin
 perform app.require_disposable_public();perform 1 from public.businesses where id=p_business for update;
 select * into v from app.public_manage_tokens where business_id=p_business and appointment_id=p_id order by generation desc limit 1 for update;
 if v.appointment_id is null or p_token !~ '^[A-Za-z0-9_-]{43}$' or p_expires<=clock_timestamp() then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;perform app.public_token_envelope(p_envelope,p_expires);
 update app.public_manage_tokens set revoked_at=clock_timestamp() where business_id=p_business and appointment_id=p_id and revoked_at is null;
 n:=v.generation+1;insert into app.public_manage_tokens(business_id,appointment_id,generation,token_hash,expires_at,envelope,issued_by_attempt) values(p_business,p_id,n,extensions.digest(p_token,'sha256'),p_expires,p_envelope,v.issued_by_attempt);
 insert into public.audit_logs(business_id,actor_type,action,entity_type,entity_id,before_data,after_data,request_id) values(p_business,'system','public_token.rotated','appointment',p_id,jsonb_build_object('generation',v.generation),jsonb_build_object('generation',n,'expires_at',p_expires,'database_role',session_user),app.current_request_id());return n;
end;$$;
create function app.purge_public_booking(p_batch integer default 500) returns jsonb language plpgsql volatile set search_path='' as $$
declare n integer;q integer;c integer;r integer;
begin
 if p_batch is null or p_batch<1 or p_batch>500 then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 with old as materialized(select business_id,authority_id,operation,key from app.public_booking_requests where created_at<=clock_timestamp()-interval '48 hours' order by created_at limit p_batch for update skip locked),gone as(delete from app.public_booking_requests t using old o where (t.business_id,t.authority_id,t.operation,t.key)=(o.business_id,o.authority_id,o.operation,o.key) returning 1) select count(*)::integer into n from gone;
 with old as materialized(select id from app.public_quotes where expires_at<=clock_timestamp() order by expires_at,id limit p_batch for update skip locked),gone as(delete from app.public_quotes t using old o where t.id=o.id returning 1) select count(*)::integer into q from gone;
 with old as materialized(select nonce from app.public_challenges where expires_at<=clock_timestamp() order by expires_at,nonce limit p_batch for update skip locked),gone as(delete from app.public_challenges t using old o where t.nonce=o.nonce returning 1) select count(*)::integer into c from gone;
 with old as materialized(select scope,identity_hash,bucket from app.public_rate_buckets where bucket<clock_timestamp()-interval '2 minutes' order by bucket,scope,identity_hash limit p_batch for update skip locked),gone as(delete from app.public_rate_buckets t using old o where (t.scope,t.identity_hash,t.bucket)=(o.scope,o.identity_hash,o.bucket) returning 1) select count(*)::integer into r from gone;
 return jsonb_build_object('requests',n,'quotes',q,'challenges',c,'buckets',r);
end;$$;
revoke all on function app.require_disposable_public(),app.public_business(text,boolean),app.public_attempt(uuid,uuid,text),app.public_manage(uuid,uuid,text),app.schedule_snapshot(uuid,uuid,uuid,text,integer),app.apply_appointment_change(uuid,text,uuid,uuid,uuid,uuid,timestamptz,text,uuid,uuid,uuid),app.public_validate_quote(uuid,uuid,uuid,uuid,timestamptz),app.public_token_envelope(jsonb,timestamptz),app.rotate_public_capability(uuid,uuid,text,timestamptz,jsonb),app.purge_public_booking(integer) from public,anon,authenticated,app_server,service_role;
revoke all on function app_internal.public_runtime_ready(),app_internal.public_quota(text,text,uuid,timestamptz),app_internal.public_issue_attempt(text,uuid,text),app_internal.public_availability(text,uuid,uuid,text,integer,uuid,text),app_internal.public_create(text,uuid,text,uuid,uuid,jsonb,text,timestamptz,jsonb),app_internal.public_read(text,uuid,text),app_internal.public_change(text,uuid,text,text,uuid,integer,jsonb,timestamptz,jsonb) from public,anon,authenticated,app_server,service_role;
grant execute on function app_internal.public_runtime_ready(),app_internal.public_quota(text,text,uuid,timestamptz),app_internal.public_issue_attempt(text,uuid,text),app_internal.public_availability(text,uuid,uuid,text,integer,uuid,text),app_internal.public_create(text,uuid,text,uuid,uuid,jsonb,text,timestamptz,jsonb),app_internal.public_read(text,uuid,text),app_internal.public_change(text,uuid,text,text,uuid,integer,jsonb,timestamptz,jsonb) to app_server;
