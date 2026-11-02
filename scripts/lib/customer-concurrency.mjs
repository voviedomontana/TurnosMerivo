import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export async function runCustomerConcurrency({ sql, dbName, prefix }) {
  assert.ok(prefix.startsWith("merivo-s2-check-"));
  assert.equal(dbName, `${prefix}-db`);
  const clients = new Set();
  let serial = 0;
  async function until(check) {
    for (let i = 0; i < 240; i++) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("Customer concurrency barrier timed out");
  }
  function connection() {
    const name = `customer-${++serial}`,
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
      );
    const c = { name, child, output: "", error: "", closed: false, code: null };
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
      `set application_name='${name}';set statement_timeout='8s';set lock_timeout='7s';`,
    );
    return c;
  }
  async function waiting(c) {
    await until(() => {
      assert.ok(!c.closed, "Expected live lock waiter");
      return (
        sql(
          `select count(*) from pg_stat_activity where application_name='${c.name}' and wait_event_type='Lock'`,
        ) === "1"
      );
    });
  }
  const claims = (u) =>
    `set role authenticated;set "request.jwt.claim.sub"='${u}';set "request.jwt.claims"='{"aal":"aal2"}';`;
  const b = randomUUID(),
    owner = randomUUID(),
    admin = randomUUID(),
    member = randomUUID(),
    id = randomUUID(),
    key = randomUUID();
  sql(
    `insert into auth.users(id,email,email_confirmed_at) values('${owner}','o-${b}@example.test',now()),('${admin}','a-${b}@example.test',now());insert into public.businesses(id,slug,name) values('${b}','customer-${b.slice(0, 18)}','Customer concurrency');insert into public.business_members(business_id,user_id,role) values('${b}','${owner}','owner');insert into public.business_members(id,business_id,user_id,role) values('${member}','${b}','${admin}','admin');`,
  );
  const write = (
    action,
    expected,
    name = "Fixture",
    k = randomUUID(),
    resource = id,
  ) =>
    `select api.write_customer('${b}','${resource}','${action}','{"full_name":"${name}"}','${k}',${expected});`;
  sql(claims(owner) + write("create", "null"));
  let passed = 0;
  function rejected(c, code) {
    assert.ok(c.error.includes(code + ":"), `Expected ${code}`);
    assert.ok(
      !c.error.includes("40P01:"),
      "Deadlock is not a successful rejection",
    );
  }
  try {
    let holder = connection();
    holder.send(
      `begin;${claims(owner)}${write("update", 1, "Winner", key)}select 'READY';`,
    );
    await until(() => holder.output.includes("READY"));
    let waiter = connection();
    waiter.send(claims(admin) + write("update", 1, "Loser"));
    await waiting(waiter);
    assert.equal((await holder.finish("commit;")).code, 0);
    rejected(await waiter.finish(), "PT412");
    assert.equal(
      sql(
        `select version||':'||full_name from public.customers where id='${id}'`,
      ),
      "2:Winner",
    );
    passed++;
    holder = connection();
    holder.send(
      `begin;${claims(owner)}select api.update_member('${b}','${member}','admin','suspended','${randomUUID()}',1);select 'READY';`,
    );
    await until(() => holder.output.includes("READY"));
    waiter = connection();
    waiter.send(claims(admin) + write("update", 2, "Revoked"));
    await waiting(waiter);
    await holder.finish("commit;");
    rejected(await waiter.finish(), "PT404");
    assert.equal(
      sql(`select version from public.customers where id='${id}'`),
      "2",
    );
    passed++;
    const duplicate = randomUUID(),
      sameKey = randomUUID(),
      create = write("create", "null", "Shared command", sameKey, duplicate);
    holder = connection();
    holder.send(`begin;${claims(owner)}${create}select 'READY';`);
    await until(() => holder.output.includes("READY"));
    waiter = connection();
    waiter.send(claims(owner) + create);
    await waiting(waiter);
    await holder.finish("commit;");
    assert.equal((await waiter.finish()).code, 0);
    assert.equal(
      sql(
        `select count(*) from public.audit_logs where entity_id='${duplicate}'`,
      ),
      "1",
    );
    passed++;
    sql(
      `update app.customer_requests set created_at=clock_timestamp()-interval '49 hours' where business_id='${b}' and key='${key}'`,
    );
    holder = connection();
    holder.send(
      `begin;select app.purge_customer_requests(500);select 'READY';`,
    );
    await until(() => holder.output.includes("READY"));
    waiter = connection();
    waiter.send(claims(owner) + write("update", 1, "Winner", key));
    await waiting(waiter);
    await holder.finish("commit;");
    rejected(await waiter.finish(), "PT412");
    assert.equal(
      sql(`select version from public.customers where id='${id}'`),
      "2",
    );
    passed++;
    sql(
      `update app.customer_requests set created_at=clock_timestamp()-interval '49 hours' where business_id='${b}'`,
    );
    holder = connection();
    holder.send(
      `begin;select app.purge_customer_requests(500);select 'READY';`,
    );
    await until(() => holder.output.includes("READY"));
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
          `select count(*) from app.customer_requests where business_id='${b}'`,
        ),
      ) > 0,
    );
    passed++;
    console.log(
      `Customer concurrency PASS: ${passed} independent-connection scenarios: version conflict, revocation, replay, purge/write, purge rollback without root blocking.`,
    );
    return passed;
  } finally {
    for (const c of clients) c.child.kill();
  }
}
