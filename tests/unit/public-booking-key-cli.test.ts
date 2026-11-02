import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const directories: string[] = [];
const secret = () => randomBytes(32).toString("base64url");
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "merivo-custody-test-"));
  directories.push(directory);
  return {
    filename: path.join(directory, "backup.json"),
    ring: JSON.stringify({ active: "v1", keys: { v1: secret() } }),
    recovery: secret(),
  };
}
function run(args: string[], ring = "", recovery = "") {
  return spawnSync(
    process.execPath,
    ["scripts/public-booking-keys.mjs", ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PUBLIC_BOOKING_ENCRYPTION_KEYS: ring,
        PUBLIC_BOOKING_RECOVERY_KEY: recovery,
      },
      timeout: 20000,
    },
  );
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    // mkdtemp gives this test exclusive ownership of each exact directory.
    if (
      path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith("merivo-custody-test-")
    )
      throw Error("Unexpected cleanup path");
    rmSync(directory, { recursive: true });
  }
});
describe("operator key custody CLI", () => {
  it("runs the disk recovery drill without reading configured keys", () => {
    const result = run(["drill"], "invalid", "invalid");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      synthetic: true,
      encrypted_file_restore: true,
      retained_key_decryption: true,
      wrong_recovery_key_rejected: true,
    });
  });
  it("writes encrypted material and verifies it without exporting keys", () => {
    const f = fixture();
    const backup = run(["backup", "--output", f.filename], f.ring, f.recovery);
    expect(backup.status).toBe(0);
    const verified = run(["verify", "--input", f.filename], f.ring, f.recovery);
    expect(verified.status).toBe(0);
    const output =
      backup.stdout +
      backup.stderr +
      verified.stdout +
      verified.stderr +
      readFileSync(f.filename, "utf8");
    for (const value of [f.recovery, ...Object.values(JSON.parse(f.ring).keys)])
      expect(output.includes(String(value))).toBe(false);
  });
  it("never overwrites an existing backup", () => {
    const f = fixture();
    writeFileSync(f.filename, "sentinel");
    expect(
      run(["backup", "--output", f.filename], f.ring, f.recovery).status,
    ).toBe(1);
    expect(readFileSync(f.filename, "utf8")).toBe("sentinel");
  });
  it("rejects writes inside the repository or relative output paths", () => {
    const f = fixture();
    for (const filename of [
      path.resolve("test-results/forbidden-key-backup.json"),
      "backup.json",
    ])
      expect(
        run(["backup", "--output", filename], f.ring, f.recovery).status,
      ).toBe(1);
  });
  it("rejects reused recovery keys and missing configuration without leaking input", () => {
    const f = fixture();
    const reused = JSON.parse(f.ring).keys.v1 as string;
    const result = run(["backup", "--output", f.filename], f.ring, reused);
    expect(result.status).toBe(1);
    expect((result.stdout + result.stderr).includes(reused)).toBe(false);
    expect(run(["backup", "--output", f.filename]).status).toBe(1);
  });
  it("fails closed for wrong recovery key, corrupted backup and mismatched runtime", () => {
    const f = fixture();
    expect(
      run(["backup", "--output", f.filename], f.ring, f.recovery).status,
    ).toBe(0);
    expect(
      run(["verify", "--input", f.filename], f.ring, secret()).status,
    ).toBe(1);
    const other = JSON.stringify({ active: "v1", keys: { v1: secret() } });
    expect(
      run(["verify", "--input", f.filename], other, f.recovery).status,
    ).toBe(1);
    const envelope = JSON.parse(readFileSync(f.filename, "utf8"));
    envelope.tag = secret().slice(0, 22);
    writeFileSync(f.filename, JSON.stringify(envelope));
    expect(
      run(["verify", "--input", f.filename], f.ring, f.recovery).status,
    ).toBe(1);
  });
  it("does not accept secrets through additional command arguments", () => {
    const f = fixture();
    const result = run(
      ["backup", "--output", f.filename, f.recovery],
      f.ring,
      f.recovery,
    );
    expect(result.status).toBe(1);
    expect((result.stdout + result.stderr).includes(f.recovery)).toBe(false);
  });
});
