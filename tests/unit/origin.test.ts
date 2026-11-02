import { describe, it, expect } from "vitest";
import { isSameOrigin } from "@/lib/http/origin";
describe("cookie mutation origin validation", () => {
  it("uses the actual Host when Next normalizes its internal request URL", () => {
    expect(
      isSameOrigin(
        new Request("http://localhost:3000/api", {
          headers: { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" },
        }),
      ),
    ).toBe(true);
  });
  it.each([
    undefined,
    "null",
    "https://evil.test",
    "http://app.example.test",
    "https://app.example.test/path",
    "https://app.example.test.evil.test",
  ])("rejects untrusted Origin %s", (origin) => {
    expect(
      isSameOrigin(
        new Request("https://app.example.test/api", {
          headers: {
            Host: "app.example.test",
            ...(origin ? { Origin: origin } : {}),
          },
        }),
      ),
    ).toBe(false);
  });
  it("accepts an exact HTTPS origin", () => {
    expect(
      isSameOrigin(
        new Request("http://internal:3000/api", {
          headers: {
            Host: "app.example.test",
            Origin: "https://app.example.test",
          },
        }),
      ),
    ).toBe(true);
  });
});
