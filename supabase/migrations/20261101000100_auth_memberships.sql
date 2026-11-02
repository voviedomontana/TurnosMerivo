-- Sprint 2. Identity is always derived from a verified PostgREST session.
create extension if not exists pgcrypto with schema extensions;

create table public.platform_admins (
  user_id uuid primary key references public.users(id),
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id),
  actor_type text not null check (actor_type in ('user','platform_admin','system','integration')),
  actor_user_id uuid references public.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  request_id uuid not null,
  created_at timestamptz not null default now()
);
create index audit_business_created on public.audit_logs(business_id,created_at desc);
create table app.member_invitations (
  member_id uuid primary key,
  business_id uuid not null,
  token_hash bytea not null unique,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references public.users(id),
  foreign key (business_id,member_id) references public.business_members(business_id,id),
  check (octet_length(token_hash)=32)
);
create table app.member_requests (
  business_id uuid not null references public.businesses(id),
  user_id uuid not null references public.users(id),
  operation text not null,
  key uuid not null,
  request_hash bytea not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (business_id,user_id,operation,key)
);
alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;
alter table app.member_invitations enable row level security;
alter table app.member_invitations force row level security;
alter table app.member_requests enable row level security;
alter table app.member_requests force row level security;
revoke all on public.platform_admins,public.audit_logs,app.member_invitations,app.member_requests
  from public,anon,authenticated,service_role,app_server;

create function app.sync_auth_profile()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.email is not null then
    insert into public.users(id,email) values(new.id,new.email)
    on conflict(id) do update set email=excluded.email;
  end if;
  return new;
end;
$$;
create trigger auth_profile_sync after insert or update of email on auth.users
  for each row execute function app.sync_auth_profile();
insert into public.users(id,email) select id,email from auth.users where email is not null
  on conflict(id) do update set email=excluded.email;

-- Retain the S1 boolean helper signature, now requiring MFA for privileged members.
create or replace function app.is_active_member(p_business_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (select 1 from public.business_members m
    join public.users u on u.id=m.user_id
    join public.businesses b on b.id=m.business_id
    where m.business_id=p_business_id and m.user_id=auth.uid()
      and m.status='active' and u.deleted_at is null
      and b.status='active' and b.deleted_at is null
      and ((m.role='barber' and not exists(select 1 from public.platform_admins p where p.user_id=auth.uid()))
        or auth.jwt()->>'aal'='aal2'));
$$;

create function app.require_member(p_business_id uuid, p_manage boolean default false)
returns public.business_members language plpgsql stable security definer set search_path='' as $$
declare v_member public.business_members;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='PT401'; end if;
  select m.* into v_member from public.business_members m
    join public.users u on u.id=m.user_id
    join public.businesses b on b.id=m.business_id
    join auth.users a on a.id=u.id
    where m.business_id=p_business_id and m.user_id=auth.uid() and m.status='active'
      and u.deleted_at is null and b.deleted_at is null and b.status='active'
      and a.email_confirmed_at is not null;
  if v_member.id is null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  if (v_member.role in ('owner','admin') or exists(select 1 from public.platform_admins p where p.user_id=auth.uid()))
    and coalesce(auth.jwt()->>'aal','') <> 'aal2' then
    raise exception 'MFA_REQUIRED' using errcode='PT403';
  end if;
  if p_manage and v_member.role='barber' then raise exception 'FORBIDDEN' using errcode='PT403'; end if;
  return v_member;
end;
$$;

create function api.me()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='PT401'; end if;
  select jsonb_build_object('id',u.id,'email',u.email,'full_name',u.full_name,
    'platform_admin',exists(select 1 from public.platform_admins p where p.user_id=u.id),
    'memberships',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'business_id',m.business_id,'name',b.name,'slug',b.slug::text,'role',m.role,'version',m.version)
      order by b.name,b.id) from public.business_members m join public.businesses b on b.id=m.business_id
      where m.user_id=u.id and m.status='active' and b.status='active' and b.deleted_at is null),'[]'::jsonb))
    into v_result from public.users u join auth.users a on a.id=u.id
    where u.id=auth.uid() and u.deleted_at is null and a.email_confirmed_at is not null;
  if v_result is null then raise exception 'UNAUTHENTICATED' using errcode='PT401'; end if;
  return v_result;
