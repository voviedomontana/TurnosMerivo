import { z } from "zod";
import { rpc, sessionClient, AccessError } from "@/modules/auth/service";
import { getRequestId } from "@/lib/http/request-id";
import { isSameOrigin } from "@/lib/http/origin";
import { readJsonBody } from "@/lib/http/body";
import {
  customerInput,
  customerDetail,
  customerPage,
  pageInput,
} from "./schemas";
import { customerMessage } from "./service";
export async function handleCustomerRequest(
  request: Request,
  params: { businessId: string; resourceId?: string; action?: string },
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
      businessId = z.uuid().parse(params.businessId);
    if (
      (params.action === "search" && !params.resourceId) ||
      (request.method === "GET" && !params.resourceId)
    ) {
      const query = new URL(request.url).searchParams;
      const input = pageInput.parse(
        params.action === "search"
          ? await readJsonBody(request)
          : Object.fromEntries(query.entries()),
      );
      if (
        request.method === "GET" &&
        (input.value !== null || query.has("field") || query.has("mode"))
      )
        throw new AccessError("VALIDATION_ERROR", 400);
      const result = customerPage.parse(
        await rpc(
          "list_customers_page",
          {
            p_business_id: businessId,
            p_state: input.state,
            p_field: input.field,
            p_value: input.value,
            p_mode: input.mode,
            p_limit: input.limit,
            p_cursor: input.cursor,
          },
          bearer,
          client,
          trace,
        ),
      );
      return Response.json(result, { headers });
    }
    if (request.method === "GET") {
      const result = customerDetail.parse(
        await rpc(
          "read_customer",
          {
            p_business_id: businessId,
            p_id: z.uuid().parse(params.resourceId),
          },
          bearer,
          client,
          trace,
        ),
      );
      return Response.json(result, {
        headers: { ...headers, ETag: `"${result.version}"` },
      });
    }
    const key = z.uuid().parse(request.headers.get("idempotency-key")),
      input = await readJsonBody(request);
    let id: string,
      action: string,
      data: unknown,
      expected: number | null = null;
    if (!params.resourceId) {
      if (request.headers.has("if-match"))
        throw new AccessError("VALIDATION_ERROR", 400);
      const envelope = z
        .object({ id: z.uuidv4(), data: customerInput })
        .strict()
        .parse(input);
      id = envelope.id;
      data = envelope.data;
      action = "create";
    } else {
      id = z.uuidv4().parse(params.resourceId);
      const match = request.headers.get("if-match");
      if (match !== null) {
        const value = z
          .string()
          .regex(/^"[1-9][0-9]*"$/)
          .parse(match);
        expected = z
          .number()
          .int()
          .min(1)
          .max(2147483647)
          .parse(Number(value.slice(1, -1)));
      }
      action = params.action
        ? z.enum(["archive", "restore"]).parse(params.action)
        : "update";
      data =
        action === "update"
          ? customerInput.parse(input)
          : z.object({}).strict().parse(input);
    }
    const result = z
      .object({
        id: z.uuid(),
        business_id: z.uuid(),
        version: z.number().int().positive(),
        deleted_at: z.string().nullable(),
      })
      .strict()
      .parse(
        await rpc(
          "write_customer",
          {
            p_business_id: businessId,
            p_id: id,
            p_action: action,
            p_data: data,
            p_key: key,
            p_expected: expected,
          },
          bearer,
          client,
          trace,
        ),
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
        title: customerMessage(safe),
        request_id: trace,
      },
      {
        status: safe.status,
        headers: { ...headers, "Content-Type": "application/problem+json" },
      },
    );
  }
}
