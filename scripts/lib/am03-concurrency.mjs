import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

// Only called with the brand-new database created by the isolated security harness.
export async function runAm03Concurrency({ sql, dbName, prefix }) {
  assert.ok(prefix.startsWith("merivo-s2-check-"));
  assert.equal(dbName, `${prefix}-db`);
  const clients = new Set();
  let serial = 0;
  async function until(test, description) {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (test()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Concurrent barrier timed out: ${description}`);
  }
  function connection() {
    const name = `am03-${++serial}`;
    const process = spawn(
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
    const client = {
      name,
      process,
      output: "",
      error: "",
      closed: false,
      code: null,
    };
    clients.add(client);
    process.stdout.on("data", (chunk) => {
      client.output += chunk.toString();
    });
    process.stderr.on("data", (chunk) => {
      client.error += chunk.toString();
    });
    process.stdin.on("error", () => {
      /* A rejected ON_ERROR_STOP caller can close before finish. */
    });
    process.on("close", (code) => {
      client.closed = true;
      client.code = code;
      clients.delete(client);
    });
    process.on("error", () => {
      client.closed = true;
      client.code = -1;
    });
    client.send = (query) => {
      process.stdin.write(`${query}\n`);
    };
    client.finish = async (query = "") => {
      process.stdin.end(query);
      await until(() => client.closed, "independent connection completion");
      return client;
    };
    client.send(
      `set application_name='${name}'; set statement_timeout='6s'; set lock_timeout='5s';`,
    );
    return client;
  }
  function claims(user) {
    return `set role authenticated; set "request.jwt.claim.sub"='${user}'; set "request.jwt.claims"='{"aal":"aal2"}';`;
  }
  async function holder(business) {
    const c = connection();
    c.send(
      `begin; select 1 from public.businesses where id='${business}' for update; select 'ROOT_READY';`,
    );
    await until(() => c.output.includes("ROOT_READY"), "root lock acquired");
    return c;
  }
  async function blocked(c) {
    await until(() => {
      assert.ok(!c.closed, "Caller must still be waiting at the lock barrier");
      return (
        sql(
          `select count(*) from pg_stat_activity where application_name='${c.name}' and wait_event_type='Lock'`,
        ) === "1"
      );
    }, "caller waiting on an independently held lock");
  }
  function state(c, expected) {
    assert.ok(
      c.error.includes(`${expected}:`),
      `Expected SQLSTATE ${expected} from independent caller`,
    );
    assert.ok(
      !c.error.includes("40P01:"),
      "No deadlock may be accepted as an authorization result",
    );
  }
  let passed = 0;
  function pass(name) {
    passed++;
    console.log(`Concurrency PASS: ${name}`);
  }
  function fixture() {
    const b = randomUUID(),
      owner = randomUUID(),
      admin = randomUUID(),
      barber = randomUUID(),
      outsider = randomUUID(),
      invitee = randomUUID();
    const ownerMember = randomUUID(),
      adminMember = randomUUID(),
      target = randomUUID(),
      pending = randomUUID();
    const token = randomBytes(32).toString("base64url");
    sql(`insert into auth.users(id,email,email_confirmed_at) values
      ('${owner}','o-${b}@example.test',now()),('${admin}','a-${b}@example.test',now()),
      ('${barber}','b-${b}@example.test',now()),('${outsider}','x-${b}@example.test',now()),('${invitee}','i-${b}@example.test',now());
      insert into public.businesses(id,slug,name) values('${b}','c-${b.slice(0, 20)}','Concurrent fixture');
      insert into public.business_settings(business_id) values('${b}');
      insert into public.business_members(id,business_id,user_id,role) values
        ('${ownerMember}','${b}','${owner}','owner'),('${adminMember}','${b}','${admin}','admin'),('${target}','${b}','${barber}','barber');
      insert into public.business_members(id,business_id,invited_email,role,status) values('${pending}','${b}','i-${b}@example.test','barber','invited');
      insert into app.member_invitations(member_id,business_id,token_hash) values('${pending}','${b}',extensions.digest('${token}','sha256'));`);
    return {
      b,
      owner,
      admin,
      barber,
      outsider,
      invitee,
      ownerMember,
      adminMember,
      target,
      pending,
      token,
    };
  }
  function update(f, version = 1, key = randomUUID()) {
    return `select api.update_member('${f.b}','${f.target}','barber','suspended','${key}',${version})->>'version';`;
  }
  function prepare(f) {
    return `select api.prepare_member_auth_invite('${f.b}','${f.pending}')->>'version';`;
  }
  function accept(f) {
    return `select api.accept_invitation('${f.token}','${randomUUID()}')->>'version';`;
  }
  try {
    const f = fixture();
    const h = await holder(f.b);
    for (const [actor, query, expected] of [
      [f.outsider, update(f), "PT404"],
      [f.barber, update(f), "PT403"],
      [
        f.admin,
        `select api.update_member('${f.b}','${f.ownerMember}','barber','active','${randomUUID()}',null);`,
        "PT403",
      ],
    ]) {
      const c = connection();
      await c.finish(claims(actor) + query);
      state(c, expected);
      assert.ok(
        !h.closed,
        "Preauthorization must reject while root remains held",
      );
    }
    await h.finish("commit;");
    pass("unauthorized calls reject before waiting for a held root");

    for (const [name, query] of [
      ["update", (x) => update(x)],
      [
        "invite",
        (x) =>
          `select api.invite_member('${x.b}','new-${x.b}@example.test','barber',repeat('q',43),'${randomUUID()}');`,
      ],
      [
        "lifecycle",
        (x) =>
          `select api.manage_invitation('${x.b}','${x.pending}',null,'${randomUUID()}',1);`,
      ],
      ["send guard", prepare],
    ]) {
      const x = fixture(),
        lock = await holder(x.b),
        caller = connection();
      caller.send(claims(x.admin) + query(x));
      await blocked(caller);
      await lock.finish(
        `update public.business_members set status='suspended' where id='${x.adminMember}'; commit;`,
      );
      await caller.finish();
      state(caller, "PT404");
      assert.equal(
        sql(
          `select count(*) from public.audit_logs where business_id='${x.b}'`,
        ),
        "0",
      );
      assert.equal(
        sql(
          `select count(*) from app.member_requests where business_id='${x.b}'`,
        ),
        "0",
      );
      assert.equal(
        sql(
          `select version from public.business_members where id='${x.target}'`,
        ),
        "1",
      );
      pass(`${name}: actor revoked after preflight, rejected after root lock`);
    }
    for (const [name, query, target] of [
      ["update ceiling", update, "target"],
      ["send ceiling", prepare, "pending"],
    ]) {
      const x = fixture(),
        lock = await holder(x.b),
        caller = connection();
      caller.send(claims(x.admin) + query(x));
      await blocked(caller);
      await lock.finish(
        `update public.business_members set role='admin' where id='${x[target]}'; commit;`,
      );
      await caller.finish();
      state(caller, "PT403");
      assert.equal(
        sql(
          `select count(*) from public.audit_logs where business_id='${x.b}'`,
        ),
        "0",
      );
      pass(`${name}: target promotion during wait invalidates admin authority`);
    }
    for (const kind of [
      "rotated token",
      "revoked invitation",
      "expired while waiting",
      "business suspended",
      "identity email changed",
    ]) {
      const x = fixture();
      if (kind === "expired while waiting")
        sql(
          `update app.member_invitations set expires_at=clock_timestamp()+interval '2 seconds' where member_id='${x.pending}'`,
        );
      const lock = await holder(x.b),
        caller = connection();
      caller.send(claims(x.invitee) + accept(x));
      await blocked(caller);
      const change =
        kind === "rotated token"
          ? `update app.member_invitations set token_hash=extensions.digest(repeat('z',43),'sha256') where member_id='${x.pending}';`
          : kind === "revoked invitation"
            ? `update public.business_members set status='suspended' where id='${x.pending}'; update app.member_invitations set expires_at=clock_timestamp() where member_id='${x.pending}';`
            : kind === "expired while waiting"
              ? "select pg_sleep(2.1);"
              : kind === "business suspended"
                ? `update public.businesses set status='suspended' where id='${x.b}';`
                : `update auth.users set email='changed-${x.b}@example.test' where id='${x.invitee}';`;
      await lock.finish(`${change} commit;`);
      await caller.finish();
      state(caller, "PT404");
      assert.equal(
        sql(
          `select count(*) from public.business_members where id='${x.pending}' and user_id is not null`,
        ),
        "0",
      );
      assert.equal(
        sql(
          `select count(*) from public.audit_logs where business_id='${x.b}'`,
        ),
        "0",
      );
      pass(`acceptance: ${kind} after preflight cannot activate membership`);
    }
    {
      const x = fixture();
      const authorized = connection();
      await authorized.finish(claims(x.admin) + prepare(x));
      assert.equal(authorized.code, 0);
      // Simulated delayed provider: its SQL authorization is already committed.
      // A separate writer can acquire the root while the email is still pending.
      const lock = await holder(x.b);
      await lock.finish(
        `update public.business_members set status='suspended' where id='${x.pending}'; update app.member_invitations set expires_at=clock_timestamp() where member_id='${x.pending}'; commit;`,
      );
      const delivered = connection();
      await delivered.finish(claims(x.invitee) + accept(x));
      state(delivered, "PT404");
      pass(
        "delayed authorized email retains no SQL lock and cannot revive a revoked invitation",
      );
    }
    {
      const x = fixture(),
        secondOwner = randomUUID();
      sql(
        `update public.business_members set role='owner' where id='${x.adminMember}'`,
      );
      const lock = await holder(x.b),
        a = connection(),
        b = connection();
      a.send(
        claims(x.owner) +
          `select api.update_member('${x.b}','${x.adminMember}','barber','active','${randomUUID()}',2);`,
      );
      b.send(
        claims(x.admin) +
          `select api.update_member('${x.b}','${x.ownerMember}','barber','active','${secondOwner}',1);`,
      );
      await blocked(a);
      await blocked(b);
      await lock.finish("commit;");
      await Promise.all([a.finish(), b.finish()]);
      assert.equal([a, b].filter((c) => c.code === 0).length, 1);
      state(
        [a, b].find((c) => c.code !== 0),
        "PT403",
      );
      assert.equal(
        sql(
          `select count(*) from public.business_members where business_id='${x.b}' and role='owner' and status='active'`,
        ),
        "1",
      );
      assert.equal(
        sql(
          `select count(*) from public.audit_logs where business_id='${x.b}'`,
        ),
        "1",
      );
      pass("opposing owner demotions serialize and retain one active owner");
    }
    {
      const x = fixture(),
        key = randomUUID(),
        traceA = randomUUID(),
        traceB = randomUUID(),
        lock = await holder(x.b),
        a = connection(),
        b = connection();
      a.send(
        claims(x.admin) +
          `set "request.headers"='{"x-request-id":"${traceA}"}';` +
          update(x, 1, key),
      );
      b.send(
        claims(x.admin) +
          `set "request.headers"='{"x-request-id":"${traceB}"}';` +
          update(x, 1, key),
      );
      await blocked(a);
      await blocked(b);
      await lock.finish("commit;");
      await Promise.all([a.finish(), b.finish()]);
      assert.equal(a.code, 0);
      assert.equal(b.code, 0);
      assert.equal(
        sql(
          `select version from public.business_members where id='${x.target}'`,
        ),
        "2",
      );
      assert.equal(
        sql(
          `select count(*) from public.audit_logs where business_id='${x.b}'`,
        ),
        "1",
      );
      assert.equal(
        sql(
          `select count(*) from app.member_requests where business_id='${x.b}'`,
        ),
        "1",
      );
      pass(
        "concurrent identical keys produce one mutation, version increment, audit and replay row",
      );
      assert.equal(
        sql(`select count(*) from public.audit_logs a join app.member_requests r on r.business_id=a.business_id
        and r.origin_request_id=a.request_id where a.business_id='${x.b}' and a.request_id in ('${traceA}','${traceB}')`),
        "1",
      );
    }
    {
      const x = fixture(),
        target2 = randomUUID(),
        traceA = randomUUID(),
        traceB = randomUUID();
      sql(
        `insert into public.business_members(id,business_id,user_id,role) values('${target2}','${x.b}','${x.outsider}','barber')`,
      );
      const lock = await holder(x.b),
        a = connection(),
        b = connection();
      a.send(
        claims(x.admin) +
          `set "request.headers"='{"x-request-id":"${traceA}"}';` +
          update(x),
      );
      b.send(
        claims(x.admin) +
          `set "request.headers"='{"x-request-id":"${traceB}"}';` +
          update({ ...x, target: target2 }),
      );
      await blocked(a);
      await blocked(b);
      await lock.finish("commit;");
      await Promise.all([a.finish(), b.finish()]);
      assert.equal(a.code, 0);
      assert.equal(b.code, 0);
      assert.equal(
        sql(`select count(*) from public.audit_logs a join app.member_requests r on r.business_id=a.business_id and r.origin_request_id=a.request_id
        where a.business_id='${x.b}' and ((a.entity_id='${x.target}' and a.request_id='${traceA}') or (a.entity_id='${target2}' and a.request_id='${traceB}'))`),
        "2",
      );
      pass(
        "distinct concurrent attempts retain their own trace in audit and replay origin",
      );
    }
    {
      const x = fixture(),
        caller = connection();
      await caller.finish(
        "begin isolation level repeatable read;" + claims(x.admin) + update(x),
      );
      state(caller, "PT400");
      assert.equal(
        sql(
          `select version from public.business_members where id='${x.target}'`,
        ),
        "1",
      );
      pass(
        "transaction-wide stale snapshot isolation is rejected before mutation",
      );
    }
    return passed;
  } finally {
    // Closing stdin rolls back any unfinished holder; all data lives in disposable DB.
    for (const c of clients) c.process.stdin.end("\nrollback;\n");
    await until(() => clients.size === 0, "release independent test sessions");
  }
}
