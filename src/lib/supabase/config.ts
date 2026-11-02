import { z } from "zod";

const configSchema = z.object({
  url: z.url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    );
  }),
  publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/),
});

export function parseSupabaseConfig(url?: string, publishableKey?: string) {
  if (!url && !publishableKey) return null;
  const result = configSchema.safeParse({ url, publishableKey });
  if (!result.success) {
    throw new Error(
      "Invalid Supabase configuration. Set both public variables as described in .env.example.",
    );
  }
  return result.data;
}

export function getSupabaseConfig() {
  return parseSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
