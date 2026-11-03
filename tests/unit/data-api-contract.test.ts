import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = readFileSync("supabase/config.toml", "utf8");
const api =
  config.split(/^\[/m).find((section) => section.startsWith("api]")) ?? "";

describe("Data API deployment contract", () => {
  it("exposes the session RPC schema without exposing private or platform schemas", () => {
    const list = api.match(/^schemas\s*=\s*(\[[^\]]*\])/m)?.[1];
    expect(list).toBeDefined();
    expect((JSON.parse(list!) as string[]).sort()).toEqual(["api", "public"]);
  });
  it("keeps automatic table grants disabled", () => {
    expect(api).toMatch(/^auto_expose_new_tables\s*=\s*false\s*$/m);
  });
});
