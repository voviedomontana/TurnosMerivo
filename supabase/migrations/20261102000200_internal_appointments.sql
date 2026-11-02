-- Approved IN-01/02/03 only: future internal appointments; no public booking.
create extension if not exists btree_gist with schema extensions;
create table public.appointments(
 id uuid primary key,business_id uuid not null references public.businesses(id),customer_id uuid not null,staff_member_id uuid not null,service_id uuid not null,
 status text not null default 'confirmed' check(status in ('confirmed','cancelled')),
 starts_at timestamptz not null,ends_at timestamptz not null,blocked_until timestamptz not null,
 service_name_snapshot text not null check(length(service_name_snapshot) between 1 and 100),price_cents_snapshot integer not null check(price_cents_snapshot>=0),currency text not null default 'ARS' check(currency='ARS'),duration_minutes_snapshot smallint not null check(duration_minutes_snapshot between 5 and 480),buffer_minutes_snapshot smallint not null check(buffer_minutes_snapshot between 0 and 120),
 created_by uuid not null references public.users(id),cancelled_at timestamptz,version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(business_id,id),foreign key(business_id,customer_id) references public.customers(business_id,id),foreign key(business_id,staff_member_id) references public.staff_members(business_id,id),foreign key(business_id,service_id) references public.services(business_id,id),
 check(isfinite(starts_at) and isfinite(ends_at) and isfinite(blocked_until)),check(extract(epoch from ends_at-starts_at)=duration_minutes_snapshot*60),check(extract(epoch from blocked_until-ends_at)=buffer_minutes_snapshot*60),check((status='cancelled')=(cancelled_at is not null))
);
create index appointments_agenda on public.appointments(business_id,starts_at,id);
create index appointments_staff_agenda on public.appointments(business_id,staff_member_id,starts_at,id);
create table app.appointment_occupancy(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,appointment_id uuid not null,staff_member_id uuid not null,generation integer not null check(generation>0),starts_at timestamptz not null,blocked_until timestamptz not null,released_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 unique(business_id,appointment_id,generation),foreign key(business_id,appointment_id) references public.appointments(business_id,id),foreign key(business_id,staff_member_id) references public.staff_members(business_id,id),check(isfinite(starts_at) and isfinite(blocked_until) and starts_at<blocked_until),
 constraint appointment_occupancy_no_overlap exclude using gist(business_id with =,staff_member_id with =,tstzrange(starts_at,blocked_until,'[)') with &&) where(released_at is null)
);
create unique index appointment_one_current_allocation on app.appointment_occupancy(business_id,appointment_id) where released_at is null;
create table public.appointment_events(
 id uuid primary key default gen_random_uuid(),business_id uuid not null,appointment_id uuid not null,version integer not null check(version>0),event_type text not null check(event_type in ('created','rescheduled','cancelled')),actor_user_id uuid not null references public.users(id),actor_member_id uuid not null,reason text check(length(reason)<=500),before_data jsonb,after_data jsonb not null,request_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 unique(business_id,id),unique(business_id,appointment_id,version),foreign key(business_id,appointment_id) references public.appointments(business_id,id),foreign key(business_id,actor_member_id) references public.business_members(business_id,id)
);
create table app.appointment_outbox(business_id uuid not null,event_id uuid not null,appointment_id uuid not null,version integer not null,event_type text not null,payload jsonb not null,status text not null default 'pending' check(status='pending'),created_at timestamptz not null default clock_timestamp(),primary key(business_id,event_id),foreign key(business_id,event_id) references public.appointment_events(business_id,id),foreign key(business_id,appointment_id) references public.appointments(business_id,id));
create table app.appointment_requests(business_id uuid not null references public.businesses(id),user_id uuid not null references public.users(id),operation text not null check(operation in ('create','reschedule','cancel')),key uuid not null,canon_version integer not null default 1 check(canon_version=1),request_hash bytea not null,result jsonb not null,origin_request_id uuid not null,created_at timestamptz not null default clock_timestamp(),primary key(business_id,user_id,operation,key));
create index appointment_requests_age on app.appointment_requests(created_at);
alter table public.appointments enable row level security;alter table public.appointments force row level security;
alter table app.appointment_occupancy enable row level security;alter table app.appointment_occupancy force row level security;
alter table public.appointment_events enable row level security;alter table public.appointment_events force row level security;
alter table app.appointment_outbox enable row level security;alter table app.appointment_outbox force row level security;
alter table app.appointment_requests enable row level security;alter table app.appointment_requests force row level security;
revoke all on public.appointments,app.appointment_occupancy,public.appointment_events,app.appointment_outbox,app.appointment_requests from public,anon,authenticated,app_server,service_role;

