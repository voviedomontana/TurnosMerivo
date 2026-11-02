-- Approved HS-01/02/03: internal scheduling preview, never appointments.
create table app.calendar_controls(id uuid primary key,business_id uuid not null unique references public.businesses(id),version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(id=business_id));
create trigger calendar_touch before update on app.calendar_controls for each row execute function app.touch_record();
create table public.staff_working_plans(id uuid primary key,business_id uuid not null,staff_member_id uuid not null,effective_from date not null check(isfinite(effective_from)),superseded_at timestamptz,created_at timestamptz not null default now(),created_by uuid not null references public.users(id),unique(business_id,id),foreign key(business_id,staff_member_id) references public.staff_members(business_id,id));
create unique index working_plan_live_date on public.staff_working_plans(business_id,staff_member_id,effective_from) where superseded_at is null;
create table public.working_hours(business_id uuid not null,plan_id uuid not null,position integer not null,weekday smallint not null check(weekday between 1 and 7),start_minute smallint not null check(start_minute between 0 and 1439),end_minute smallint not null check(end_minute between 1 and 1440),primary key(business_id,plan_id,position),foreign key(business_id,plan_id) references public.staff_working_plans(business_id,id),check(start_minute<end_minute));
create table public.schedule_exceptions(id uuid primary key,business_id uuid not null references public.businesses(id),staff_member_id uuid,local_date date not null check(isfinite(local_date)),kind text not null check(kind in ('closed','custom_hours')),intervals jsonb not null check(jsonb_typeof(intervals)='array'),reason text check(length(reason)<=500),deleted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(business_id,id),foreign key(business_id,staff_member_id) references public.staff_members(business_id,id),check((kind='closed' and intervals='[]') or kind='custom_hours'));
create unique index exception_staff_date on public.schedule_exceptions(business_id,staff_member_id,local_date) where deleted_at is null and staff_member_id is not null;
create unique index exception_global_date on public.schedule_exceptions(business_id,local_date) where deleted_at is null and staff_member_id is null;
create table public.time_blocks(id uuid primary key,business_id uuid not null references public.businesses(id),staff_member_id uuid,starts_at timestamptz not null,ends_at timestamptz not null,kind text not null check(kind in ('manual','vacation','other')),reason text check(length(reason)<=500),deleted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(business_id,id),foreign key(business_id,staff_member_id) references public.staff_members(business_id,id),check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at));
create index blocks_scope_time on public.time_blocks(business_id,staff_member_id,starts_at,ends_at) where deleted_at is null;
create table app.schedule_requests(business_id uuid not null references public.businesses(id),user_id uuid not null references public.users(id),operation text not null check(operation in ('plan.save','exception.save','exception.archive','block.save','block.archive')),key uuid not null,canon_version integer not null default 1 check(canon_version=1),request_hash bytea not null,result jsonb not null,origin_request_id uuid not null,created_at timestamptz not null default clock_timestamp(),primary key(business_id,user_id,operation,key));
create index schedule_requests_age on app.schedule_requests(created_at);
alter table app.calendar_controls enable row level security;alter table app.calendar_controls force row level security;
alter table public.staff_working_plans enable row level security;alter table public.staff_working_plans force row level security;
alter table public.working_hours enable row level security;alter table public.working_hours force row level security;
alter table public.schedule_exceptions enable row level security;alter table public.schedule_exceptions force row level security;
alter table public.time_blocks enable row level security;alter table public.time_blocks force row level security;
alter table app.schedule_requests enable row level security;alter table app.schedule_requests force row level security;
revoke all on app.calendar_controls,public.staff_working_plans,public.working_hours,public.schedule_exceptions,public.time_blocks,app.schedule_requests from public,anon,authenticated,app_server,service_role;

create function app.schedule_date(p_value text) returns date language plpgsql immutable set search_path='' as $$
declare v date;begin
 if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 v:=p_value::date;if not isfinite(v) then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;return v;
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'VALIDATION_ERROR' using errcode='PT400';end;$$;
create function app.schedule_reason(p_value text) returns text language plpgsql immutable set search_path='' as $$
declare v text:=nullif(normalize(btrim(p_value),NFC),'');begin
 if length(v)>500 or replace(replace(v,E'\n',''),E'\t','') ~ '[[:cntrl:]]' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;return v;
