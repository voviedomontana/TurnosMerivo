import "server-only";
import { getAppServerDatabase } from "@/lib/database/server";
import { z } from "zod";
export class PublicBookingError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
const known = new Set([
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "PRECONDITION_FAILED",
  "PRECONDITION_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "SLOT_TAKEN",
  "TIME_NOT_ALLOWED",
  "DUPLICATE_RESOURCE",
  "ATTEMPT_ALREADY_USED",
  "APPOINTMENT_STATE_CONFLICT",
  "RESOURCE_STATE_CONFLICT",
  "POLICY_WINDOW_CLOSED",
  "PUBLIC_BOOKING_DISABLED",
  "PUBLIC_CREATION_UNSUPPORTED",
  "PRIVACY_NOTICE_UNAVAILABLE",
]);
export async function publicQuery(
  statement: string,
  values: (string | number | null)[],
  trace: string,
): Promise<unknown> {
  const sql = getAppServerDatabase();
  if (!sql) throw new PublicBookingError("UNAVAILABLE", 503);
  try {
    return await sql.begin(async (tx) => {
      await tx`select set_config('request.headers',${JSON.stringify({ "x-request-id": trace })},true)`;
      // postgres.js must receive a JSON parameter, not a pre-serialized text value
      // that its jsonb serializer would encode a second time.
      const parameters = values.map((value, index) =>
        typeof value === "string" && statement.includes(`$${index + 1}::jsonb`)
          ? tx.json(z.json().parse(JSON.parse(value)))
          : value,
      );
      const rows = await tx.unsafe<{ value: unknown }[]>(statement, parameters);
      return rows[0]?.value;
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "message" in error
    ) {
      const status = /^PT(400|403|404|409|412|428|429|503)$/.exec(
        String(error.code),
      );
      if (status && known.has(String(error.message)))
        throw new PublicBookingError(String(error.message), Number(status[1]));
    }
    throw new PublicBookingError("UNAVAILABLE", 503);
  }
}
