# Application function catalog — Sprints 1–2

## Approved A-M06 — bounded replay recognition and private purge

Migration `20261101000800_expire_membership_replays.sql`, validated only in disposable
infrastructure. No scheduler or changes to application-role privileges.

| Function/object                                | Capability / verification                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| app.lock_member_request(uuid,text,uuid)        | Volatile invoker, private EXECUTE. Called after the verified tenant-root lock; scope includes auth.uid/operation/key. Locks the replay row, then checks server wall time; rows aged at least 48 hours are not replayed and their scoped PK is deleted transactionally before a fresh command |
| app.purge_member_requests(integer default 500) | Volatile invoker, private EXECUTE, postgres owner only by default. Batch 1…500, fixed cutoff per call, FOR UPDATE SKIP LOCKED; deletes only expired member_requests, returns count, never acquires root/member locks                                                                         |
| app.member_requests.created_at index           | Supports private retention scans; PK/tenant/actor scope unchanged                                                                                                                                                                                                                            |
| Existing three mutation coordinators           | Same S2 guards, signatures, hashes, lock phases and audit/origin; replay lookup delegates to private helper and new records timestamp their insertion with clock_timestamp                                                                                                                   |

Both functions pin empty search_path and receive no grants for PUBLIC, anon,
authenticated, app_server or service_role. Business failures roll back any opportunistic
expired-row cleanup. No audit/invitation deletion, TTL refresh on replay or indefinite
exactly-once promise. Maintenance uses a short transaction per batch; zero deleted
can mean expired rows were locked. Evidence: [A-M06 report](../docs/S2_AM06_REPORT.md).

## Approved A-M04 / A-M05 — request correlation and member pages

New migrations `20261101000600_correlate_membership_requests.sql` and
`20261101000700_paginate_business_members.sql`, tested only in disposable services.

| Function/object                                                   | Capability / verification                                                                                                                                                                                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| app.current_request_id()                                          | Volatile invoker, private EXECUTE. Reads only the request correlation UUID from request.headers; malformed/absent metadata generates a UUID. Never establishes identity or permission                                                   |
| app.member_requests.origin_request_id                             | Nullable private metadata. New committed operations store the first attempt UUID; old rows remain NULL; no backfill or grants                                                                                                           |
| app.manage_member / api.manage_invitation / api.accept_invitation | Existing signatures, guards, lock order, intention hashes and replay branches unchanged from A-M03; only new audit/first-origin persistence uses the per-attempt UUID                                                                   |
| api.list_members_page(uuid,integer,text)                          | Stable definer, authenticated only. Existing require_member management/MFA guard on each call; 50 default/200 maximum; tuple keyset by created_at,id within the selected tenant; bounded versioned cursor validated after authorization |

All functions pin empty search_path. No app_server/service_role expansion. The new
page RPC enumerates the existing member projection; the old list_members(uuid)
remains complete. Cursor is an untrusted selector, not a capability. New index:
business_members_page_order(business_id,created_at,id). No retention/purge change.

Evidence: [A-M04/A-M05 report](../docs/S2_AM04_AM05_REPORT.md).

## Approved A-M03 — C-01 / C-02 / C-07

New migration: `20261101000500_reauthorize_membership_operations.sql`. Validated
only in disposable infrastructure; not applied to the owner's database in this phase.

| Function                                   | Mode / grant                         | Verification and lock order                                                                                                                     |
| ------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| app.lock_managed_business(uuid)            | volatile definer, private            | require_member before root FOR UPDATE, then a fresh require_member command; READ COMMITTED required                                             |
| app.require_current_invitation(text)       | volatile definer, private            | confirmed current identity/email, active profile/business, current token hash/expiry, pending or authorized accepted state, MFA by current role |
| api.prepare_member_auth_invite(uuid,uuid)  | volatile definer, authenticated only | actor/target preflight; root, actor recheck, member, invitation; current role ceiling and expiry; fixed recipient from DB                       |
| app.manage_member (existing signature)     | volatile definer, private            | actor/target preflight, root reauthorization, replay row, target member; authorization before replay/precondition decision                      |
| api.manage_invitation (existing signature) | volatile definer, authenticated      | preflight, root reauthorization, replay row, member, invitation; current role ceiling before replay/version                                     |
| api.accept_invitation (existing signature) | volatile definer, authenticated      | token/identity preflight, root, fresh token/identity, replay row, member, invitation, final token check before consumption/replay               |

