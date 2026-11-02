import { z } from "zod";
import { parseKeyring } from "./crypto";
import type { HumanCheck } from "./antiabuse";
export function publicConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const mode = env.PUBLIC_BOOKING_ENVIRONMENT;
  if (mode !== "discardable" && mode !== "staging")
    throw Error("PUBLIC_BOOKING_DISABLED");
  const configuredOrigin =
    mode === "discardable"
      ? env.PUBLIC_BOOKING_TEST_ORIGIN
      : env.PUBLIC_BOOKING_ORIGIN;
  const origin = new URL(configuredOrigin ?? "");
  if (origin.origin !== configuredOrigin)
    throw Error("PUBLIC_BOOKING_DISABLED");
  if (
    mode === "discardable" &&
    (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
      env.PUBLIC_BOOKING_NETWORK_MODE !== "loopback-only")
  )
    throw Error("PUBLIC_BOOKING_DISABLED");
  let human: HumanCheck | undefined;
  let networkKey: Buffer | undefined;
  if (mode === "staging") {
    if (
      origin.protocol !== "https:" ||
      origin.port ||
      !origin.hostname.includes(".") ||
      env.VERCEL !== "1" ||
      env.VERCEL_ENV !== "preview" ||
      !env.PUBLIC_BOOKING_VERCEL_PROJECT_ID ||
      env.PUBLIC_BOOKING_VERCEL_PROJECT_ID !== env.VERCEL_PROJECT_ID ||
      env.PUBLIC_BOOKING_NETWORK_MODE !== "vercel-direct"
    )
      throw Error("PUBLIC_BOOKING_DISABLED");
    const credentials = z
      .object({
        siteKey: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/),
        secret: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/),
        encoded: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      })
      .safeParse({
        siteKey: env.PUBLIC_BOOKING_TURNSTILE_SITE_KEY,
        secret: env.PUBLIC_BOOKING_TURNSTILE_SECRET,
        encoded: env.PUBLIC_BOOKING_NETWORK_KEY,
      });
    if (!credentials.success) throw Error("PUBLIC_BOOKING_DISABLED");
    const { siteKey, secret, encoded } = credentials.data;
    if (/^[123]x0/.test(siteKey) || /^[123]x0/.test(secret))
      throw Error("PUBLIC_BOOKING_DISABLED");
    human = { siteKey, secret, hostname: origin.hostname };
    networkKey = Buffer.from(encoded, "base64url");
    if (networkKey.toString("base64url") !== encoded)
      throw Error("PUBLIC_BOOKING_DISABLED");
  }
  const parsed = z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .safeParse(
      mode === "discardable"
        ? env.PUBLIC_BOOKING_TEST_CHALLENGE_KEY
        : env.PUBLIC_BOOKING_CHALLENGE_KEY,
    );
  if (!parsed.success) throw Error("PUBLIC_BOOKING_DISABLED");
  const challenge = parsed.data;
  const keyring = parseKeyring(env.PUBLIC_BOOKING_ENCRYPTION_KEYS ?? "");
  if (
    networkKey &&
    (networkKey.equals(Buffer.from(challenge, "base64url")) ||
      Object.values(keyring.keys).some((v) =>
        networkKey!.equals(Buffer.from(v, "base64url")),
      ))
  )
    throw Error("PUBLIC_BOOKING_DISABLED");
  if (
    Object.values(keyring.keys).some((value) =>
      Buffer.from(value, "base64url").equals(
        Buffer.from(challenge, "base64url"),
      ),
    )
  )
    throw Error("PUBLIC_BOOKING_DISABLED");
  return {
    mode,
    human,
    networkKey,
    origin: origin.origin,
    secure: origin.protocol === "https:",
    challenge: Buffer.from(challenge, "base64url"),
    keyring,
  };
}

export function runtimeGate(config: ReturnType<typeof publicConfig>) {
  return config.mode === "staging"
    ? {
        statement: "select app_internal.public_staging_ready($1) as value",
        values: [config.origin],
      }
    : {
        statement: "select app_internal.public_runtime_ready() as value",
        values: [],
      };
}
