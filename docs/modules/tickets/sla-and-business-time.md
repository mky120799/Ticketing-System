# Tickets: SLA and business time

[`SlaService`](../../../apps/api/src/tickets/sla.service.ts) calculates initial deadlines, pauses/resumes them and periodically derives a controlled SLA status. Compliance's business calendar is reused so deadline math has one implementation.

## Initial calculation

`calculate(client, priority, now, country)` selects the active `default` SLA policy for the priority. Missing policy is a business conflict: ticket creation cannot proceed with undefined obligations.

For a wall calendar, it adds configured first-response/resolution minutes directly. For `business` calendar it loads `business_hours` for country and the country's `business_holidays`, then calls `addBusinessMinutes` with timezone, opening/closing minute and working weekdays.

If a business-calendar policy has no country hours row, the current code falls back to wall-clock minutes. That is an availability-oriented fallback but can violate expected regulatory timing; production configuration validation should reject an active business policy without a complete calendar rather than silently changing semantics.

The resulting policy key and deadlines are persisted on the ticket, preserving the targets used at creation even if configuration later changes.

## First response semantics

`first_responded_at` is set once by the first customer-facing action: a customer-visible note, a queued communication, approval that queues a communication, or relevant status change such as pending customer/resolved. Internal notes do not satisfy it.

`NEXT_SLA_STATUS_SQL` calculates:

- `paused` when `sla_paused_at` exists;
- `breached` when resolved time/current time is after resolution due;
- `first_response_overdue` when first response/current time is after first-response due;
- `met` when resolved without a prior condition;
- otherwise `running`.

Resolution breach has precedence over first-response breach.

## Pause and resume

Before entering `pending_customer`, `pauseIfConfigured` reads `pause_while_pending_customer` for ticket policy/priority and sets `sla_paused_at` if enabled. `resumeIfPaused` adds the elapsed pause duration to both deadlines and clears the pause marker in one SQL update.

Portal/email customer replies call the shared reply service; if a waiting ticket returns to `in_progress`, it resumes the clock in the same transaction.

## Reconciliation paths

The manual dashboard route calls `reconcile(user, correlationId)` and requires `sla:reconcile`. Administrators update entity/country-wide; supervisors are additionally queue-scoped. Only rows whose derived status differs are updated. Every changed ticket gets audit/outbox evidence.

`reconcileSystem` is the scheduler variant. It selects a bounded 500-row batch with `FOR UPDATE SKIP LOCKED`, writes system-actor audit/outbox/live events and creates attention notifications for response-overdue/breached rows. Remaining rows wait for the next tick.

## Frontend

Ticket sidebar renders persisted deadlines/status. Queue quick view treats configured overdue statuses as presentation filters over already loaded tickets. Dashboard aggregates status server-side. Administrators edit policies in `service-levels-section.tsx` and business hours/holidays in the compliance section.

The frontend must display dates in user-friendly local form without recalculating due times; timezone/business-calendar decisions belong to the server.

## Tests and interview answer

Test wall/business calendars, before/after opening, weekend, holiday, timezone/DST, missing policy/calendar, first-response precedence, pause/resume duration, manual scope and concurrent system batches. [`business-calendar.spec.ts`](../../../apps/api/test/business-calendar.spec.ts) covers calendar arithmetic; workflow/ticket integration should prove persistence/events.

> At creation I select an SLA policy by priority and calculate both targets using either wall minutes or a timezone-aware business calendar that skips non-working days and holidays. Customer waiting can pause the clock; resume shifts both deadlines by the exact paused duration. A bounded scheduler uses skip-locked rows to derive statuses, then atomically writes status, audit, outbox, live hints and notifications. The browser displays server deadlines rather than recalculating them.