All pin empty search_path and retain postgres ownership. New helpers have no
application-role EXECUTE; no app_server/service_role expansion. The Server Action
waits for the dedicated RPC to complete before Auth Admin I/O. No network call holds
a PostgreSQL lock. Metadata tracing, pagination and replay retention remain unchanged.
Maintenance must acquire the root before updating children; the existing last-owner
trigger does not retroactively repair an inverted order already acquired by raw DML.

Evidence: [A-M03 implementation report](../docs/S2_AM03_REPORT.md).

## Approved S2 security fixes A-08 / A-05

`api.read_business_private(uuid)` is a stable definer owned by postgres, with empty
search_path and EXECUTE only for authenticated. Its tenant selector is checked by
the existing private `app.require_member(..., true)`: confirmed identity, active
profile/member/business, current owner/admin role and aal2. It returns explicit
business/settings columns, never a whole-row JSON conversion. Direct SELECT on those
two tables is revoked for authenticated, including owners/admins. No technical-role
grants changed. `api.me`, self profile/membership and the public projection remain.

`app.protect_last_owner()` retains its signature, invoker mode, trigger and locking
behavior; only its domain exception changes to SQLSTATE PT409 / LAST_OWNER. Other
CHECK/trigger errors retain 23514 and are safely classified as INTERNAL_ERROR/500
by the membership service. No lock/preauthorization refactor is included.

Evidence and isolated test procedure: [S2 security fix report](../docs/S2_SECURITY_FIX_REPORT.md).

Owner: `postgres` for all functions below. All pin `search_path = ''`. Application
functions have no EXECUTE grants to PUBLIC, anon or service_role, including defaults.
No application functions exist in the exposed `public` schema.

| Function                               | Mode            | Caller / authority                                                                     | Purpose                                                                                                                      |
| -------------------------------------- | --------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| app.is_valid_business_slug(text)       | invoker         | Maintenance or a verified owner operation                                              | Shared database slug constraint; no identity argument.                                                                       |
| app.touch_record()                     | invoker trigger | Maintenance update on the four base tables                                             | Immutable identity/tenant, version increment and timestamp.                                                                  |
| app.validate_business_timezone()       | invoker trigger | Maintenance write to businesses                                                        | Validate against pg_timezone_names.                                                                                          |
| app.protect_last_owner()               | invoker trigger | Maintenance member update/delete                                                       | Serialize on business and reject removing the last active owner.                                                             |
| app.is_active_member(uuid)             | **definer**     | authenticated only; auth.uid(), active member and nondeleted profile                   | Boolean-only RLS helper; postgres bypass prevents recursive membership policy. Tenant parameter is a selector, not identity. |
| app_internal.get_public_business(text) | **definer**     | app_server only; canonical slug, active/nondeleted business and public_booking_enabled | Fixed public projection. No actor/source/override or arbitrary tenant selector.                                              |
| app.create_business(text,text)         | invoker         | Maintenance postgres only                                                              | Idempotent initial business/settings bootstrap. No public registration or membership granting.                               |

`postgres` is a BYPASSRLS owner: FORCE RLS does not protect the definer body. All
definers enforce their limited capability themselves. No context setter or direct
table access is available to app_server. Support grants and integration credentials
remain unimplemented.

## Sprint 2 additions

All owned by postgres with empty search_path and no PUBLIC/anon/service_role grants.

