// Offline configuration check. Never loads .env.local or contacts a service.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseAppServerDatabaseUrl } from "../src/lib/database/config.ts";

const targetSchema = z
  .object({
    schemaVersion: z.literal(1),
    purpose: z.literal("staging"),
    dataPolicy: z.literal("synthetic-only"),
    isolationConfirmed: z.boolean(),
    supabaseProjectRef: z
      .string()
      .regex(/^[a-z]{20}$/)
      .or(z.literal("")),
    forbiddenSupabaseProjectRefs: z
      .array(z.string().regex(/^[a-z]{20}$/))
      .min(1),
    vercelTeamSlug: z.string().regex(/^[a-z0-9-]+$/),
    vercelProjectId: z
      .string()
      .regex(/^prj_[A-Za-z0-9]+$/)
      .or(z.literal("")),
    origin: z.string(),
  })
  .strict();
const checks = [];
const check = (id, passed) => checks.push({ id, passed: Boolean(passed) });
try {
  const [option, filename, ...extra] = process.argv.slice(2);
  if (option !== "--target" || !filename || extra.length) throw Error();
  const target = targetSchema.parse(JSON.parse(readFileSync(filename, "utf8")));
  const env = process.env;
  check("isolation_confirmed_by_operator", target.isolationConfirmed);
  check(
    "supabase_not_protected_project",
    /^[a-z]{20}$/.test(target.supabaseProjectRef) &&
      !target.forbiddenSupabaseProjectRefs.includes(target.supabaseProjectRef),
  );
  let origin;
  try {
    origin = new URL(target.origin);
  } catch {
    /* Fail closed below. */
  }
  check(
    "stable_https_origin",
    origin &&
      origin.protocol === "https:" &&
      origin.origin === target.origin &&
      !origin.port &&
      !origin.hostname.endsWith(".supabase.co"),
  );
  check("staging_mode", env.PUBLIC_BOOKING_ENVIRONMENT === "staging");
  check(
    "origin_matches_target",
    target.origin && env.PUBLIC_BOOKING_ORIGIN === target.origin,
  );
  check(
    "vercel_project_pinned",
    target.vercelProjectId &&
      env.VERCEL_PROJECT_ID === target.vercelProjectId &&
      env.PUBLIC_BOOKING_VERCEL_PROJECT_ID === target.vercelProjectId,
  );
  check(
    "vercel_preview_declared",
    env.VERCEL === "1" &&
      env.VERCEL_ENV === "preview" &&
      env.PUBLIC_BOOKING_NETWORK_MODE === "vercel-direct",
  );
  check(
    "supabase_project_pinned",
    env.SUPABASE_PROJECT_REF === target.supabaseProjectRef,
  );
  check(
    "auth_project_matches",
    env.NEXT_PUBLIC_SUPABASE_URL ===
      `https://${target.supabaseProjectRef}.supabase.co`,
  );
  let database;
  try {
    const parsed = parseAppServerDatabaseUrl(
      env.DATABASE_URL_APP_SERVER,
      target.supabaseProjectRef,
    );
    if (parsed) database = new URL(parsed);
  } catch {
    /* Never print connection strings or parser diagnostics. */
  }
  check(
    "database_project_matches",
    database &&
      ((decodeURIComponent(database.username) === "app_server" &&
        database.hostname === `db.${target.supabaseProjectRef}.supabase.co` &&
        ["", "5432"].includes(database.port)) ||
        (decodeURIComponent(database.username) ===
          `app_server.${target.supabaseProjectRef}` &&
          /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(database.hostname))) &&
      database.pathname === "/postgres",
  );
  check(
    "required_credentials_present_only",
    [
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "PUBLIC_BOOKING_ENCRYPTION_KEYS",
      "PUBLIC_BOOKING_CHALLENGE_KEY",
      "PUBLIC_BOOKING_NETWORK_KEY",
      "PUBLIC_BOOKING_TURNSTILE_SITE_KEY",
      "PUBLIC_BOOKING_TURNSTILE_SECRET",
    ].every((name) => Boolean(env[name]?.trim())),
  );
  check("recovery_key_not_in_application", !env.PUBLIC_BOOKING_RECOVERY_KEY);
} catch {
  check("target_file_valid", false);
}
const passed = checks.length > 0 && checks.every((value) => value.passed);
console.log(
  JSON.stringify({
    status: passed ? "CONFIGURATION_MATCHES" : "BLOCKED",
    scope: "offline_declared_configuration_only",
    readyForBookings: false,
    contactedServices: false,
    checks,
  }),
);
process.exitCode = passed ? 0 : 2;
