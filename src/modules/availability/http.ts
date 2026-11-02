import { z } from "zod";
import { getRequestId } from "@/lib/http/request-id";
import { isSameOrigin } from "@/lib/http/origin";
import { readJsonBody } from "@/lib/http/body";
import { rpc, sessionClient, AccessError } from "@/modules/auth/service";
import {
  planInput,
  exceptionInput,
  blockInput,
  scheduleSchema,
  previewSource,
  localDate,
} from "./schemas";
import { computeSlots } from "./compute";
import { scheduleMessage } from "./service";
export async function handleScheduleRequest(
  request: Request,
  params: {
    businessId: string;
    staffId?: string;
    kind: "schedule" | "plan" | "exception" | "block" | "preview" | "control";
  },
) {
  const trace = getRequestId(request.headers.get("x-request-id")),
    headers = { "Cache-Control": "private, no-store", "X-Request-Id": trace };
  try {
    const raw = request.headers.get("authorization"),
      bearer = raw
        ? z
            .string()
            .regex(/^Bearer [A-Za-z0-9._-]+$/)
            .parse(raw)
            .slice(7)
        : undefined;
    if (request.method !== "GET" && !bearer && !isSameOrigin(request))
      throw new AccessError("FORBIDDEN", 403);
    const client = await sessionClient(bearer, trace),
      businessId = z.uuid().parse(params.businessId),
      staffId = params.staffId ? z.uuid().parse(params.staffId) : null;
    const call = (name: string, args: Record<string, unknown>) =>
      rpc(name, { p_business_id: businessId, ...args }, bearer, client, trace);
    if (request.method === "GET") {
      if (params.kind === "control")
        return Response.json(await call("read_calendar_control", {}), {
          headers,
        });
      if (params.kind === "schedule") {
        const data = scheduleSchema.parse(
          await call("read_schedule", { p_staff_id: staffId }),
        );
        return Response.json(data, {
          headers: { ...headers, ETag: `"${data.staff_version}"` },
        });
      }
      const query = z
        .object({
          staff_id: z.uuid(),
          service_id: z.uuid(),
          from: localDate,
          days: z.coerce.number().int().min(1).max(7).default(1),
        })
        .strict()
        .parse(Object.fromEntries(new URL(request.url).searchParams));
      const data = previewSource.parse(
        await call("schedule_preview_source", {
          p_staff_id: query.staff_id,
          p_service_id: query.service_id,
          p_from: query.from,
          p_days: query.days,
        }),
      );
      return Response.json(
        {
          mode: data.mode,
          can_book: false,
          occupancy_checked: data.occupancy_checked,
          settings_version: data.settings_version,
          business_version: data.business_version,
          timezone: data.timezone,
          staff_version: data.staff_version,
          service_version: data.service_version,
          global_version: data.global_version,
          price_cents: data.price_cents,
          duration_minutes: data.duration_minutes,
          buffer_minutes: data.buffer_minutes,
          days: data.days.map((d) => ({ date: d.date, warning: d.warning })),
          slots: computeSlots(data),
        },
        { headers },
      );
    }
    const envelope = z
      .object({
        id: z.uuidv4(),
        action: z.enum(["save", "archive"]).default("save"),
        data: z.unknown(),
      })
      .strict()
      .parse(await readJsonBody(request));
    const key = z.uuid().parse(request.headers.get("idempotency-key")),
      match = request.headers.get("if-match");
    const expected =
      match === null
        ? null
        : z
            .number()
            .int()
            .min(1)
            .max(2147483647)
            .parse(
              Number(
                z
                  .string()
                  .regex(/^"[1-9][0-9]*"$/)
                  .parse(match)
                  .slice(1, -1),
              ),
            );
    const data =
      envelope.action === "archive"
        ? z.object({}).strict().parse(envelope.data)
        : (params.kind === "plan"
            ? planInput
            : params.kind === "exception"
              ? exceptionInput
              : blockInput
          ).parse(envelope.data);
    const result = z
      .object({
        id: z.uuid(),
        staff_id: z.uuid().nullable(),
        version: z.number().int().positive(),
        kind: z.string(),
        action: z.string(),
      })
      .strict()
      .parse(
        await call("write_schedule", {
          p_staff_id: staffId,
          p_kind: params.kind,
          p_id: envelope.id,
          p_action: envelope.action,
          p_data: data,
          p_key: key,
          p_expected: expected,
        }),
      );
    return Response.json(result, {
      headers: { ...headers, ETag: `"${result.version}"` },
    });
  } catch (error) {
    const safe =
      error instanceof AccessError
        ? error
        : error instanceof z.ZodError ||
            error instanceof SyntaxError ||
            error instanceof RangeError
          ? new AccessError("VALIDATION_ERROR", 400)
          : new AccessError("UNAVAILABLE", 503);
    return Response.json(
      {
        type: "about:blank",
        status: safe.status,
        code: safe.code,
        title: scheduleMessage(safe),
        request_id: trace,
        ...(safe.conflicts ? { conflicts: safe.conflicts } : {}),
      },
      {
        status: safe.status,
        headers: { ...headers, "Content-Type": "application/problem+json" },
      },
    );
  }
}
