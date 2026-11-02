import { z } from "zod";
import { solveHuman } from "./human-client";
export class PublicClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function publicFetch(
  base: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<unknown> {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Merivo-Public": "1",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const problem = z
      .object({ code: z.string(), title: z.string() })
      .safeParse(value);
    throw new PublicClientError(
      response.status,
      problem.success ? problem.data.code : "UNAVAILABLE",
      problem.success
        ? problem.data.title
        : "No pudimos completar la operación.",
    );
  }
  return value;
}
export async function publicCommand(
  base: string,
  purpose: "create" | "cancel" | "reschedule",
  resource: string,
  path: string,
  body: unknown,
  key: string,
  version?: number,
) {
  const proof = z
    .object({
      challenge: z.string(),
      turnstile: z
        .object({
          site_key: z.string(),
          action: z.enum(["create", "cancel", "reschedule"]),
          cdata: z.uuid(),
        })
        .optional(),
    })
    .parse(await publicFetch(base, "/challenge", { purpose, resource }));
  if (proof.turnstile && proof.turnstile.action !== purpose)
    throw Error("No pudimos verificar la solicitud.");
  const human = proof.turnstile ? await solveHuman(proof.turnstile) : undefined;
  return publicFetch(base, path, body, {
    "Idempotency-Key": key,
    "X-Merivo-Challenge": proof.challenge,
    ...(human ? { "X-Merivo-Human": human } : {}),
    ...(version === undefined ? {} : { "If-Match": `"${version}"` }),
  });
}
