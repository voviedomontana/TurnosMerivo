// Never loads .env or connects to an existing container, volume or database.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { runAm03Concurrency } from "./lib/am03-concurrency.mjs";
import { runAm06Concurrency } from "./lib/am06-concurrency.mjs";
import { runAm06Integration } from "./lib/am06-integration.mjs";
import { runCatalogConcurrency } from "./lib/catalog-concurrency.mjs";
import { runCustomerConcurrency } from "./lib/customer-concurrency.mjs";
import { runScheduleConcurrency } from "./lib/schedule-concurrency.mjs";
import { runAppointmentConcurrency } from "./lib/appointment-concurrency.mjs";
import { runPublicBookingConcurrency } from "./lib/public-booking-concurrency.mjs";
import {
  runAm0405Integration,
  verifyAm04LegacyMigration,
} from "./lib/am0405-integration.mjs";

const historical = {
  "20261102000400_public_booking.sql":
    "35cbffffd009d5df0eb1d131dab2c7710c42d95c3ae47fc545c21ad8498aea16",
  "20261102000300_public_catalog.sql":
    "56833037cddb439e1de543371542215ad90d77a824a9d92da1e82c5c8ed0a4d6",
  "20261102000200_internal_appointments.sql":
    "14f8fd0adf146a55855f7f2dee09eefde47309ba54bc660b6cb97614a14a6aef",
  "20261102000100_create_scheduling.sql":
    "0c869e2919370d42a0d8f44b59db6699acb4139f8f8550344296edb963515de6",
  "20261101001000_create_customer_directory.sql":
    "562c13f80ebb22c3386524795e056a2019ca56f56f96c5c6454c7a04a48d7107",
  "20261101000900_create_professional_service_catalog.sql":
    "93d5562ffbefd936612006abccdf30d950dd1479b12adfa8d75d5584dbeb1dfc",
  "20261101000800_expire_membership_replays.sql":
    "48d6d5a5a523a094bf2f8fc3e457065495a49146f752068151af44e0f1a2cfd0",
  "20261101000600_correlate_membership_requests.sql":
    "28a2832fe8db532b606f82ac80e42c1a497fd3fa2b2455a5a12b9461d0e4b465",
  "20261101000700_paginate_business_members.sql":
    "6bdfef52fe9f4d5643dd0b38d88c3ecfe59169b21d0c151f7493bd1df202a309",
  "20261101000500_reauthorize_membership_operations.sql":
    "0ce9aa32d86c8362252e1950e17832ad0ef17c377d5cb378925212877967ff80",
  "20261031231242_init_tenancy.sql":
    "82cdc1ec871e1f4be005e97ad4f1651c3a2b6626f21b44a5b8ab3fc4ba8e48a2",
  "20261031231400_allow_maintenance_server_role.sql":
    "90ad4dbf1b05b01a8eb2a890ba64fc81fa51609c0fdc03ec0a443711e1da2fe6",
  "20261031232111_restrict_future_function_execute.sql":
    "f0044e46afe66865e5c806296c6f47636d0601797a997c888bd884b78f1276f1",
  "20261101000100_auth_memberships.sql":
    "f8534225fba134cf5a5d88e0bec65f555d10b446b21ab54f6db92701a76f74ec",
  "20261101000200_invitation_lifecycle.sql":
    "147292d9b1a93bf3ce56735ed2f029a4c8b877521e44faa0b85b02e1279119ed",
  "20261101000300_restrict_private_business_reads.sql":
    "8f34c51f4c9a42f912b56cdadaec89d8ad14b585023016fd651d99a91a5b5179",
  "20261101000400_identify_last_owner_error.sql":
    "e7d70a2af03b1effba90a72a7af442adb94b51de0bae761857f36942c06b2133",
};
for (const [name, hash] of Object.entries(historical))
  assert.equal(
    createHash("sha256")
      .update(readFileSync(`supabase/migrations/${name}`))
      .digest("hex"),
    hash,
    `Historical migration changed: ${name}`,
  );