end;$$;
revoke all on function app.schedule_reason(text) from public,anon,authenticated,app_server,service_role;
create function app.schedule_intervals(p_value jsonb,p_weekly boolean) returns jsonb language plpgsql immutable set search_path='' as $$
declare v_item jsonb;v_out jsonb:='[]';v_day integer;v_start integer;v_end integer;v_previous jsonb;
begin
 if jsonb_typeof(p_value) is distinct from 'array' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 if jsonb_array_length(p_value)>14 then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 for v_item in select value from jsonb_array_elements(p_value) loop
  if jsonb_typeof(v_item)<>'object' then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
  if exists(select 1 from jsonb_object_keys(v_item) k where k not in ('weekday','start_minute','end_minute') or (not p_weekly and k='weekday')) then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
  perform app.catalog_integer(v_item,'start_minute',0,1439);perform app.catalog_integer(v_item,'end_minute',1,1440);
  if p_weekly then perform app.catalog_integer(v_item,'weekday',1,7);end if;
 end loop;
 for v_item in select value from jsonb_array_elements(p_value) order by coalesce((value->>'weekday')::integer,1),(value->>'start_minute')::integer loop
  v_day:=case when p_weekly then (v_item->>'weekday')::integer else 1 end;v_start:=(v_item->>'start_minute')::integer;v_end:=(v_item->>'end_minute')::integer;
  if v_start>=v_end then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
  if v_previous is not null and coalesce((v_previous->>'weekday')::integer,1)=v_day then
   if v_start<(v_previous->>'end_minute')::integer then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
   if v_start=(v_previous->>'end_minute')::integer then v_out:=v_out-(jsonb_array_length(v_out)-1);v_start:=(v_previous->>'start_minute')::integer;end if;
  end if;
  v_previous:=jsonb_build_object('start_minute',v_start,'end_minute',v_end)||case when p_weekly then jsonb_build_object('weekday',v_day) else '{}'::jsonb end;
  v_out:=v_out||jsonb_build_array(v_previous);
 end loop;return v_out;
end;$$;
-- Inverse wall-clock mapping: roundtrip rejects gaps, min chooses first fold occurrence.
-- Minute increments preserve the exact base instant; no process timezone dependency.
alter table public.schedule_exceptions add constraint exception_intervals_coherent check(intervals=app.schedule_intervals(intervals,false) and (kind='closed' or jsonb_array_length(intervals)>0));
create function app.guard_working_interval() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op<>'INSERT' then raise exception 'IMMUTABLE_PLAN' using errcode='PT409';end if;
 if exists(select 1 from public.working_hours h where h.business_id=new.business_id and h.plan_id=new.plan_id and h.weekday=new.weekday and h.start_minute<new.end_minute and new.start_minute<h.end_minute) then raise exception 'INTERVAL_OVERLAP' using errcode='PT409';end if;
 return new;
end;$$;
create trigger working_interval_guard before insert or update or delete on public.working_hours for each row execute function app.guard_working_interval();
revoke all on function app.guard_working_interval() from public,anon,authenticated,app_server,service_role;
create function app.schedule_instant(p_date date,p_minute integer,p_zone text) returns timestamptz language sql stable set search_path='' as $$
 select min(t) from generate_series(((p_date::timestamp+make_interval(mins=>p_minute)) at time zone p_zone)-interval '26 hours',((p_date::timestamp+make_interval(mins=>p_minute)) at time zone p_zone)+interval '26 hours',interval '1 minute') t
 where t at time zone p_zone=p_date::timestamp+make_interval(mins=>p_minute);
$$;
create function app.require_schedule_staff(p_business_id uuid,p_staff_id uuid) returns public.business_members language plpgsql stable security definer set search_path='' as $$
declare v public.business_members;
begin
 v:=app.require_member(p_business_id,false);
 if p_staff_id is null or not exists(select 1 from public.staff_members s where s.business_id=p_business_id and s.id=p_staff_id and (v.role<>'barber' or s.member_id=v.id) and s.deleted_at is null) then raise exception 'NOT_FOUND' using errcode='PT404';end if;
 return v;
end;$$;
create function api.read_schedule(p_business_id uuid,p_staff_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor public.business_members;v_staff public.staff_members;
begin
 v_actor:=app.require_schedule_staff(p_business_id,p_staff_id);
 select s.* into v_staff from public.staff_members s where s.business_id=p_business_id and s.id=p_staff_id;
 return jsonb_build_object('staff_id',p_staff_id,'staff_version',v_staff.version,'staff_name',v_staff.display_name,'can_manage',v_actor.role in ('owner','admin'),
 'timezone',(select timezone from public.businesses where id=p_business_id),'today',(select (clock_timestamp() at time zone timezone)::date from public.businesses where id=p_business_id),
 'global_version',coalesce((select version from app.calendar_controls where business_id=p_business_id),1),
 'plans',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'effective_from',p.effective_from,'intervals',coalesce((select jsonb_agg(jsonb_build_object('weekday',h.weekday,'start_minute',h.start_minute,'end_minute',h.end_minute) order by h.position) from public.working_hours h where h.business_id=p.business_id and h.plan_id=p.id),'[]')) order by p.effective_from) from public.staff_working_plans p where p.business_id=p_business_id and p.staff_member_id=p_staff_id and p.superseded_at is null),'[]'),
 'exceptions',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'staff_id',e.staff_member_id,'date',e.local_date,'kind',e.kind,'intervals',e.intervals)||case when v_actor.role in ('owner','admin') then jsonb_build_object('reason',e.reason) else '{}'::jsonb end order by e.local_date,e.id) from public.schedule_exceptions e where e.business_id=p_business_id and (e.staff_member_id is null or e.staff_member_id=p_staff_id) and e.deleted_at is null),'[]'),
 'blocks',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'staff_id',b.staff_member_id,'start',b.starts_at,'end',b.ends_at,'kind',b.kind)||case when v_actor.role in ('owner','admin') then jsonb_build_object('reason',b.reason) else '{}'::jsonb end order by b.starts_at,b.id) from public.time_blocks b where b.business_id=p_business_id and (b.staff_member_id is null or b.staff_member_id=p_staff_id) and b.deleted_at is null),'[]'));
