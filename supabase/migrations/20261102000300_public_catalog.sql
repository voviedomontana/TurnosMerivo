-- PB-01: commercial read projection only. No public booking command or table grants.
create function app_internal.get_public_catalog(p_slug text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_business jsonb;v_business_id uuid;
begin
 v_business:=app_internal.get_public_business(p_slug);
 if v_business is null then return null;end if;
 v_business_id:=(v_business->>'id')::uuid;
 return jsonb_build_object('business',v_business,'professionals',coalesce((
  select jsonb_agg(jsonb_build_object('id',s.id,'display_name',s.display_name,'bio',s.bio,'services',(
   select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'description',v.description,'category',v.category,'price_cents',coalesce(l.price_override_cents,v.price_cents),'currency',v.currency,'duration_minutes',coalesce(l.duration_override_minutes,v.duration_minutes)) order by v.sort_order,v.name,v.id)
   from public.staff_services l join public.services v on v.business_id=l.business_id and v.id=l.service_id
   where l.business_id=v_business_id and l.staff_member_id=s.id and v.active and v.deleted_at is null
  )) order by s.sort_order,s.display_name,s.id)
  from public.staff_members s where s.business_id=v_business_id and s.active and s.deleted_at is null and s.accepts_online
  and exists(select 1 from public.staff_services l join public.services v on v.business_id=l.business_id and v.id=l.service_id where l.business_id=v_business_id and l.staff_member_id=s.id and v.active and v.deleted_at is null)
 ),'[]'::jsonb));
end;$$;
revoke all on function app_internal.get_public_catalog(text) from public,anon,authenticated,app_server,service_role;
grant execute on function app_internal.get_public_catalog(text) to app_server;
