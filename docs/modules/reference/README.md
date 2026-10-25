# Cross-module implementation reference

[Module index](../README.md) · [Source coverage](../source-coverage.md) · [Documentation home](../../README.md)

Individual module guides explain one bounded feature. These reference maps answer the cross-cutting interview questions that require comparing several modules at once.

## Maps

1. [Runtime wiring map](runtime-wiring-map.md): all 22 Nest modules, their imports, public providers, controllers/workers and ownership boundaries.
2. [Data and consistency map](data-and-consistency-map.md): tables/state, transaction boundaries, locks/idempotency, asynchronous semantics and known gaps.
3. [Frontend-to-backend map](frontend-to-backend-map.md): React routes/components, typed client calls, Nest entry points, cache behavior and security rechecks.
4. [Failure and test map](failure-and-test-map.md): decisive failure behavior and the test level needed to prove each module's important guarantee.

## How to use this in an interview

Start with the individual module guide, then use these maps to answer follow-ups:

```text
Where is it wired?            -> runtime wiring map
What commits atomically?      -> data and consistency map
What does the browser do?     -> frontend-to-backend map
How do you know it works?     -> failure and test map
```

Do not memorize every row. Practice one vertical flow—authentication, ticket change, communication delivery or attachment scan—then use the tables to compare how the same concerns are solved elsewhere.

## Scope rule

The repository has 22 classes decorated as Nest modules, including `AppModule`. Retention is a substantial provider/subsystem owned by `WorkflowModule`, health is a root controller, and production safety runs before Nest creation; the maps include these non-module runtime units where they affect behavior.
