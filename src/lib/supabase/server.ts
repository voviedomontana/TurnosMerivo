import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";
import { getRequestId } from "@/lib/http/request-id";

export async function createServerSupabaseClient(
  bearer?: string,
  requestId?: string,
) {
  const config = getSupabaseConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    global: {
      headers: {
        "X-Request-Id": getRequestId(requestId),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    },
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll: () => (bearer ? [] : store.getAll()),
      setAll: (values) => {
        if (bearer) return;
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          /* Server Components cannot write cookies; the proxy refreshes them. */
        }
      },
    },
  });
}
