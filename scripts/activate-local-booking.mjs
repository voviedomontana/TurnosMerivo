import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Authorized local activation only. Never loads env files, resets or changes Auth.
const root = fileURLToPath(new URL("../", import.meta.url));
const container = "supabase_db_turnosmerivo";
const pending = {
  "20261101001000_create_customer_directory.sql":
    "562c13f80ebb22c3386524795e056a2019ca56f56f96c5c6454c7a04a48d7107",
  "20261102000100_create_scheduling.sql":
    "0c869e2919370d42a0d8f44b59db6699acb4139f8f8550344296edb963515de6",
  "20261102000200_internal_appointments.sql":
    "14f8fd0adf146a55855f7f2dee09eefde47309ba54bc660b6cb97614a14a6aef",
};
const historySource = readFileSync(
  path.join(root, "scripts/test-s2-security-isolated.mjs"),
  "utf8",
);
const expected = {
  ...Object.fromEntries(
    [
      ...historySource.matchAll(/"([0-9]+_[^"]+\.sql)":\s*"([a-f0-9]{64})"/g),
    ].map((m) => [m[1], m[2]]),
  ),
  ...pending,
};
const files = readdirSync(path.join(root, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const versions = files.map((f) => f.split("_")[0]);
const directory = path.join(
  root,
  "supabase/backups",
  `booking-activation-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`,
);
let stage = "preflight",
  manifest;
function run(binary, args, input) {
  // Never forward raw subprocess output/errors: dumps and configuration are private.
  return execFileSync(binary, args, {
    cwd: root,
    input,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}
const docker = (args, input) => run("docker", args, input);
const sql = (query) =>
  docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    query,
  );
const history = () =>
  sql(
    "select version from supabase_migrations.schema_migrations order by version;",
  ).split(/\r?\n/);
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
function fingerprint() {
  return JSON.parse(
    sql(`create temporary table activation_fingerprints(name text,rows bigint,digest text);
    begin isolation level repeatable read read only;
    do $$declare t record;begin
      for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public','app','app_internal') and c.relkind in ('r','p') order by n.nspname,c.relname loop
        execute format('insert into pg_temp.activation_fingerprints select %L,count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text), %L order by md5(to_jsonb(t)::text)), %L)) from %I.%I t',t.nspname||'.'||t.relname,'','',t.nspname,t.relname);
      end loop;
    end;$$;
    select jsonb_object_agg(name,jsonb_build_object('rows',rows,'digest',digest)) from activation_fingerprints;
    rollback;`),
  );
}
function save() {
  writeFileSync(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { mode: 0o600 },
  );
}
try {
  assert.deepEqual(process.argv.slice(2), ["--apply-local"]);
  stage = "preflight project configuration";
  assert.match(
    readFileSync(path.join(root, "supabase/config.toml"), "utf8"),
    /^project_id\s*=\s*"turnosmerivo"\s*$/m,
  );
  assert.match(
    readFileSync(path.join(root, "supabase/config.toml"), "utf8"),
    /^port\s*=\s*54322\s*$/m,
  );
  stage = "preflight source hashes";
  assert.equal(files.length, 15);
  assert.equal(Object.keys(expected).length, 15);
  const hashes = Object.fromEntries(
    files.map((f) => [f, hash(path.join(root, "supabase/migrations", f))]),
  );
  assert.deepEqual(
    hashes,
    Object.fromEntries(files.map((f) => [f, expected[f]])),
  );
  stage = "preflight backup ignore rules";
  run("git", [
    "check-ignore",
    "--quiet",
    "supabase/backups/activation-check.dump",
  ]);
  assert.equal(run("git", ["ls-files", "--", "supabase/backups"]), "");
  stage = "preflight container identity";
  const info = JSON.parse(docker(["inspect", container]))[0];
  assert.equal(info.Name, "/" + container);
  assert.equal(info.State.Running, true);
  assert.ok(
    info.NetworkSettings.Ports["5432/tcp"].some((p) => p.HostPort === "54322"),
  );
  stage = "preflight database identity";
  assert.equal(
    sql(
      "select current_database()||':'||current_setting('server_version_num')::integer/10000;",
    ),
    "postgres:17",
  );
  stage = "preflight migration history";
  assert.deepEqual(history(), versions.slice(0, 12));
  stage = "preflight fingerprints";
  const before = fingerprint();
  assert.ok(before["auth.mfa_factors"] && before["public.business_members"]);
  mkdirSync(directory, { recursive: true });
  manifest = {
    started_at: new Date().toISOString(),
    target: {
      container,
      database: "postgres",
      project: "turnosmerivo",
      port: 54322,
    },
    source_hashes: hashes,
    before_history: versions.slice(0, 12),
    before,
    stage,
    status: "in_progress",
  };
  save();
  stage = "backup";
  const remote = `/tmp/merivo-booking-${randomUUID()}.dump`,
    destination = path.join(directory, "before-booking.dump");
  docker([
    "exec",
    container,
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "--format=custom",
    "--file",
    remote,
  ]);
  docker(["cp", `${container}:${remote}`, destination]);
  const bytes = readFileSync(destination);
  assert.equal(bytes.subarray(0, 5).toString(), "PGDMP");
  const inventory = docker(["exec", container, "pg_restore", "--list", remote]);
  assert.ok(
    inventory.includes("mfa_factors") &&
      inventory.includes("schema_migrations") &&
      inventory.includes("business_members"),
  );
  docker(["exec", container, "pg_restore", "--file=/dev/null", remote]);
  docker(["exec", container, "rm", "--", remote]);
  manifest.backup = {
    file: "before-booking.dump",
    bytes: bytes.length,
    sha256: hash(destination),
    inventory_verified: true,
    full_decode_verified: true,
    restore_drill: false,
  };
  save();
  assert.deepEqual(fingerprint(), before);
  assert.deepEqual(history(), versions.slice(0, 12));
  assert.deepEqual(
    Object.fromEntries(
      files.map((f) => [f, hash(path.join(root, "supabase/migrations", f))]),
    ),
    hashes,
  );
  console.log(
    "Verified private custom backup, source hashes and unchanged pre-activation rows; applying exactly three local migrations.",
  );
  stage = "migration";
  manifest.stage = stage;
  save();
  run(process.execPath, [
    path.join(root, "node_modules/supabase/dist/supabase.js"),
    "migration",
    "up",
    "--local",
  ]);
  stage = "preservation";
  assert.deepEqual(history(), versions);
  const after = fingerprint();
  manifest.after = after;
  manifest.after_history = history();
  save();
  for (const [name, value] of Object.entries(before))
    assert.deepEqual(after[name], value);
  const added = Object.keys(after).filter((name) => !before[name]);
  assert.equal(added.length, 13);
  assert.ok(added.every((name) => after[name].rows === 0));
  stage = "security smoke";
  const tables = added.map((name) => `'${name}'::regclass`).join(",");
  assert.equal(
    sql(
      `select count(*) from pg_class where oid in (${tables}) and relrowsecurity and relforcerowsecurity;`,
    ),
    "13",
  );
  assert.equal(
    sql(
      `select count(*) from pg_class c cross join unnest(array['anon','authenticated','app_server','service_role']) r where c.oid in (${tables}) and has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE');`,
    ),
    "0",
  );
  const apiNames =
    "'write_customer','read_customer','list_customers_page','read_schedule','read_calendar_control','write_schedule','schedule_preview_source','list_schedule_staff','manage_appointment','read_appointment','list_appointments_page','appointment_preview_source'";
  assert.equal(
    sql(
      `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api' and p.proname in (${apiNames}) and p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('app_server',p.oid,'EXECUTE') and not has_function_privilege('service_role',p.oid,'EXECUTE');`,
    ),
    "12",
  );
  assert.equal(
    sql(
      "select count(*) from pg_constraint where conname='appointment_occupancy_no_overlap' and contype='x';",
    ),
    "1",
  );
  sql("notify pgrst, 'reload schema';");
  manifest.status = "pass";
  manifest.stage = "complete";
  manifest.finished_at = new Date().toISOString();
  manifest.preserved_tables = Object.keys(before).length;
  manifest.new_empty_tables = added;
  save();
  console.log(
    `Activation PASS: 12 -> 15 migrations; ${Object.keys(before).length} existing tables unchanged; 13 new empty tables; RLS/grants/RPC/EXCLUDE verified.`,
  );
  console.log(`Private backup and manifest: ${path.relative(root, directory)}`);
} catch {
  if (manifest) {
    manifest.status = "failed";
    manifest.stage = stage;
    save();
  }
  console.error(
    `Local activation stopped at ${stage}. No automatic reset, restore or account changes. Review the private manifest before retrying; raw database output withheld.`,
  );
  process.exitCode = 1;
}
