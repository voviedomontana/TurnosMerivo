import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
try {
  execFileSync("git", ["check-ignore", "--quiet", ".env.local"], {
    cwd: root,
    stdio: "ignore",
  });
  if (
    execFileSync("git", ["ls-files", "--", ".env.local"], {
      cwd: root,
      encoding: "utf8",
    }).trim()
  )
    throw new Error();
  const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
  if (!/^project_id\s*=\s*"turnosmerivo"\s*$/m.test(config)) throw new Error();
  const cli = resolve(root, "node_modules/supabase/dist/supabase.js");
  const status = JSON.parse(
    execFileSync(process.execPath, [cli, "status", "--output", "json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  if (status.API_URL !== "http://127.0.0.1:54321") throw new Error();
  const publicKey = status.PUBLISHABLE_KEY;
  const privateKey = status.SECRET_KEY || status.SERVICE_ROLE_KEY;
  if (!publicKey?.startsWith("sb_publishable_") || !privateKey)
    throw new Error();
  const path = resolve(root, ".env.local");
  let env = existsSync(path) ? readFileSync(path, "utf8") : "";
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
    SUPABASE_AUTH_ADMIN_KEY: privateKey,
  };
  for (const [name, value] of Object.entries(values)) {
    const found = [...env.matchAll(new RegExp(`^${name}=(.*)$`, "gm"))];
    if (found.length > 1) throw new Error();
    if (found[0]?.[1].trim() && found[0][1].trim() !== value) throw new Error();
    env = found.length
      ? env.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`)
      : `${env.trimEnd()}\n${name}=${value}\n`;
  }
  writeFileSync(path, env);
  console.log(
    "Local Auth configured in ignored .env.local. No credentials printed. Restart Next.js.",
  );
} catch {
  console.error(
    "Local Auth setup failed. Check local services and existing configuration; no conflicting values are overwritten.",
  );
  process.exitCode = 1;
}
