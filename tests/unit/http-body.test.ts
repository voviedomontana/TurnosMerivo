import { describe, it, expect } from "vitest";
import { readJsonBody } from "@/lib/http/body";
describe("bounded JSON requests", () => {
  it("reads UTF-8 JSON", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ name: "Mérivo" }),
    });
    expect(await readJsonBody(request)).toEqual({ name: "Mérivo" });
  });
  it("counts bytes rather than characters", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify("é".repeat(50_000)),
    });
    await expect(readJsonBody(request)).rejects.toBeInstanceOf(RangeError);
  });
  it("rejects absent or malformed JSON", async () => {
    await expect(
      readJsonBody(new Request("http://localhost")),
    ).rejects.toBeInstanceOf(SyntaxError);
    await expect(
      readJsonBody(
        new Request("http://localhost", { method: "POST", body: "{" }),
      ),
    ).rejects.toBeInstanceOf(SyntaxError);
  });
});