create function app.guard_appointment() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_APPOINTMENT' using errcode='PT409';end if;
 if tg_op='UPDATE' then
  if (new.id,new.business_id,new.customer_id,new.staff_member_id,new.service_id,new.created_at,new.created_by,new.service_name_snapshot,new.price_cents_snapshot,new.currency,new.duration_minutes_snapshot,new.buffer_minutes_snapshot) is distinct from (old.id,old.business_id,old.customer_id,old.staff_member_id,old.service_id,old.created_at,old.created_by,old.service_name_snapshot,old.price_cents_snapshot,old.currency,old.duration_minutes_snapshot,old.buffer_minutes_snapshot) then raise exception 'IMMUTABLE_SNAPSHOT' using errcode='PT409';end if;
  if old.status='cancelled' then raise exception 'IMMUTABLE_APPOINTMENT' using errcode='PT409';end if;
 end if;
 new.ends_at:=((new.starts_at at time zone 'UTC')+make_interval(mins=>new.duration_minutes_snapshot)) at time zone 'UTC';
 new.blocked_until:=((new.ends_at at time zone 'UTC')+make_interval(mins=>new.buffer_minutes_snapshot)) at time zone 'UTC';
 if new.status='cancelled' then new.cancelled_at:=clock_timestamp();else new.cancelled_at:=null;end if;return new;
end;$$;
create trigger appointment_geometry before insert or update or delete on public.appointments for each row execute function app.guard_appointment();
create trigger appointment_touch before update on public.appointments for each row execute function app.touch_record();
create function app.guard_appointment_allocation() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_OCCUPANCY' using errcode='PT409';end if;
 if tg_op='UPDATE' and ((new.id,new.business_id,new.appointment_id,new.staff_member_id,new.generation,new.starts_at,new.blocked_until,new.created_at) is distinct from (old.id,old.business_id,old.appointment_id,old.staff_member_id,old.generation,old.starts_at,old.blocked_until,old.created_at) or old.released_at is not null or new.released_at is null) then raise exception 'IMMUTABLE_OCCUPANCY' using errcode='PT409';end if;return new;
end;$$;
create trigger allocation_history before update or delete on app.appointment_occupancy for each row execute function app.guard_appointment_allocation();
create function app.check_appointment_occupancy() returns trigger language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_business uuid;v public.appointments;v_count integer;
begin
 if tg_table_schema='public' and tg_table_name='appointments' then v_id:=coalesce(new.id,old.id);else v_id:=coalesce(new.appointment_id,old.appointment_id);end if;
 v_business:=coalesce(new.business_id,old.business_id);select * into v from public.appointments where business_id=v_business and id=v_id;
 if v.id is null then return null;end if;
 select count(*)::integer into v_count from app.appointment_occupancy where business_id=v_business and appointment_id=v_id and released_at is null;
 if (v.status='confirmed' and (v_count<>1 or not exists(select 1 from app.appointment_occupancy o where o.business_id=v_business and o.appointment_id=v_id and o.released_at is null and o.staff_member_id=v.staff_member_id and o.starts_at=v.starts_at and o.blocked_until=v.blocked_until))) or (v.status='cancelled' and v_count<>0) then raise exception 'APPOINTMENT_OCCUPANCY_INVALID' using errcode='PT409';end if;return null;
end;$$;
create constraint trigger appointment_allocation_consistency after insert or update or delete on public.appointments deferrable initially deferred for each row execute function app.check_appointment_occupancy();
create constraint trigger allocation_appointment_consistency after insert or update or delete on app.appointment_occupancy deferrable initially deferred for each row execute function app.check_appointment_occupancy();
create trigger appointment_events_immutable before update or delete on public.appointment_events for each row execute function app.reject_audit_mutation();

