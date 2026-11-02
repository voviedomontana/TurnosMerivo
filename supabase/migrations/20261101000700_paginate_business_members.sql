-- A-M05: opt-in pagination; the original list_members(uuid) remains unchanged.
create index business_members_page_order on public.business_members(business_id,created_at,id);

create function api.list_members_page(p_business_id uuid,p_limit integer default 50,p_cursor text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_cursor jsonb; v_created timestamptz; v_id uuid;
begin
  perform app.require_member(p_business_id,true);
  if p_limit is null or p_limit<1 or p_limit>200 then raise exception 'VALIDATION_ERROR' using errcode='PT400'; end if;
  if p_cursor is not null then
    begin
      if length(p_cursor)<1 or length(p_cursor)>1024 or p_cursor !~ '^[A-Za-z0-9_-]+$' then
        raise exception 'Invalid cursor';
      end if;
      v_cursor:=convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-length(p_cursor)%4)%4),'base64'),'UTF8')::jsonb;
      if jsonb_typeof(v_cursor)<>'object' or (select count(*) from jsonb_object_keys(v_cursor))<>4
        or jsonb_typeof(v_cursor->'v') is distinct from 'number' or v_cursor->>'v'<>'1'
        or jsonb_typeof(v_cursor->'business_id') is distinct from 'string'
        or jsonb_typeof(v_cursor->'id') is distinct from 'string'
        or jsonb_typeof(v_cursor->'created_at') is distinct from 'string'
        or (v_cursor->>'business_id')::uuid<>p_business_id
        or v_cursor->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or v_cursor->>'created_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
        raise exception 'Invalid cursor';
      end if;
      v_created:=(v_cursor->>'created_at')::timestamptz;
      v_id:=(v_cursor->>'id')::uuid;
      if not isfinite(v_created) then raise exception 'Invalid cursor'; end if;
    exception when others then
      -- Cursor contents are untrusted selectors; never expose decoder/SQL details.
      raise exception 'VALIDATION_ERROR' using errcode='PT400';
    end;
  end if;
  return (
    with candidates as materialized (
      select m.id,m.user_id,coalesce(u.email,m.invited_email)::text as email,m.role,m.status,m.version,
        m.created_at,i.expires_at
      from public.business_members m left join public.users u on u.id=m.user_id
      left join app.member_invitations i on i.member_id=m.id and i.business_id=m.business_id
      where m.business_id=p_business_id and (v_created is null or (m.created_at,m.id)>(v_created,v_id))
      order by m.created_at,m.id limit p_limit+1
    ), visible as (
      select c.id,c.user_id,c.email,c.role,c.status,c.version,c.created_at,c.expires_at
      from candidates c order by c.created_at,c.id limit p_limit
    )
    select jsonb_build_object(
      'data',coalesce((select jsonb_agg(jsonb_build_object(
        'id',v.id,'user_id',v.user_id,'email',v.email,'role',v.role,'status',v.status,
        'version',v.version,'expires_at',v.expires_at) order by v.created_at,v.id) from visible v),'[]'::jsonb),
      'page',jsonb_build_object('has_more',(select count(*)>p_limit from candidates),
        'next_cursor',case when (select count(*)>p_limit from candidates) then (
          select rtrim(translate(replace(encode(convert_to(jsonb_build_object(
            'v',1,'business_id',p_business_id,'created_at',v.created_at,'id',v.id)::text,'UTF8'),'base64'),E'\n',''),'+/','-_'),'=')
          from visible v order by v.created_at desc,v.id desc limit 1
        ) else null end)
    )
  );
end;
$$;
revoke all on function api.list_members_page(uuid,integer,text) from public,anon,authenticated,service_role,app_server;
grant execute on function api.list_members_page(uuid,integer,text) to authenticated;