end;
$$;

create function api.list_members(p_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform app.require_member(p_business_id,true);
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',m.id,'user_id',m.user_id,'email',coalesce(u.email,m.invited_email),
    'role',m.role,'status',m.status,'version',m.version,'expires_at',i.expires_at)
    order by m.created_at,m.id)
    from public.business_members m left join public.users u on u.id=m.user_id
    left join app.member_invitations i on i.member_id=m.id
    where m.business_id=p_business_id),'[]'::jsonb);
end;
$$;

-- Private core. No caller may supply an actor, bypass MFA, or write tables directly.
create function app.manage_member(p_business_id uuid,p_operation text,p_member_id uuid,
  p_role text,p_status text,p_email text,p_token text,p_key uuid,p_expected integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor public.business_members; v_target public.business_members;
  v_hash bytea; v_previous app.member_requests; v_result jsonb; v_before jsonb;
begin
  perform 1 from public.businesses where id=p_business_id for update;
  v_actor := app.require_member(p_business_id,true);
  if p_key is null then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  if p_operation not in ('invite','update') or p_role is null or p_role not in ('owner','admin','barber') then
    raise exception 'VALIDATION_ERROR' using errcode='PT400';
  end if;
  if p_operation='update' then
    select * into v_target from public.business_members where id=p_member_id and business_id=p_business_id for update;
    if v_target.id is null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
    if v_target.user_id=auth.uid() then raise exception 'FORBIDDEN' using errcode='PT403'; end if;
    if p_expected is null then raise exception 'PRECONDITION_REQUIRED' using errcode='PT428'; end if;
    if p_status is null or p_status not in ('active','suspended') or v_target.status='invited' then
      raise exception 'VALIDATION_ERROR' using errcode='PT400';
    end if;
  end if;
  if v_actor.role='admin' and (p_role<>'barber' or (v_target.id is not null and v_target.role<>'barber')) then
    raise exception 'FORBIDDEN' using errcode='PT403';
  end if;
  v_hash := extensions.digest(jsonb_build_array(p_member_id,p_role,p_status,lower(btrim(p_email)),p_token,p_expected)::text,'sha256');
  select * into v_previous from app.member_requests where business_id=p_business_id and user_id=auth.uid()
    and operation=p_operation and key=p_key;
  if found then
    if v_previous.request_hash<>v_hash then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='PT409'; end if;
    return v_previous.result;
  end if;
  if p_operation='invite' then
    if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
      raise exception 'VALIDATION_ERROR' using errcode='PT400';
    end if;
    if exists(select 1 from public.business_members m left join public.users u on u.id=m.user_id
      where m.business_id=p_business_id and (u.email=lower(btrim(p_email)) or m.invited_email=lower(btrim(p_email)))) then
      raise exception 'DUPLICATE_RESOURCE' using errcode='PT409';
    end if;
    insert into public.business_members(business_id,invited_email,role,status,invited_by)
      values(p_business_id,lower(btrim(p_email)),p_role,'invited',auth.uid()) returning * into v_target;
    insert into app.member_invitations(member_id,business_id,token_hash)
      values(v_target.id,p_business_id,extensions.digest(p_token,'sha256'));
  else
    if v_target.version<>p_expected then raise exception 'PRECONDITION_FAILED' using errcode='PT412'; end if;
    v_before := jsonb_build_object('role',v_target.role,'status',v_target.status,'version',v_target.version);
    update public.business_members set role=p_role,status=p_status
      where id=p_member_id and business_id=p_business_id and version=p_expected returning * into v_target;
  end if;
  v_result := jsonb_build_object('id',v_target.id,'business_id',v_target.business_id,
    'role',v_target.role,'status',v_target.status,'version',v_target.version);
  insert into public.audit_logs(business_id,actor_type,actor_user_id,action,entity_type,entity_id,before_data,after_data,request_id)
    values(p_business_id,'user',auth.uid(),'member.'||p_operation,'business_member',v_target.id,v_before,v_result,p_key);
  insert into app.member_requests(business_id,user_id,operation,key,request_hash,result)
    values(p_business_id,auth.uid(),p_operation,p_key,v_hash,v_result);
  return v_result;
end;
$$;
create function api.invite_member(p_business_id uuid,p_email text,p_role text,p_token text,p_key uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select app.manage_member(p_business_id,'invite',null,p_role,null,p_email,p_token,p_key,null);
$$;
-- Wrappers are definer so the private core itself never receives an API grant.
alter function api.invite_member(uuid,text,text,text,uuid) security definer;
create function api.update_member(p_business_id uuid,p_member_id uuid,p_role text,p_status text,p_key uuid,p_expected integer)
returns jsonb language sql security definer set search_path='' as $$
  select app.manage_member(p_business_id,'update',p_member_id,p_role,p_status,null,null,p_key,p_expected);
$$;

create function api.accept_invitation(p_token text,p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_inv app.member_invitations; v_member public.business_members; v_email text;
  v_previous app.member_requests; v_hash bytea; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='PT401'; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' or p_key is null then
    raise exception 'VALIDATION_ERROR' using errcode='PT400';
  end if;
  select * into v_inv from app.member_invitations where token_hash=extensions.digest(p_token,'sha256');
  if v_inv.member_id is null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  perform 1 from public.businesses where id=v_inv.business_id and status='active' and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  select * into v_inv from app.member_invitations where member_id=v_inv.member_id for update;
  select * into v_member from public.business_members where id=v_inv.member_id and business_id=v_inv.business_id for update;
  select a.email into v_email from auth.users a join public.users u on u.id=a.id
    where a.id=auth.uid() and a.email_confirmed_at is not null and u.deleted_at is null;
  if v_email is null or lower(v_email)<>v_member.invited_email::text then
    raise exception 'NOT_FOUND' using errcode='PT404';
  end if;
  if (v_member.role in ('owner','admin') or exists(select 1 from public.platform_admins p where p.user_id=auth.uid()))
    and coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'MFA_REQUIRED' using errcode='PT403'; end if;
  v_hash := extensions.digest(p_token,'sha256');
  select * into v_previous from app.member_requests where business_id=v_inv.business_id and user_id=auth.uid()
    and operation='accept' and key=p_key;
  if found then
    if v_previous.request_hash<>v_hash then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='PT409'; end if;
    if v_member.status<>'active' or v_member.user_id<>auth.uid() then raise exception 'FORBIDDEN' using errcode='PT403'; end if;
    return v_previous.result;
  end if;
  if v_inv.accepted_by is not null or v_inv.expires_at<=now() or v_member.status<>'invited' then
    raise exception 'NOT_FOUND' using errcode='PT404';
  end if;
  if exists(select 1 from public.business_members where business_id=v_inv.business_id and user_id=auth.uid()) then
    raise exception 'DUPLICATE_RESOURCE' using errcode='PT409'; end if;
  update public.business_members set user_id=auth.uid(),status='active',accepted_at=now()
    where id=v_member.id returning * into v_member;
  update app.member_invitations set accepted_by=auth.uid() where member_id=v_member.id;
  v_result := jsonb_build_object('id',v_member.id,'business_id',v_member.business_id,'role',v_member.role,
    'status',v_member.status,'version',v_member.version);
  insert into public.audit_logs(business_id,actor_type,actor_user_id,action,entity_type,entity_id,after_data,request_id)
    values(v_member.business_id,'user',auth.uid(),'member.accept','business_member',v_member.id,v_result,p_key);
  insert into app.member_requests(business_id,user_id,operation,key,request_hash,result)
    values(v_member.business_id,auth.uid(),'accept',p_key,v_hash,v_result);
  return v_result;
end;
$$;
create function app.reject_audit_mutation()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Audit records are immutable' using errcode='23514'; end;
$$;
create trigger audit_immutable before update or delete on public.audit_logs for each row execute function app.reject_audit_mutation();

revoke all on all functions in schema api from public,anon,authenticated,service_role,app_server;
revoke all on function app.sync_auth_profile(),app.require_member(uuid,boolean),
  app.manage_member(uuid,text,uuid,text,text,text,text,uuid,integer),app.reject_audit_mutation()
  from public,anon,authenticated,service_role,app_server;
grant usage on schema api to authenticated;
grant execute on function api.me(),api.list_members(uuid),api.invite_member(uuid,text,text,text,uuid),
  api.update_member(uuid,uuid,text,text,uuid,integer),api.accept_invitation(text,uuid) to authenticated;