create function app.appointment_time_allowed(p_business_id uuid,p_staff_id uuid,p_start timestamptz,p_duration integer,p_buffer integer,p_policy boolean default true) returns boolean language plpgsql stable set search_path='' as $$
declare v_zone text;v_date date;v_today date;v_min integer;v_settings public.business_settings;v_now timestamptz:=clock_timestamp();v_global public.schedule_exceptions;v_own public.schedule_exceptions;v_intervals jsonb;v_item jsonb;v_start timestamptz;v_end timestamptz;v_finish timestamptz;v_blocked timestamptz;
begin
 if p_start is null or not isfinite(p_start) then return false;end if;
 select timezone into v_zone from public.businesses where id=p_business_id;select * into v_settings from public.business_settings where business_id=p_business_id;
 if v_zone is null or v_settings.business_id is null then return false;end if;
 v_date:=(p_start at time zone v_zone)::date;v_today:=(v_now at time zone v_zone)::date;
 v_min:=extract(hour from p_start at time zone v_zone)::integer*60+extract(minute from p_start at time zone v_zone)::integer;
 if v_min%v_settings.slot_interval_minutes<>0 or app.schedule_instant(v_date,v_min,v_zone) is distinct from p_start then return false;end if;
 if p_policy and (p_start<=v_now or p_start<v_now+make_interval(mins=>v_settings.min_notice_minutes) or v_date>v_today+v_settings.max_advance_days or v_date<v_today) then return false;end if;
 v_finish:=((p_start at time zone 'UTC')+make_interval(mins=>p_duration)) at time zone 'UTC';v_blocked:=((v_finish at time zone 'UTC')+make_interval(mins=>p_buffer)) at time zone 'UTC';
 if exists(select 1 from public.time_blocks b where b.business_id=p_business_id and (b.staff_member_id is null or b.staff_member_id=p_staff_id) and b.deleted_at is null and b.starts_at<v_blocked and p_start<b.ends_at) then return false;end if;
 select * into v_global from public.schedule_exceptions where business_id=p_business_id and staff_member_id is null and local_date=v_date and deleted_at is null;
 select * into v_own from public.schedule_exceptions where business_id=p_business_id and staff_member_id=p_staff_id and local_date=v_date and deleted_at is null;
 if v_global.kind='closed' or v_own.kind='closed' then return false;
 elsif v_own.id is not null then v_intervals:=v_own.intervals;
 elsif v_global.id is not null then v_intervals:=v_global.intervals;
 else select coalesce(jsonb_agg(jsonb_build_object('start_minute',h.start_minute,'end_minute',h.end_minute)),'[]') into v_intervals from public.working_hours h where h.business_id=p_business_id and h.weekday=extract(isodow from v_date) and h.plan_id=(select id from public.staff_working_plans where business_id=p_business_id and staff_member_id=p_staff_id and superseded_at is null and effective_from<=v_date order by effective_from desc limit 1);end if;
 for v_item in select value from jsonb_array_elements(v_intervals) loop
  v_start:=app.schedule_instant(v_date,(v_item->>'start_minute')::integer,v_zone);v_end:=app.schedule_instant(v_date,(v_item->>'end_minute')::integer,v_zone);
  if v_start is not null and v_end is not null and v_start<=p_start and v_finish<=v_end then return true;end if;
 end loop;return false;
end;$$;
create function app.assert_schedule_appointments(p_business_id uuid,p_staff_id uuid) returns void language plpgsql stable set search_path='' as $$
declare v public.appointments;v_conflicts jsonb:='[]';v_count integer:=0;
begin
 for v in select * from public.appointments where business_id=p_business_id and status='confirmed' and starts_at>clock_timestamp() and (p_staff_id is null or staff_member_id=p_staff_id) order by starts_at,id loop
  if not app.appointment_time_allowed(p_business_id,v.staff_member_id,v.starts_at,v.duration_minutes_snapshot,v.buffer_minutes_snapshot,false) then
   v_count:=v_count+1;if v_count<=20 then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('id',v.id,'staff_id',v.staff_member_id,'starts_at',v.starts_at,'ends_at',v.ends_at));end if;
  end if;
 end loop;
 if v_count>0 then raise exception 'APPOINTMENTS_AFFECTED' using errcode='PT409',detail=jsonb_build_object('appointments',v_conflicts,'has_more',v_count>20)::text;end if;
end;$$;
create function app.appointment_context(p_data jsonb,p_action text) returns jsonb language plpgsql immutable set search_path='' as $$
declare v_keys text[]:=case when p_action='create' then array['staff','service','customer','calendar','settings','business'] else array['staff','calendar','settings','business'] end;v_key text;v_result jsonb:='{}';
begin
 if p_data is null or p_data='null' then p_data:='{}';end if;
 if jsonb_typeof(p_data)<>'object' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 if exists(select 1 from jsonb_object_keys(p_data) k where not k=any(v_keys)) then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 foreach v_key in array v_keys loop v_result:=v_result||jsonb_build_object(v_key,case when p_data->v_key is null or p_data->v_key='null' then null else app.catalog_integer(p_data,v_key,1,2147483647) end);end loop;return v_result;
