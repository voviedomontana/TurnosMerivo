-- Explicitly approved catalog subset. No availability, appointments or EXCLUDE.
create table public.staff_members (
  id uuid primary key,
  business_id uuid not null references public.businesses(id),
  member_id uuid,
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  bio text check (length(bio)<=1000),
  active boolean not null default true,
  accepts_online boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  version integer not null default 1 check (version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(business_id,id),
  foreign key(business_id,member_id) references public.business_members(business_id,id)
);
create unique index staff_live_member_unique on public.staff_members(business_id,member_id)
  where deleted_at is null and member_id is not null;
create table public.services (
  id uuid primary key,
  business_id uuid not null references public.businesses(id),
  name text not null check (length(btrim(name)) between 1 and 100),
  description text check (length(description)<=1000),
  category text check (length(category)<=100),
  price_cents integer not null check (price_cents>=0),
  currency text not null default 'ARS' check (currency='ARS'),
  duration_minutes smallint not null check (duration_minutes between 5 and 480),
  buffer_minutes smallint not null default 0 check (buffer_minutes between 0 and 120),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  version integer not null default 1 check (version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(business_id,id)
);
create unique index services_live_name_unique on public.services(business_id,lower(normalize(btrim(name),NFC))) where deleted_at is null;
create table public.staff_services (
  business_id uuid not null,
  staff_member_id uuid not null,
  service_id uuid not null,
  price_override_cents integer check (price_override_cents>=0),
  duration_override_minutes smallint check (duration_override_minutes between 5 and 480),
  primary key(business_id,staff_member_id,service_id),
  foreign key(business_id,staff_member_id) references public.staff_members(business_id,id),
  foreign key(business_id,service_id) references public.services(business_id,id)
);
create table app.catalog_requests (
  business_id uuid not null references public.businesses(id),
  user_id uuid not null references public.users(id),
  operation text not null check (operation in ('staff.create','staff.update','staff.archive','staff.restore','service.create','service.update','service.archive','service.restore')),
  key uuid not null,
  request_hash bytea not null,
  result jsonb not null,
  origin_request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(business_id,user_id,operation,key)
);
create index catalog_requests_created_at on app.catalog_requests(created_at);
create trigger staff_touch before update on public.staff_members for each row execute function app.touch_record();
create trigger services_touch before update on public.services for each row execute function app.touch_record();
alter table public.staff_members enable row level security;
alter table public.staff_members force row level security;
alter table public.services enable row level security;
alter table public.services force row level security;
alter table public.staff_services enable row level security;
alter table public.staff_services force row level security;
alter table app.catalog_requests enable row level security;
alter table app.catalog_requests force row level security;
create policy staff_tenant_read on public.staff_members for select to authenticated using(app.is_active_member(business_id));
create policy services_tenant_read on public.services for select to authenticated using(app.is_active_member(business_id));
create policy staff_services_tenant_read on public.staff_services for select to authenticated using(app.is_active_member(business_id));
revoke all on public.staff_members,public.services,public.staff_services,app.catalog_requests from public,anon,authenticated,app_server,service_role;

create function app.catalog_integer(p_data jsonb,p_field text,p_min integer,p_max integer,p_default integer default null)
returns integer language plpgsql immutable set search_path='' as $$
declare v_number numeric;
begin
  if p_data->p_field is null and p_default is not null then return p_default; end if;
  if jsonb_typeof(p_data->p_field) is distinct from 'number' then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  v_number:=(p_data->>p_field)::numeric;
  if v_number<>trunc(v_number) or v_number<p_min or v_number>p_max then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  return v_number::integer;
end;
$$;

create function app.catalog_payload(p_kind text,p_data jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v_name text; v_result jsonb; v_assignments jsonb:='[]'; v_item jsonb; v_id uuid;
  v_price integer; v_duration integer; v_ids uuid[]:='{}'; v_member uuid;
begin
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  if p_kind='service' then
    if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('name','description','category','price_cents','duration_minutes','buffer_minutes','active','sort_order')) then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
    v_name:=normalize(btrim(p_data->>'name'),NFC);
    if jsonb_typeof(p_data->'name') is distinct from 'string' or length(v_name) not between 1 and 100 then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
    if (p_data ? 'description' and jsonb_typeof(p_data->'description') not in ('string','null'))
      or (p_data ? 'category' and jsonb_typeof(p_data->'category') not in ('string','null'))
      or length(p_data->>'description')>1000 or length(p_data->>'category')>100 then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
    v_result:=jsonb_build_object('name',v_name,'description',nullif(btrim(p_data->>'description'),''),'category',nullif(btrim(p_data->>'category'),''),
      'price_cents',app.catalog_integer(p_data,'price_cents',0,2147483647),
      'duration_minutes',app.catalog_integer(p_data,'duration_minutes',5,480),
      'buffer_minutes',app.catalog_integer(p_data,'buffer_minutes',0,120,0));
  elsif p_kind='staff' then
    if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('display_name','bio','member_id','active','accepts_online','sort_order','assignments')) then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
    v_name:=normalize(btrim(p_data->>'display_name'),NFC);
    if jsonb_typeof(p_data->'display_name') is distinct from 'string' or length(v_name) not between 1 and 100 then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
    if (p_data ? 'bio' and jsonb_typeof(p_data->'bio') not in ('string','null')) or length(p_data->>'bio')>1000
      or (p_data ? 'member_id' and jsonb_typeof(p_data->'member_id') not in ('string','null'))
      or (p_data ? 'accepts_online' and jsonb_typeof(p_data->'accepts_online')<>'boolean') then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
    v_member:=(p_data->>'member_id')::uuid;
    if p_data ? 'assignments' and jsonb_typeof(p_data->'assignments')<>'array' then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
    if jsonb_array_length(coalesce(p_data->'assignments','[]'))>500 then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
    for v_item in select value from jsonb_array_elements(coalesce(p_data->'assignments','[]')) loop
      if jsonb_typeof(v_item)<>'object' or exists(select 1 from jsonb_object_keys(v_item) k where k not in ('service_id','price_override_cents','duration_override_minutes'))
        or jsonb_typeof(v_item->'service_id') is distinct from 'string' then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
      v_id:=(v_item->>'service_id')::uuid;
      if v_id=any(v_ids) then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
      v_ids:=array_append(v_ids,v_id);
      v_price:=case when v_item->'price_override_cents' is null or v_item->'price_override_cents'='null' then null else app.catalog_integer(v_item,'price_override_cents',0,2147483647) end;
      v_duration:=case when v_item->'duration_override_minutes' is null or v_item->'duration_override_minutes'='null' then null else app.catalog_integer(v_item,'duration_override_minutes',5,480) end;
      v_assignments:=v_assignments||jsonb_build_array(jsonb_build_object('service_id',v_id,'price_override_cents',v_price,'duration_override_minutes',v_duration));
    end loop;
    select coalesce(jsonb_agg(value order by value->>'service_id'),'[]') into v_assignments from jsonb_array_elements(v_assignments);
    v_result:=jsonb_build_object('display_name',v_name,'bio',nullif(btrim(p_data->>'bio'),''),'member_id',v_member,
      'accepts_online',coalesce((p_data->>'accepts_online')::boolean,true),'assignments',v_assignments);
  else raise exception 'VALIDATION_ERROR' using errcode='PT400';
  end if;
  if p_data ? 'active' and jsonb_typeof(p_data->'active')<>'boolean' then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  return v_result||jsonb_build_object('active',coalesce((p_data->>'active')::boolean,true),'sort_order',app.catalog_integer(p_data,'sort_order',0,10000,0));
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
  raise exception 'VALIDATION_ERROR' using errcode='PT400';
end;
$$;

create function app.purge_catalog_requests(p_batch_size integer default 500)
returns integer language plpgsql volatile set search_path='' as $$
declare v_cutoff timestamptz:=clock_timestamp()-interval '48 hours'; v_count integer;
begin
  if p_batch_size is null or p_batch_size<1 or p_batch_size>500 then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  with expired as materialized (
    select r.business_id,r.user_id,r.operation,r.key from app.catalog_requests r where r.created_at<=v_cutoff
    order by r.created_at,r.business_id,r.user_id,r.operation,r.key limit p_batch_size for update skip locked
  ), removed as (
    delete from app.catalog_requests r using expired e where r.business_id=e.business_id and r.user_id=e.user_id and r.operation=e.operation and r.key=e.key returning 1
  ) select count(*)::integer into v_count from removed;
  return v_count;
end;
$$;

create function app.write_catalog(p_business_id uuid,p_kind text,p_id uuid,p_action text,p_data jsonb,p_key uuid,p_expected integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor public.business_members; v_staff public.staff_members; v_service public.services;
  v_previous app.catalog_requests; v_payload jsonb; v_hash bytea; v_operation text;
  v_result jsonb; v_before jsonb; v_version integer; v_deleted timestamptz; v_item jsonb;
  v_member uuid; v_service_id uuid; v_trace uuid:=app.current_request_id();
begin
  v_actor:=app.require_member(p_business_id,true);
  if p_kind is null or p_kind not in ('staff','service') or p_action is null or p_action not in ('create','update','archive','restore') or p_id is null or p_key is null then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  if p_action in ('create','update') then v_payload:=app.catalog_payload(p_kind,p_data);
  else
    if p_data is distinct from '{}'::jsonb then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
    v_payload:='{}';
  end if;
  v_actor:=app.lock_managed_business(p_business_id);
  v_operation:=p_kind||'.'||p_action;
  v_hash:=extensions.digest(jsonb_build_array(p_kind,p_id,p_action,v_payload,p_expected)::text,'sha256');
  select r.* into v_previous from app.catalog_requests r where r.business_id=p_business_id and r.user_id=auth.uid() and r.operation=v_operation and r.key=p_key for update;
  if v_previous.key is not null and v_previous.created_at<=clock_timestamp()-interval '48 hours' then
    delete from app.catalog_requests where business_id=p_business_id and user_id=auth.uid() and operation=v_operation and key=p_key;
    v_previous:=null;
  end if;
  if p_kind='staff' then
    select s.* into v_staff from public.staff_members s where s.id=p_id and s.business_id=p_business_id for update;
    v_version:=v_staff.version;v_deleted:=v_staff.deleted_at;
  else
    select s.* into v_service from public.services s where s.id=p_id and s.business_id=p_business_id for update;
    v_version:=v_service.version;v_deleted:=v_service.deleted_at;
  end if;
  if v_previous.key is not null then
    if v_version is null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
    if v_previous.request_hash<>v_hash then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='PT409'; end if;
    return v_previous.result;
  end if;
  if p_action='create' then
    if v_version is not null then raise exception 'DUPLICATE_RESOURCE' using errcode='PT409'; end if;
    if (p_kind='staff' and exists(select 1 from public.staff_members where id=p_id)) or (p_kind='service' and exists(select 1 from public.services where id=p_id)) then raise exception 'DUPLICATE_RESOURCE' using errcode='PT409'; end if;
    if p_expected is not null then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  else
    if v_version is null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
    if p_expected is null then raise exception 'PRECONDITION_REQUIRED' using errcode='PT428'; end if;
    if v_version<>p_expected then raise exception 'PRECONDITION_FAILED' using errcode='PT412'; end if;
    if (p_action in ('update','archive') and v_deleted is not null) or (p_action='restore' and v_deleted is null) then raise exception 'RESOURCE_STATE_CONFLICT' using errcode='PT409'; end if;
    v_before:=jsonb_build_object('id',p_id,'version',v_version,'deleted_at',v_deleted);
  end if;
  if p_kind='service' and p_action in ('create','update','restore') and exists(select 1 from public.services s where s.business_id=p_business_id and s.id<>p_id and s.deleted_at is null
    and lower(normalize(btrim(s.name),NFC))=lower(normalize(btrim(case when p_action='restore' then v_service.name else v_payload->>'name' end),NFC))) then raise exception 'DUPLICATE_RESOURCE' using errcode='PT409'; end if;
  if p_kind='staff' and p_action in ('create','update','restore') then
    v_member:=case when p_action='restore' then v_staff.member_id else (v_payload->>'member_id')::uuid end;
    if v_member is not null and exists(select 1 from public.staff_members s where s.business_id=p_business_id and s.id<>p_id and s.member_id=v_member and s.deleted_at is null) then raise exception 'DUPLICATE_RESOURCE' using errcode='PT409'; end if;
  end if;
  if p_action in ('create','update') then
    if p_kind='staff' then
      v_member:=(v_payload->>'member_id')::uuid;
      if v_member is not null and (p_action='create' or v_member is distinct from v_staff.member_id) then
        if not exists(select 1 from public.business_members m join public.users u on u.id=m.user_id join auth.users a on a.id=u.id
          where m.business_id=p_business_id and m.id=v_member and m.status='active' and u.deleted_at is null and a.email_confirmed_at is not null) then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
      end if;
      for v_item in select value from jsonb_array_elements(v_payload->'assignments') loop
        v_service_id:=(v_item->>'service_id')::uuid;
        select s.* into v_service from public.services s where s.id=v_service_id and s.business_id=p_business_id;
        if v_service.id is null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
        if v_service.deleted_at is not null and not exists(select 1 from public.staff_services a where a.business_id=p_business_id and a.staff_member_id=p_id and a.service_id=v_service_id) then raise exception 'RESOURCE_STATE_CONFLICT' using errcode='PT409'; end if;
      end loop;
      if p_action='create' then
        insert into public.staff_members(id,business_id,member_id,display_name,bio,active,accepts_online,sort_order)
          values(p_id,p_business_id,v_member,v_payload->>'display_name',v_payload->>'bio',(v_payload->>'active')::boolean,(v_payload->>'accepts_online')::boolean,(v_payload->>'sort_order')::integer) returning * into v_staff;
      else
        update public.staff_members set member_id=v_member,display_name=v_payload->>'display_name',bio=v_payload->>'bio',active=(v_payload->>'active')::boolean,
          accepts_online=(v_payload->>'accepts_online')::boolean,sort_order=(v_payload->>'sort_order')::integer where id=p_id and business_id=p_business_id returning * into v_staff;
      end if;
      delete from public.staff_services where business_id=p_business_id and staff_member_id=p_id;
      insert into public.staff_services(business_id,staff_member_id,service_id,price_override_cents,duration_override_minutes)
        select p_business_id,p_id,(i->>'service_id')::uuid,(i->>'price_override_cents')::integer,(i->>'duration_override_minutes')::smallint from jsonb_array_elements(v_payload->'assignments') i;
    else
      if p_action='create' then
        insert into public.services(id,business_id,name,description,category,price_cents,duration_minutes,buffer_minutes,active,sort_order)
          values(p_id,p_business_id,v_payload->>'name',v_payload->>'description',v_payload->>'category',(v_payload->>'price_cents')::integer,
          (v_payload->>'duration_minutes')::smallint,(v_payload->>'buffer_minutes')::smallint,(v_payload->>'active')::boolean,(v_payload->>'sort_order')::integer) returning * into v_service;
      else
        update public.services set name=v_payload->>'name',description=v_payload->>'description',category=v_payload->>'category',price_cents=(v_payload->>'price_cents')::integer,
          duration_minutes=(v_payload->>'duration_minutes')::smallint,buffer_minutes=(v_payload->>'buffer_minutes')::smallint,active=(v_payload->>'active')::boolean,sort_order=(v_payload->>'sort_order')::integer
          where id=p_id and business_id=p_business_id returning * into v_service;
      end if;
    end if;
  elsif p_kind='staff' then
    update public.staff_members set deleted_at=case when p_action='archive' then clock_timestamp() else null end where id=p_id and business_id=p_business_id returning * into v_staff;
  else
    update public.services set deleted_at=case when p_action='archive' then clock_timestamp() else null end where id=p_id and business_id=p_business_id returning * into v_service;
  end if;
  v_result:=jsonb_build_object('id',p_id,'business_id',p_business_id,'kind',p_kind,'version',case when p_kind='staff' then v_staff.version else v_service.version end,
    'active',case when p_kind='staff' then v_staff.active else v_service.active end,'deleted_at',case when p_kind='staff' then v_staff.deleted_at else v_service.deleted_at end);
  insert into public.audit_logs(business_id,actor_type,actor_user_id,action,entity_type,entity_id,before_data,after_data,request_id)
    values(p_business_id,'user',auth.uid(),'catalog.'||v_operation,p_kind,p_id,v_before,v_result,v_trace);
  insert into app.catalog_requests(business_id,user_id,operation,key,request_hash,result,origin_request_id)
    values(p_business_id,auth.uid(),v_operation,p_key,v_hash,v_result,v_trace);
  return v_result;
end;
$$;
create function api.write_catalog(p_business_id uuid,p_kind text,p_id uuid,p_action text,p_data jsonb,p_key uuid,p_expected integer)
returns jsonb language sql volatile security definer set search_path='' as $$
  select app.write_catalog(p_business_id,p_kind,p_id,p_action,p_data,p_key,p_expected);
$$;

create function api.list_catalog(p_business_id uuid,p_include_archived boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor public.business_members;
begin
  v_actor:=app.require_member(p_business_id,false);
  if p_include_archived is null then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  return jsonb_build_object(
    'staff',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'business_id',s.business_id,
      'member_id',case when v_actor.role in ('owner','admin') then s.member_id else null end,'display_name',s.display_name,'bio',s.bio,
      'active',s.active,'accepts_online',s.accepts_online,'sort_order',s.sort_order,'version',s.version,'deleted_at',s.deleted_at) order by s.sort_order,lower(s.display_name),s.id)
      from public.staff_members s where s.business_id=p_business_id and (p_include_archived or s.deleted_at is null)),'[]'),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'business_id',s.business_id,'name',s.name,'description',s.description,'category',s.category,
      'price_cents',s.price_cents,'currency',s.currency,'duration_minutes',s.duration_minutes,'buffer_minutes',s.buffer_minutes,'active',s.active,'sort_order',s.sort_order,
      'version',s.version,'deleted_at',s.deleted_at) order by s.sort_order,lower(s.name),s.id)
      from public.services s where s.business_id=p_business_id and (p_include_archived or s.deleted_at is null)),'[]'),
    'assignments',coalesce((select jsonb_agg(jsonb_build_object('staff_member_id',a.staff_member_id,'service_id',a.service_id,'price_override_cents',a.price_override_cents,
      'duration_override_minutes',a.duration_override_minutes) order by a.staff_member_id,a.service_id) from public.staff_services a
      join public.staff_members s on s.business_id=a.business_id and s.id=a.staff_member_id
      where a.business_id=p_business_id and (p_include_archived or s.deleted_at is null)),'[]')
  );
end;
$$;
revoke all on function app.catalog_integer(jsonb,text,integer,integer,integer),app.catalog_payload(text,jsonb),app.purge_catalog_requests(integer),
  app.write_catalog(uuid,text,uuid,text,jsonb,uuid,integer),api.write_catalog(uuid,text,uuid,text,jsonb,uuid,integer),api.list_catalog(uuid,boolean)
  from public,anon,authenticated,service_role,app_server;
grant execute on function api.write_catalog(uuid,text,uuid,text,jsonb,uuid,integer),api.list_catalog(uuid,boolean) to authenticated;
