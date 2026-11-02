import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

export type HumanCheck = { secret: string; siteKey: string; hostname: string };
export function networkIdentity(
  headers: Headers,
  key: Buffer,
  business: string,
) {
  // Trust this header only behind the pinned Vercel direct ingress configured server-side.
  const raw = headers.get("x-vercel-forwarded-for") ?? "";
  if (!isIP(raw) || raw.includes("%")) throw Error("NETWORK_UNAVAILABLE");
  // WHATWG URL normalizes equivalent IPv6 representations; mapped IPv4 shares its bucket.
  let ip =
    isIP(raw) === 6 ? new URL(`http://[${raw}]/`).hostname.slice(1, -1) : raw;
  if (ip.startsWith("::ffff:")) {
    const parts = ip.slice(7).split(":");
    if (parts.length === 2) {
      const value = parseInt(parts[0], 16) * 65536 + parseInt(parts[1], 16);
      ip = [24, 16, 8, 0].map((n) => (value >>> n) & 255).join(".");
    }
  }
  return `vercel:${createHmac("sha256", key)
    .update(JSON.stringify(["merivo-network-v1", business, ip]))
    .digest("hex")}`;
}

export async function verifyHuman(
  config: HumanCheck,
  token: string,
  action: string,
  nonce: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
) {
  if (!token || token.length > 2048) throw Error("CHALLENGE_INVALID");
  let response: Response;
  try {
    response = await fetcher(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: new URLSearchParams({ secret: config.secret, response: token }),
        signal: AbortSignal.timeout(5000),
        redirect: "error",
        cache: "no-store",
      },
    );
    if (!response.ok) throw Error();
    const value = z
      .object({
        success: z.boolean(),
        hostname: z.string().optional(),
        action: z.string().optional(),
        cdata: z.string().optional(),
        challenge_ts: z.iso.datetime().optional(),
      })
      .parse(await response.json());
    if (
      !value.success ||
      value.hostname !== config.hostname ||
      value.action !== action ||
      value.cdata !== nonce ||
      !value.challenge_ts
    )
      throw Error("CHALLENGE_INVALID");
    const age = now - Date.parse(value.challenge_ts);
    if (age < -30000 || age >= 300000) throw Error("CHALLENGE_INVALID");
  } catch (error) {
    if (error instanceof Error && error.message === "CHALLENGE_INVALID")
      throw error;
    throw Error("HUMAN_VERIFICATION_UNAVAILABLE");
  }
}