end;$$;
create function api.read_calendar_control(p_business_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform app.require_member(p_business_id,true);return jsonb_build_object('id',p_business_id,'version',coalesce((select version from app.calendar_controls where business_id=p_business_id),1));end;$$;

create function api.write_schedule(p_business_id uuid,p_staff_id uuid,p_kind text,p_id uuid,p_action text,p_data jsonb,p_key uuid,p_expected integer) returns jsonb language plpgsql volatile security definer set search_path='' as $$
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
 if p_staff_id is not null then update public.staff_members set updated_at=updated_at where business_id=p_business_id and id=p_staff_id returning version into v_version;
 elsif exists(select 1 from app.calendar_controls where business_id=p_business_id) then update app.calendar_controls set updated_at=updated_at where business_id=p_business_id returning version into v_version;
 else insert into app.calendar_controls(id,business_id,version) values(p_business_id,p_business_id,2) returning version into v_version;end if;
 v_result:=jsonb_build_object('id',p_id,'staff_id',p_staff_id,'version',v_version,'kind',p_kind,'action',p_action);
 insert into public.audit_logs(business_id,actor_type,actor_user_id,action,entity_type,entity_id,after_data,request_id) values(p_business_id,'user',auth.uid(),'schedule.'||v_operation,'schedule',p_id,v_result,v_trace);
 insert into app.schedule_requests(business_id,user_id,operation,key,request_hash,result,origin_request_id) values(p_business_id,auth.uid(),v_operation,p_key,v_hash,v_result,v_trace);return v_result;
end;$$;

create function api.schedule_preview_source(p_business_id uuid,p_staff_id uuid,p_service_id uuid,p_from text,p_days integer default 1) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 return jsonb_build_object('mode','schedule_preview','can_book',false,'occupancy_checked',false,'timezone',v_zone,'now',v_now,'staff_id',p_staff_id,'staff_version',v_staff.version,'service_id',p_service_id,'service_version',v_service.version,'global_version',coalesce((select version from app.calendar_controls where business_id=p_business_id),1),'duration_minutes',coalesce(v_link.duration_override_minutes,v_service.duration_minutes),'buffer_minutes',v_service.buffer_minutes,'min_notice_minutes',v_settings.min_notice_minutes,'price_cents',coalesce(v_link.price_override_cents,v_service.price_cents),'days',v_days,'blocks',coalesce((select jsonb_agg(jsonb_build_object('start',starts_at,'end',ends_at)) from public.time_blocks where business_id=p_business_id and (staff_member_id is null or staff_member_id=p_staff_id) and deleted_at is null and ends_at>v_now),'[]'));
end;$$;
create function app.purge_schedule_requests(p_batch_size integer default 500) returns integer language plpgsql volatile set search_path='' as $$
declare v_count integer;begin
 if p_batch_size is null or p_batch_size<1 or p_batch_size>500 then raise exception 'VALIDATION_ERROR' using errcode='PT400';end if;
 with expired as materialized(select business_id,user_id,operation,key from app.schedule_requests where created_at<=clock_timestamp()-interval '48 hours' order by created_at,business_id,user_id,operation,key limit p_batch_size for update skip locked),removed as(delete from app.schedule_requests r using expired e where r.business_id=e.business_id and r.user_id=e.user_id and r.operation=e.operation and r.key=e.key returning 1) select count(*)::integer into v_count from removed;return v_count;
end;$$;
create function api.list_schedule_staff(p_business_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v public.business_members;begin v:=app.require_member(p_business_id,false);return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.display_name,'active',s.active) order by s.sort_order,s.display_name,s.id) from public.staff_members s where s.business_id=p_business_id and s.deleted_at is null and (v.role<>'barber' or s.member_id=v.id)),'[]');end;$$;
revoke all on function api.list_schedule_staff(uuid) from public,anon,authenticated,app_server,service_role;
grant execute on function api.list_schedule_staff(uuid) to authenticated;
revoke all on function app.schedule_date(text),app.schedule_intervals(jsonb,boolean),app.schedule_instant(date,integer,text),app.require_schedule_staff(uuid,uuid),app.purge_schedule_requests(integer),api.read_schedule(uuid,uuid),api.read_calendar_control(uuid),api.write_schedule(uuid,uuid,text,uuid,text,jsonb,uuid,integer),api.schedule_preview_source(uuid,uuid,uuid,text,integer) from public,anon,authenticated,app_server,service_role;
grant execute on function api.read_schedule(uuid,uuid),api.read_calendar_control(uuid),api.write_schedule(uuid,uuid,text,uuid,text,jsonb,uuid,integer),api.schedule_preview_source(uuid,uuid,uuid,text,integer) to authenticated;
