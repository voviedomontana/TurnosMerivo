export function parseAppServerDatabaseUrl(
  value?: string,
  projectRef?: string,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const username = decodeURIComponent(url.username);
    const pooled = Boolean(
      projectRef &&
      /^[a-z]{20}$/.test(projectRef) &&
      username === `app_server.${projectRef}` &&
      /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
      ["5432", "6543"].includes(url.port) &&
      url.pathname === "/postgres",
    );
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      (username !== "app_server" && !pooled) ||
      !url.password ||
      !url.hostname ||
      url.pathname === "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("Invalid configuration");
    }
    return value;
  } catch {
    throw new Error(
      "Invalid DATABASE_URL_APP_SERVER. Use the restricted app_server connection described in the README.",
    );
  }
}