end;$$;
create function app.check_appointment_context(p_expected jsonb,p_actual jsonb) returns void language plpgsql immutable set search_path='' as $$
declare v record;begin
 for v in select key,value from jsonb_each(p_expected) loop
  if v.value='null' then raise exception 'PRECONDITION_REQUIRED' using errcode='PT428';end if;
  if v.value is distinct from p_actual->v.key then raise exception 'PRECONDITION_FAILED' using errcode='PT412';end if;
 end loop;
end;$$;

create function api.manage_appointment(p_business_id uuid,p_action text,p_id uuid,p_data jsonb,p_key uuid,p_expected integer default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
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
 if p_action='create' then
  insert into public.appointments(id,business_id,customer_id,staff_member_id,service_id,starts_at,ends_at,blocked_until,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,buffer_minutes_snapshot,created_by)
   values(p_id,p_business_id,v_customer_id,v_staff_id,v_service_id,v_start,v_start,v_start,v_service.name,coalesce(v_link.price_override_cents,v_service.price_cents),coalesce(v_link.duration_override_minutes,v_service.duration_minutes),v_service.buffer_minutes,auth.uid()) returning * into v_new;v_event_type:='created';
 else
  v_before:=jsonb_build_object('status',v_old.status,'version',v_old.version,'starts_at',v_old.starts_at,'ends_at',v_old.ends_at,'blocked_until',v_old.blocked_until);
  update app.appointment_occupancy set released_at=clock_timestamp() where business_id=p_business_id and appointment_id=p_id and released_at is null;
  if p_action='reschedule' then update public.appointments set starts_at=v_start where business_id=p_business_id and id=p_id returning * into v_new;v_event_type:='rescheduled';
  else update public.appointments set status='cancelled' where business_id=p_business_id and id=p_id returning * into v_new;v_event_type:='cancelled';end if;
 end if;
 if p_action<>'cancel' then
  select coalesce(max(generation),0)+1 into v_generation from app.appointment_occupancy where business_id=p_business_id and appointment_id=p_id;
  insert into app.appointment_occupancy(business_id,appointment_id,staff_member_id,generation,starts_at,blocked_until) values(p_business_id,p_id,v_staff_id,v_generation,v_new.starts_at,v_new.blocked_until);
 end if;
 v_result:=jsonb_build_object('id',p_id,'business_id',p_business_id,'status',v_new.status,'version',v_new.version,'starts_at',v_new.starts_at,'ends_at',v_new.ends_at,'blocked_until',v_new.blocked_until);
 insert into public.appointment_events(business_id,appointment_id,version,event_type,actor_user_id,actor_member_id,reason,before_data,after_data,request_id) values(p_business_id,p_id,v_new.version,v_event_type,auth.uid(),v_actor.id,v_reason,v_before,v_result,v_trace) returning id into v_event;
 insert into app.appointment_outbox(business_id,event_id,appointment_id,version,event_type,payload) values(p_business_id,v_event,p_id,v_new.version,v_event_type,jsonb_build_object('appointment_id',p_id,'event_id',v_event,'version',v_new.version));
 insert into public.audit_logs(business_id,actor_type,actor_user_id,action,entity_type,entity_id,before_data,after_data,request_id) values(p_business_id,'user',auth.uid(),'appointment.'||v_event_type,'appointment',p_id,v_before,v_result,v_trace);
 insert into app.appointment_requests(business_id,user_id,operation,key,request_hash,result,origin_request_id) values(p_business_id,auth.uid(),p_action,p_key,v_hash,v_result,v_trace);return v_result;
exception
 when exclusion_violation then get stacked diagnostics v_constraint=constraint_name;if v_constraint='appointment_occupancy_no_overlap' then raise exception 'SLOT_TAKEN' using errcode='PT409';else raise;end if;
 when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR' using errcode='PT400';
end;$$;

create function app.purge_appointment_requests(p_batch_size integer default 500) returns integer language plpgsql volatile set search_path='' as $$
declare v_count integer;v_cutoff timestamptz:=clock_timestamp()-interval '48 hours';begin
 if p_batch_size is null or p_batch_size<1 or p_batch_size>500 then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 with expired as materialized(select business_id,user_id,operation,key from app.appointment_requests where created_at<=v_cutoff order by created_at,business_id,user_id,operation,key limit p_batch_size for update skip locked),removed as(delete from app.appointment_requests r using expired e where r.business_id=e.business_id and r.user_id=e.user_id and r.operation=e.operation and r.key=e.key returning 1) select count(*)::integer into v_count from removed;return v_count;
end;$$;

create function api.read_appointment(p_business_id uuid,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;begin
 perform app.require_member(p_business_id,true);
 select jsonb_build_object('id',a.id,'business_id',a.business_id,'customer_id',a.customer_id,'customer_name',c.full_name,'phone_raw',c.phone_raw,'customer_version',c.version,'staff_id',a.staff_member_id,'staff_name',s.display_name,'service_id',a.service_id,'service_name',a.service_name_snapshot,'price_cents',a.price_cents_snapshot,'currency',a.currency,'duration_minutes',a.duration_minutes_snapshot,'buffer_minutes',a.buffer_minutes_snapshot,'starts_at',a.starts_at,'ends_at',a.ends_at,'blocked_until',a.blocked_until,'status',a.status,'version',a.version,'cancelled_at',a.cancelled_at,'timezone',b.timezone,'now',clock_timestamp(),
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'version',e.version,'event_type',e.event_type,'reason',e.reason,'created_at',e.created_at,'actor_user_id',e.actor_user_id) order by e.version) from public.appointment_events e where e.business_id=a.business_id and e.appointment_id=a.id),'[]')) into v
 from public.appointments a join public.customers c on c.business_id=a.business_id and c.id=a.customer_id join public.staff_members s on s.business_id=a.business_id and s.id=a.staff_member_id join public.businesses b on b.id=a.business_id where a.business_id=p_business_id and a.id=p_id;
 if v is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;return v;
