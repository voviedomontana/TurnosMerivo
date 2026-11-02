import { problem } from "@/lib/http/problem";
import {
  resolvePublicCatalog,
  type PublicCatalogReader,
} from "./public-catalog";
export async function getPublicCatalogResponse(
  slug: string,
  read: PublicCatalogReader,
) {
  const trace = crypto.randomUUID();
  try {
    const catalog = await resolvePublicCatalog(slug, read);
    if (!catalog) return problem(404, trace);
    return Response.json(catalog, {
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": trace,
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return problem(503, trace);
  }
}
