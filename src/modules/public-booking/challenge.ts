import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
const schema = z
  .object({
    slug: z.string(),
    purpose: z.enum(["create", "cancel", "reschedule"]),
    resource: z.uuid(),
    nonce: z.uuid(),
    expires_at: z.iso.datetime(),
  })
  .strict();
export function issueChallenge(
  key: Buffer,
  slug: string,
  purpose: "create" | "cancel" | "reschedule",
  resource: string,
  now = Date.now(),
) {
  const payload = Buffer.from(
    JSON.stringify(
      schema.parse({
        slug,
        purpose,
        resource,
        nonce: randomUUID(),
        expires_at: new Date(now + 90000).toISOString(),
      }),
    ),
  ).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", key).update(payload).digest("base64url")
  );
}
export function verifyChallenge(
  key: Buffer,
  value: string,
  slug: string,
  purpose: string,
  resource: string,
  now = Date.now(),
) {
  try {
    if (value.length > 2048) throw Error();
    const [payload, signature, ...extra] = value.split(".");
    if (extra.length || !signature) throw Error();
    const actual = Buffer.from(signature, "base64url"),
      expected = createHmac("sha256", key).update(payload).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw Error();
    const parsed = schema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    );
    if (
      parsed.slug !== slug ||
      parsed.purpose !== purpose ||
      parsed.resource !== resource ||
      Date.parse(parsed.expires_at) <= now ||
      Date.parse(parsed.expires_at) > now + 90000
    )
      throw Error();
    return parsed;
  } catch {
    throw Error("CHALLENGE_INVALID");
  }
}
