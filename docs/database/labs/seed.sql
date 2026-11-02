-- Lab seed for docs/database/hands-on-labs.md and docs/notifications/hands-on-labs.md.
-- Run against the scratch database case_lab AFTER migrations, never against case_platform:
--   psql -h localhost -p 5433 -U case_user -d case_lab -v ON_ERROR_STOP=1 -f docs/database/labs/seed.sql

-- 50,000 tickets spread over six queues, five statuses and four priorities, one per minute going back in time.
INSERT INTO tickets (id, category, priority, status, queue, branch_code, department, legal_entity, country, subject, description, created_by, assigned_to, created_at, updated_at)
SELECT gen_random_uuid(),
       (ARRAY['complaint','service-request','transaction-dispute','card-issue'])[1 + g % 4],
       (ARRAY['low','normal','high','critical'])[1 + g % 4],
       (ARRAY['submitted','assigned','in_progress','resolved','closed'])[1 + g % 5],
       (ARRAY['customer-support','payments','cards','fraud','kyc','loans'])[1 + g % 6],
       'BR-' || (g % 20), 'operations', 'BANK-IN', 'IN',
       'Lab ticket ' || g, 'Seeded description ' || g, 'seed-user',
       CASE WHEN g % 3 = 0 THEN 'agent-' || (g % 10) END,
       now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval
FROM generate_series(1, 50000) AS g;

-- Two customer references per ticket (100,000 rows) for the foreign-key index lab.
INSERT INTO ticket_references (id, ticket_id, reference_type, source_system, opaque_reference, masked_value)
SELECT gen_random_uuid(), id, 'customer', 'core', 'CUST-' || left(id::text, 8), '••••'
FROM tickets, generate_series(1, 2);

-- 20,000 notifications: half addressed to one of ten agents, half to supervisors of three queues.
INSERT INTO notifications (id, recipient_user, recipient_queue, audience_role, legal_entity, country, type, ticket_id, title, created_at)
SELECT gen_random_uuid(),
       CASE WHEN g % 2 = 0 THEN 'agent-' || (g % 10) END,
       CASE WHEN g % 2 = 1 THEN (ARRAY['customer-support','payments','cards'])[1 + g % 3] END,
       CASE WHEN g % 2 = 1 THEN 'supervisor' END,
       'BANK-IN', 'IN', 'ticket_assigned', NULL, 'Lab notification ' || g, now() - (g || ' seconds')::interval
FROM generate_series(1, 20000) AS g;

-- Small tables the concurrency labs use.
CREATE TABLE lab_counter (id int PRIMARY KEY, n int NOT NULL, version int NOT NULL DEFAULT 0);
INSERT INTO lab_counter VALUES (1, 0, 0);
CREATE TABLE lab_acct (id int PRIMARY KEY, bal int NOT NULL);
INSERT INTO lab_acct VALUES (1, 100), (2, 100);
CREATE TABLE lab_oncall (name text PRIMARY KEY, on_call boolean NOT NULL);
INSERT INTO lab_oncall VALUES ('a', true), ('b', true);

ANALYZE;