end;$$;
create function api.list_appointments_page(p_business_id uuid,p_from text default null,p_days integer default 1,p_staff_id uuid default null,p_limit integer default 50,p_cursor text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_from date;v_zone text;v_cursor jsonb;v_start timestamptz;v_id uuid;v_filter text;
begin
 perform app.require_member(p_business_id,true);select timezone into v_zone from public.businesses where id=p_business_id;v_from:=case when p_from is null then (clock_timestamp() at time zone v_zone)::date else app.schedule_date(p_from) end;
 if p_days is null or p_days<1 or p_days>7 or p_limit is null or p_limit<1 or p_limit>200 then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 if p_staff_id is not null and not exists(select 1 from public.staff_members where business_id=p_business_id and id=p_staff_id) then raise exception 'NOT_FOUND' using errcode='PT404';end if;
 select timezone into v_zone from public.businesses where id=p_business_id;
 v_filter:=encode(extensions.digest(jsonb_build_array(v_from,p_days,p_staff_id)::text,'sha256'),'hex');
 if p_cursor is not null then begin
  if length(p_cursor)<1 or length(p_cursor)>1024 or p_cursor !~ '^[A-Za-z0-9_-]+$' then raise exception 'Invalid cursor';end if;
  v_cursor:=convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-length(p_cursor)%4)%4),'base64'),'UTF8')::jsonb;
  if jsonb_typeof(v_cursor)<>'object' or (select count(*) from jsonb_object_keys(v_cursor))<>5 or jsonb_typeof(v_cursor->'v') is distinct from 'number' or v_cursor->>'v' is distinct from '1' or v_cursor->>'business_id' is distinct from p_business_id::text or v_cursor->>'filter_hash' is distinct from v_filter or jsonb_typeof(v_cursor->'id') is distinct from 'string' or jsonb_typeof(v_cursor->'starts_at') is distinct from 'string' or v_cursor->>'starts_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'Invalid cursor';end if;
  v_start:=(v_cursor->>'starts_at')::timestamptz;v_id:=(v_cursor->>'id')::uuid;if not isfinite(v_start) then raise exception 'Invalid cursor';end if;
 exception when others then raise exception 'VALIDATION_ERROR' using errcode='PT400';end;end if;
 return (
  with candidates as materialized(
   select a.id,a.customer_id,c.full_name as customer_name,a.staff_member_id,s.display_name as staff_name,a.service_name_snapshot,a.price_cents_snapshot,a.currency,a.starts_at,a.ends_at,a.status,a.version
   from public.appointments a join public.customers c on c.business_id=a.business_id and c.id=a.customer_id join public.staff_members s on s.business_id=a.business_id and s.id=a.staff_member_id
   where a.business_id=p_business_id and (p_staff_id is null or a.staff_member_id=p_staff_id) and (a.starts_at at time zone v_zone)::date>=v_from and (a.starts_at at time zone v_zone)::date<v_from+p_days
   and a.starts_at>=(v_from::timestamp at time zone v_zone)-interval '26 hours' and a.starts_at<((v_from+p_days)::timestamp at time zone v_zone)+interval '26 hours'
   and (v_start is null or (a.starts_at,a.id)>(v_start,v_id)) order by a.starts_at,a.id limit p_limit+1
  ),visible as(select * from candidates order by starts_at,id limit p_limit)
  select jsonb_build_object('from',v_from,'days',p_days,'now',clock_timestamp(),'timezone',v_zone,'data',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'customer_id',v.customer_id,'customer_name',v.customer_name,'staff_id',v.staff_member_id,'staff_name',v.staff_name,'service_name',v.service_name_snapshot,'price_cents',v.price_cents_snapshot,'currency',v.currency,'starts_at',v.starts_at,'ends_at',v.ends_at,'status',v.status,'version',v.version) order by v.starts_at,v.id) from visible v),'[]'),
   'page',jsonb_build_object('has_more',(select count(*)>p_limit from candidates),'next_cursor',case when(select count(*)>p_limit from candidates) then (select rtrim(translate(replace(encode(convert_to(jsonb_build_object('v',1,'business_id',p_business_id,'starts_at',v.starts_at,'id',v.id,'filter_hash',v_filter)::text,'UTF8'),'base64'),E'\n',''),'+/','-_'),'=') from visible v order by v.starts_at desc,v.id desc limit 1) else null end))
 );
