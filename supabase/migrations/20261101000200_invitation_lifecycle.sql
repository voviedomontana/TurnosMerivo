-- Rotate expired/pending invitations and revoke them without deleting history.
create function api.manage_invitation(p_business_id uuid,p_member_id uuid,p_token text,p_key uuid,p_expected integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor public.business_members; v_member public.business_members;
  v_previous app.member_requests; v_hash bytea; v_result jsonb; v_operation text;
begin
  perform 1 from public.businesses where id=p_business_id for update;
  v_actor:=app.require_member(p_business_id,true);
  select * into v_member from public.business_members where business_id=p_business_id and id=p_member_id for update;
  if v_member.id is null or v_member.user_id is not null then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  if v_actor.role='admin' and v_member.role<>'barber' then raise exception 'FORBIDDEN' using errcode='PT403'; end if;
  if p_key is null or (p_token is not null and p_token !~ '^[A-Za-z0-9_-]{43}$') then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  if p_expected is null then raise exception 'PRECONDITION_REQUIRED' using errcode='PT428'; end if;
  v_operation:=case when p_token is null then 'revoke_invitation' else 'renew_invitation' end;
  v_hash:=extensions.digest(jsonb_build_array(p_member_id,p_token,p_expected)::text,'sha256');
  select * into v_previous from app.member_requests where business_id=p_business_id and user_id=auth.uid() and operation=v_operation and key=p_key;
  if found then
    if v_previous.request_hash<>v_hash then raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='PT409'; end if;
    return v_previous.result;
  end if;
  if v_member.version<>p_expected then raise exception 'PRECONDITION_FAILED' using errcode='PT412'; end if;
  update public.business_members set status=case when p_token is null then 'suspended' else 'invited' end
    where id=p_member_id and business_id=p_business_id and version=p_expected returning * into v_member;
  if p_token is null then
    update app.member_invitations set expires_at=now() where member_id=p_member_id and business_id=p_business_id;
  else
    update app.member_invitations set token_hash=extensions.digest(p_token,'sha256'),expires_at=now()+interval '7 days'
      where member_id=p_member_id and business_id=p_business_id and accepted_by is null;
    if not found then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
  end if;
  v_result:=jsonb_build_object('id',v_member.id,'business_id',p_business_id,'role',v_member.role,'status',v_member.status,'version',v_member.version);
  insert into public.audit_logs(business_id,actor_type,actor_user_id,action,entity_type,entity_id,after_data,request_id)
    values(p_business_id,'user',auth.uid(),'member.'||v_operation,'business_member',p_member_id,v_result,p_key);
  insert into app.member_requests(business_id,user_id,operation,key,request_hash,result)
    values(p_business_id,auth.uid(),v_operation,p_key,v_hash,v_result);
  return v_result;
end;
$$;
revoke all on function api.manage_invitation(uuid,uuid,text,uuid,integer) from public,anon,authenticated,service_role,app_server;
grant execute on function api.manage_invitation(uuid,uuid,text,uuid,integer) to authenticated;
