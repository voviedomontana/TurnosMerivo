import assert from "node:assert/strict";

export async function runDataApiContract({ prefix, rest, users, call }) {
  assert.ok(prefix.startsWith("merivo-s2-check-"));
  assert.equal(new URL(rest).hostname, "127.0.0.1");
  let passed = 0;
  for (const schema of [
    "app",
    "app_internal",
    "auth",
    "storage",
    "extensions",
    "graphql_public",
  ]) {
    for (const method of ["GET", "POST"]) {
      const response = await call(
        rest,
        "/rpc/me",
        method === "POST" ? {} : undefined,
        users[0].token,
        method,
        undefined,
        { [method === "GET" ? "Accept-Profile" : "Content-Profile"]: schema },
      );
      assert.equal(
        response.status,
        406,
        "Unexposed schema must be rejected before RPC execution",
      );
      assert.equal(
        response.data?.code,
        "PGRST106",
        "Explicit schema rejection expected",
      );
      passed++;
    }
  }
  const session = await call(
    rest,
    "/rpc/me",
    {},
    users[0].token,
    "POST",
    undefined,
    { "Content-Profile": "api" },
  );
  assert.equal(
    session.status,
    200,
    "Authenticated API profile must remain available",
  );
  assert.equal(
    session.data.memberships.length,
    1,
    "Selector must retain the fixture membership",
  );
  passed++;
  const anonymous = await call(
    rest,
    "/rpc/me",
    {},
    undefined,
    "POST",
    undefined,
    { "Content-Profile": "api" },
  );
  assert.equal(
    anonymous.status,
    401,
    "Schema exposure must not grant anonymous session RPC execution",
  );
  passed++;
  const privateTable = await call(
    rest,
    "/business_settings?select=business_id&limit=1",
    undefined,
    users[0].token,
    "GET",
    "public",
  );
  assert.equal(
    privateTable.status,
    403,
    "Public schema exposure must retain A-08 table denial",
  );
  passed++;
  const privateRpc = await call(
    rest,
    "/rpc/public_staging_ready",
    { p_origin: "https://staging.example.test" },
    users[0].token,
    "POST",
    undefined,
    { "Content-Profile": "public" },
  );
  assert.equal(
    privateRpc.status,
    404,
    "Internal backend capability must have no public RPC alias",
  );
  assert.equal(
    privateRpc.data?.code,
    "PGRST202",
    "Private RPC must be absent from the public schema",
  );
  passed++;
  console.log(
    `Data API contract PASS: ${passed} real HTTP checks; public/api compatibility, anonymous denial, private table/RPC denial and six unexposed schemas for both profile headers. Disposable services only.`,
  );
  return passed;
}
