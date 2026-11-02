import { problem } from "@/lib/http/problem";
import { resolvePublicBusiness } from "./service";
import type { PublicBusinessReader } from "./types";

export async function getPublicBusinessResponse(
  slug: string,
  read: PublicBusinessReader,
) {
  const requestId = crypto.randomUUID();
  try {
    const resolved = await resolvePublicBusiness(slug, read);
    if (!resolved) return problem(404, requestId);
    return Response.json(resolved.business, {
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch {
    // Never serialize database errors or connection strings into the public response.
    return problem(503, requestId);
  }
}
