-- Per-schema REVOKE cannot remove PostgreSQL's global PUBLIC EXECUTE default.
-- This affects future postgres-owned functions only, not existing Supabase functions.
alter default privileges for role postgres revoke execute on functions from public;
