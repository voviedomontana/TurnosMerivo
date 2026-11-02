import { describe, expect, it } from "vitest";
import { parseAppServerDatabaseUrl } from "@/lib/database/config";

describe("restricted server connection", () => {
  const ref = "abcdefghijklmnopqrst";
  const pooler = `postgresql://app_server.${ref}:synthetic@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
  it("accepts the pinned restricted role through the hosted shared pooler", () => {
    expect(parseAppServerDatabaseUrl(pooler, ref)).toBe(pooler);
    expect(
      parseAppServerDatabaseUrl(pooler.replace(":6543/", ":5432/"), ref),
    ).toContain(":5432/");
  });
  it.each([
    [pooler, undefined],
    [pooler, "tsrqponmlkjihgfedcba"],
    [pooler.replace("app_server.", "postgres."), ref],
    [pooler.replace("app_server.", "service_role."), ref],
    [
      pooler.replace(
        "pooler.supabase.com",
        "pooler.supabase.com.attacker.test",
      ),
      ref,
    ],
    [pooler.replace("aws-0-us-east-1.pooler.supabase.com", "127.0.0.1"), ref],
    [pooler.replace(":6543/", ":1234/"), ref],
    [pooler.replace("/postgres", "/other"), ref],
    [pooler + "?options=role%3Dpostgres", ref],
  ])(
    "rejects an unpinned, privileged or malformed pooled connection %#",
    (url, project) => {
      expect(() => parseAppServerDatabaseUrl(url, project)).toThrow(
        "Invalid DATABASE_URL_APP_SERVER.",
      );
    },
  );
  it("is optional for the landing", () => {
    expect(parseAppServerDatabaseUrl()).toBeNull();
    expect(parseAppServerDatabaseUrl("")).toBeNull();
  });
  it("accepts only the restricted login", () => {
    const url = "postgresql://app_server:example@127.0.0.1:54322/postgres";
    expect(parseAppServerDatabaseUrl(url)).toBe(url);
  });
  it.each([
    "postgresql://postgres:example@127.0.0.1:54322/postgres",
    "postgresql://service_role:example@127.0.0.1:54322/postgres",
    "postgresql://app_server@127.0.0.1:54322/postgres",
    "postgresql://app_server:example@127.0.0.1:54322/postgres?options=override",
    "invalid",
  ])(
    "rejects invalid or privileged connections without echoing credentials",
    (url) => {
      expect(() => parseAppServerDatabaseUrl(url)).toThrow(
        "Invalid DATABASE_URL_APP_SERVER.",
      );
    },
  );
});