| Function                  | Mode / caller                  | Verification                                                                                                  |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| app.sync_auth_profile     | definer trigger only           | auth.users identity/email, no role metadata                                                                   |
| app.require_member        | definer, private core only     | auth.uid, confirmed email, active profile/member/business, current role, aal2 for privileged members/platform |
| app.manage_member         | definer, private wrappers only | require_member, common business lock, no self changes, grant ceiling, version, idempotency, atomic audit      |
| api.me                    | definer, authenticated         | confirmed auth.uid, own profile and selector projection only                                                  |
| api.list_members          | definer, authenticated         | require_member with management permission; fixed tenant projection                                            |
| api.invite_member         | definer, authenticated         | private core; seven-day hashed invitation, no secret in persisted response                                    |
| api.update_member         | definer, authenticated         | private core; expected version and request key required                                                       |
| api.accept_invitation     | definer, authenticated         | one-use token, verified email from auth.users, MFA by target role, active tenant, atomic audit/replay         |
| app.reject_audit_mutation | invoker trigger only           | append-only audit                                                                                             |

`api.manage_invitation(uuid,uuid,text,uuid,integer)` is a definer callable only by
authenticated; it verifies the active actor/tenant/MFA and role ceiling, locks the
business then the member, checks version/replay, rotates the hash for seven days or
revokes the unused invitation. It records atomic audit without persisting secrets.

S1 app.is_active_member now also enforces active business and MFA on privileged
reads. It remains the only boolean RLS helper callable by authenticated.

The second migration permits postgres to SET ROLE app_server for verification;
app_server cannot SET ROLE postgres/authenticated and inherits no privileged role.
The local provisioning script enables LOGIN with a random password outside migrations.
Tests grant schema usage for pgTAP **inside their rollback transaction only**; this
is not a persistent app_server permission.

## Approved professional/service catalog subset

Migration `20261101000900_create_professional_service_catalog.sql` adds three
definers owned by postgres with empty search_path. No PUBLIC, anon, app_server or
service_role EXECUTE/table grants are added. All four new tables force RLS; direct
authenticated table access is also revoked. Reads use fixed RPC projections.

| Function                                                  | Mode / caller                               | Verification                                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api.list_catalog(uuid,boolean)                            | definer, authenticated                      | Active tenant membership; privileged roles require aal2; barber member_id projection is NULL.                                                                 |
| api.write_catalog(uuid,text,uuid,text,jsonb,uuid,integer) | definer, authenticated                      | Thin private-core wrapper; no actor/role from the caller.                                                                                                     |
| app.write_catalog(uuid,text,uuid,text,jsonb,uuid,integer) | definer, private                            | Preauthorization, common business root lock and fresh authorization, replay row then resource; version, same-tenant references, atomic mutation/audit/replay. |
| app.catalog_payload(text,jsonb)                           | immutable invoker, private                  | Strict fields/types/bounds, canonical normalized intent and assignment ordering.                                                                              |
| app.catalog_integer(jsonb,text,integer,integer,integer)   | immutable invoker, private                  | Integer bounds, no implicit string coercion.                                                                                                                  |
| app.purge_catalog_requests(integer)                       | volatile invoker, maintenance postgres only | Expired catalog replay rows only; 1–500, SKIP LOCKED; no scheduler or elevated execution.                                                                     |

`app.touch_record` now also runs on staff_members/services. Assignments use their
professional's version; they cannot be written independently. Catalog replay
retention is separate from the S2 membership ledger and never deletes audit or
invitations. Stable resource UUIDs prevent repeated creation after replay expiry.

## Customer directory: approved CM-01/CM-02 and administrative CM-05

Migration 20261101001000 adds only public.customers and app.customer_requests. Both
force RLS with no direct application grants or policies; deny-all tables are accessed
only through checked postgres definers with fixed projections. No marketing, barber,
anonymous or technical-role capability is added. Existing twelve migrations remain.

