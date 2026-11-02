import "server-only";
import postgres from "postgres";
import { parseAppServerDatabaseUrl } from "./config";

let connection: ReturnType<typeof postgres> | undefined;

export function getAppServerDatabase() {
  const url = parseAppServerDatabaseUrl(
    process.env.DATABASE_URL_APP_SERVER,
    process.env.SUPABASE_PROJECT_REF,
  );
  if (!url) return null;
  if (!connection) {
    const hostname = new URL(url).hostname;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    connection = postgres(url, {
      max: 2,
      prepare: false,
      connect_timeout: 5,
      idle_timeout: 20,
      max_lifetime: 60 * 10,
      ssl: local ? false : { rejectUnauthorized: true },
      onnotice: () => {},
    });
  }
  return connection;
}
