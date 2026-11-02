-- PostgreSQL CREATEROLE granted ADMIN but not SET when the role was created.
-- Permit maintenance to test the restricted role; never grant postgres to app_server.
grant app_server to postgres with set true;
