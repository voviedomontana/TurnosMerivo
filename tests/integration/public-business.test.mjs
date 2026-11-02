import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = fileURLToPath(
  new URL("../../node_modules/next/dist/bin/next", import.meta.url),
);
const ids = Array.from({ length: 4 }, () => randomUUID());
const slugs = ids.map((id) => `test-${id.slice(0, 18)}`);
const servers = [];
let baseUrl;
let offlineUrl;
let seeded = false;

function localSql(sql) {
  try {
    return execFileSync(
      "docker",
      [
        "exec",
        "-i",
        "supabase_db_turnosmerivo",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
      ],
      {
        cwd: root,
        input: sql,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  } catch {
    throw new Error(
      "Local integration fixture command failed. Verify Docker and migrations.",
    );
  }
}

async function startServer(configured) {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const env = { ...process.env };
  if (!configured) env.DATABASE_URL_APP_SERVER = "";
  const child = spawn(
    process.execPath,
    [cli, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: root,
      env,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  servers.push(child);
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null)
      throw new Error("Integration HTTP server exited before becoming ready");
    try {
      if ((await fetch(url)).ok) return url;
    } catch {
      /* Wait for this server to listen. */
    }
    await delay(100);
  }
  throw new Error("Integration HTTP server readiness timed out");
}

before(
  async () => {
    if (!process.env.DATABASE_URL_APP_SERVER)
      throw new Error(
        "Run npm run db:provision-local before integration tests",
      );
    const url = new URL(process.env.DATABASE_URL_APP_SERVER);
    assert.equal(url.username, "app_server");
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
    assert.equal(url.port, "54322");
    assert.equal(url.pathname, "/postgres");
    localSql(`begin;
    insert into public.businesses(id,slug,name,tax_id) values
    ${ids.map((id, i) => `('${id}','${slugs[i]}','Integration fixture','private-value')`).join(",")};
    insert into public.business_settings(business_id) values ${ids.map((id) => `('${id}')`).join(",")};
    update public.businesses set status='suspended' where id='${ids[1]}';
    update public.business_settings set public_booking_enabled=false where business_id='${ids[2]}';
    update public.businesses set deleted_at=now() where id='${ids[3]}';
    commit;`);
    seeded = true;
    baseUrl = await startServer(true);
    offlineUrl = await startServer(false);
  },
  { timeout: 45_000 },
);

after(async () => {
  for (const child of servers) {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([once(child, "exit"), delay(3000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
  if (seeded)
    localSql(`begin;
    delete from public.business_settings where business_id in (${ids.map((id) => `'${id}'`).join(",")});
    delete from public.businesses where id in (${ids.map((id) => `'${id}'`).join(",")});
    commit;`);
});

test("public HTTP read uses the restricted real database connection and safe projection", async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/public/${slugs[0]}?business_id=${ids[1]}`,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, ids[0]);
  assert.equal(body.slug, slugs[0]);
  assert.equal(body.tax_id, undefined);
  assert.equal(body.tenant, undefined);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("unknown, invalid, suspended, disabled and deleted businesses have uniform 404 responses", async () => {
  const results = [];
  for (const slug of [
    "missing-integration-test",
    "admin",
    ...slugs.slice(1),
    "invalid%27slug",
  ]) {
    const response = await fetch(`${baseUrl}/api/v1/public/${slug}`);
    assert.equal(response.status, 404);
    const { request_id: requestId, ...problem } = await response.json();
    assert.ok(requestId);
    results.push(problem);
  }
  for (const result of results) assert.deepEqual(result, results[0]);
});

test("landing stays operational without a configured database", async () => {
  const response = await fetch(offlineUrl);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /TurnosMerivo/);
  const api = await fetch(`${offlineUrl}/api/v1/public/${slugs[0]}`);
  assert.equal(api.status, 503);
  const body = await api.text();
  assert.match(body, /UNAVAILABLE/);
  assert.ok(!body.includes(process.env.DATABASE_URL_APP_SERVER));
});
