import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAppServerDatabaseUrl } from "../src/lib/database/config.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const envPath = resolve(root, ".env.local");

try {
  const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
  if (!/^project_id\s*=\s*"turnosmerivo"\s*$/m.test(config))
    throw new Error("Unexpected local project");
  execFileSync("git", ["check-ignore", "--quiet", ".env.local"], {
    cwd: root,
    stdio: "ignore",
  });
  let tracked = false;
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", ".env.local"], {
      cwd: root,
      stdio: "ignore",
    });
    tracked = true;
  } catch {
    /* An untracked, ignored env file is required. */
  }
  if (tracked) throw new Error("Environment file is tracked");

  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const assignments = [
    ...existing.matchAll(/^DATABASE_URL_APP_SERVER=(.*)$/gm),
  ];
  if (assignments.length > 1)
    throw new Error("Duplicate connection configuration");
  const stored = assignments[0]?.[1].trim().replace(/^(["'])(.*)\1$/, "$2");
  const configured = process.env.DATABASE_URL_APP_SERVER || stored;
  let password = randomBytes(32).toString("base64url");
  if (configured) {
    parseAppServerDatabaseUrl(configured);
    const url = new URL(configured);
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.port !== "54322" ||
      url.pathname !== "/postgres"
    )
      throw new Error("Not the local database");
    password = decodeURIComponent(url.password);
    if (!/^[A-Za-z0-9_-]{20,}$/.test(password))
      throw new Error("Existing password needs manual review");
    if (stored && stored !== configured)
      throw new Error("Conflicting connection configuration");
  }
  // Password goes through stdin, never command arguments or output. Only the local container is targeted.
  const sql = `\nDO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_server' AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
      OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member='app_server'::regrole)
      OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('businesses','business_settings','users','business_members')
        AND has_table_privilege('app_server',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
      THEN RAISE EXCEPTION 'Unexpected server privileges'; END IF;
  END $$;
  ALTER ROLE app_server LOGIN PASSWORD '${password}';\n`;
  execFileSync(
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
    ],
    {
      input: sql,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  if (!stored) {
    const value =
      configured ||
      `postgresql://app_server:${password}@127.0.0.1:54322/postgres`;
    const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
    const content = assignments.length
      ? existing.replace(
          /^DATABASE_URL_APP_SERVER=.*$/m,
          `DATABASE_URL_APP_SERVER=${value}`,
        )
      : `${existing}${prefix}# Local restricted connection; never commit this file.\nDATABASE_URL_APP_SERVER=${value}\n`;
    writeFileSync(envPath, content, {
      encoding: "utf8",
      mode: 0o600,
      flag: existsSync(envPath) ? "w" : "wx",
    });
  }
  console.log(
    "Local app_server login provisioned. Configuration is in ignored .env.local; no credentials were printed.",
  );
} catch {
  console.error(
    "Local database provisioning failed. Verify Docker, local migrations, Git ignore rules and existing env configuration. No credentials are printed.",
  );
  process.exitCode = 1;
}