const publicFocus = process.argv.includes("--public-focus");
const prefix = `merivo-s2-check-${randomUUID().slice(0, 8)}`;
const names = {
  db: `${prefix}-db`,
  auth: `${prefix}-auth`,
  rest: `${prefix}-rest`,
};
const containers = [];
let networkCreated = false;
let stage = "initialization";
const password = randomBytes(32).toString("hex");
const jwtSecret = randomBytes(48).toString("base64url");
const images = {
  db: "public.ecr.aws/supabase/postgres:17.11.0.006",
  auth: "public.ecr.aws/supabase/gotrue:v2.197.0",
  rest: "public.ecr.aws/supabase/postgrest:v16.5",
};
function docker(args, input) {
  try {
    return execFileSync("docker", args, {
      input,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 90_000,
    }).trim();
  } catch (error) {
    // Docker/SQL errors can include connection strings. Never print raw stderr.
    const diagnostic = String(error.stderr ?? "").match(
      /ERROR:([^\r\n]*)/,
    )?.[1];
    const safe = diagnostic
      ?.replaceAll(password, "[redacted]")
      .replaceAll(jwtSecret, "[redacted]");
    throw new Error(
      `Isolated test operation failed at ${stage} (${args[0]})${safe ? `: ${safe}` : "."}`,
    );
  }
}
function sql(input, role = "postgres") {
  assert.ok(names.db.startsWith("merivo-s2-check-"));
  return docker(
    [
      "exec",
      "-i",
      names.db,
      "psql",
      "-X",
      "-U",
      role,
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    input,
  );
}
function start(kind, env, port) {
  const name = names[kind];
  const args = [
    "run",
    "-d",
    "--pull=never",
    "--name",
    name,
    "--network",
    prefix,
    "--label",
    `merivo.test.run=${prefix}`,
  ];
  for (const [key, value] of Object.entries(env))
    args.push("-e", `${key}=${value}`);
  if (port) args.push("-p", `127.0.0.1::${port}`);
  args.push(images[kind]);
  docker(args);
  containers.push(name);
  if (!port) return null;
  let binding;
  try {
    binding = docker(["port", name, `${port}/tcp`]);
  } catch {
    const diagnostic = spawnSync("docker", ["logs", name], {
      encoding: "utf8",
      windowsHide: true,
    });
    const lines = `${diagnostic.stdout}\n${diagnostic.stderr}`.split("\n");
    const messages = lines.flatMap((line) => {
      try {
        const log = JSON.parse(line);
        return log.level === "fatal" || log.level === "error"
          ? [String(log.msg)]
          : [];
      } catch {
        return [];
      }
    });
    const safe = messages
      .join("; ")
      .replaceAll(password, "[redacted]")
      .replaceAll(jwtSecret, "[redacted]");
    const state = docker([
      "inspect",
      "--format",
      "{{.State.Status}} {{json .NetworkSettings.Ports}}",
      name,
    ]);
    throw new Error(
      `Isolated ${kind} startup failed (${state})${safe ? `: ${safe}` : "."}`,
    );
  }
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  return `http://${binding}`;
}
async function wait(check) {
  for (let n = 0; n < 60; n++) {
    try {
      if (await check()) return;
    } catch {
      /* Wait only on this run's new services. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Isolated service not ready at ${stage}.`);
}
async function call(
  base,
  path,
  body,
  token,
  method = "POST",
  profile,
  extraHeaders = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(profile ? { "Accept-Profile": profile } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: response.status, data };
}
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  return ((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

try {
  stage = "create isolated network";
  docker(["network", "create", "--label", `merivo.test.run=${prefix}`, prefix]);
  networkCreated = true;
  stage = "start empty PostgreSQL";
  const databaseHttp = start(
    "db",
    { POSTGRES_PASSWORD: password, POSTGRES_DB: "postgres" },
    5432,
  );
  // The image briefly runs a socket-only server while its platform init scripts run.
  // Wait for the final TCP listener to avoid racing those scripts.
  await wait(() => {
    docker(["exec", names.db, "pg_isready", "-h", "127.0.0.1"]);
    return sql("select 1") === "1";
  });
  stage = "bootstrap test platform roles";
  // Prevent bind values or literal capability fixtures from entering PostgreSQL logs.
  // This changes only this invocation's UUID-scoped disposable database.
  sql(
    "alter system set log_statement='none';alter system set log_min_error_statement='panic';alter system set log_parameter_max_length=0;alter system set log_parameter_max_length_on_error=0;select pg_reload_conf();",
    "supabase_admin",
  );
  await wait(
    () =>
      sql(
        "select current_setting('log_statement')||':'||current_setting('log_min_error_statement')||':'||current_setting('log_parameter_max_length_on_error');",
      ) === "none:panic:0",
  );
  sql(
    `
    create schema if not exists extensions;
    create schema if not exists auth;
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      if not exists(select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
      if not exists(select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin login createrole; end if;
    end $$;
    alter role authenticator password '${password}';
    alter role supabase_auth_admin password '${password}';
    grant anon,authenticated,service_role to authenticator;
    grant usage on schema public,extensions to anon,authenticated,service_role;
    alter schema auth owner to supabase_auth_admin;
    grant all on schema auth to supabase_auth_admin;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select nullif(current_setting('request.jwt.claims',true),'')::jsonb
    $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
    alter function auth.uid() owner to supabase_auth_admin;
    alter function auth.jwt() owner to supabase_auth_admin;
  `,
    "supabase_admin",
  );
  stage = "start isolated Auth";
  const auth = start(
    "auth",
    {
      GOTRUE_API_HOST: "0.0.0.0",
      GOTRUE_API_PORT: "9999",
      API_EXTERNAL_URL: "http://127.0.0.1:9999",
      GOTRUE_DB_DRIVER: "postgres",
      GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${password}@${names.db}:5432/postgres`,
      GOTRUE_SITE_URL: "http://127.0.0.1:3000",
      GOTRUE_JWT_SECRET: jwtSecret,
      GOTRUE_JWT_AUD: "authenticated",
      GOTRUE_JWT_ADMIN_ROLES: "service_role",
      GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
      GOTRUE_JWT_EXP: "3600",
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
      GOTRUE_MAILER_AUTOCONFIRM: "true",
      GOTRUE_MFA_TOTP_ENROLL_ENABLED: "true",
      GOTRUE_MFA_TOTP_VERIFY_ENABLED: "true",
    },
    9999,
  );
  await wait(async () => (await fetch(`${auth}/health`)).ok);
  stage = "apply repository migrations to empty test database";
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const migration = readFileSync(`supabase/migrations/${file}`, "utf8");
    if (file === "20261101000600_correlate_membership_requests.sql")
      verifyAm04LegacyMigration(sql, migration);
    sql(migration);
  }
  stage = "pgTAP regression";
  let total = 0;
  for (const file of readdirSync("supabase/tests")
    .filter((f) => f.endsWith(".test.sql"))
    .sort()) {
    stage = `pgTAP ${file}`;
    const output = sql(readFileSync(`supabase/tests/${file}`, "utf8"));
    const failures = output
      .split("\n")
      .filter((line) => /^not ok|^# (Failed|Looks like)/.test(line));
    if (failures.length)
      throw new Error(`pgTAP failed: ${file}; ${failures.join("; ")}`);
    const count = output.match(/^ok \d+/gm)?.length ?? 0;
    assert.ok(count > 0, `No assertions executed: ${file}`);
    total += count;
    console.log(`${file}: ${count} assertions passed (rolled back).`);
  }
  stage = "public booking independent connections";
  const publicBookingCases = await runPublicBookingConcurrency({
    sql,
    dbName: names.db,
    prefix,
  });
  stage = "A-M03 independent PostgreSQL connections";
  const concurrentCases = publicFocus
    ? 0
    : await runAm03Concurrency({
        sql,
        dbName: names.db,
        prefix,
      });
  stage = "A-M06 independent replay/purge connections";
  const ttlCases = publicFocus
    ? 0
    : await runAm06Concurrency({ sql, dbName: names.db, prefix });
  stage = "catalog independent connections";
  const catalogCases = publicFocus
    ? 0
    : await runCatalogConcurrency({
        sql,
        dbName: names.db,
        prefix,
      });
  stage = "customer independent connections";
  const customerCases = publicFocus
    ? 0
    : await runCustomerConcurrency({
        sql,
        dbName: names.db,
        prefix,
      });
  stage = "appointment independent connections";
  const appointmentCases = publicFocus
    ? 0
    : await runAppointmentConcurrency({
        sql,
        dbName: names.db,
        prefix,
      });
  stage = "schedule independent connections";
  const scheduleCases = publicFocus
    ? 0
    : await runScheduleConcurrency({
        sql,
        dbName: names.db,
        prefix,
      });
  stage = "start isolated PostgREST";
  const rest = start(
    "rest",
    {
      PGRST_DB_URI: `postgres://authenticator:${password}@${names.db}:5432/postgres`,
      PGRST_DB_SCHEMAS: "api,public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: jwtSecret,
      PGRST_DB_EXTRA_SEARCH_PATH: "public,extensions",
    },
    3000,
  );
  await wait(async () => (await fetch(rest)).status === 200);
  stage = "real password login and MFA fixtures";
  const users = [];
  for (const name of ["owner", "admin", "barber", "invitee"]) {
    const email = `${name}-${prefix}@example.test`;
    const signup = await call(auth, "/signup", { email, password });
    assert.equal(signup.status, 200, "Synthetic signup failed");
    const login = await call(auth, "/token?grant_type=password", {
      email,
      password,
    });
    assert.equal(login.status, 200, "Password login failed");
    assert.match(login.data.user.id, /^[0-9a-f-]{36}$/);
    users.push({
      id: login.data.user.id,
      email,
      token: login.data.access_token,
      session: {
        access_token: login.data.access_token,
        refresh_token: login.data.refresh_token,
      },
    });
  }
  assert.equal(
    (
      await call(auth, "/token?grant_type=password", {
        email: users[0].email,
        password: "incorrect-fixture-password",
      })
    ).status,
    400,
  );
  const business = randomUUID(),
    other = randomUUID(),
    member = randomUUID();
  sql(`insert into public.businesses(id,slug,name,tax_id) values('${business}','http-alpha','HTTP Alpha','PRIVATE-HTTP-TAX'),('${other}','http-bravo','HTTP Bravo','PRIVATE-OTHER-TAX');
    insert into public.business_settings(business_id) values('${business}'),('${other}');
    insert into public.business_members(business_id,user_id,role) values('${business}','${users[0].id}','owner'),('${business}','${users[1].id}','admin');
    insert into public.business_members(id,business_id,user_id,role) values('${member}','${business}','${users[2].id}','barber');`);
  const rpc = (name, body, user) =>
    call(rest, `/rpc/${name}`, body, user.token);
  const privateRead = (user, id = business) =>
    rpc("read_business_private", { p_business_id: id }, user);
  assert.equal((await rpc("me", {}, users[0])).status, 200);
  assert.equal((await privateRead(users[0])).status, 403);
  assert.equal((await privateRead(users[2])).status, 403);
  for (const user of users.slice(0, 2)) {
    const factor = await call(
      auth,
      "/factors",
      { factor_type: "totp", friendly_name: "Isolated test" },
      user.token,
    );
    assert.equal(factor.status, 200, "TOTP enrollment failed");
    const challenge = await call(
      auth,
      `/factors/${factor.data.id}/challenge`,
      {},
      user.token,
    );
    assert.equal(challenge.status, 200, "TOTP challenge failed");
    const verified = await call(
      auth,
      `/factors/${factor.data.id}/verify`,
      { challenge_id: challenge.data.id, code: totp(factor.data.totp.secret) },
      user.token,
    );
    assert.equal(verified.status, 200, "TOTP verification failed");
    user.token = verified.data.access_token;
    user.session = {
      access_token: verified.data.access_token,
      refresh_token: verified.data.refresh_token,
    };
    const privateResult = await privateRead(user);
    assert.equal(privateResult.status, 200);
    assert.equal(privateResult.data.business.tax_id, "PRIVATE-HTTP-TAX");
    assert.equal((await privateRead(user, other)).status, 404);
  }
  stage = "real authenticated RPC compatibility";
  for (const user of users.slice(0, 3)) {
    const selector = await rpc("me", {}, user);
    assert.equal(selector.status, 200);
    assert.equal(selector.data.memberships.length, 1);
    assert.ok(!JSON.stringify(selector.data).includes("PRIVATE-"));
    for (const table of ["businesses", "business_settings"]) {
      const direct = await call(
        rest,
        `/${table}?select=*`,
        undefined,
        user.token,
        "GET",
        "public",
      );
      assert.equal(direct.status, 403);
    }
  }
  assert.equal((await privateRead(users[3])).status, 404);
  assert.equal(
    (
      await call(rest, "/rpc/read_business_private", {
        p_business_id: business,
      })
    ).status,
    401,
  );
  assert.equal(
    (await rpc("list_members", { p_business_id: business }, users[1])).data
      .length,
    3,
  );
  const inviteToken = randomBytes(32).toString("base64url");
  const invitation = await rpc(
    "invite_member",
    {
      p_business_id: business,
      p_email: users[3].email,
      p_role: "barber",
      p_token: inviteToken,
      p_key: randomUUID(),
    },
    users[0],
  );
  assert.equal(invitation.status, 200);
  const recipient = await rpc(
    "prepare_member_auth_invite",
    {
      p_business_id: business,
      p_member_id: invitation.data.id,
    },
    users[1],
  );
  assert.equal(
    recipient.status,
    200,
    "Admin can authorize the current barber invitation",
  );
  assert.equal(recipient.data.email, users[3].email);
  assert.equal(
    (
      await rpc(
        "prepare_member_auth_invite",
        {
          p_business_id: business,
          p_member_id: invitation.data.id,
        },
        users[2],
      )
    ).status,
    403,
    "Barber cannot invoke the send guard directly",
  );
  const missingVersion = {
    p_business_id: business,
    p_member_id: member,
    p_role: "barber",
    p_status: "suspended",
    p_key: randomUUID(),
    p_expected: null,
  };
  assert.equal(
    (await rpc("update_member", missingVersion, users[1])).status,
    428,
  );
  assert.equal(
    (await rpc("update_member", missingVersion, users[2])).status,
    403,
  );
  assert.equal(
    (await rpc("update_member", missingVersion, users[3])).status,
    404,
  );
  assert.equal(
    (
      await rpc(
        "update_member",
        { ...missingVersion, p_expected: 99 },
        users[1],
      )
    ).status,
    412,
  );
  const accepted = await rpc(
    "accept_invitation",
    { p_token: inviteToken, p_key: randomUUID() },
    users[3],
  );
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.status, "active");
  const denied = await rpc(
    "update_member",
    {
      p_business_id: business,
      p_member_id: member,
      p_role: "owner",
      p_status: "active",
      p_key: randomUUID(),
      p_expected: 1,
    },
    users[1],
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.data.message, "FORBIDDEN");
  stage = "LAST_OWNER through real PostgREST and failed-write rollback";
  // Test-only probes: created after the production surface inventory assertions.
  // They never exist in repository migrations or in the owner's database.
  sql(`
    create function api.fixture_delete_owner(p_business_id uuid) returns void
    language sql security definer set search_path='' as $$
      delete from public.business_members where business_id=p_business_id and role='owner'
    $$;
    create function api.fixture_invalid_setting(p_business_id uuid) returns void
    language sql security definer set search_path='' as $$
      update public.business_settings set slot_interval_minutes=7 where business_id=p_business_id
    $$;
    revoke all on function api.fixture_delete_owner(uuid),api.fixture_invalid_setting(uuid) from public;
    grant execute on function api.fixture_delete_owner(uuid),api.fixture_invalid_setting(uuid) to authenticated;
    notify pgrst, 'reload schema';
  `);
  let lastOwner;
  await wait(async () => {
    lastOwner = await rpc(
      "fixture_delete_owner",
      { p_business_id: business },
      users[0],
    );
    return lastOwner.status !== 404 && lastOwner.status !== 503;
  });
  assert.equal(lastOwner.status, 409, "Real LAST_OWNER must return HTTP 409");
  assert.equal(lastOwner.data.code, "PT409");
  assert.equal(lastOwner.data.message, "LAST_OWNER");
  const invalid = await rpc(
    "fixture_invalid_setting",
    { p_business_id: business },
    users[0],
  );
  assert.equal(
    invalid.data.code,
    "23514",
    "Unrelated real CHECK must retain its SQLSTATE",
  );
  assert.equal(
    sql(
      `select role||':'||status||':'||version::text from public.business_members where business_id='${business}' and user_id='${users[0].id}'`,
    ),
    "owner:active:1",
  );
  assert.equal(
    sql(
      `select slot_interval_minutes::text||':'||version::text from public.business_settings where business_id='${business}'`,
    ),
    "15:1",
  );
  stage = "A-M04/A-M05 HTTP integration and optional isolated browser";
  // Only the disposable technical role: never read or change owner credentials.
  if (process.argv.includes("--ui"))
    sql(`alter role app_server login password '${password}';`);
  await runAm0405Integration({
    publicFocus,
    publicDatabaseUrl: `postgres://app_server:${password}@${new URL(databaseHttp).host}/postgres`,
    sql,
    rest,
    auth,
    users,
    business,
    member,
    call,
    ui: process.argv.includes("--ui"),
  });
  stage = "A-M06 HTTP retention integration";
  await runAm06Integration({ sql, rest, users, call });
  console.log(
    `PASS: ${total} pgTAP assertions; ${concurrentCases + ttlCases + catalogCases + customerCases + scheduleCases + appointmentCases + publicBookingCases} independent-connection scenarios (${ttlCases} A-M06, ${catalogCases} catalog, ${customerCases} customers, ${scheduleCases} scheduling, ${appointmentCases} appointments, ${publicBookingCases} public booking); real password login, TOTP aal2, selector, private/table reads, tenant isolation, roles, invitation acceptance, LAST_OWNER HTTP 409 and failed-write rollback.`,
  );
} catch (error) {
  // Assertion messages are constant descriptions; never serialize actual sessions.
  console.error(
    `FAIL at ${stage}: ${error instanceof assert.AssertionError ? error.message.split("\n")[0] : error.message}`,
  );
  process.exitCode = 1;
} finally {
  for (const name of containers.reverse()) {
    // Only UUID-prefixed resources created in this invocation are eligible.
    assert.ok(name.startsWith(`${prefix}-`));
    docker(["rm", "-f", "-v", name]);
  }
  if (networkCreated) docker(["network", "rm", prefix]);
  console.log(
    "Removed this run's disposable containers, volumes and network; owner environment untouched.",
  );
}
