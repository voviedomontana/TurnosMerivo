import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export function verifyAm04LegacyMigration(sql, migration) {
  const user = randomUUID(),
    business = randomUUID(),
    key = randomUUID();
  sql(`begin;
    insert into auth.users(id,email,email_confirmed_at) values('${user}','legacy-${user}@example.test',now());
    insert into public.businesses(id,slug,name) values('${business}','legacy-${business.slice(0, 20)}','Legacy fixture');
    insert into app.member_requests(business_id,user_id,operation,key,request_hash,result,created_at)
      values('${business}','${user}','legacy','${key}',extensions.digest('legacy','sha256'),'{"version":1,"legacy":true}','2026-10-01T00:00:00Z');
    insert into public.audit_logs(business_id,actor_type,actor_user_id,action,entity_type,request_id)
      values('${business}','user','${user}','legacy','business_member','${key}');
    ${migration}
    do $$ begin
      if not exists(select 1 from app.member_requests where key='${key}' and origin_request_id is null
        and result='{"version":1,"legacy":true}'::jsonb and created_at='2026-10-01T00:00:00Z'::timestamptz) then
        raise exception 'Historical replay record was rewritten'; end if;
      if not exists(select 1 from public.audit_logs where business_id='${business}' and request_id='${key}') then
        raise exception 'Historical audit correlation was rewritten'; end if;
    end $$;
    rollback;`);
  console.log(
    "Migration PASS: historical replay/result/timestamp and audit IDs preserved; legacy origin remains NULL.",
  );
}

export async function runAm0405Integration({
  publicDatabaseUrl,
  publicFocus,
  sql,
  rest,
  auth,
  users,
  business,
  member,
  call,
  ui,
}) {
  const rpc = (name, args, user = users[1], trace) =>
    call(
      rest,
      `/rpc/${name}`,
      args,
      user.token,
      "POST",
      undefined,
      trace ? { "X-Request-Id": trace } : {},
    );
  const key = randomUUID(),
    traceA = randomUUID(),
    traceB = randomUUID();
  const intent = {
    p_business_id: business,
    p_member_id: member,
    p_role: "barber",
    p_status: "suspended",
    p_key: key,
    p_expected: 1,
  };
  const write = await rpc("update_member", intent, users[1], traceA);
  const replay = await rpc("update_member", intent, users[1], traceB);
  assert.equal(write.status, 200);
  assert.deepEqual(write.data, replay.data);
  assert.equal(
    sql(
      `select request_id from public.audit_logs where business_id='${business}' and entity_id='${member}'`,
    ),
    traceA,
  );
  assert.equal(
    sql(
      `select origin_request_id from app.member_requests where business_id='${business}' and key='${key}'`,
    ),
    traceA,
  );
  assert.equal(
    sql(
      `select count(*) from public.audit_logs where business_id='${business}' and entity_id='${member}'`,
    ),
    "1",
  );
  console.log(
    "HTTP PASS: request A audit/origin, authorized replay B without duplicate mutation.",
  );

  sql(`insert into public.business_members(business_id,invited_email,role,status,created_at)
    select '${business}','browser-page-'||n||'@example.test','barber','invited','2026-10-01T10:00:00.123456Z' from generate_series(1,210) n;
    insert into app.member_invitations(member_id,business_id,token_hash)
    select id,business_id,extensions.digest(id::text||'isolated-pagination','sha256') from public.business_members
    where business_id='${business}' and invited_email like 'browser-page-%@example.test';`);
  const legacy = await rpc("list_members", { p_business_id: business });
  assert.equal(legacy.data.length, 214);
  const first = await rpc("list_members_page", { p_business_id: business });
  assert.equal(first.data.data.length, 50);
  let cursor = null;
  const ids = [];
  let rounds = 0;
  do {
    const page = await rpc("list_members_page", {
      p_business_id: business,
      p_limit: 37,
      p_cursor: cursor,
    });
    assert.equal(page.status, 200);
    ids.push(...page.data.data.map((m) => m.id));
    cursor = page.data.page.next_cursor;
    rounds++;
    assert.ok(rounds < 10);
    assert.equal(page.data.page.has_more, Boolean(cursor));
  } while (cursor);
  assert.equal(ids.length, 214);
  assert.equal(new Set(ids).size, 214);
  assert.deepEqual(
    ids,
    legacy.data.map((m) => m.id),
  );
  const max = await rpc("list_members_page", {
    p_business_id: business,
    p_limit: 200,
  });
  assert.equal(max.data.data.length, 200);
  const invalid = [
    "",
    "!",
    "a",
    "A".repeat(1025),
    Buffer.from(
      JSON.stringify({
        v: 1,
        business_id: randomUUID(),
        id: member,
        created_at: "2026-10-01T10:00:00Z",
      }),
    ).toString("base64url"),
  ];
  for (const value of invalid)
    assert.equal(
      (
        await rpc("list_members_page", {
          p_business_id: business,
          p_cursor: value,
        })
      ).status,
      400,
    );
  assert.equal(
    (await rpc("list_members_page", { p_business_id: business, p_limit: 201 }))
      .status,
    400,
  );
  assert.equal(
    (await rpc("list_members_page", { p_business_id: business }, users[2]))
      .status,
    404,
  ); // suspended by traced write
  const adminMember = sql(
    `select id from public.business_members where business_id='${business}' and user_id='${users[1].id}'`,
  );
  const revoke = {
    p_business_id: business,
    p_member_id: adminMember,
    p_role: "admin",
    p_status: "suspended",
    p_key: randomUUID(),
    p_expected: 1,
  };
  assert.equal(
    (await rpc("update_member", revoke, users[0], randomUUID())).status,
    200,
  );
  assert.equal(
    (
      await rpc("list_members_page", {
        p_business_id: business,
        p_cursor: first.data.page.next_cursor,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await rpc(
        "update_member",
        { ...revoke, p_status: "active", p_expected: 2, p_key: randomUUID() },
        users[0],
        randomUUID(),
      )
    ).status,
    200,
  );
  const outsideFirstPage = legacy.data.at(-1);
  assert.ok(!first.data.data.some((m) => m.id === outsideFirstPage.id));
  // Direct targets never come from a paginated list inside the action/guard.
  assert.equal(
    (
      await rpc(
        "prepare_member_auth_invite",
        { p_business_id: business, p_member_id: first.data.data[0].id },
        users[0],
      )
    ).status,
    200,
  );
  console.log(
    "HTTP PASS: legacy 214 rows, keyset with timestamp ties, 50/200 limits, invalid/foreign cursors and revocation between pages.",
  );
  if (ui) {
    const { runAm0405Browser } = await import("./am0405-browser.mjs");
    await runAm0405Browser({
      sql,
      auth,
      rest,
      users,
      business,
      member,
      publicDatabaseUrl,
      publicFocus,
    });
  }
}
