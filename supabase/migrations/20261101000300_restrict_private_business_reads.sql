-- A-08: table access cannot distinguish application roles within authenticated.
revoke select on public.businesses, public.business_settings from authenticated;

create function api.read_business_private(p_business_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_member(p_business_id, true);
  return (
    select jsonb_build_object(
      'business', jsonb_build_object(
        'id', b.id, 'slug', b.slug::text, 'name', b.name,
        'legal_name', b.legal_name, 'tax_id', b.tax_id, 'phone', b.phone,
        'address_line', b.address_line, 'city', b.city, 'region', b.region,
        'country', b.country, 'timezone', b.timezone, 'logo_path', b.logo_path,
        'status', b.status, 'plan_id', b.plan_id,
        'billing_customer_ref', b.billing_customer_ref, 'version', b.version
      ),
      'settings', jsonb_build_object(
        'business_id', s.business_id, 'slot_interval_minutes', s.slot_interval_minutes,
        'min_notice_minutes', s.min_notice_minutes, 'max_advance_days', s.max_advance_days,
        'cancellation_cutoff_hours', s.cancellation_cutoff_hours,
        'reschedule_cutoff_hours', s.reschedule_cutoff_hours,
        'max_client_reschedules', s.max_client_reschedules, 'auto_confirm', s.auto_confirm,
        'pending_hold_minutes', s.pending_hold_minutes, 'allow_any_staff', s.allow_any_staff,
        'require_email', s.require_email, 'public_booking_enabled', s.public_booking_enabled,
        'barber_can_edit_availability', s.barber_can_edit_availability,
        'max_active_bookings_per_customer', s.max_active_bookings_per_customer,
        'reminder_offsets_minutes', s.reminder_offsets_minutes, 'locale', s.locale,
        'currency', s.currency, 'branding', s.branding,
        'privacy_policy_version', s.privacy_policy_version, 'version', s.version
      )
    )
    from public.businesses b
    join public.business_settings s on s.business_id = b.id
    where b.id = p_business_id
  );
end;
$$;

revoke all on function api.read_business_private(uuid)
  from public, anon, authenticated, service_role, app_server;
grant execute on function api.read_business_private(uuid) to authenticated;
