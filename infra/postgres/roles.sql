-- Separates the account that OWNS the schema (runs migrations) from the account the application RUNS as.
-- Run once per database as a superuser or a role with CREATEROLE, after the schema exists or before the first migration:
--   OWNER_PASSWORD=... APP_PASSWORD=... envsubst < infra/postgres/roles.sql | psql -d case_platform -v ON_ERROR_STOP=1
-- Then run migrations as case_owner and point the API's DATABASE_URL at case_app.
--
-- Why: PostgreSQL lets a table's owner disable its triggers or rewrite it. If the application runs as the owner, any
-- flaw in the application (or a stolen credential) could rewrite the audit trail. The runtime account below can only
-- add audit events and read them.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'case_owner') THEN CREATE ROLE case_owner LOGIN PASSWORD '${OWNER_PASSWORD}'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'case_app') THEN CREATE ROLE case_app LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
END $$;

DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO case_app', current_database()); END $$;

-- The owner creates schemas (for example `reporting`) when migrations run.
DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO case_owner', current_database()); END $$;
ALTER SCHEMA public OWNER TO case_owner;
GRANT USAGE ON SCHEMA public TO case_app;

-- Objects that already exist: hand ownership to the migration account...
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE format('ALTER TABLE public.%I OWNER TO case_owner', r.tablename); END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP EXECUTE format('ALTER SEQUENCE public.%I OWNER TO case_owner', r.sequencename); END LOOP;
END $$;
-- ...and give the application what it needs on them.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO case_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO case_app;
-- Future tables created by migrations get the same grants automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE case_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO case_app;
ALTER DEFAULT PRIVILEGES FOR ROLE case_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO case_app;

-- The audit trail is append-only for the application: it may add and read events, never change, remove or truncate them.
-- The checks and anchors tables are likewise insert/read only.
DO $$ BEGIN
  IF to_regclass('public.audit_events') IS NOT NULL THEN REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_events FROM case_app; END IF;
  IF to_regclass('public.audit_verifications') IS NOT NULL THEN REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_verifications FROM case_app; END IF;
  IF to_regclass('public.audit_anchors') IS NOT NULL THEN REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_anchors FROM case_app; END IF;
END $$;

-- Read-only account for BI / reporting tools. It can see only the `reporting` views (classifications, dates, outcomes and
-- opaque IDs); it has no access to case content. Set REPORTING_PASSWORD, or remove this block if no BI tool needs direct access.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'case_reporting') THEN CREATE ROLE case_reporting LOGIN PASSWORD '${REPORTING_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS reporting AUTHORIZATION case_owner;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO case_reporting', current_database()); END $$;
GRANT USAGE ON SCHEMA reporting TO case_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO case_reporting;
ALTER DEFAULT PRIVILEGES FOR ROLE case_owner IN SCHEMA reporting GRANT SELECT ON TABLES TO case_reporting;
