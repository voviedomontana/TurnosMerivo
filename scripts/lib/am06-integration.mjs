import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

export async function runAm06Integration({ sql, rest, users, call }) {
  const business = randomUUID(),
    target = randomUUID(),
    adminMember = randomUUID();
  sql(`insert into public.businesses(id,slug,name) values('${business}','ttl-http-${business.slice(0, 18)}','TTL HTTP');
    insert into public.business_settings(business_id) values('${business}');
    insert into public.business_members(business_id,user_id,role) values('${business}','${users[0].id}','owner');
    insert into public.business_members(id,business_id,user_id,role) values('${adminMember}','${business}','${users[1].id}','admin'),('${target}','${business}','${users[2].id}','barber');`);
  const rpc = (name, args, user = users[1], trace = randomUUID()) =>
    call(rest, `/rpc/${name}`, args, user.token, "POST", undefined, {
      "X-Request-Id": trace,
    });
  const key = randomUUID(),
    traceA = randomUUID(),
    traceC = randomUUID();
  const intent = {
    p_business_id: business,
    p_member_id: target,
    p_role: "barber",
    p_status: "suspended",
    p_key: key,
    p_expected: 1,
  };
  const first = await rpc("update_member", intent, users[1], traceA);
  assert.equal(first.status, 200);
  sql(
    `update app.member_requests set created_at=clock_timestamp()-interval '47 hours 59 minutes' where business_id='${business}' and key='${key}'`,
  );
  const replay = await rpc("update_member", intent);
  assert.deepEqual(replay.data, first.data);
  assert.equal(
    (
      await rpc("update_member", {
        ...intent,
        p_status: "active",
        p_expected: 2,
      })
    ).status,
    409,
  );
  assert.equal(
    (await rpc("update_member", { ...intent, p_expected: null })).status,
    409,
  );
  sql(
    `update app.member_requests set created_at=clock_timestamp()-interval '48 hours' where business_id='${business}' and key='${key}'`,
  );
  assert.equal((await rpc("update_member", intent)).status, 412);
  assert.equal(
    (await rpc("update_member", { ...intent, p_expected: null })).status,
    428,
  );
  sql("select app.purge_member_requests(500)");
  assert.equal((await rpc("update_member", intent)).status, 412);
  const fresh = await rpc(
    "update_member",
    { ...intent, p_status: "active", p_expected: 2 },
    users[1],
    traceC,
  );
  assert.equal(fresh.data.version, 3);
  assert.equal(
    sql(
      `select origin_request_id from app.member_requests where business_id='${business}' and key='${key}'`,
    ),
    traceC,
  );
  assert.equal(
    sql(
      `select count(*) from public.audit_logs where business_id='${business}' and entity_id='${target}'`,
    ),
    "2",
  );
  const revoke = {
    p_business_id: business,
    p_member_id: adminMember,
    p_role: "admin",
    p_status: "suspended",
    p_key: randomUUID(),
    p_expected: 1,
  };
  assert.equal((await rpc("update_member", revoke, users[0])).status, 200);
  assert.equal(
    (
      await rpc("update_member", {
        ...intent,
        p_status: "active",
        p_expected: 2,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await rpc(
        "update_member",
        { ...revoke, p_status: "active", p_key: randomUUID(), p_expected: 2 },
        users[0],
      )
    ).status,
    200,
  );
  const inviteKey = randomUUID(),
    token = randomBytes(32).toString("base64url");
  const invitation = {
    p_business_id: business,
    p_email: users[3].email,
    p_role: "barber",
    p_token: token,
    p_key: inviteKey,
  };
  const invite = await rpc("invite_member", invitation);
  assert.equal(invite.status, 200);
  sql(
    `update app.member_requests set created_at=clock_timestamp()-interval '49 hours' where business_id='${business}' and key='${inviteKey}'`,
  );
  assert.equal((await rpc("invite_member", invitation)).status, 409);
  sql("select app.purge_member_requests(500)");
  assert.equal((await rpc("invite_member", invitation)).status, 409);
  const acceptedKey = randomUUID();
  assert.equal(
    (
      await rpc(
        "accept_invitation",
        { p_token: token, p_key: acceptedKey },
        users[3],
      )
    ).status,
    200,
  );
  sql(
    `update app.member_requests set created_at=clock_timestamp()-interval '49 hours' where business_id='${business}' and key='${acceptedKey}'`,
  );
  assert.equal(
    (
      await rpc(
        "accept_invitation",
        { p_token: token, p_key: acceptedKey },
        users[3],
      )
    ).status,
    404,
  );
  const auditBefore = sql(
    `select count(*) from public.audit_logs where business_id='${business}'`,
  );
  sql("select app.purge_member_requests(500)");
  assert.equal(
    (
      await rpc(
        "accept_invitation",
        { p_token: token, p_key: acceptedKey },
        users[3],
      )
    ).status,
    404,
  );
  assert.equal(
    sql(
      `select count(*) from public.audit_logs where business_id='${business}'`,
    ),
    auditBefore,
  );
  assert.equal(
    sql(
      `select count(*) from app.member_invitations where business_id='${business}' and accepted_by='${users[3].id}'`,
    ),
    "1",
  );
  assert.equal(
    (await rpc("purge_member_requests", { p_batch_size: 1 }, users[0])).status,
    404,
  );
  console.log(
    "C06 HTTP PASS: 48h recognition, 409/412/428/404 after expiry, authorized fresh version, revocation, no duplicate invite/accept and preserved audit/invitation.",
  );
}
