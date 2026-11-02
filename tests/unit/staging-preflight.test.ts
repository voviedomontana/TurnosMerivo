import { afterEach, describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const directories: string[] = [];
const ref = "abcdefghijklmnopqrst";
const target = {
  schemaVersion: 1,
  purpose: "staging",
  dataPolicy: "synthetic-only",
  isolationConfirmed: true,
  supabaseProjectRef: ref,
  forbiddenSupabaseProjectRefs: ["tsrqponmlkjihgfedcba"],
  vercelTeamSlug: "fixture-team",
  vercelProjectId: "prj_fixture",
  origin: "https://staging.example.test",
};
const env = {
  PUBLIC_BOOKING_ENVIRONMENT: "staging",
  PUBLIC_BOOKING_ORIGIN: target.origin,
  PUBLIC_BOOKING_VERCEL_PROJECT_ID: target.vercelProjectId,
  VERCEL_PROJECT_ID: target.vercelProjectId,
  VERCEL: "1",
  VERCEL_ENV: "preview",
  PUBLIC_BOOKING_NETWORK_MODE: "vercel-direct",
  SUPABASE_PROJECT_REF: ref,
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  DATABASE_URL_APP_SERVER: `postgresql://app_server.${ref}:synthetic-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic",
  PUBLIC_BOOKING_ENCRYPTION_KEYS: "synthetic",
  PUBLIC_BOOKING_CHALLENGE_KEY: "synthetic",
  PUBLIC_BOOKING_NETWORK_KEY: "synthetic",
  PUBLIC_BOOKING_TURNSTILE_SITE_KEY: "synthetic",
  PUBLIC_BOOKING_TURNSTILE_SECRET: "synthetic-secret",
  PUBLIC_BOOKING_RECOVERY_KEY: "",
};
function run(
  changes: Record<string, string | undefined> = {},
  document: unknown = target,
) {
  const directory = mkdtempSync(path.join(tmpdir(), "merivo-preflight-"));
  directories.push(directory);
  const filename = path.join(directory, "target.json");
  writeFileSync(filename, JSON.stringify(document));
  return spawnSync(
    process.execPath,
    ["scripts/public-staging-preflight.mjs", "--target", filename],
    {
      encoding: "utf8",
      env: { ...process.env, ...env, ...changes },
      timeout: 15000,
    },
  );
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (
      path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith("merivo-preflight-")
    )
      throw Error("Unsafe cleanup target");
    rmSync(directory, { recursive: true });
  }
});
describe("offline staging preflight", () => {
  it("checks declared target consistency without certifying deployment or credentials", () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "CONFIGURATION_MATCHES",
      readyForBookings: false,
      contactedServices: false,
    });
    expect((result.stdout + result.stderr).includes("synthetic-password")).toBe(
      false,
    );
    expect((result.stdout + result.stderr).includes("synthetic-secret")).toBe(
      false,
    );
  });
  it("rejects a production mode, foreign Auth project or database target", () => {
    for (const change of [
      { PUBLIC_BOOKING_ENVIRONMENT: "production" },
      { NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" },
      {
        DATABASE_URL_APP_SERVER:
          "postgresql://app_server:synthetic-password@127.0.0.1:54322/postgres",
      },
      {
        DATABASE_URL_APP_SERVER: `postgresql://postgres.${ref}:synthetic-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
      },
      { SUPABASE_PROJECT_REF: "tsrqponmlkjihgfedcba" },
    ])
      expect(run(change).status).toBe(2);
  });
  it("requires a concrete pinned Vercel project and independent recovery custody", () => {
    expect(run({ VERCEL_PROJECT_ID: "prj_other" }).status).toBe(2);
    expect(
      run({ PUBLIC_BOOKING_RECOVERY_KEY: "synthetic-recovery" }).status,
    ).toBe(2);
    expect(run({ PUBLIC_BOOKING_TURNSTILE_SECRET: "" }).status).toBe(2);
    expect(run({}, { ...target, vercelProjectId: "" }).status).toBe(2);
  });
  it("rejects an unconfirmed target and secret-bearing metadata", () => {
    expect(
      run({}, { ...target, forbiddenSupabaseProjectRefs: [ref] }).status,
    ).toBe(2);
    expect(run({}, { ...target, isolationConfirmed: false }).status).toBe(2);
    const result = run({}, { ...target, password: "synthetic-secret" });
    expect(result.status).toBe(2);
    expect((result.stdout + result.stderr).includes("synthetic-secret")).toBe(
      false,
    );
  });
  it("does not accept dashboard URLs or insecure origins as booking origins", () => {
    for (const origin of [
      "",
      "http://staging.example.test",
      `https://${ref}.supabase.co`,
      target.origin + "/path",
    ])
      expect(
        run({ PUBLIC_BOOKING_ORIGIN: origin }, { ...target, origin }).status,
      ).toBe(2);
  });
});
