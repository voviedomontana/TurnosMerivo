import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  const config = getSupabaseConfig();
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  if (!config || request.headers.has("authorization")) return response;
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        response.headers.set("Cache-Control", "private, no-store");
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  try {
    await supabase.auth.getUser();
  } catch {
    /* Protected handlers still fail closed if Auth is unavailable. */
  }
  return response;
}
export const config = {
  matcher: [
    "/app/:path*",
    "/login",
    "/seguridad",
    "/invitaciones",
    "/auth/:path*",
    "/api/v1/me",
    "/api/v1/businesses/:path*",
    "/api/v1/invitations/:path*",
  ],
};
