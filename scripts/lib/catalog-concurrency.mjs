import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export async function runCatalogConcurrency({ sql, dbName, prefix }) {
  assert.ok(prefix.startsWith("merivo-s2-check-"));
  assert.equal(dbName, `${prefix}-db`);
  const b = randomUUID(),
    owner = randomUUID(),
    admin = randomUUID(),
    service = randomUUID(),
    member = randomUUID();
  sql(`insert into auth.users(id,email,email_confirmed_at) values('${owner}','o-${b}@example.test',now()),('${admin}','a-${b}@example.test',now());
    insert into public.businesses(id,slug,name) values('${b}','cat-${b.slice(0, 20)}','Catalog races');
    insert into public.business_settings(business_id) values('${b}');
    insert into public.business_members(business_id,user_id,role) values('${b}','${owner}','owner');
    insert into public.business_members(id,business_id,user_id,role) values('${member}','${b}','${admin}','admin');`);
  const claims = (user) =>
    `set role authenticated;set "request.jwt.claim.sub"='${user}';set "request.jwt.claims"='{"aal":"aal2"}';`;
  const write = (action, id, key, expected, price = 100) =>
    `select api.write_catalog('${b}','service','${id}','${action}','{"name":"Corte","price_cents":${price},"duration_minutes":30}','${key}',${expected});`;
  sql(claims(owner) + write("create", service, randomUUID(), "null"));
  function query(text, name) {
    const child = spawn(
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
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
        "-At",
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "",
      error = "";
    child.stdout.on("data", (c) => {
      output += c;
    });
    child.stderr.on("data", (c) => {
      error += c;
    });
    const done = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output, error }));
    });
    child.stdin.end(
      `set application_name='${name}';set statement_timeout='12s';${text}`,
    );
    return done;
  }
  async function barrier(name) {
    for (let i = 0; i < 100; i++) {
      if (
        sql(
          `select count(*) from pg_stat_activity where application_name='${name}' and wait_event='PgSleep'`,
        ) === "1"
      )
        return;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error("Catalog lock barrier not reached");
  }
  let holder = query(
    `begin;${claims(owner)}${write("update", service, randomUUID(), 1, 200)}select pg_sleep(2);commit;`,
    "catalog-edit-holder",
  );
  await barrier("catalog-edit-holder");
  const stale = await query(
    claims(admin) + write("update", service, randomUUID(), 1, 300),
    "catalog-edit-waiter",
  );
  assert.equal((await holder).code, 0);
  assert.ok(stale.error.includes("PT412:"));
  assert.equal(
    sql(
      `select version||':'||price_cents from public.services where id='${service}'`,
    ),
    "2:200",
  );
  holder = query(
    `begin;${claims(owner)}select api.update_member('${b}','${member}','admin','suspended','${randomUUID()}',1);select pg_sleep(2);commit;`,
    "catalog-revoke-holder",
  );
  await barrier("catalog-revoke-holder");
  const revoked = await query(
    claims(admin) + write("update", service, randomUUID(), 2, 400),
    "catalog-revoke-waiter",
  );
  assert.equal((await holder).code, 0);
  assert.ok(revoked.error.includes("PT404:"));
  assert.equal(
    sql(
      `select version||':'||price_cents from public.services where id='${service}'`,
    ),
    "2:200",
  );
  const id = randomUUID(),
    key = randomUUID();
  const create = `select api.write_catalog('${b}','staff','${id}','create','{"display_name":"Concurrent profile"}','${key}',null);`;
  holder = query(
    `begin;${claims(owner)}${create}select pg_sleep(2);commit;`,
    "catalog-replay-holder",
  );
  await barrier("catalog-replay-holder");
  const replay = await query(claims(owner) + create, "catalog-replay-waiter");
  assert.equal((await holder).code, 0);
  assert.equal(replay.code, 0);
  assert.equal(
    sql(`select count(*) from public.audit_logs where entity_id='${id}'`),
    "1",
  );
  console.log(
    "Catalog concurrency PASS: stale edit, revocation while waiting, duplicate create/replay; independent PostgreSQL connections, no deadlocks.",
  );
  return 3;
}
