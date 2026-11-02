import { describe, expect, it } from "vitest";
import { parseSupabaseConfig } from "@/lib/supabase/config";

describe("optional Supabase configuration", () => {
  it("allows the landing to run without configuration", () => {
    expect(parseSupabaseConfig()).toBeNull();
    expect(parseSupabaseConfig("", "")).toBeNull();
  });
  it("accepts a public key and secure project URL", () => {
    expect(
      parseSupabaseConfig("https://example.supabase.co", "sb_publishable_test"),
    ).toEqual({
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_test",
    });
  });
  it.each([
    ["https://example.supabase.co", undefined],
    [undefined, "sb_publishable_test"],
    ["invalid", "sb_publishable_test"],
    ["https://example.supabase.co", "sb_secret_test"],
    ["http://example.com", "sb_publishable_test"],
  ])(
    "rejects partial or unsafe configuration without exposing values",
    (url, key) => {
      expect(() => parseSupabaseConfig(url, key)).toThrow(
        "Invalid Supabase configuration.",
      );
    },
  );
  it("allows the future local Supabase instance", () => {
    expect(
      parseSupabaseConfig("http://127.0.0.1:54321", "sb_publishable_test"),
    ).not.toBeNull();
  });
});
