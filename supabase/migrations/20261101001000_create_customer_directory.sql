-- Customer directory only; no marketing, appointments, Auth users or integrations.
create function app.customer_text(p_value text,p_max integer,p_multiline boolean default false)
returns text language plpgsql immutable set search_path='' as $$
declare v text:=nullif(normalize(btrim(p_value),NFC),'');
begin
  if length(v)>p_max or (case when p_multiline then replace(replace(v,E'\n',''),E'\t','') else v end) ~ '[[:cntrl:]]' then
    raise exception 'VALIDATION_ERROR' using errcode='PT400';
  end if;
  return v;
end; $$;
create function app.customer_phone(p_raw text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v text:=app.customer_text(p_raw,64); d text; e text; s text:='needs_review';
begin
  if v is null then return jsonb_build_object('phone_e164',null,'phone_status','missing'); end if;
  if v !~ '^\+?[0-9 ().-]+$' then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  d:=translate(v,' ().-','');
  if d !~ '^\+?[0-9]+$' then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  if left(d,1)='+' then
    if d !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
    if left(d,3)<>'+54' or d ~ '^\+54([0-9]{10}|9[0-9]{10})$' then e:=d;s:='international'; end if;
  end if;
  return jsonb_build_object('phone_e164',e,'phone_status',s);
end; $$;
create function app.customer_payload(p_data jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v_name text; v_phone text; v_email text; v_ig text; v_notes text;
begin
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('full_name','phone_raw','email','instagram_handle','private_notes')) then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  if exists(select 1 from jsonb_each(p_data) e where jsonb_typeof(e.value) not in ('string','null')) then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  v_name:=app.customer_text(p_data->>'full_name',120);
  if v_name is null then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  v_phone:=app.customer_text(p_data->>'phone_raw',64);
  v_email:=app.customer_text(p_data->>'email',254);
  if v_email is not null and (v_email !~ '^[A-Za-z0-9_%+-]+([.][A-Za-z0-9_%+-]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$' or length(split_part(v_email,'@',1))>64) then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  v_ig:=app.customer_text(p_data->>'instagram_handle',31);
  if left(v_ig,1)='@' then v_ig:=substr(v_ig,2); end if;
  if v_ig is not null and v_ig !~ '^[A-Za-z0-9_.]{1,30}$' then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  v_notes:=app.customer_text(p_data->>'private_notes',2000,true);
  return jsonb_build_object('full_name',v_name,'phone_raw',v_phone,'email',v_email,'instagram_handle',v_ig,'private_notes',v_notes)||app.customer_phone(v_phone);
end; $$;
create table public.customers (
  id uuid primary key,
  business_id uuid not null references public.businesses(id),
  full_name text not null,
  phone_raw text,
  phone_e164 text,
  phone_status text not null check(phone_status in ('missing','international','needs_review')),
  normalization_version text not null default 'customer-contact-v1' check(normalization_version='customer-contact-v1'),
  email text,
  instagram_handle text,
  private_notes text,
  source text not null default 'admin_api' check(source='admin_api'),
  marketing_revision integer not null default 1 check(marketing_revision>0),
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name_search text generated always as(lower(full_name)) stored,
  phone_search_digits text generated always as(translate(phone_raw,'+ ().-','')) stored,
  email_search text generated always as(lower(email)) stored,
  instagram_search text generated always as(lower(instagram_handle)) stored,
  unique(business_id,id),
  check(full_name=app.customer_text(full_name,120)),
  check(length(email)<=254 and length(instagram_handle)<=30 and length(private_notes)<=2000)
);
create function app.validate_customer()
returns trigger language plpgsql set search_path='' as $$
declare v jsonb;
begin
  v:=app.customer_payload(jsonb_build_object('full_name',new.full_name,'phone_raw',new.phone_raw,'email',new.email,'instagram_handle',new.instagram_handle,'private_notes',new.private_notes));
  new.full_name:=v->>'full_name';new.phone_raw:=v->>'phone_raw';new.phone_e164:=v->>'phone_e164';new.phone_status:=v->>'phone_status';
  new.email:=v->>'email';new.instagram_handle:=v->>'instagram_handle';new.private_notes:=v->>'private_notes';
  if tg_op='UPDATE' then
    new.source:=old.source;
    new.marketing_revision:=old.marketing_revision+case when (new.phone_raw,new.email,new.instagram_handle) is distinct from (old.phone_raw,old.email,old.instagram_handle) or (old.deleted_at is null and new.deleted_at is not null) then 1 else 0 end;
  else new.marketing_revision:=1; end if;
  return new;
end; $$;
create trigger customer_validate before insert or update on public.customers for each row execute function app.validate_customer();
create trigger customer_touch before update on public.customers for each row execute function app.touch_record();
create index customers_current_page on public.customers(business_id,created_at,id) where deleted_at is null;
create index customers_archived_page on public.customers(business_id,created_at,id) where deleted_at is not null;
create index customers_name_search on public.customers(business_id,name_search text_pattern_ops);
create index customers_phone_search on public.customers(business_id,phone_search_digits text_pattern_ops);
create index customers_phone_exact on public.customers(business_id,phone_e164);
create index customers_email_search on public.customers(business_id,email_search text_pattern_ops);
create index customers_instagram_search on public.customers(business_id,instagram_search text_pattern_ops);
create table app.customer_requests (
  business_id uuid not null references public.businesses(id),
  user_id uuid not null references public.users(id),
  operation text not null check(operation in ('create','update','archive','restore')),
  key uuid not null,
  canonical_version integer not null default 1 check(canonical_version=1),
  request_hash bytea not null,
  result jsonb not null,
  origin_request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(business_id,user_id,operation,key)
);
create index customer_requests_age on app.customer_requests(created_at);
alter table public.customers enable row level security;
alter table public.customers force row level security;
alter table app.customer_requests enable row level security;
alter table app.customer_requests force row level security;
revoke all on public.customers,app.customer_requests from public,anon,authenticated,service_role,app_server;

create function api.write_customer(p_business_id uuid,p_id uuid,p_action text,p_data jsonb,p_key uuid,p_expected integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor public.business_members; v_customer public.customers; v_prev app.customer_requests;
  v_data jsonb; v_hash bytea; v_result jsonb; v_trace uuid:=app.current_request_id(); v_before jsonb;
begin
  v_actor:=app.require_member(p_business_id,true);
  if p_id is null or p_key is null or p_action is null or p_action not in ('create','update','archive','restore') or p_id::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  if p_action in ('create','update') then v_data:=app.customer_payload(p_data);
  else
    if p_data is distinct from '{}'::jsonb then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
    v_data:='{}';
  end if;
  v_actor:=app.lock_managed_business(p_business_id);
  v_hash:=extensions.digest(jsonb_build_array(1,p_business_id,auth.uid(),p_action,p_id,v_data,p_expected)::text,'sha256');
  select r.* into v_prev from app.customer_requests r where r.business_id=p_business_id and r.user_id=auth.uid() and r.operation=p_action and r.key=p_key for update;
  if v_prev.key is not null and v_prev.created_at<=clock_timestamp()-interval '48 hours' then
    delete from app.customer_requests where business_id=p_business_id and user_id=auth.uid() and operation=p_action and key=p_key;
    v_prev:=null;
  end if;
  select c.* into v_customer from public.customers c where c.business_id=p_business_id and c.id=p_id for update;
  if v_prev.key is not null then
    if v_customer.id is null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
    if v_prev.request_hash<>v_hash then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='PT409'; end if;
    return v_prev.result;
  end if;
  if p_action='create' then
    if exists(select 1 from public.customers c where c.id=p_id) then raise exception 'DUPLICATE_RESOURCE' using errcode='PT409'; end if;
    if p_expected is not null then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
    insert into public.customers(id,business_id,full_name,phone_raw,email,instagram_handle,private_notes,phone_status)
      values(p_id,p_business_id,v_data->>'full_name',v_data->>'phone_raw',v_data->>'email',v_data->>'instagram_handle',v_data->>'private_notes',v_data->>'phone_status') returning * into v_customer;
  else
    if v_customer.id is null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
    if p_expected is null then raise exception 'PRECONDITION_REQUIRED' using errcode='PT428'; end if;
    if p_expected<>v_customer.version then raise exception 'PRECONDITION_FAILED' using errcode='PT412'; end if;
    if (p_action in ('update','archive') and v_customer.deleted_at is not null) or (p_action='restore' and v_customer.deleted_at is null) then raise exception 'RESOURCE_STATE_CONFLICT' using errcode='PT409'; end if;
    v_before:=jsonb_build_object('id',p_id,'version',v_customer.version,'deleted_at',v_customer.deleted_at);
    if p_action='update' then
      update public.customers set full_name=v_data->>'full_name',phone_raw=v_data->>'phone_raw',email=v_data->>'email',instagram_handle=v_data->>'instagram_handle',private_notes=v_data->>'private_notes' where business_id=p_business_id and id=p_id returning * into v_customer;
    else
      update public.customers set deleted_at=case when p_action='archive' then clock_timestamp() else null end where business_id=p_business_id and id=p_id returning * into v_customer;
    end if;
  end if;
  v_result:=jsonb_build_object('id',p_id,'business_id',p_business_id,'version',v_customer.version,'deleted_at',v_customer.deleted_at);
  insert into public.audit_logs(business_id,actor_type,actor_user_id,action,entity_type,entity_id,before_data,after_data,request_id)
    values(p_business_id,'user',auth.uid(),'customer.'||p_action,'customer',p_id,v_before,v_result,v_trace);
  insert into app.customer_requests(business_id,user_id,operation,key,request_hash,result,origin_request_id)
    values(p_business_id,auth.uid(),p_action,p_key,v_hash,v_result,v_trace);
  return v_result;
end; $$;
create function api.read_customer(p_business_id uuid,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
  perform app.require_member(p_business_id,true);
  select jsonb_build_object('id',c.id,'full_name',c.full_name,'phone_raw',c.phone_raw,'phone_e164',c.phone_e164,'phone_status',c.phone_status,'email',c.email,'instagram_handle',c.instagram_handle,'version',c.version,'created_at',c.created_at,'deleted_at',c.deleted_at,'private_notes',c.private_notes,'source',c.source,'updated_at',c.updated_at)
    into v from public.customers c where c.business_id=p_business_id and c.id=p_id;
  if v is null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  return v;
end; $$;
create function api.list_customers_page(p_business_id uuid,p_state text default 'current',p_field text default 'name',p_value text default null,p_mode text default 'prefix',p_limit integer default 50,p_cursor text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_cursor jsonb; v_created timestamptz; v_id uuid; v_filter text; v_value text; v_pattern text; v_min integer; v_max integer;
begin
  perform app.require_member(p_business_id,true);
  if p_state is null or p_state not in ('current','archived') or p_field is null or p_field not in ('name','phone','email','instagram') or p_mode is null or p_mode not in ('prefix','exact') or p_limit is null or p_limit<1 or p_limit>200 then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  v_value:=lower(app.customer_text(p_value,254));
  if v_value is not null then
    if p_field='phone' then
      if v_value !~ '^\+?[0-9 ().-]+$' then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
      v_value:=translate(v_value,'+ ().-','');
    elsif p_field='instagram' and left(v_value,1)='@' then v_value:=substr(v_value,2); end if;
    v_min:=case when p_field='phone' then 4 when p_field='email' then 3 else 2 end;
    v_max:=case when p_field='name' then 120 when p_field='phone' then 64 when p_field='instagram' then 30 else 254 end;
    if length(v_value)<v_min or length(v_value)>v_max then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  end if;
  v_filter:=encode(extensions.digest(jsonb_build_array(1,p_state,p_field,v_value,p_mode)::text,'sha256'),'hex');
  if p_cursor is not null then
    begin
      if length(p_cursor)<1 or length(p_cursor)>1024 or p_cursor !~ '^[A-Za-z0-9_-]+$' then raise exception 'Invalid cursor'; end if;
      v_cursor:=convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-length(p_cursor)%4)%4),'base64'),'UTF8')::jsonb;
      if jsonb_typeof(v_cursor)<>'object' or (select count(*) from jsonb_object_keys(v_cursor))<>5
        or jsonb_typeof(v_cursor->'v') is distinct from 'number' or v_cursor->>'v' is distinct from '1' or v_cursor->>'business_id' is distinct from p_business_id::text or v_cursor->>'filter_hash' is distinct from v_filter
        or jsonb_typeof(v_cursor->'id') is distinct from 'string' or jsonb_typeof(v_cursor->'created_at') is distinct from 'string'
        or v_cursor->>'created_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'Invalid cursor'; end if;
      v_created:=(v_cursor->>'created_at')::timestamptz;v_id:=(v_cursor->>'id')::uuid;
      if not isfinite(v_created) then raise exception 'Invalid cursor'; end if;
    exception when others then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end;
  end if;
  v_pattern:=replace(replace(replace(v_value,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  return (
    with candidates as materialized (
      select c.id,c.full_name,c.phone_raw,c.phone_e164,c.phone_status,c.email,c.instagram_handle,c.version,c.created_at,c.deleted_at
      from public.customers c where c.business_id=p_business_id and (c.deleted_at is null)=(p_state='current')
      and (v_created is null or (c.created_at,c.id)>(v_created,v_id))
      and (v_value is null or case when p_mode='exact' then
        (case p_field when 'name' then c.name_search when 'phone' then c.phone_search_digits when 'email' then c.email_search else c.instagram_search end)=v_value
        else (case p_field when 'name' then c.name_search when 'phone' then c.phone_search_digits when 'email' then c.email_search else c.instagram_search end) like v_pattern escape E'\\' end)
      order by c.created_at,c.id limit p_limit+1
    ), visible as (select * from candidates order by created_at,id limit p_limit)
    select jsonb_build_object('data',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'full_name',c.full_name,'phone_raw',c.phone_raw,'phone_e164',c.phone_e164,'phone_status',c.phone_status,'email',c.email,'instagram_handle',c.instagram_handle,'version',c.version,'created_at',c.created_at,'deleted_at',c.deleted_at) order by c.created_at,c.id) from visible c),'[]'),
      'page',jsonb_build_object('has_more',(select count(*)>p_limit from candidates),'next_cursor',case when (select count(*)>p_limit from candidates) then
        (select rtrim(translate(replace(encode(convert_to(jsonb_build_object('v',1,'business_id',p_business_id,'created_at',c.created_at,'id',c.id,'filter_hash',v_filter)::text,'UTF8'),'base64'),E'\n',''),'+/','-_'),'=') from visible c order by c.created_at desc,c.id desc limit 1) else null end))
  );
