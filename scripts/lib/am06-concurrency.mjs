import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

export async function runAm06Concurrency({ sql, dbName, prefix }) {
  assert.ok(prefix.startsWith("merivo-s2-check-"));
  assert.equal(dbName, `${prefix}-db`);
  const clients = new Set();
  let serial = 0,
    passed = 0;
  async function until(check, label) {
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`AM06 barrier timed out: ${label}`);
  }
  function connection() {
    const name = `am06-${++serial}`;
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
    const c = { name, child, output: "", error: "", closed: false, code: null };
    clients.add(c);
    child.stdout.on("data", (chunk) => {
      c.output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      c.error += chunk;
    });
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      c.closed = true;
      c.code = code;
      clients.delete(c);
    });
    child.on("error", () => {
      c.closed = true;
      c.code = -1;
      clients.delete(c);
    });
    c.send = (query) => child.stdin.write(`${query}\n`);
    c.finish = async (query = "") => {
      child.stdin.end(query);
      await until(() => c.closed, "independent session completion");
      return c;
    };
    c.send(
      `set application_name='${name}';set statement_timeout='10s';set lock_timeout='8s';`,
    );
    return c;
  }
  const claims = (user) =>
    `set role authenticated;set "request.jwt.claim.sub"='${user}';set "request.jwt.claims"='{"aal":"aal2"}';`;
  const update = (f, expected = 1, key = f.key, status = "suspended") =>
    `select 'RESULT='||(api.update_member('${f.b}','${f.target}','barber','${status}','${key}',${expected})->>'version');`;
  async function blocked(c) {
    await until(() => {
      assert.ok(!c.closed, "Caller exited before reaching lock barrier");
      return (
        sql(
          `select count(*) from pg_stat_activity where application_name='${c.name}' and wait_event_type='Lock'`,
        ) === "1"
      );
    }, "PostgreSQL lock wait");
  }
  function rejected(c, code) {
    assert.ok(
      c.error.includes(`${code}:`),
      `Expected ${code} from independent connection`,
    );
    assert.ok(
      !c.error.includes("40P01:"),
      "A deadlock cannot count as a successful rejection",
    );
  }
  function pass(label) {
    passed++;
    console.log(`C06 concurrency PASS: ${label}`);
  }
  function fixture() {
    const b = randomUUID(),
      owner = randomUUID(),
      admin = randomUUID(),
      barber = randomUUID(),
      target = randomUUID(),
      pending = randomUUID(),
      key = randomUUID();
    const token = randomBytes(32).toString("base64url");
    sql(`insert into auth.users(id,email,email_confirmed_at) values('${owner}','o-${b}@example.test',now()),('${admin}','a-${b}@example.test',now()),('${barber}','b-${b}@example.test',now());
      insert into public.businesses(id,slug,name) values('${b}','ttl-c-${b.slice(0, 20)}','TTL concurrency');
      insert into public.business_settings(business_id) values('${b}');
      insert into public.business_members(business_id,user_id,role) values('${b}','${owner}','owner'),('${b}','${admin}','admin');
      insert into public.business_members(id,business_id,user_id,role) values('${target}','${b}','${barber}','barber');
      insert into public.business_members(id,business_id,invited_email,role,status) values('${pending}','${b}','p-${b}@example.test','barber','invited');
      insert into app.member_invitations(member_id,business_id,token_hash) values('${pending}','${b}',extensions.digest('${token}','sha256'));`);
    const f = { b, owner, admin, barber, target, pending, key };
    sql(claims(admin) + update(f));
    return f;
  }
  const expire = (f, age = "49 hours") =>
    sql(
      `update app.member_requests set created_at=clock_timestamp()-interval '${age}' where business_id='${f.b}' and key='${f.key}'`,
    );
  const expired = (f) =>
    sql(
      `select (created_at<=clock_timestamp()-interval '48 hours')::integer from app.member_requests where business_id='${f.b}' and key='${f.key}'`,
    ) === "1";
  try {
    {
      const f = fixture();
      expire(f, "47 hours 59 minutes 56 seconds");
      const writer = connection();
      writer.send(
        "begin;" + claims(f.admin) + update(f) + "select 'REPLAY_HELD';",
      );
      await until(
        () => writer.output.includes("REPLAY_HELD"),
        "authorized replay row lock",
      );
      await until(
        () => expired(f),
        "wall-clock expiry while replay transaction remains open",
      );
      const purger = connection();
      await purger.finish("select 'DELETED='||app.purge_member_requests(500);");
      assert.equal(purger.code, 0);
      assert.ok(purger.output.includes("DELETED=0"));
      assert.ok(!writer.closed);
      assert.equal(
        sql(
          `select count(*) from app.member_requests where business_id='${f.b}' and key='${f.key}'`,
        ),
        "1",
      );
      await writer.finish("commit;");
      assert.equal(sql("select app.purge_member_requests(500)"), "1");
      assert.equal(
        sql(
          `select count(*) from public.audit_logs where business_id='${f.b}'`,
        ),
        "1",
      );
      assert.equal(
        sql(
          `select count(*) from app.member_invitations where business_id='${f.b}'`,
        ),
        "1",
      );
      pass(
        "purger skips replay held across expiry, then deletes after commit without touching audit/invitation",
      );
    }
    for (const fresh of [false, true]) {
      const f = fixture();
      expire(f);
      const purger = connection();
      purger.send(
        "begin;select 'DELETED='||app.purge_member_requests(500);select 'PURGE_HELD';",
      );
      await until(
        () => purger.output.includes("PURGE_HELD"),
        "uncommitted purge row deletion",
      );
      assert.ok(purger.output.includes("DELETED=1"));
      const writer = connection();
      writer.send(
        claims(f.admin) +
          update(f, fresh ? 2 : 1, f.key, fresh ? "active" : "suspended"),
      );
      await blocked(writer);
      await purger.finish("commit;");
      await writer.finish();
      if (fresh) {
        assert.equal(writer.code, 0);
        assert.ok(writer.output.includes("RESULT=3"));
        assert.equal(
          sql(
            `select count(*) from app.member_requests where business_id='${f.b}' and key='${f.key}' and created_at>clock_timestamp()-interval '1 minute'`,
          ),
          "1",
        );
      } else rejected(writer, "PT412");
      assert.equal(
        sql(
          `select version from public.business_members where id='${f.target}'`,
        ),
        fresh ? "3" : "2",
      );
      assert.equal(
        sql(
          `select count(*) from public.audit_logs where business_id='${f.b}'`,
        ),
        fresh ? "2" : "1",
      );
      pass(
        fresh
          ? "writer waits for purge, then fresh version reuses key once without a uniqueness race"
          : "writer waits for purge; old expected version cannot repeat the effect",
      );
    }
    {
      const f = fixture();
      expire(f, "47 hours 59 minutes 56 seconds");
      const root = connection();
      root.send(
        `begin;select 1 from public.businesses where id='${f.b}' for update;select 'ROOT_HELD';`,
      );
      await until(() => root.output.includes("ROOT_HELD"), "tenant root held");
      const writer = connection();
      writer.send(claims(f.admin) + update(f));
      await blocked(writer);
      await until(() => expired(f), "expiry during root wait");
      await root.finish("commit;");
      await writer.finish();
      rejected(writer, "PT412");
      assert.equal(
        sql(
          `select count(*) from public.audit_logs where business_id='${f.b}'`,
        ),
        "1",
      );
      sql("select app.purge_member_requests(500)");
      pass(
        "expiry is evaluated after lock acquisition, not at old transaction start",
      );
    }
    {
      const f = fixture();
      sql(`insert into app.member_requests(business_id,user_id,operation,key,request_hash,result,created_at)
        select '${f.b}','${f.admin}','concurrent-purge',gen_random_uuid(),extensions.digest(n::text,'sha256'),'{}',clock_timestamp()-interval '50 hours' from generate_series(1,600) n;`);
      const a = connection();
      a.send(
        "begin;select 'DELETED='||app.purge_member_requests(300);select 'A_HELD';",
      );
      await until(
        () => a.output.includes("A_HELD"),
        "first purge locks its batch",
      );
      const b = connection();
      b.send(
        "begin;select 'DELETED='||app.purge_member_requests(300);select 'B_HELD';",
      );
      await until(
        () => b.output.includes("B_HELD"),
        "second purge skips first batch",
      );
      assert.ok(a.output.includes("DELETED=300"));
      assert.ok(b.output.includes("DELETED=300"));
      await Promise.all([a.finish("commit;"), b.finish("commit;")]);
      assert.equal(
        sql(
          `select count(*) from app.member_requests where business_id='${f.b}' and operation='concurrent-purge'`,
        ),
        "0",
      );
      assert.equal(
        sql(
          `select count(*) from app.member_requests where business_id='${f.b}' and operation='update'`,
        ),
        "1",
      );
      pass(
        "two purgers delete disjoint bounded batches and retain recent rows",
      );
    }
    {
      const f = fixture(),
        barrier = BigInt(
          `0x${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        ).toString();
      sql(`insert into app.member_requests(business_id,user_id,operation,key,request_hash,result,created_at)
        values('${f.b}','${f.admin}','am06-failure-probe','${randomUUID()}',extensions.digest('failure','sha256'),'{}',clock_timestamp()-interval '100 hours');
        create function app.am06_test_purge_failure() returns trigger language plpgsql set search_path='' as $$
        begin
          if old.operation='am06-failure-probe' then
            perform pg_advisory_xact_lock(${barrier}::bigint);
            raise exception 'AM06_PURGE_FAILURE';
          end if;
          return old;
        end $$;
        create trigger am06_test_purge_failure before delete on app.member_requests for each row execute function app.am06_test_purge_failure();`);
      let control, purger;
      try {
        control = connection();
        control.send(
          `begin;select pg_advisory_xact_lock(${barrier}::bigint);select 'FAULT_HELD';`,
        );
        await until(
          () => control.output.includes("FAULT_HELD"),
          "test-only failure barrier",
        );
        purger = connection();
        purger.send("select app.purge_member_requests(500);");
        await blocked(purger);
        const writer = connection();
        await writer.finish(
          claims(f.admin) + update(f, 2, randomUUID(), "active"),
        );
        assert.equal(writer.code, 0);
        assert.ok(!purger.closed);
        await control.finish("commit;");
        await purger.finish();
        rejected(purger, "P0001");
        assert.equal(
          sql(
            `select count(*) from app.member_requests where business_id='${f.b}' and operation='am06-failure-probe'`,
          ),
          "1",
        );
        assert.equal(
          sql(
            `select version from public.business_members where id='${f.target}'`,
          ),
          "3",
        );
        assert.equal(
          sql(
            `select count(*) from public.audit_logs where business_id='${f.b}'`,
          ),
          "2",
        );
        assert.equal(
          sql(
            `select count(*) from app.member_invitations where business_id='${f.b}'`,
          ),
          "1",
        );
      } finally {
        if (control && !control.closed) await control.finish("rollback;");
        if (purger && !purger.closed) await purger.finish();
        sql(
          "drop trigger am06_test_purge_failure on app.member_requests;drop function app.am06_test_purge_failure();",
        );
      }
      sql("select app.purge_member_requests(500)");
      pass(
        "blocked failing purger holds no root; independent membership write commits and failure rolls purge back",
      );
    }
    return passed;
  } finally {
    for (const c of clients) c.child.stdin.end("\nrollback;\n");
    await until(() => clients.size === 0, "close isolated connections");
  }
}
