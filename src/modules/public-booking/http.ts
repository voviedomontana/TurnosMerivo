import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getRequestId } from "@/lib/http/request-id";
import { readJsonBody } from "@/lib/http/body";
import { isBusinessSlug } from "@/modules/businesses/schemas";
import { publicConfig, runtimeGate } from "./config";
import { networkIdentity, verifyHuman } from "./antiabuse";
import { issueChallenge, verifyChallenge } from "./challenge";
import { openToken, sealToken, envelopeSchema } from "./crypto";
import { publicQuery, PublicBookingError } from "./repository";
import {
  secret,
  createInput,
  changeInput,
  availabilitySchema,
  managementSchema,
} from "./schemas";
const uuid = z.uuid();
const cookies = (request: Request) =>
  new Map(
    (request.headers.get("cookie") ?? "").split(";").flatMap((v) => {
      const at = v.indexOf("=");
      return at < 0 ? [] : [[v.slice(0, at).trim(), v.slice(at + 1).trim()]];
    }),
  );
export async function handlePublicBooking(
  request: Request,
  p: { slug: string; kind: string; id?: string; action?: string },
) {
  const trace = getRequestId(request.headers.get("x-request-id")),
    headers: Record<string, string> = {
      "Cache-Control": "private, no-store",
      "X-Request-Id": trace,
      "Referrer-Policy": "no-referrer",
    };
  let validatingResponse = false;
  try {
    const config = publicConfig(),
      url = new URL(request.url);
    if (
      request.headers.get("host") !== new URL(config.origin).host ||
      request.headers.get("sec-fetch-site") === "cross-site" ||
      request.headers.get("x-merivo-public") !== "1" ||
      (request.method !== "GET" &&
        request.headers.get("origin") !== config.origin)
    )
      throw new PublicBookingError("FORBIDDEN", 403);
    if (!isBusinessSlug(p.slug)) throw new PublicBookingError("NOT_FOUND", 404);
    if (p.id) uuid.parse(p.id);
    const query = (
      statement: string,
      values: (string | number | null)[] = [],
    ) => publicQuery(statement, values, trace);
    const gate = runtimeGate(config);
    if ((await query(gate.statement, gate.values)) !== true)
      throw new PublicBookingError("PUBLIC_BOOKING_DISABLED", 503);
    const publicBusiness = await query(
      "select app_internal.get_public_business($1) as value",
      [p.slug],
    );
    if (publicBusiness === null) throw new PublicBookingError("NOT_FOUND", 404);
    validatingResponse = true;
    const business = z.object({ id: uuid }).parse(publicBusiness);
    validatingResponse = false;
    const identity = config.networkKey
      ? networkIdentity(request.headers, config.networkKey, business.id)
      : `loopback:${business.id}`;
    const jar = cookies(request),
      attemptCookie = (id: string) => `merivo_attempt_${id}`,
      manageCookie = (id: string) => `merivo_manage_${id}`;
    const setCookie = (
      name: string,
      value: string,
      path: string,
      expires: string,
    ) => {
      secret.parse(value);
      const age = Math.max(
        0,
        Math.floor((Date.parse(expires) - Date.now()) / 1000),
      );
      headers["Set-Cookie"] =
        `${name}=${value}; Path=${path}; Max-Age=${age}; HttpOnly; SameSite=Lax${config.secure ? "; Secure" : ""}`;
    };
    const quota = async (
      scope: "read" | "issue" | "write",
      proof?: { nonce: string; expires_at: string },
    ) => {
      if (
        (await query(
          "select app_internal.public_quota($1,$2,$3::uuid,$4::timestamptz) as value",
          [scope, identity, proof?.nonce ?? null, proof?.expires_at ?? null],
        )) !== true
      )
        throw new PublicBookingError("RATE_LIMITED", 429);
    };
    await quota("read");
    const respond = (value: unknown, status = 200) =>
      Response.json(value, { status, headers });
    if (p.kind === "challenge") {
      const body = z
        .object({
          purpose: z.enum(["create", "cancel", "reschedule"]),
          resource: uuid,
        })
        .strict()
        .parse(await readJsonBody(request));
      const challenge = issueChallenge(
        config.challenge,
        p.slug,
        body.purpose,
        body.resource,
      );
      const binding = verifyChallenge(
        config.challenge,
        challenge,
        p.slug,
        body.purpose,
        body.resource,
      );
      return respond({
        challenge,
        environment: config.mode,
        human_verification: Boolean(config.human),
        ...(config.human
          ? {
              turnstile: {
                site_key: config.human.siteKey,
                action: body.purpose,
                cdata: binding.nonce,
              },
            }
          : {}),
      });
    }
    if (p.kind === "attempt") {
      await quota("issue");
      const { id } = z
          .object({ id: z.uuidv4() })
          .strict()
          .parse(await readJsonBody(request)),
        value = randomBytes(32).toString("base64url");
      validatingResponse = true;
      const result = z
        .object({
          id: uuid,
          expires_at: z.string(),
          privacy_policy_version: z.string().nullable(),
          require_email: z.boolean(),
        })
        .strict()
        .parse(
          await query(
            "select app_internal.public_issue_attempt($1,$2::uuid,$3) as value",
            [p.slug, id, value],
          ),
        );
      setCookie(
        attemptCookie(id),
        value,
        `/api/v1/public/${p.slug}`,
        result.expires_at,
      );
      return respond(result, 201);
    }
    const token = p.id ? jar.get(manageCookie(p.id)) : undefined;
    if (p.kind === "availability") {
      const input = z
        .object({
          staff_id: uuid,
          service_id: uuid,
          from: z.iso.date(),
          days: z.coerce.number().int().min(1).max(7).default(1),
        })
        .strict()
        .parse(Object.fromEntries(url.searchParams));
      validatingResponse = true;
      return respond(
        availabilitySchema.parse(
          await query(
            "select app_internal.public_availability($1,$2::uuid,$3::uuid,$4,$5) as value",
            [p.slug, input.staff_id, input.service_id, input.from, input.days],
          ),
        ),
      );
    }
    if (p.kind === "manage" && p.action === "exchange") {
      const body = z
        .object({ token: secret })
        .strict()
        .parse(await readJsonBody(request));
      validatingResponse = true;
      const result = managementSchema.parse(
        await query(
          "select app_internal.public_read($1,$2::uuid,$3) as value",
          [p.slug, p.id!, body.token],
        ),
      );
      setCookie(
        manageCookie(p.id!),
        body.token,
        `/api/v1/public/${p.slug}/manage/${p.id}`,
        result.token_expires_at,
      );
      headers.ETag = `"${result.version}"`;
      return respond(result);
    }
    if (p.kind === "manage" && request.method === "GET") {
      if (!token || !secret.safeParse(token).success)
        throw new PublicBookingError("NOT_FOUND", 404);
      if (p.action === "availability") {
        const input = z
          .object({
            from: z.iso.date(),
            days: z.coerce.number().int().min(1).max(7).default(1),
          })
          .strict()
          .parse(Object.fromEntries(url.searchParams));
        validatingResponse = true;
        return respond(
          availabilitySchema.parse(
            await query(
              "select app_internal.public_availability($1,null,null,$2,$3,$4::uuid,$5) as value",
              [p.slug, input.from, input.days, p.id!, token],
            ),
          ),
        );
      }
      if (p.action) throw new PublicBookingError("NOT_FOUND", 404);
      validatingResponse = true;
      const result = managementSchema.parse(
        await query(
          "select app_internal.public_read($1,$2::uuid,$3) as value",
          [p.slug, p.id!, token],
        ),
      );
      headers.ETag = `"${result.version}"`;
      return respond(result);
    }
    const key = uuid.parse(request.headers.get("idempotency-key"));
    if (p.kind === "create") {
      const input = createInput.parse(await readJsonBody(request)),
        attempt = jar.get(attemptCookie(input.attempt_id));
      if (!attempt || !secret.safeParse(attempt).success)
        throw new PublicBookingError("NOT_FOUND", 404);
      const proof = verifyChallenge(
        config.challenge,
        request.headers.get("x-merivo-challenge") ?? "",
        p.slug,
        "create",
        input.id,
      );
      if (config.human)
        await verifyHuman(
          config.human,
          request.headers.get("x-merivo-human") ?? "",
          "create",
          proof.nonce,
        );
      await quota("write", proof);
      const expires = new Date(
          Date.parse(input.starts_at) + 86400000,
        ).toISOString(),
        candidate = randomBytes(32).toString("base64url");
      const envelope = sealToken(config.keyring, candidate, {
        business_id: business.id,
        appointment_id: input.id,
        generation: 1,
        expires_at: expires,
      });
      const { id, attempt_id, ...data } = input;
      validatingResponse = true;
      const result = z
        .object({
          id: uuid,
          business_id: uuid,
          status: z.enum(["confirmed", "cancelled"]),
          version: z.number().int(),
          starts_at: z.string(),
          ends_at: z.string(),
          blocked_until: z.string(),
          envelope: envelopeSchema,
          token_expires_at: z.string(),
          generation: z.number().int(),
        })
        .strict()
        .parse(
          await query(
            "select app_internal.public_create($1,$2::uuid,$3,$4::uuid,$5::uuid,$6::jsonb,$7,$8::timestamptz,$9::jsonb) as value",
            [
              p.slug,
              attempt_id,
              attempt,
              id,
              key,
              JSON.stringify(data),
              candidate,
              expires,
              JSON.stringify(envelope),
            ],
          ),
        );
      const recovered = openToken(config.keyring, result.envelope, {
        business_id: result.business_id,
        appointment_id: result.id,
        generation: result.generation,
        expires_at: result.token_expires_at,
      });
      // The bearer appears only in a fragment intended for the recipient, never in a query.
      headers.ETag = `"${result.version}"`;
      return respond(
        {
          id: result.id,
          status: result.status,
          version: result.version,
          starts_at: result.starts_at,
          ends_at: result.ends_at,
          manage_url: `/b/${p.slug}/r/${result.id}#t=${recovered}`,
        },
        201,
      );
    }
    if (p.kind === "manage") {
      if (!token || !secret.safeParse(token).success)
        throw new PublicBookingError("NOT_FOUND", 404);
      const action = z.enum(["cancel", "reschedule"]).parse(p.action),
        proof = verifyChallenge(
          config.challenge,
          request.headers.get("x-merivo-challenge") ?? "",
          p.slug,
          action,
          p.id!,
        );
      if (config.human)
        await verifyHuman(
          config.human,
          request.headers.get("x-merivo-human") ?? "",
          action,
          proof.nonce,
        );
      await quota("write", proof);
      // Authenticate capability before interpreting If-Match. SQL repeats after the root.
      validatingResponse = true;
      const detail = managementSchema.parse(
        await query(
          "select app_internal.public_read($1,$2::uuid,$3) as value",
          [p.slug, p.id!, token],
        ),
      );
      validatingResponse = false;
      const match = request.headers.get("if-match"),
        expected =
          match === null
            ? null
            : Number(
                z
                  .string()
                  .regex(/^"[1-9][0-9]*"$/)
                  .parse(match)
                  .slice(1, -1),
              );
      if (expected !== null)
        z.number().int().min(1).max(2147483647).parse(expected);
      const data = changeInput.parse(await readJsonBody(request));
      if (
        (action === "cancel" && (data.starts_at || data.quote_id)) ||
        (action === "reschedule" && (!data.starts_at || !data.quote_id))
      )
        throw new PublicBookingError("VALIDATION_ERROR", 400);
      const expires =
          action === "reschedule"
            ? new Date(Date.parse(data.starts_at!) + 86400000).toISOString()
            : null,
        envelope = expires
          ? sealToken(config.keyring, token, {
              business_id: detail.business_id,
              appointment_id: p.id!,
              generation: detail.generation,
              expires_at: expires,
            })
          : null;
      validatingResponse = true;
      const result = z
        .object({
          id: uuid,
          business_id: uuid,
          status: z.enum(["confirmed", "cancelled"]),
          version: z.number().int(),
          starts_at: z.string(),
          ends_at: z.string(),
          blocked_until: z.string(),
          token_expires_at: z.string(),
        })
        .strict()
        .parse(
          await query(
            "select app_internal.public_change($1,$2::uuid,$3,$4,$5::uuid,$6::integer,$7::jsonb,$8::timestamptz,$9::jsonb) as value",
            [
              p.slug,
              p.id!,
              token,
              action,
              key,
              expected,
              JSON.stringify(data),
              expires,
              envelope ? JSON.stringify(envelope) : null,
            ],
          ),
        );
      setCookie(
        manageCookie(p.id!),
        token,
        `/api/v1/public/${p.slug}/manage/${p.id}`,
        result.token_expires_at,
      );
      headers.ETag = `"${result.version}"`;
      return respond({
        id: result.id,
        status: result.status,
        version: result.version,
        starts_at: result.starts_at,
        ends_at: result.ends_at,
      });
    }
    throw new PublicBookingError("NOT_FOUND", 404);
  } catch (error) {
    const safe =
      error instanceof PublicBookingError
        ? error
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? new PublicBookingError(
              validatingResponse ? "UNAVAILABLE" : "VALIDATION_ERROR",
              validatingResponse ? 503 : 400,
            )
          : error instanceof Error && error.message === "CHALLENGE_INVALID"
            ? new PublicBookingError("CHALLENGE_INVALID", 403)
            : new PublicBookingError("UNAVAILABLE", 503);
    const messages: Record<string, string> = {
      NOT_FOUND: "No encontramos un acceso válido para ese turno o intento.",
      RATE_LIMITED: "Llegaste al límite de intentos. Esperá un minuto.",
      SLOT_TAKEN: "Ese horario se acaba de ocupar. Consultá nuevamente.",
      PRECONDITION_FAILED:
        "Los datos cambiaron. Actualizá el turno o los horarios antes de confirmar.",
      PRECONDITION_REQUIRED: "Actualizá el turno antes de confirmar.",
      POLICY_WINDOW_CLOSED:
        "Ya no se permite este cambio según las condiciones del negocio.",
      PUBLIC_CREATION_UNSUPPORTED:
        "El negocio todavía no tiene habilitada esta modalidad de confirmación.",
      TIME_NOT_ALLOWED: "Ese horario ya no está disponible.",
      VALIDATION_ERROR: "Revisá los datos ingresados.",
      IDEMPOTENCY_KEY_REUSED:
        "Esta solicitud corresponde a otros datos. Revisá antes de confirmar.",
    };
    return Response.json(
      {
        type: "about:blank",
        status: safe.status,
        code: safe.code,
        title: messages[safe.code] ?? "No pudimos completar la operación.",
        request_id: trace,
      },
      {
        status: safe.status,
        headers: { ...headers, "Content-Type": "application/problem+json" },
      },
    );
  }
}
