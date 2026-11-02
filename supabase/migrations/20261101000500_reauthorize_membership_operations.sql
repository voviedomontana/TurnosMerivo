-- A-M03 only: preauthorize, coordinate the root, then reauthorize with a fresh
-- READ COMMITTED command snapshot. No external calls or new business features.
create function app.lock_managed_business(p_business_id uuid)
returns public.business_members language plpgsql volatile security definer set search_path='' as $$
begin
  perform app.require_member(p_business_id,true);
  -- Repeated reads must not inherit a transaction-wide, pre-lock snapshot.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'VALIDATION_ERROR' using errcode='PT400';
  end if;
  perform 1 from public.businesses where id=p_business_id for update;
  return app.require_member(p_business_id,true);
end;
$$;

create or replace function app.manage_member(p_business_id uuid,p_operation text,p_member_id uuid,
  p_role text,p_status text,p_email text,p_token text,p_key uuid,p_expected integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor public.business_members; v_target public.business_members;
  v_hash bytea; v_previous app.member_requests; v_result jsonb; v_before jsonb;
begin
  v_actor:=app.require_member(p_business_id,true);
  if p_key is null or p_operation is null or p_operation not in ('invite','update')
    or p_role is null or p_role not in ('owner','admin','barber') then
    raise exception 'VALIDATION_ERROR' using errcode='PT400';
  end if;
  if p_operation='update' then
    select m.* into v_target from public.business_members m where m.id=p_member_id and m.business_id=p_business_id;
    if v_target.id is null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
    if v_target.user_id=auth.uid() then raise exception 'FORBIDDEN' using errcode='PT403'; end if;
  end if;
  if v_actor.role='admin' and (p_role<>'barber' or (v_target.id is not null and v_target.role<>'barber')) then
    raise exception 'FORBIDDEN' using errcode='PT403';
  end if;

  v_actor:=app.lock_managed_business(p_business_id);
  v_hash:=extensions.digest(jsonb_build_array(p_member_id,p_role,p_status,lower(btrim(p_email)),p_token,p_expected)::text,'sha256');
  select r.* into v_previous from app.member_requests r where r.business_id=p_business_id and r.user_id=auth.uid()
    and r.operation=p_operation and r.key=p_key for update;
  if p_operation='update' then
    select m.* into v_target from public.business_members m where m.id=p_member_id and m.business_id=p_business_id for update;
    if v_target.id is null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
    if v_target.user_id=auth.uid() then raise exception 'FORBIDDEN' using errcode='PT403'; end if;
  elsif v_previous.key is not null then
    select m.* into v_target from public.business_members m
      where m.id=(v_previous.result->>'id')::uuid and m.business_id=p_business_id for update;
    if v_target.id is null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  end if;
  if v_actor.role='admin' and (p_role<>'barber' or (v_target.id is not null and v_target.role<>'barber')) then
    raise exception 'FORBIDDEN' using errcode='PT403';
  end if;
  if v_previous.key is not null then
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
    if p_expected is null then raise exception 'PRECONDITION_REQUIRED' using errcode='PT428'; end if;
    if p_status is null or p_status not in ('active','suspended') or v_target.status='invited' then
      raise exception 'VALIDATION_ERROR' using errcode='PT400';
    end if;
    if v_target.version<>p_expected then raise exception 'PRECONDITION_FAILED' using errcode='PT412'; end if;
    v_before:=jsonb_build_object('role',v_target.role,'status',v_target.status,'version',v_target.version);
    update public.business_members set role=p_role,status=p_status
      where id=p_member_id and business_id=p_business_id and version=p_expected returning * into v_target;
  end if;
  v_result:=jsonb_build_object('id',v_target.id,'business_id',v_target.business_id,
    'role',v_target.role,'status',v_target.status,'version',v_target.version);
  insert into public.audit_logs(business_id,actor_type,actor_user_id,action,entity_type,entity_id,before_data,after_data,request_id)
    values(p_business_id,'user',auth.uid(),'member.'||p_operation,'business_member',v_target.id,v_before,v_result,p_key);
  insert into app.member_requests(business_id,user_id,operation,key,request_hash,result)
    values(p_business_id,auth.uid(),p_operation,p_key,v_hash,v_result);
  return v_result;
end;
$$;

create or replace function api.manage_invitation(p_business_id uuid,p_member_id uuid,p_token text,p_key uuid,p_expected integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor public.business_members; v_member public.business_members;
  v_inv app.member_invitations; v_previous app.member_requests; v_hash bytea; v_result jsonb; v_operation text;
begin
  v_actor:=app.require_member(p_business_id,true);
  select m.* into v_member from public.business_members m where m.business_id=p_business_id and m.id=p_member_id;
  if v_member.id is null or v_member.user_id is not null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  if v_actor.role='admin' and v_member.role<>'barber' then raise exception 'FORBIDDEN' using errcode='PT403'; end if;
  if p_key is null or (p_token is not null and p_token !~ '^[A-Za-z0-9_-]{43}$') then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;

  v_actor:=app.lock_managed_business(p_business_id);
  v_operation:=case when p_token is null then 'revoke_invitation' else 'renew_invitation' end;
  v_hash:=extensions.digest(jsonb_build_array(p_member_id,p_token,p_expected)::text,'sha256');
  select r.* into v_previous from app.member_requests r where r.business_id=p_business_id and r.user_id=auth.uid()
    and r.operation=v_operation and r.key=p_key for update;
  select m.* into v_member from public.business_members m where m.business_id=p_business_id and m.id=p_member_id for update;
  if v_member.id is null or v_member.user_id is not null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  if v_actor.role='admin' and v_member.role<>'barber' then raise exception 'FORBIDDEN' using errcode='PT403'; end if;
  select i.* into v_inv from app.member_invitations i where i.member_id=p_member_id and i.business_id=p_business_id for update;
  if v_inv.member_id is null or v_inv.accepted_by is not null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  if v_previous.key is not null then
    if v_previous.request_hash<>v_hash then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='PT409'; end if;
    return v_previous.result;
  end if;
  if p_expected is null then raise exception 'PRECONDITION_REQUIRED' using errcode='PT428'; end if;
  if v_member.version<>p_expected then raise exception 'PRECONDITION_FAILED' using errcode='PT412'; end if;
  update public.business_members set status=case when p_token is null then 'suspended' else 'invited' end
    where id=p_member_id and business_id=p_business_id and version=p_expected returning * into v_member;
  if p_token is null then
    update app.member_invitations set expires_at=clock_timestamp() where member_id=p_member_id and business_id=p_business_id;
  else
    update app.member_invitations set token_hash=extensions.digest(p_token,'sha256'),expires_at=clock_timestamp()+interval '7 days'
      where member_id=p_member_id and business_id=p_business_id and accepted_by is null;
  end if;
  v_result:=jsonb_build_object('id',v_member.id,'business_id',p_business_id,'role',v_member.role,'status',v_member.status,'version',v_member.version);
  insert into public.audit_logs(business_id,actor_type,actor_user_id,action,entity_type,entity_id,after_data,request_id)
    values(p_business_id,'user',auth.uid(),'member.'||v_operation,'business_member',p_member_id,v_result,p_key);
  insert into app.member_requests(business_id,user_id,operation,key,request_hash,result)
    values(p_business_id,auth.uid(),v_operation,p_key,v_hash,v_result);
  return v_result;
end;
$$;

-- Both preflight and post-lock acceptance use this private identity/token guard.
create function app.require_current_invitation(p_token text)
returns app.member_invitations language plpgsql volatile security definer set search_path='' as $$
declare v_inv app.member_invitations; v_member public.business_members; v_email text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED' using errcode='PT401'; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  select i.* into v_inv from app.member_invitations i join public.businesses b on b.id=i.business_id
    where i.token_hash=extensions.digest(p_token,'sha256') and b.status='active' and b.deleted_at is null;
  if v_inv.member_id is null or v_inv.expires_at<=clock_timestamp() then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  select m.* into v_member from public.business_members m where m.id=v_inv.member_id and m.business_id=v_inv.business_id;
  select a.email into v_email from auth.users a join public.users u on u.id=a.id
    where a.id=auth.uid() and a.email_confirmed_at is not null and u.deleted_at is null;
  if v_member.id is null or v_email is null or lower(v_email)<>lower(v_member.invited_email::text)
    or not coalesce(((v_inv.accepted_by is null and v_member.status='invited' and v_member.user_id is null)
      or (v_inv.accepted_by=auth.uid() and v_member.status='active' and v_member.user_id=auth.uid())),false) then
    raise exception 'NOT_FOUND' using errcode='PT404';
  end if;
  if (v_member.role in ('owner','admin') or exists(select 1 from public.platform_admins p where p.user_id=auth.uid()))
    and coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'MFA_REQUIRED' using errcode='PT403'; end if;
  return v_inv;
end;
$$;

create or replace function api.accept_invitation(p_token text,p_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_inv app.member_invitations; v_checked app.member_invitations; v_member public.business_members;
  v_previous app.member_requests; v_hash bytea; v_result jsonb;
begin
  v_inv:=app.require_current_invitation(p_token);
  if p_key is null or current_setting('transaction_isolation')<>'read committed' then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  perform 1 from public.businesses where id=v_inv.business_id for update;
  v_checked:=app.require_current_invitation(p_token);
  if v_checked.member_id<>v_inv.member_id or v_checked.business_id<>v_inv.business_id then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  v_hash:=extensions.digest(p_token,'sha256');
  select r.* into v_previous from app.member_requests r where r.business_id=v_inv.business_id and r.user_id=auth.uid()
    and r.operation='accept' and r.key=p_key for update;
  select m.* into v_member from public.business_members m where m.id=v_inv.member_id and m.business_id=v_inv.business_id for update;
  select i.* into v_inv from app.member_invitations i where i.member_id=v_member.id and i.business_id=v_member.business_id for update;
  -- Recheck even after waiting for a child lock or crossing the expiry boundary.
  perform app.require_current_invitation(p_token);
  if v_previous.key is not null then
    if v_previous.request_hash<>v_hash then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='PT409'; end if;
    if v_member.status<>'active' or v_member.user_id<>auth.uid() then raise exception 'FORBIDDEN' using errcode='PT403'; end if;
    return v_previous.result;
  end if;
  if v_inv.accepted_by is not null or v_member.status<>'invited' then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  if exists(select 1 from public.business_members where business_id=v_inv.business_id and user_id=auth.uid()) then
    raise exception 'DUPLICATE_RESOURCE' using errcode='PT409'; end if;
  update public.business_members set user_id=auth.uid(),status='active',accepted_at=now()
    where id=v_member.id returning * into v_member;
  update app.member_invitations set accepted_by=auth.uid() where member_id=v_member.id;
  v_result:=jsonb_build_object('id',v_member.id,'business_id',v_member.business_id,'role',v_member.role,
    'status',v_member.status,'version',v_member.version);
  insert into public.audit_logs(business_id,actor_type,actor_user_id,action,entity_type,entity_id,after_data,request_id)
    values(v_member.business_id,'user',auth.uid(),'member.accept','business_member',v_member.id,v_result,p_key);
  insert into app.member_requests(business_id,user_id,operation,key,request_hash,result)
    values(v_member.business_id,auth.uid(),'accept',p_key,v_hash,v_result);
  return v_result;
end;
$$;

create function api.prepare_member_auth_invite(p_business_id uuid,p_member_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor public.business_members; v_member public.business_members; v_inv app.member_invitations;
begin
  v_actor:=app.require_member(p_business_id,true);
  select m.* into v_member from public.business_members m where m.id=p_member_id and m.business_id=p_business_id;
  if v_member.id is null or v_member.user_id is not null or v_member.status<>'invited' then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  if v_actor.role='admin' and v_member.role<>'barber' then raise exception 'FORBIDDEN' using errcode='PT403'; end if;
  select i.* into v_inv from app.member_invitations i where i.member_id=p_member_id and i.business_id=p_business_id;
  if v_inv.member_id is null or v_inv.accepted_by is not null or v_inv.expires_at<=clock_timestamp() then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  v_actor:=app.lock_managed_business(p_business_id);
  select m.* into v_member from public.business_members m where m.id=p_member_id and m.business_id=p_business_id for update;
  if v_member.id is null or v_member.user_id is not null or v_member.status<>'invited' then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  if v_actor.role='admin' and v_member.role<>'barber' then raise exception 'FORBIDDEN' using errcode='PT403'; end if;
  select i.* into v_inv from app.member_invitations i where i.member_id=p_member_id and i.business_id=p_business_id for update;
  if v_inv.member_id is null or v_inv.accepted_by is not null or v_inv.expires_at<=clock_timestamp() then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  return jsonb_build_object('id',v_member.id,'business_id',p_business_id,'email',v_member.invited_email::text,'version',v_member.version);
end;
$$;

revoke all on function app.lock_managed_business(uuid),app.require_current_invitation(text),
  api.prepare_member_auth_invite(uuid,uuid) from public,anon,authenticated,service_role,app_server;
grant execute on function api.prepare_member_auth_invite(uuid,uuid) to authenticated;
