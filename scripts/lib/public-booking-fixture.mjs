import { randomUUID } from "node:crypto";
export function publicBookingFixture(sql, ownerId) {
  const b = randomUUID(),
    staff = randomUUID(),
    service = randomUUID(),
    plan = randomUUID(),
    customer = randomUUID(),
    owner = ownerId ?? randomUUID(),
    slug = `pb-${b.slice(0, 20)}`;
  if (!ownerId)
    sql(
      `insert into auth.users(id,email,email_confirmed_at) values('${owner}','pb-${owner}@example.test',now());`,
    );
  sql(
    `insert into public.businesses(id,slug,name) values('${b}','${slug}','Merivo prueba pública');insert into public.business_settings(business_id,min_notice_minutes,cancellation_cutoff_hours,reschedule_cutoff_hours,privacy_policy_version) values('${b}',0,0,0,'test-notice-v1');insert into public.business_members(business_id,user_id,role) values('${b}','${owner}','owner');insert into public.staff_members(id,business_id,display_name) values('${staff}','${b}','Profesional público de prueba');insert into public.services(id,business_id,name,price_cents,duration_minutes,buffer_minutes) values('${service}','${b}','Corte público de prueba',180000,30,15);insert into public.staff_services(business_id,staff_member_id,service_id) values('${b}','${staff}','${service}');insert into public.customers(id,business_id,full_name,phone_raw,phone_status,private_notes) values('${customer}','${b}','Ficha administrativa fixture','1144445555','needs_review','PRIVATE-NOTES');insert into public.staff_working_plans(id,business_id,staff_member_id,effective_from,created_by) values('${plan}','${b}','${staff}',(clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date,'${owner}');insert into public.working_hours(business_id,plan_id,position,weekday,start_minute,end_minute) select '${b}','${plan}',n,n,540,1080 from generate_series(1,7)n;`,
  );
  const day = sql(
      "select ((clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date+1)::text",
    ),
    nextDay = sql(`select ('${day}'::date+1)::text`);
  return { b, staff, service, customer, owner, slug, day, nextDay };
}
