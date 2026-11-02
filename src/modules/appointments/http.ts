import { z } from "zod";
import { rpc, sessionClient, AccessError } from "@/modules/auth/service";
import { getRequestId } from "@/lib/http/request-id";
import { isSameOrigin } from "@/lib/http/origin";
import { readJsonBody } from "@/lib/http/body";
import {
  createAppointmentInput,
  rescheduleInput,
  cancelInput,
  appointmentPage,
  appointmentDetail,
} from "./schemas";
import { appointmentMessage } from "./service";
import { previewSource, localDate } from "@/modules/availability/schemas";
import { computeSlots } from "@/modules/availability/compute";
export async function handleAppointmentRequest(
  request: Request,
  params: { businessId: string; appointmentId?: string; action?: string },
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
      id = params.appointmentId
        ? z.uuid().parse(params.appointmentId)
        : undefined;
    const call = (name: string, args: Record<string, unknown>) =>
      rpc(name, { p_business_id: businessId, ...args }, bearer, client, trace);
    if (request.method === "GET") {
      const query = Object.fromEntries(new URL(request.url).searchParams);
      if (params.action && params.action !== "availability")
        throw new AccessError("VALIDATION_ERROR", 400);
      if (params.action === "availability") {
        const input = z
          .object({
            from: localDate,
            days: z.coerce.number().int().min(1).max(7).default(1),
          })
          .strict()
          .parse(query);
        const data = previewSource.parse(
          await call("appointment_preview_source", {
            p_id: id,
            p_from: input.from,
            p_days: input.days,
          }),
        );
        return Response.json(
          {
            mode: data.mode,
            can_book: false,
            occupancy_checked: data.occupancy_checked,
            timezone: data.timezone,
            staff_version: data.staff_version,
            service_version: data.service_version,
            global_version: data.global_version,
            settings_version: data.settings_version,
            business_version: data.business_version,
            price_cents: data.price_cents,
            duration_minutes: data.duration_minutes,
            buffer_minutes: data.buffer_minutes,
            days: data.days.map((d) => ({ date: d.date, warning: d.warning })),
            slots: computeSlots(data),
          },
          { headers },
        );
      }
      if (id) {
        const data = appointmentDetail.parse(
          await call("read_appointment", { p_id: id }),
        );
        return Response.json(data, {
          headers: { ...headers, ETag: `"${data.version}"` },
        });
      }
      const input = z
        .object({
          from: localDate.optional(),
          days: z.coerce.number().int().min(1).max(7).default(1),
          staff_id: z.uuid().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          cursor: z
            .string()
            .min(1)
            .max(1024)
            .regex(/^[A-Za-z0-9_-]+$/)
            .optional(),
        })
        .strict()
        .parse(query);
      return Response.json(
        appointmentPage.parse(
          await call("list_appointments_page", {
            p_from: input.from ?? null,
            p_days: input.days,
            p_staff_id: input.staff_id ?? null,
            p_limit: input.limit,
            p_cursor: input.cursor ?? null,
          }),
        ),
        { headers },
      );
    }
    const key = z.uuid().parse(request.headers.get("idempotency-key")),
      input = await readJsonBody(request);
    let data: unknown,
      action: string,
      appointmentId: string,
      expected: number | null = null;
    if (!id) {
      if (request.headers.has("if-match"))
        throw new AccessError("VALIDATION_ERROR", 400);
      const value = createAppointmentInput.parse(input);
      appointmentId = value.id;
      const { id: unused, ...body } = value;
      void unused;
      data = body;
      action = "create";
    } else {
      appointmentId = id;
      action = z.enum(["reschedule", "cancel"]).parse(params.action);
      const match = request.headers.get("if-match");
      if (match !== null)
        expected = z
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
      data = (action === "reschedule" ? rescheduleInput : cancelInput).parse(
        input,
      );
    }
    const result = z
      .object({
        id: z.uuid(),
        business_id: z.uuid(),
        status: z.enum(["confirmed", "cancelled"]),
        version: z.number().int().positive(),
        starts_at: z.string(),
        ends_at: z.string(),
        blocked_until: z.string(),
      })
      .strict()
      .parse(
        await call("manage_appointment", {
          p_action: action,
          p_id: appointmentId,
          p_data: data,
          p_key: key,
          p_expected: expected,
        }),
      );
    return Response.json(result, {
      status: action === "create" ? 201 : 200,
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
        title: appointmentMessage(safe),
        request_id: trace,
      },
      {
        status: safe.status,
        headers: { ...headers, "Content-Type": "application/problem+json" },
      },
    );
  }
}
