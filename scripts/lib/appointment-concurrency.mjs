import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
export async function runAppointmentConcurrency({ sql, dbName, prefix }) {
  assert.ok(prefix.startsWith("merivo-s2-check-"));
  assert.equal(dbName, `${prefix}-db`);
  const clients = new Set();
  let serial = 0;
  async function until(check) {
    for (let i = 0; i < 320; i++) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw Error("Appointment concurrency barrier timed out");
  }
  function connection() {
    const name = `appointment-${++serial}`,
      child = spawn(
        "docker",
        [
          "exec",
          "-i",
          dbName,
          "psql",
          "-X",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-At",
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          "VERBOSITY=verbose",
        ],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      ),
      c = { name, child, output: "", error: "", closed: false, code: null };
    clients.add(c);
    child.stdout.on("data", (x) => {
      c.output += x;
    });
    child.stderr.on("data", (x) => {
      c.error += x;
    });
    child.stdin.on("error", () => {});
    child.on("error", () => {
      c.closed = true;
      c.code = -1;
    });
    child.on("close", (code) => {
      c.closed = true;
      c.code = code;
      clients.delete(c);
    });
    c.send = (q) => child.stdin.write(q + "\n");
    c.finish = async (q = "") => {
      child.stdin.end(q);
      await until(() => c.closed);
      return c;
    };
    c.send(
      `set application_name='${name}';set statement_timeout='10s';set lock_timeout='9s';`,
    );
    return c;
  }
  async function waiting(c) {
    await until(() => {
      assert.ok(!c.closed);
      return (
        sql(
          `select count(*) from pg_stat_activity where application_name='${c.name}' and wait_event_type='Lock'`,
        ) === "1"
      );
    });
  }
  const b = randomUUID(),
    owner = randomUUID(),
    admin = randomUUID(),
    member = randomUUID(),
    staff = randomUUID(),
    customer = randomUUID(),
    service = randomUUID(),
    plan = randomUUID();
  const day = sql(
    "select ((clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date+1)::text",
  );
  sql(
    `insert into auth.users(id,email,email_confirmed_at) values('${owner}','o-${b}@example.test',now()),('${admin}','a-${b}@example.test',now());insert into public.businesses(id,slug,name) values('${b}','in-${b.slice(0, 20)}','Appointment concurrency');insert into public.business_settings(business_id,min_notice_minutes) values('${b}',0);insert into public.business_members(business_id,user_id,role) values('${b}','${owner}','owner');insert into public.business_members(id,business_id,user_id,role) values('${member}','${b}','${admin}','admin');insert into public.staff_members(id,business_id,display_name) values('${staff}','${b}','Fixture');insert into public.customers(id,business_id,full_name) values('${customer}','${b}','Synthetic fixture');insert into public.services(id,business_id,name,price_cents,duration_minutes,buffer_minutes) values('${service}','${b}','Fixture',150000,30,15);insert into public.staff_services(business_id,staff_member_id,service_id) values('${b}','${staff}','${service}');insert into public.staff_working_plans(id,business_id,staff_member_id,effective_from,created_by) values('${plan}','${b}','${staff}','${day}','${owner}');insert into public.working_hours(business_id,plan_id,position,weekday,start_minute,end_minute) select '${b}','${plan}',n,n,540,1080 from generate_series(1,7)n;`,
  );
  const claims = (u) =>
    `set role authenticated;set "request.jwt.claim.sub"='${u}';set "request.jwt.claims"='{"aal":"aal2"}';`;
  const context = {
    staff: 1,
    service: 1,
    customer: 1,
    calendar: 1,
    settings: 1,
    business: 1,
  };
  const body = (hour) => ({
    customer_id: customer,
    staff_id: staff,
    service_id: service,
    starts_at: `${day}T${hour}:00:00-03:00`,
    context_versions: context,
  });
  const create = (hour, id = randomUUID(), key = randomUUID()) =>
    `select api.manage_appointment('${b}','create','${id}','${JSON.stringify(body(hour))}','${key}',null);`;
  const change = (id, action, hour, version = 1, key = randomUUID()) =>
    `select api.manage_appointment('${b}','${action}','${id}','${JSON.stringify(action === "cancel" ? {} : { starts_at: `${day}T${hour}:00:00-03:00`, context_versions: { staff: 1, calendar: 1, settings: 1, business: 1 } })}','${key}',${version});`;
  async function hold(q) {
    const c = connection();
    c.send(`begin;${q}select 'READY';`);
    await until(() => {
      if (c.closed) throw Error(c.error);
      return c.output.includes("READY");
    });
    return c;
  }
  const reject = (c, code, message) => {
    assert.ok(
      c.error.includes(code + ":"),
      `Expected ${code}: ${c.error.slice(0, 200)}`,
    );
    if (message) assert.ok(c.error.includes(message));
    assert.ok(!c.error.includes("40P01:"));
  };
  let passed = 0;
  try {
    const a = randomUUID();
    let holder = await hold(claims(owner) + create("09", a)),
      waiter = connection();
    waiter.send(claims(admin) + create("09"));
    await waiting(waiter);
    assert.equal((await holder.finish("commit;")).code, 0);
    reject(await waiter.finish(), "PT409", "SLOT_TAKEN");
    passed++;
    const r = randomUUID(),
      key = randomUUID();
    holder = await hold(claims(owner) + create("10", r, key));
    waiter = connection();
    waiter.send(claims(owner) + create("10", r, key));
    await waiting(waiter);
    assert.equal((await holder.finish("commit;")).code, 0);
    assert.equal((await waiter.finish()).code, 0);
    assert.equal(
      sql(
        `select count(*) from public.appointment_events where appointment_id='${r}'`,
      ),
      "1",
    );
    passed++;
    holder = await hold(claims(owner) + change(a, "reschedule", "11"));
    waiter = connection();
    waiter.send(claims(admin) + create("11"));
    await waiting(waiter);
    assert.equal((await holder.finish("commit;")).code, 0);
    reject(await waiter.finish(), "PT409", "SLOT_TAKEN");
    assert.equal(
      sql(
        `select count(*) from app.appointment_occupancy where appointment_id='${a}'`,
      ),
      "2",
    );
    passed++;
    holder = await hold(claims(owner) + change(a, "cancel", null, 2));
    waiter = connection();
    waiter.send(claims(admin) + change(a, "reschedule", "12", 2));
    await waiting(waiter);
    assert.equal((await holder.finish("commit;")).code, 0);
    reject(await waiter.finish(), "PT412");
    passed++;
    // Both sessions begin authorized; revocation wins the same root lock.
    const revokedId = randomUUID(),
      revokedKey = randomUUID();
    sql(claims(admin) + create("14", revokedId, revokedKey));
    holder = await hold(
      claims(owner) +
        `select api.update_member('${b}','${member}','admin','suspended','${randomUUID()}',1);`,
    );
    waiter = connection();
    waiter.send(claims(admin) + create("14", revokedId, revokedKey));
    await waiting(waiter);
    assert.equal((await holder.finish("commit;")).code, 0);
    reject(await waiter.finish(), "PT404");
    passed++;
    // Booking wins; a competing global closure must roll back completely.
    holder = await hold(claims(owner) + create("12"));
    waiter = connection();
    waiter.send(
      claims(owner) +
        `select api.write_schedule('${b}',null,'exception','${randomUUID()}','save','{"date":"${day}","kind":"closed","intervals":[]}','${randomUUID()}',1);`,
    );
    await waiting(waiter);
    assert.equal((await holder.finish("commit;")).code, 0);
    reject(await waiter.finish(), "PT409", "APPOINTMENTS_AFFECTED");
    assert.equal(
      sql(
        `select count(*) from app.calendar_controls where business_id='${b}'`,
      ),
      "0",
    );
    passed++;
    // Purge has no root lock: a held purge can fail without blocking fresh work.
    sql(
      `update app.appointment_requests set created_at=clock_timestamp()-interval '49 hours' where business_id='${b}'`,
    );
    holder = await hold("select app.purge_appointment_requests(500);");
    waiter = connection();
    assert.equal((await waiter.finish(claims(owner) + create("13"))).code, 0);
    await holder.finish("rollback;");
    passed++;
    // Expired replay waits on its own row only; aborted purge leaves a normal replay expiry.
    holder = await hold("select app.purge_appointment_requests(500);");
    waiter = connection();
    waiter.send(claims(owner) + create("10", r, key));
    await waiting(waiter);
    await holder.finish("rollback;");
    reject(await waiter.finish(), "PT409", "DUPLICATE_RESOURCE");
    assert.equal(
      sql(
        `select count(*) from public.appointment_events where appointment_id='${r}'`,
      ),
      "1",
    );
    passed++;
    // Bypass RPC root deliberately as maintenance fixtures: EXCLUDE itself serializes overlap.
    const direct = (id) =>
      `insert into public.appointments(id,business_id,customer_id,staff_member_id,service_id,starts_at,ends_at,blocked_until,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,buffer_minutes_snapshot,created_by) values('${id}','${b}','${customer}','${staff}','${service}','${day}T15:00:00-03:00','${day}T15:30:00-03:00','${day}T15:45:00-03:00','Fixture',150000,30,15,'${owner}');insert into app.appointment_occupancy(business_id,appointment_id,staff_member_id,generation,starts_at,blocked_until) values('${b}','${id}','${staff}',1,'${day}T15:00:00-03:00','${day}T15:45:00-03:00');`;
    holder = await hold(direct(randomUUID()));
    waiter = connection();
    waiter.send("begin;" + direct(randomUUID()));
    await waiting(waiter);
    assert.equal((await holder.finish("commit;")).code, 0);
    reject(
      await waiter.finish("commit;"),
      "23P01",
      "appointment_occupancy_no_overlap",
    );
    passed++;
    // Reverse ordering: configuration commits first; the old booking context is stale.
    const nextDay = sql(`select ('${day}'::date+1)::text`),
      failedId = randomUUID();
    holder = await hold(
      claims(owner) +
        `select api.write_schedule('${b}',null,'exception','${randomUUID()}','save','{"date":"${nextDay}","kind":"closed","intervals":[]}','${randomUUID()}',1);`,
    );
    waiter = connection();
    waiter.send(
      claims(owner) + create("09", failedId).replaceAll(day, nextDay),
    );
    await waiting(waiter);
    assert.equal((await holder.finish("commit;")).code, 0);
    reject(await waiter.finish(), "PT412");
    assert.equal(
      sql(`select count(*) from public.appointments where id='${failedId}'`),
      "0",
    );
    passed++;
    console.log(
      `Appointments concurrency PASS: ${passed} independent-connection scenarios, no deadlocks; root reauthorization, competing slots, replay, reschedule/cancel, HS rollback, purge failure and direct EXCLUDE.`,
    );
    return passed;
  } finally {
    for (const c of clients) c.child.kill();
  }
}