end;$$;
create function api.appointment_preview_source(p_business_id uuid,p_id uuid,p_from text,p_days integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v public.appointments;v_source jsonb;
begin
 perform app.require_member(p_business_id,true);select * into v from public.appointments where business_id=p_business_id and id=p_id;
 if v.id is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;
 if v.status<>'confirmed' or v.starts_at<=clock_timestamp() then raise exception 'APPOINTMENT_STATE_CONFLICT' using errcode='PT409';end if;
 v_source:=api.schedule_preview_source(p_business_id,v.staff_member_id,v.service_id,p_from,p_days);
 return v_source||jsonb_build_object('duration_minutes',v.duration_minutes_snapshot,'buffer_minutes',v.buffer_minutes_snapshot,'price_cents',v.price_cents_snapshot,
  'occupied',coalesce((select jsonb_agg(jsonb_build_object('start',o.starts_at,'end',o.blocked_until)) from app.appointment_occupancy o where o.business_id=p_business_id and o.staff_member_id=v.staff_member_id and o.appointment_id<>p_id and o.released_at is null and o.starts_at<((app.schedule_date(p_from)+p_days)::timestamp at time zone (v_source->>'timezone'))+interval '26 hours' and o.blocked_until>(app.schedule_date(p_from)::timestamp at time zone (v_source->>'timezone'))-interval '26 hours'),'[]'));
end;$$;

revoke all on function app.guard_appointment(),app.guard_appointment_allocation(),app.check_appointment_occupancy(),app.appointment_time_allowed(uuid,uuid,timestamptz,integer,integer,boolean),app.assert_schedule_appointments(uuid,uuid),app.appointment_context(jsonb,text),app.check_appointment_context(jsonb,jsonb),app.purge_appointment_requests(integer),api.manage_appointment(uuid,text,uuid,jsonb,uuid,integer),api.read_appointment(uuid,uuid),api.list_appointments_page(uuid,text,integer,uuid,integer,text),api.appointment_preview_source(uuid,uuid,text,integer) from public,anon,authenticated,app_server,service_role;
-- Public execution is granted only after the compatible scheduling replacements below.

-- Same HS guards/protocol; add real occupancy and reject configuration conflicts.
create or replace function api.schedule_preview_source(p_business_id uuid,p_staff_id uuid,p_service_id uuid,p_from text,p_days integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor public.business_members;v_staff public.staff_members;v_service public.services;v_link public.staff_services;v_zone text;v_today date;v_from date;v_date date;v_settings public.business_settings;v_intervals jsonb;v_global public.schedule_exceptions;v_own public.schedule_exceptions;v_days jsonb:='[]';v_resolved jsonb;v_candidates jsonb;v_item jsonb;v_start timestamptz;v_end timestamptz;v_warning text;v_now timestamptz:=clock_timestamp();
begin
 v_actor:=app.require_schedule_staff(p_business_id,p_staff_id);
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

create or replace function api.write_schedule(p_business_id uuid,p_staff_id uuid,p_kind text,p_id uuid,p_action text,p_data jsonb,p_key uuid,p_expected integer) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor public.business_members;v_previous app.schedule_requests;v_payload jsonb;v_hash bytea;v_operation text;v_version integer;v_date date;v_today date;v_zone text;v_start timestamptz;v_end timestamptz;v_existing_staff uuid;v_exists boolean;v_deleted timestamptz;v_result jsonb;v_reason text;v_trace uuid:=app.current_request_id();
begin
 v_actor:=app.require_member(p_business_id,true);
 if p_id is null or p_key is null or p_kind is null or p_kind not in ('plan','exception','block') or p_action is null or p_action not in ('save','archive') or (p_kind='plan' and (p_staff_id is null or p_action<>'save')) or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 if p_action='archive' then
  if p_data<>'{}' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;v_payload:='{}';
 elsif p_kind='plan' then
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('effective_from','intervals')) then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
  v_payload:=jsonb_build_object('effective_from',app.schedule_date(p_data->>'effective_from'),'intervals',app.schedule_intervals(p_data->'intervals',true));
 else
  if jsonb_typeof(p_data->'kind') is distinct from 'string' or (p_data ? 'reason' and jsonb_typeof(p_data->'reason') not in ('string','null')) then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
  v_reason:=app.schedule_reason(p_data->>'reason');
  if p_kind='exception' then
   if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('date','kind','intervals','reason')) or p_data->>'kind' not in ('closed','custom_hours') then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
   v_payload:=jsonb_build_object('date',app.schedule_date(p_data->>'date'),'kind',p_data->>'kind','intervals',app.schedule_intervals(p_data->'intervals',false),'reason',v_reason);
   if (v_payload->>'kind'='closed' and v_payload->'intervals'<>'[]') or (v_payload->>'kind'='custom_hours' and v_payload->'intervals'='[]') then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
  else
   if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('start_date','start_minute','end_date','end_minute','kind','reason')) or p_data->>'kind' not in ('manual','vacation','other') then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
   v_payload:=jsonb_build_object('start_date',app.schedule_date(p_data->>'start_date'),'start_minute',app.catalog_integer(p_data,'start_minute',0,1439),'end_date',app.schedule_date(p_data->>'end_date'),'end_minute',app.catalog_integer(p_data,'end_minute',0,1440),'kind',p_data->>'kind','reason',v_reason);
  end if;
 end if;
 v_actor:=app.lock_managed_business(p_business_id);
 select timezone,(clock_timestamp() at time zone timezone)::date into v_zone,v_today from public.businesses where id=p_business_id;
 v_operation:=p_kind||'.'||p_action;v_hash:=extensions.digest(jsonb_build_array(1,p_business_id,auth.uid(),p_staff_id,p_kind,p_id,p_action,v_payload,p_expected)::text,'sha256');
 select r.* into v_previous from app.schedule_requests r where r.business_id=p_business_id and r.user_id=auth.uid() and r.operation=v_operation and r.key=p_key for update;
 if v_previous.key is not null and v_previous.created_at<=clock_timestamp()-interval '48 hours' then delete from app.schedule_requests where business_id=p_business_id and user_id=auth.uid() and operation=v_operation and key=p_key;v_previous:=null;end if;
 if p_staff_id is not null then
  select s.version into v_version from public.staff_members s where s.business_id=p_business_id and s.id=p_staff_id and s.deleted_at is null for update;
  if v_version is null then raise exception 'NOT_FOUND' using errcode='PT404';end if;
 else
  select version into v_version from app.calendar_controls where business_id=p_business_id for update;v_version:=coalesce(v_version,1);
 end if;
 if v_previous.key is not null then
  if v_previous.request_hash<>v_hash then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='PT409';end if;return v_previous.result;
 end if;
 if p_expected is null then raise exception 'PRECONDITION_REQUIRED' using errcode='PT428';end if;
 if v_version<>p_expected then raise exception 'PRECONDITION_FAILED' using errcode='PT412';end if;
 if p_kind='plan' then
  if exists(select 1 from public.staff_working_plans where id=p_id) then raise exception 'DUPLICATE_RESOURCE' using errcode='PT409';end if;
  v_date:=(v_payload->>'effective_from')::date;if v_date<v_today then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
  update public.staff_working_plans set superseded_at=clock_timestamp() where business_id=p_business_id and staff_member_id=p_staff_id and effective_from=v_date and superseded_at is null;
  insert into public.staff_working_plans(id,business_id,staff_member_id,effective_from,created_by) values(p_id,p_business_id,p_staff_id,v_date,auth.uid());
  insert into public.working_hours(business_id,plan_id,position,weekday,start_minute,end_minute) select p_business_id,p_id,n::integer,(i->>'weekday')::smallint,(i->>'start_minute')::smallint,(i->>'end_minute')::smallint from jsonb_array_elements(v_payload->'intervals') with ordinality a(i,n);
 else
  if p_kind='exception' then select staff_member_id,deleted_at,local_date into v_existing_staff,v_deleted,v_date from public.schedule_exceptions where business_id=p_business_id and id=p_id for update;
  else select staff_member_id,deleted_at,(starts_at at time zone v_zone)::date into v_existing_staff,v_deleted,v_date from public.time_blocks where business_id=p_business_id and id=p_id for update;end if;
  v_exists:=found;
  if v_exists and v_existing_staff is distinct from p_staff_id then raise exception 'NOT_FOUND' using errcode='PT404';end if;
  if v_exists and v_deleted is not null then raise exception 'RESOURCE_STATE_CONFLICT' using errcode='PT409';end if;
  if p_action='archive' then
   if not v_exists then raise exception 'NOT_FOUND' using errcode='PT404';end if;
   if v_date<v_today then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
   if p_kind='exception' then update public.schedule_exceptions set deleted_at=clock_timestamp(),updated_at=clock_timestamp() where business_id=p_business_id and id=p_id;
   else update public.time_blocks set deleted_at=clock_timestamp(),updated_at=clock_timestamp() where business_id=p_business_id and id=p_id;end if;
  elsif p_kind='exception' then
   if v_exists and v_date<v_today then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
   v_date:=(v_payload->>'date')::date;if v_date<v_today then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
   if exists(select 1 from public.schedule_exceptions where business_id=p_business_id and staff_member_id is not distinct from p_staff_id and local_date=v_date and deleted_at is null and id<>p_id) then raise exception 'RESOURCE_STATE_CONFLICT' using errcode='PT409';end if;
   if v_exists then update public.schedule_exceptions set local_date=v_date,kind=v_payload->>'kind',intervals=v_payload->'intervals',reason=v_payload->>'reason',updated_at=clock_timestamp() where business_id=p_business_id and id=p_id;
   else insert into public.schedule_exceptions(id,business_id,staff_member_id,local_date,kind,intervals,reason) values(p_id,p_business_id,p_staff_id,v_date,v_payload->>'kind',v_payload->'intervals',v_payload->>'reason');end if;
  else
   if v_exists and exists(select 1 from public.time_blocks where business_id=p_business_id and id=p_id and starts_at<clock_timestamp()) then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
   v_start:=app.schedule_instant((v_payload->>'start_date')::date,(v_payload->>'start_minute')::integer,v_zone);v_end:=app.schedule_instant((v_payload->>'end_date')::date,(v_payload->>'end_minute')::integer,v_zone);
   if v_start is null or v_end is null or v_start<clock_timestamp() or v_end<=v_start then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
   if v_exists and v_date<v_today then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
   if v_exists then update public.time_blocks set starts_at=v_start,ends_at=v_end,kind=v_payload->>'kind',reason=v_payload->>'reason',updated_at=clock_timestamp() where business_id=p_business_id and id=p_id;
   else insert into public.time_blocks(id,business_id,staff_member_id,starts_at,ends_at,kind,reason) values(p_id,p_business_id,p_staff_id,v_start,v_end,v_payload->>'kind',v_payload->>'reason');end if;
  end if;
 end if;
 perform app.assert_schedule_appointments(p_business_id,p_staff_id);
 if p_staff_id is not null then update public.staff_members set updated_at=updated_at where business_id=p_business_id and id=p_staff_id returning version into v_version;
 elsif exists(select 1 from app.calendar_controls where business_id=p_business_id) then update app.calendar_controls set updated_at=updated_at where business_id=p_business_id returning version into v_version;
 else insert into app.calendar_controls(id,business_id,version) values(p_business_id,p_business_id,2) returning version into v_version;end if;
 v_result:=jsonb_build_object('id',p_id,'staff_id',p_staff_id,'version',v_version,'kind',p_kind,'action',p_action);
 insert into public.audit_logs(business_id,actor_type,actor_user_id,action,entity_type,entity_id,after_data,request_id) values(p_business_id,'user',auth.uid(),'schedule.'||v_operation,'schedule',p_id,v_result,v_trace);
 insert into app.schedule_requests(business_id,user_id,operation,key,request_hash,result,origin_request_id) values(p_business_id,auth.uid(),v_operation,p_key,v_hash,v_result,v_trace);return v_result;
end;$$;

grant execute on function api.manage_appointment(uuid,text,uuid,jsonb,uuid,integer),api.read_appointment(uuid,uuid),api.list_appointments_page(uuid,text,integer,uuid,integer,text),api.appointment_preview_source(uuid,uuid,text,integer) to authenticated;
