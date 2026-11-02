import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
export async function runScheduleConcurrency({ sql, dbName, prefix }) {
  assert.ok(prefix.startsWith("merivo-s2-check-"));
  assert.equal(dbName, `${prefix}-db`);
  const clients = new Set();
  let serial = 0;
  async function until(check) {
    for (let i = 0; i < 320; i++) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw Error("Schedule concurrency barrier timed out");
  }
  function connection() {
    const name = `schedule-${++serial}`,
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
    day = sql(
      "select ((clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date+1)::text",
    );
  sql(
    `insert into auth.users(id,email,email_confirmed_at) values('${owner}','o-${b}@example.test',now()),('${admin}','a-${b}@example.test',now());insert into public.businesses(id,slug,name) values('${b}','hs-${b.slice(0, 20)}','Schedule concurrency');insert into public.business_members(business_id,user_id,role) values('${b}','${owner}','owner');insert into public.business_members(id,business_id,user_id,role) values('${member}','${b}','${admin}','admin');insert into public.staff_members(id,business_id,display_name) values('${staff}','${b}','Fixture');`,
  );
  const claims = (u) =>
    `set role authenticated;set "request.jwt.claim.sub"='${u}';set "request.jwt.claims"='{"aal":"aal2"}';`;
  const plan = (version, id = randomUUID(), key = randomUUID()) =>
    `select api.write_schedule('${b}','${staff}','plan','${id}','save','{"effective_from":"${day}","intervals":[]}','${key}',${version});`;
  async function hold(query) {
    const c = connection();
    c.send(`begin;${query}select 'READY';`);
    await until(() => c.output.includes("READY"));
    return c;
  }
  const reject = (c, code) => {
    assert.ok(c.error.includes(code + ":"), `Expected ${code}`);
    assert.ok(!c.error.includes("40P01:"), "Deadlock is not a valid rejection");
  };
  let passed = 0;
  try {
    let holder = await hold(claims(owner) + plan(1)),
      waiter = connection();
    waiter.send(claims(admin) + plan(1));
    await waiting(waiter);
    await holder.finish("commit;");
    reject(await waiter.finish(), "PT412");
    assert.equal(
      sql(`select version from public.staff_members where id='${staff}'`),
      "2",
    );
    passed++;
    holder = await hold(
      claims(owner) +
        `select api.update_member('${b}','${member}','admin','suspended','${randomUUID()}',1);`,
    );
    waiter = connection();
    waiter.send(claims(admin) + plan(2));
    await waiting(waiter);
    await holder.finish("commit;");
    reject(await waiter.finish(), "PT404");
    passed++;
    holder = await hold(
      claims(owner) +
        `select api.write_catalog('${b}','staff','${staff}','update','{"display_name":"Catalog winner"}','${randomUUID()}',2);`,
    );
    waiter = connection();
    waiter.send(claims(owner) + plan(2));
    await waiting(waiter);
    await holder.finish("commit;");
    reject(await waiter.finish(), "PT412");
    assert.equal(
      sql(`select version from public.staff_members where id='${staff}'`),
      "3",
    );
    passed++;
    const global = () =>
      `select api.write_schedule('${b}',null,'exception','${randomUUID()}','save','{"date":"${day}","kind":"closed","intervals":[]}','${randomUUID()}',1);`;
    holder = await hold(claims(owner) + global());
    waiter = connection();
    waiter.send(claims(owner) + global());
    await waiting(waiter);
    await holder.finish("commit;");
    reject(await waiter.finish(), "PT412");
    assert.equal(
      sql(`select version from app.calendar_controls where business_id='${b}'`),
      "2",
    );
    passed++;
    const id = randomUUID(),
      key = randomUUID(),
      same = plan(3, id, key);
    holder = await hold(claims(owner) + same);
    waiter = connection();
    waiter.send(claims(owner) + same);
    await waiting(waiter);
    await holder.finish("commit;");
    assert.equal((await waiter.finish()).code, 0);
    assert.equal(
      sql(`select count(*) from public.audit_logs where entity_id='${id}'`),
      "1",
    );
    passed++;
    sql(
      `update app.schedule_requests set created_at=clock_timestamp()-interval '49 hours' where business_id='${b}' and key='${key}'`,
    );
    holder = await hold("select app.purge_schedule_requests(500);");
    waiter = connection();
    waiter.send(claims(owner) + same);
    await waiting(waiter);
    await holder.finish("commit;");
    reject(await waiter.finish(), "PT412");
    assert.equal(
      sql(`select version from public.staff_members where id='${staff}'`),
      "4",
    );
    passed++;
    sql(
      `update app.schedule_requests set created_at=clock_timestamp()-interval '49 hours' where business_id='${b}'`,
    );
    holder = await hold("select app.purge_schedule_requests(500);");
    const other = connection();
    assert.equal(
      (
        await other.finish(
          claims(owner) +
            `select api.update_member('${b}','${member}','admin','active','${randomUUID()}',2);`,
        )
      ).code,
      0,
    );
    await holder.finish("rollback;");
    assert.ok(
      Number(
        sql(
          `select count(*) from app.schedule_requests where business_id='${b}'`,
        ),
      ) > 0,
    );
    passed++;
    console.log(
      `Schedule concurrency PASS: ${passed} independent-connection scenarios; editors, role revocation, catalogue, global initialization, replay and purge.`,
    );
    return passed;
  } finally {
    for (const c of clients) c.child.kill();
  }
}
