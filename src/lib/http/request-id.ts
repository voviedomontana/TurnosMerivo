const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Correlation metadata only; never an identity, permission or idempotency key.
export function getRequestId(value?: string | null): string {
  return value && uuid.test(value) ? value.toLowerCase() : crypto.randomUUID();
}