end; $$;
create function app.purge_customer_requests(p_batch_size integer default 500)
returns integer language plpgsql volatile set search_path='' as $$
declare v_count integer;v_cutoff timestamptz:=clock_timestamp()-interval '48 hours';
begin
  if p_batch_size is null or p_batch_size<1 or p_batch_size>500 then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  with expired as materialized(select business_id,user_id,operation,key from app.customer_requests where created_at<=v_cutoff order by created_at,business_id,user_id,operation,key limit p_batch_size for update skip locked),
    removed as(delete from app.customer_requests r using expired e where r.business_id=e.business_id and r.user_id=e.user_id and r.operation=e.operation and r.key=e.key returning 1)
  select count(*)::integer into v_count from removed;return v_count;
end; $$;
revoke all on function app.customer_text(text,integer,boolean),app.customer_phone(text),app.customer_payload(jsonb),app.validate_customer(),app.purge_customer_requests(integer),api.write_customer(uuid,uuid,text,jsonb,uuid,integer),api.read_customer(uuid,uuid),api.list_customers_page(uuid,text,text,text,text,integer,text) from public,anon,authenticated,service_role,app_server;
grant execute on function api.write_customer(uuid,uuid,text,jsonb,uuid,integer),api.read_customer(uuid,uuid),api.list_customers_page(uuid,text,text,text,text,integer,text) to authenticated;
