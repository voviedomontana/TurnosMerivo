import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { publicBookingFixture } from "./public-booking-fixture.mjs";
export async function runPublicBookingConcurrency({ sql, dbName, prefix }) {
  assert.ok(prefix.startsWith("merivo-s2-check-"));
  assert.equal(dbName, `${prefix}-db`);
  const clients = new Set();
  let serial = 0;
  async function until(check) {
    for (let i = 0; i < 320; i++) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw Error("Public booking concurrency barrier timed out");
  }
  function connection() {
    const name = `public-booking-${++serial}`,
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
  const f = publicBookingFixture(sql);
  sql("update app.public_booking_runtime set disposable=true;");
  const backend = "set role app_server;";
  const envelope = JSON.stringify({
    key_id: "fixture",
    nonce: "c".repeat(16),
    tag: "d".repeat(22),
    ciphertext: "e".repeat(58),
  });
  const quote = () =>
    sql(
      backend +
        `select app_internal.public_availability('${f.slug}','${f.staff}','${f.service}','${f.day}',1)->>'quote_id';`,
    )
      .split(/\r?\n/)
      .at(-1);
  function intent(hour) {
    const a = randomUUID(),
      id = randomUUID(),
      key = randomUUID(),
      secret = randomUUID().replaceAll("-", "") + "a".repeat(11),
      token = randomUUID().replaceAll("-", "") + "b".repeat(11);
    sql(
      backend +
        `select app_internal.public_issue_attempt('${f.slug}','${a}','${secret}');`,
    );
    const data = {
      staff_id: f.staff,
      service_id: f.service,
      starts_at: `${f.day}T${hour}:00:00-03:00`,
      quote_id: quote(),
      customer: {
        full_name: "Concurrent public fixture",
        phone_raw: "1144445555",
      },
      privacy_policy_version: "test-notice-v1",
    };
    return {
      a,
      id,
      key,
      secret,
      token,
      data,
      query: `select app_internal.public_create('${f.slug}','${a}','${secret}','${id}','${key}','${JSON.stringify(data)}','${token}','${f.day}T${hour}:00:00-03:00'::timestamptz+interval '24 hours','${envelope}');`,
    };
  }
  async function hold(q) {
    const c = connection();
    c.send(`begin;${q}select 'READY';`);
    await until(() => {
      if (c.closed)
        throw Error(
          `Public booking holder ${passed} failed (${c.error.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? "unknown"}); statement output withheld`,
        );
      return c.output.includes("READY");
    });
    return c;
  }
  function reject(c, code, message) {
    assert.ok(
      c.error.includes(code + ":"),
      `Expected public rejection ${code}`,
    );
    if (message)
      assert.ok(c.error.includes(message), "Expected named domain rejection");
    assert.ok(!c.error.includes("40P01:"), "Deadlocks are failures");
  }
  let passed = 0;
  try {
    const first = intent("09"),
      second = intent("09");
    let holder = await hold(backend + first.query),
      waiter = connection();
    waiter.send(backend + second.query);
    await waiting(waiter);
    assert.equal((await holder.finish("commit;")).code, 0);
    reject(await waiter.finish(), "PT409", "SLOT_TAKEN");
    assert.equal(
      sql(
        `select count(*) from public.appointments where business_id='${f.b}'`,
      ),
      "1",
    );
    passed++;
    const replay = intent("10");
    holder = await hold(backend + replay.query);
    waiter = connection();
    waiter.send(backend + replay.query);
    await waiting(waiter);
    assert.equal((await holder.finish("commit;")).code, 0);
    assert.equal((await waiter.finish()).code, 0);
    assert.equal(
      sql(
        `select count(*) from public.appointment_events where appointment_id='${replay.id}'`,
      ),
      "1",
    );
    passed++;
    const admin = intent("11");
    holder = await hold(
      `set role authenticated;set "request.jwt.claim.sub"='${f.owner}';set "request.jwt.claims"='{"aal":"aal2"}';select api.manage_appointment('${f.b}','create','${randomUUID()}','${JSON.stringify({ customer_id: f.customer, staff_id: f.staff, service_id: f.service, starts_at: `${f.day}T11:00:00-03:00`, context_versions: { staff: 1, service: 1, customer: 1, calendar: 1, settings: 1, business: 1 } })}','${randomUUID()}',null);`,
    );
    waiter = connection();
    waiter.send(backend + admin.query);
    await waiting(waiter);
    assert.equal((await holder.finish("commit;")).code, 0);
    reject(await waiter.finish(), "PT409", "SLOT_TAKEN");
    passed++;
    // A cookie which was valid at preflight expires while the command waits.
    const expiring = intent("12");
    holder = await hold(
      `select id from public.businesses where id='${f.b}' for update;update app.public_attempts set expires_at=clock_timestamp()-interval '1 second' where id='${expiring.a}';`,
    );
    waiter = connection();
    waiter.send(backend + expiring.query);
    await waiting(waiter);
    await holder.finish("commit;");
    reject(await waiter.finish(), "PT404");
    passed++;
    // Revocation wins root after the public preflight saw the old token.
    holder = await hold(
      `select id from public.businesses where id='${f.b}' for update;update app.public_manage_tokens set revoked_at=clock_timestamp() where appointment_id='${replay.id}';`,
    );
    waiter = connection();
    waiter.send(
      backend +
        `select app_internal.public_change('${f.slug}','${replay.id}','${replay.token}','cancel','${randomUUID()}',1,'{}');`,
    );
    await waiting(waiter);
    await holder.finish("commit;");
    reject(await waiter.finish(), "PT404");
    passed++;
    const closed = intent("13");
    holder = await hold(
      `set role authenticated;set "request.jwt.claim.sub"='${f.owner}';set "request.jwt.claims"='{"aal":"aal2"}';select api.write_schedule('${f.b}',null,'block','${randomUUID()}','save','{"start_date":"${f.day}","start_minute":780,"end_date":"${f.day}","end_minute":825,"kind":"manual"}','${randomUUID()}',1);`,
    );
    waiter = connection();
    waiter.send(backend + closed.query);
    await waiting(waiter);
    await holder.finish("commit;");
    reject(await waiter.finish(), "PT412");
    passed++;
    // Two sessions target one version: cancellation wins and movement cannot repeat it.
    const movable = intent("14");
    sql(backend + movable.query);
    const moveQuote = quote();
    holder = await hold(
      backend +
        `select app_internal.public_change('${f.slug}','${movable.id}','${movable.token}','cancel','${randomUUID()}',1,'{}');`,
    );
    waiter = connection();
    waiter.send(
      backend +
        `select app_internal.public_change('${f.slug}','${movable.id}','${movable.token}','reschedule','${randomUUID()}',1,'{"starts_at":"${f.day}T15:00:00-03:00","quote_id":"${moveQuote}"}','${f.day}T15:00:00-03:00'::timestamptz+interval '24 hours','${envelope}');`,
    );
    await waiting(waiter);
    await holder.finish("commit;");
    reject(await waiter.finish(), "PT412");
    passed++;
    // Aborted purge owns no root and must not prevent another booking.
    sql(
      `update app.public_booking_requests set created_at=clock_timestamp()-interval '49 hours' where business_id='${f.b}'`,
    );
    holder = await hold("select app.purge_public_booking(500);");
    const fresh = intent("16");
    waiter = connection();
    assert.equal((await waiter.finish(backend + fresh.query)).code, 0);
    await holder.finish("rollback;");
    assert.ok(
      Number(
        sql(
          `select count(*) from app.public_booking_requests where business_id='${f.b}'`,
        ),
      ) > 0,
    );
    passed++;
    // A transaction lost before COMMIT leaves no business effect; the same intent retries once.
    const interrupted = intent("17");
    holder = await hold(backend + interrupted.query);
    await holder.finish("rollback;");
    assert.equal(
      sql(
        `select count(*) from public.appointments where id='${interrupted.id}'`,
      ),
      "0",
    );
    sql(backend + interrupted.query);
    assert.equal(
      sql(
        `select count(*) from public.appointment_events where appointment_id='${interrupted.id}'`,
      ),
      "1",
    );
    passed++;
    // A staging closure/expiry committed while a command waits must be rechecked.
    sql(
      "update app.public_booking_runtime set disposable=false,staging_enabled=true,staging_origin='https://staging.example.test',staging_until=clock_timestamp()+interval '1 hour';",
    );
    for (const close of [
      "staging_enabled=false",
      "staging_until=clock_timestamp()-interval '1 second'",
    ]) {
      sql(
        "update app.public_booking_runtime set staging_enabled=true,staging_until=clock_timestamp()+interval '1 hour';",
      );
      const gated = intent("12");
      holder = await hold(
        `select id from public.businesses where id='${f.b}' for update;`,
      );
      waiter = connection();
      waiter.send(backend + gated.query);
      await waiting(waiter);
      sql(`update app.public_booking_runtime set ${close};`);
      await holder.finish("commit;");
      reject(await waiter.finish(), "PT503", "PUBLIC_BOOKING_DISABLED");
      assert.equal(
        sql(`select count(*) from public.appointments where id='${gated.id}'`),
        "0",
      );
      passed++;
    }
    console.log(
      `Public booking concurrency PASS: ${passed} independent-connection scenarios: competing customers/admin, identical replay, expired cookie/revoked token after wait, changed availability, cancel/move and failed purge.`,
    );
    return passed;
  } finally {
    for (const c of clients) c.child.kill();
    sql(
      "update app.public_booking_runtime set disposable=false,staging_enabled=false;",
    );
  }
}
