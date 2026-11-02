import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  parseKeyring,
  sealToken,
} from "../../src/modules/public-booking/crypto.ts";
import { publicBookingFixture } from "./public-booking-fixture.mjs";
export async function runPublicBookingHttp({
  browser,
  origin,
  sql,
  users,
  keyring,
}) {
  const f = publicBookingFixture(sql, users[0].id),
    ctx = await browser.newContext(),
    other = await browser.newContext(),
    base = `${origin}/api/v1/public/${f.slug}`,
    ring = parseKeyring(keyring);
  let cases = 0,
    checkpoint = "replay";
  async function call(c, p, body, headers = {}) {
    const r = await c.request.fetch(base + p, {
      method: body === undefined ? "GET" : "POST",
      headers: { Origin: origin, "X-Merivo-Public": "1", ...headers },
      ...(body === undefined ? {} : { data: body }),
    });
    return {
      status: r.status(),
      data: await r.json(),
    };
  }
  const preview = async () => {
    const r = await call(
      ctx,
      `/availability?staff_id=${f.staff}&service_id=${f.service}&from=${f.day}`,
    );
    assert.equal(r.status, 200);
    return r.data.quote_id;
  };
  async function attempt() {
    const id = randomUUID();
    assert.equal((await call(ctx, "/attempts", { id })).status, 201);
    return id;
  }
  async function command(c, action, id, p, body, key = randomUUID(), match) {
    const proof = await call(c, "/challenge", {
      purpose: action,
      resource: id,
    });
    assert.equal(proof.status, 200);
    return call(c, p, body, {
      "Idempotency-Key": key,
      "X-Merivo-Challenge": proof.data.challenge,
      ...(match ? { "If-Match": match } : {}),
    });
  }
  const body = (a, id, q, h = "09") => ({
    id,
    attempt_id: a,
    staff_id: f.staff,
    service_id: f.service,
    starts_at: `${f.day}T${h}:00:00-03:00`,
    quote_id: q,
    customer: { full_name: "HTTP fixture", phone_raw: "1144445555" },
    privacy_policy_version: "test-notice-v1",
  });
  try {
    let a = await attempt(),
      q = await preview();
    const id = randomUUID(),
      key = randomUUID(),
      input = body(a, id, q);
    const created = await command(
      ctx,
      "create",
      id,
      "/appointments",
      input,
      key,
    );
    assert.equal(
      created.status,
      201,
      `Public create returned ${created.status}/${created.data.code ?? "no-code"}; persisted=${sql(`select count(*) from public.appointments where id='${id}'`)}`,
    );
    const link = created.data.manage_url,
      token = new URL(link, origin).hash.slice(3);
    const replay = await command(
      ctx,
      "create",
      id,
      "/appointments",
      input,
      key,
    );
    assert.equal(replay.status, 201);
    assert.ok(
      replay.data.manage_url === link,
      "Replay preserves capability without printing its value",
    );
    assert.equal(
      (
        await command(
          ctx,
          "create",
          id,
          "/appointments",
          {
            ...input,
            customer: { ...input.customer, full_name: "Different intention" },
          },
          key,
        )
      ).status,
      409,
    );
    assert.equal(
      (await command(other, "create", id, "/appointments", input, key)).status,
      404,
    );
    cases += 3;
    assert.equal(
      (await call(ctx, `/manage/${id}/exchange`, { token })).status,
      200,
    );
    assert.equal((await call(other, `/manage/${id}`)).status, 404);
    assert.equal(
      (await command(ctx, "cancel", id, `/manage/${id}/cancel`, {})).status,
      428,
    );
    assert.equal(
      (
        await command(
          ctx,
          "cancel",
          id,
          `/manage/${id}/cancel`,
          {},
          randomUUID(),
          '"99"',
        )
      ).status,
      412,
    );
    cases += 3;
    checkpoint = "ciphertext/key/capability tampering";
    sql(
      `update app.public_manage_tokens set envelope=jsonb_set(envelope,'{key_id}','"unknown"') where appointment_id='${id}'`,
    );
    const unavailable = await command(
      ctx,
      "create",
      id,
      "/appointments",
      input,
      key,
    );
    assert.equal(unavailable.status, 503);
    assert.ok(!JSON.stringify(unavailable.data).includes(token));
    cases++;
    const expires = new Date(
        Date.parse(input.starts_at) + 86400000,
      ).toISOString(),
      correct = sealToken(ring, token, {
        business_id: f.b,
        appointment_id: id,
        generation: 1,
        expires_at: expires,
      });
    sql(
      `update app.public_manage_tokens set envelope='${JSON.stringify(correct)}',expires_at=expires_at+interval '1 hour' where appointment_id='${id}'`,
    );
    assert.equal(
      (await command(ctx, "create", id, "/appointments", input, key)).status,
      503,
    );
    cases++;
    sql(
      `update app.public_manage_tokens set expires_at='${expires}' where appointment_id='${id}'`,
    );
    assert.equal(
      (await command(ctx, "create", id, "/appointments", input, key)).status,
      201,
    );
    sql(
      `update app.public_attempts set expires_at=clock_timestamp()-interval '1 second' where id='${a}'`,
    );
    assert.equal(
      (await command(ctx, "create", id, "/appointments", input, key)).status,
      404,
    );
    cases++;
    sql(
      `update app.public_manage_tokens set expires_at=clock_timestamp()-interval '1 second' where appointment_id='${id}'`,
    );
    assert.equal((await call(ctx, `/manage/${id}`)).status, 404);
    cases++;
    const next = randomBytes(32).toString("base64url"),
      envelope = sealToken(ring, next, {
        business_id: f.b,
        appointment_id: id,
        generation: 2,
        expires_at: expires,
      });
    sql(
      `select app.rotate_public_capability('${f.b}','${id}','${next}','${expires}','${JSON.stringify(envelope)}');`,
    );
    assert.equal(
      (await call(ctx, `/manage/${id}/exchange`, { token })).status,
      404,
    );
    assert.equal(
      (await call(ctx, `/manage/${id}/exchange`, { token: next })).status,
      200,
    );
    cases++;
    sql(
      `update app.public_manage_tokens set revoked_at=clock_timestamp() where appointment_id='${id}' and generation=2`,
    );
    assert.equal((await call(ctx, `/manage/${id}`)).status, 404);
    cases++;
    checkpoint = "cookie and policies";
    a = await attempt();
    q = await preview();
    const blocked = randomUUID();
    sql(
      `update app.public_attempts set revoked_at=clock_timestamp() where id='${a}'`,
    );
    assert.equal(
      (
        await command(
          ctx,
          "create",
          blocked,
          "/appointments",
          body(a, blocked, q, "10"),
        )
      ).status,
      404,
    );
    cases++;
    a = await attempt();
    q = await preview();
    const policy = randomUUID();
    sql(
      `update public.business_settings set auto_confirm=false where business_id='${f.b}'`,
    );
    assert.equal(
      (
        await command(
          ctx,
          "create",
          policy,
          "/appointments",
          body(a, policy, q, "10"),
        )
      ).data.code,
      "PUBLIC_CREATION_UNSUPPORTED",
    );
    sql(
      `update public.business_settings set auto_confirm=true where business_id='${f.b}'`,
    );
    cases++;
    checkpoint = "nine independent rollback stages";
    const counts = () =>
      sql(
        `select jsonb_build_array((select count(*) from public.customers where business_id='${f.b}'),(select count(*) from public.appointments where business_id='${f.b}'),(select count(*) from app.appointment_occupancy where business_id='${f.b}'),(select count(*) from public.appointment_events where business_id='${f.b}'),(select count(*) from app.appointment_outbox where business_id='${f.b}'),(select count(*) from public.audit_logs where business_id='${f.b}'),(select count(*) from app.public_booking_requests where business_id='${f.b}'),(select count(*) from app.public_manage_tokens where business_id='${f.b}'),(select count(*) from app.public_privacy_ack where business_id='${f.b}'))::text;`,
      );
    sql(
      "create function app.public_fixture_failure() returns trigger language plpgsql set search_path='' as $$begin raise exception 'INJECTED_PRIVATE_FAILURE' using errcode='23514';end;$$;",
    );
    for (const table of [
      "public.customers",
      "public.appointments",
      "app.appointment_occupancy",
      "public.appointment_events",
      "public.audit_logs",
      "app.appointment_outbox",
      "app.public_booking_requests",
      "app.public_manage_tokens",
      "app.public_privacy_ack",
    ]) {
      // Privileged fixture cleanup only; the separate quota test never resets its counters.
      sql(
        "delete from app.public_rate_buckets where scope in ('issue','write');",
      );
      const failAttempt = await attempt(),
        failQuote = await preview(),
        failId = randomUUID(),
        before = counts();
      sql(
        `create trigger public_fixture_failure before insert on ${table} for each row execute function app.public_fixture_failure();`,
      );
      try {
        const r = await command(
          ctx,
          "create",
          failId,
          "/appointments",
          body(failAttempt, failId, failQuote, "14"),
        );
        assert.equal(r.status, 503);
        assert.ok(!JSON.stringify(r.data).includes("INJECTED_PRIVATE_FAILURE"));
        assert.equal(
          counts(),
          before,
          "All nine business aggregates must roll back",
        );
        cases++;
      } finally {
        sql(`drop trigger public_fixture_failure on ${table};`);
      }
    }
    sql("drop function app.public_fixture_failure();");
    console.log(
      `Public booking HTTP PASS: ${cases} scenarios: authority/replay, If-Match, unknown key/AAD, retained-key recovery, cookie/token expiry/revocation/rotation, auto_confirm and nine injected rollbacks.`,
    );
  } catch (error) {
    throw Error(`Public HTTP ${checkpoint}: ${error.message.split("\n")[0]}`);
  } finally {
    await ctx.close();
    await other.close();
  }
}