| Function                                                       | Mode / caller                               | Verification                                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api.write_customer(uuid,uuid,text,jsonb,uuid,integer)          | definer, authenticated                      | require_member(true), canonical payload, root UPDATE and fresh authorization, replay then customer lock, state/version, atomic audit and metadata replay. |
| api.read_customer(uuid,uuid)                                   | stable definer, authenticated               | Active owner/admin + aal2, same-tenant customer, explicit administrative detail including private notes.                                                  |
| api.list_customers_page(uuid,text,text,text,text,integer,text) | stable definer, authenticated               | Same management guard before filters/cursor; keyset 50/200, tenant/filter-bound cursor; never notes or evidence.                                          |
| app.customer_text / customer_phone / customer_payload          | immutable invoker, private                  | Codepoint bounds, strict fields, conservative contact validation/normalization.                                                                           |
| app.validate_customer                                          | invoker trigger, private                    | Derived contact fields and marketing_revision; contact changes/archive invalidate epoch, restore does not reset it. No consent data exists.               |
| app.purge_customer_requests(integer)                           | volatile invoker, maintenance postgres only | Customer replay only, 48 h, 1–500, SKIP LOCKED; no root afterward and no scheduler.                                                                       |

app.touch_record also protects customers identity/tenant/created_at and increments
profile version. All new functions pin an empty search_path and revoke PUBLIC,
anon/service_role/app_server; only three api signatures grant authenticated EXECUTE.
No whole-row JSON projection, no PII in mutation responses/audit/replay. All UI writes
use the authenticated REST API, so source is server-fixed admin_api. Marketing notices
and evidence are unimplemented; no marketing grant or customer Auth identity is implied.

## Scheduling HS-01/02/03

Migration 20261102000100 adds six RLS-forced deny-all tables: calendar_controls,
staff_working_plans, working_hours, schedule_exceptions, time_blocks and schedule_requests.
No direct app-role grants, no appointments or anonymous/technical-role capability.

| Function                                                        | Mode/caller                                 | Authority and projection                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| api.list_schedule_staff(uuid)                                   | stable definer, authenticated               | require_member; barber only staff linked to that exact membership/tenant. Minimal name/ID/active projection.                                                                                                                             |
| api.read_schedule(uuid,uuid)                                    | stable definer, authenticated               | Verified staff scope; owner/admin aal2; barber own only and no reasons. Explicit fields.                                                                                                                                                 |
| api.read_calendar_control(uuid)                                 | stable definer, authenticated               | Owner/admin aal2; virtual version 1 without write when absent.                                                                                                                                                                           |
| api.write_schedule(uuid,uuid,text,uuid,text,jsonb,uuid,integer) | volatile definer, authenticated             | Owner/admin aal2; preflight/root UPDATE/revalidation/replay/parent/children; UUIDs, versions, state and atomic audit/replay.                                                                                                             |
| api.schedule_preview_source(uuid,uuid,uuid,text,integer)        | stable definer, authenticated               | Same staff guard; active same-tenant service/link; bounded seven dates. Snapshot of operational calculation inputs (including minimum notice), no private reasons, tax/billing or branding data. Explicitly no booking/occupancy checks. |
| app.require_schedule_staff(uuid,uuid)                           | stable definer, private                     | Shared verified membership and staff ownership guard, no caller-asserted actor.                                                                                                                                                          |
| app.schedule_date / schedule_reason / schedule_intervals        | immutable invoker, private                  | Typed dates/text/intervals; canonical sorted/merged payload and rejected overlaps.                                                                                                                                                       |
| app.schedule_instant(date,integer,text)                         | stable invoker, private                     | UTC inverse wall-time mapping; roundtrip for gaps and first fold occurrence.                                                                                                                                                             |
| app.guard_working_interval()                                    | invoker trigger, private                    | Published intervals immutable; row overlap guard supplements canonical writes.                                                                                                                                                           |
| app.purge_schedule_requests(integer)                            | volatile invoker, postgres maintenance only | Expired schedule replay ≤500, SKIP LOCKED; no root afterward, no scheduler.                                                                                                                                                              |

All functions owned by postgres, search_path empty, PUBLIC/anon/app_server/service_role
revoked. Only five api signatures granted authenticated. touch_record increments staff
or calendar control once per command; business/settings versions are untouched. Existing
S2/catalogue/customer functions and grants remain. See scheduling implementation report.
