-- Staging only. No activation, secrets, role changes or production mode.
alter table app.public_booking_runtime
  add column staging_enabled boolean not null default false,
  add column staging_origin text,
  add column staging_until timestamptz,
  add constraint public_staging_configuration check (
    not staging_enabled or (
      staging_origin is not null and staging_origin ~ '^https://[a-z0-9.-]+$'
      and length(staging_origin) <= 253 and staging_until is not null
    )
  );

create function app_internal.public_staging_ready(p_origin text)
returns boolean language sql volatile security definer set search_path='' as $$
  select coalesce((select staging_enabled and not disposable
    and staging_origin = p_origin and staging_until > clock_timestamp()
    and staging_until <= clock_timestamp() + interval '24 hours'
    from app.public_booking_runtime where id), false);
$$;
revoke all on function app_internal.public_staging_ready(text) from public,anon,authenticated,service_role;
grant execute on function app_internal.public_staging_ready(text) to app_server;

-- Preserve the existing guard signature used by every public command.
-- VOLATILE refreshes the gate after a root-lock wait in READ COMMITTED.
create or replace function app.require_disposable_public()
returns void language plpgsql volatile set search_path='' as $$
begin
  if not coalesce((select disposable or (staging_enabled
      and staging_until > clock_timestamp()
      and staging_until <= clock_timestamp() + interval '24 hours')
      from app.public_booking_runtime where id), false) then
    raise exception 'PUBLIC_BOOKING_DISABLED' using errcode='PT503';
  end if;
end;$$;
revoke all on function app.require_disposable_public() from public,anon,authenticated,app_server,service_role;

create function app.audit_public_staging_gate()
returns trigger language plpgsql set search_path='' as $$
begin
  if (old.staging_enabled,old.staging_origin,old.staging_until)
      is distinct from (new.staging_enabled,new.staging_origin,new.staging_until) then
    insert into public.audit_logs(actor_type,action,entity_type,before_data,after_data,request_id)
    values ('system','public_staging.configured','public_runtime',
      jsonb_build_object('enabled',old.staging_enabled,'origin',old.staging_origin,'until',old.staging_until),
      jsonb_build_object('enabled',new.staging_enabled,'origin',new.staging_origin,'until',new.staging_until,'database_role',session_user),
      app.current_request_id());
  end if;
  return new;
end;$$;
revoke all on function app.audit_public_staging_gate() from public,anon,authenticated,app_server,service_role;
create trigger audit_public_staging_gate after update on app.public_booking_runtime
for each row execute function app.audit_public_staging_gate();
