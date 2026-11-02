import { z } from "zod";
import { getRequestId } from "@/lib/http/request-id";
import { isSameOrigin } from "@/lib/http/origin";
import { readJsonBody } from "@/lib/http/body";
import { AccessError, rpc, sessionClient } from "@/modules/auth/service";
import { staffInput } from "@/modules/staff/schemas";
import { serviceInput } from "./schemas";
import { catalogMessage, readCatalog } from "./catalog";
export async function handleCatalogRequest(
  request: Request,
  params: { businessId: string; kind?: string; resourceId?: string },
) {
  const trace = getRequestId(request.headers.get("x-request-id")),
    headers = { "Cache-Control": "private, no-store", "X-Request-Id": trace };
  try {
    const raw = request.headers.get("authorization");
    const bearer = raw
      ? z
          .string()
          .regex(/^Bearer [A-Za-z0-9._-]+$/)
          .parse(raw)
          .slice(7)
      : undefined;
    if (request.method !== "GET" && !bearer && !isSameOrigin(request))
      throw new AccessError("FORBIDDEN", 403);
    const businessId = z.uuid().parse(params.businessId);
    if (request.method === "GET") {
      const archived = new URL(request.url).searchParams.get(
        "include_archived",
      );
      if (archived !== null && !["true", "false"].includes(archived))
        throw new AccessError("VALIDATION_ERROR", 400);
      return Response.json(
        await readCatalog(businessId, archived === "true", bearer, trace),
        { headers },
      );
    }
    const client = await sessionClient(bearer, trace);
    const kind = z.enum(["staff", "service"]).parse(params.kind),
      key = z.uuid().parse(request.headers.get("idempotency-key"));
    const input = await readJsonBody(request);
    let action: "create" | "update" | "archive" | "restore",
      id: string,
      data: unknown,
      expected: number | null = null;
    if (request.method === "POST" && !params.resourceId) {
      const envelope = z
        .object({ id: z.uuid(), data: z.unknown() })
        .strict()
        .parse(input);
      id = envelope.id;
      action = "create";
      data = (kind === "staff" ? staffInput : serviceInput).parse(
        envelope.data,
      );
    } else {
      id = z.uuid().parse(params.resourceId);
      const match = request.headers.get("if-match");
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
      if (request.method === "PUT") {
        action = "update";
        data = (kind === "staff" ? staffInput : serviceInput).parse(input);
      } else {
        const state = z
          .object({ action: z.enum(["archive", "restore"]) })
          .strict()
          .parse(input);
        action = state.action;
        data = {};
      }
    }
    const result = z
      .object({ id: z.uuid(), version: z.number().int().positive() })
      .passthrough()
      .parse(
        await rpc(
          "write_catalog",
          {
            p_business_id: businessId,
            p_kind: kind,
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
        title: catalogMessage(safe),
        request_id: trace,
      },
      {
        status: safe.status,
        headers: { ...headers, "Content-Type": "application/problem+json" },
      },
    );
  }
}
