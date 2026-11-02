import { z } from "zod";
import { readJsonBody } from "@/lib/http/body";
import { isSameOrigin } from "@/lib/http/origin";
import { getRequestId } from "@/lib/http/request-id";
import {
  AccessError,
  accessMessages,
  getMe,
  listMembers,
  listMembersPage,
  rpc,
  sessionClient,
} from "./service";
import { acceptSchema, inviteSchema, updateMemberSchema } from "./schemas";

type Operation = "me" | "list" | "invite" | "update" | "accept";
export async function handleAuthRequest(
  request: Request,
  operation: Operation,
  ids: { businessId?: string; memberId?: string } = {},
) {
  const requestId = getRequestId(request.headers.get("x-request-id"));
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Request-Id": requestId,
  };
  try {
    const authorization = request.headers.get("authorization");
    const bearer = authorization
      ? z
          .string()
          .regex(/^Bearer [A-Za-z0-9._-]+$/)
          .parse(authorization)
          .slice(7)
      : undefined;
    const mutation = !["me", "list"].includes(operation);
    if (mutation && !bearer) {
      if (!isSameOrigin(request)) throw new AccessError("FORBIDDEN", 403);
    }
    if (ids.businessId) z.uuid().parse(ids.businessId);
    if (ids.memberId) z.uuid().parse(ids.memberId);
    if (operation === "me")
      return Response.json(await getMe(bearer, requestId), { headers });
    if (operation === "list") {
      const query = new URL(request.url).searchParams;
      if (query.has("limit") || query.has("cursor")) {
        return Response.json(
          await listMembersPage(
            ids.businessId!,
            {
              limit: query.has("limit")
                ? query.getAll("limit").length === 1
                  ? query.get("limit")
                  : []
                : undefined,
              cursor: query.has("cursor")
                ? query.getAll("cursor").length === 1
                  ? query.get("cursor")
                  : []
                : undefined,
            },
            bearer,
            requestId,
          ),
          { headers },
        );
      }
      return Response.json(
        {
          data: await listMembers(ids.businessId!, bearer, requestId),
          page: { next_cursor: null, has_more: false },
        },
        { headers },
      );
    }
    const client = await sessionClient(bearer, requestId);
    const key = z.uuid().parse(request.headers.get("idempotency-key"));
    const input = await readJsonBody(request);
    let result: unknown;
    if (operation === "invite") {
      const value = inviteSchema.parse(input);
      result = await rpc(
        "invite_member",
        {
          p_business_id: ids.businessId,
          p_email: value.email,
          p_role: value.role,
          p_token: value.token,
          p_key: key,
        },
        bearer,
        client,
      );
    } else if (operation === "update") {
      const match = request.headers.get("if-match");
      const version =
        match === null
          ? null
          : z
              .string()
              .regex(/^"[1-9][0-9]*"$/)
              .parse(match)
              .slice(1, -1);
      const value = updateMemberSchema.parse(input);
      result = await rpc(
        "update_member",
        {
          p_business_id: ids.businessId,
          p_member_id: ids.memberId,
          p_role: value.role,
          p_status: value.status,
          p_key: key,
          p_expected: version === null ? null : Number(version),
        },
        bearer,
        client,
      );
    } else {
      const value = acceptSchema.parse(input);
      result = await rpc(
        "accept_invitation",
        { p_token: value.token, p_key: key },
        bearer,
        client,
      );
    }
    const version = z
      .object({ version: z.number().int() })
      .parse(result).version;
    return Response.json(result, {
      status: operation === "invite" ? 201 : 200,
      headers: { ...headers, ETag: `"${version}"` },
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
        title:
          accessMessages[safe.code] ?? "No pudimos completar la operación.",
        status: safe.status,
        code: safe.code,
        request_id: requestId,
      },
      {
        status: safe.status,
        headers: { ...headers, "Content-Type": "application/problem+json" },
      },
    );
  }
}
