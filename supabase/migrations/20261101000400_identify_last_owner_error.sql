-- A-05: preserve the existing trigger and guard, identify only this domain error.
create or replace function app.protect_last_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform 1 from public.businesses where id = old.business_id for update;
  if old.role = 'owner' and old.status = 'active'
    and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active'
      or new.user_id is distinct from old.user_id) then
    if not exists (select 1 from public.business_members
      where business_id = old.business_id and id <> old.id and role = 'owner' and status = 'active') then
      raise exception 'LAST_OWNER' using errcode = 'PT409';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
