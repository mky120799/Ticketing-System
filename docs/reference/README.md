# Cross-module reference maps

[Documentation home](../README.md) · [Source coverage](source-coverage.md)

Topic folders explain one subject deeply. These maps answer the follow-up questions that need **several topics compared side by side**.

## Maps

1. [Runtime wiring map](runtime-wiring-map.md): all 22 Nest modules, their imports, public providers, controllers/workers and ownership boundaries.
2. [Data and consistency map](data-and-consistency-map.md): tables/state, transaction boundaries, locks/idempotency, asynchronous semantics and known gaps.
3. [Frontend-to-backend map](frontend-to-backend-map.md): React routes/components, typed client calls, Nest entry points, cache behaviour and security rechecks.
4. [Failure and test map](failure-and-test-map.md): decisive failure behaviour and the test level needed to prove each guarantee.
5. [Source coverage](source-coverage.md): every source module and frontend area → the topic folder that documents it.

For locking specifically, the [database locking and concurrency catalogue](../database/locking-and-concurrency.md) is the most complete single table.

## How to use this in an interview

```text
Where is it wired?            -> runtime wiring map
What commits atomically?      -> data and consistency map (+ locking catalogue)
What does the browser do?     -> frontend-to-backend map
How do you know it works?     -> failure and test map
```

Don't memorise every row. Practise one vertical flow (login, ticket change, communication delivery or attachment scan), then use the tables to compare how the same concerns are solved elsewhere.

## Scope rule

The repository has 22 classes decorated as Nest modules, including `AppModule`. Retention is a provider owned by `WorkflowModule`, health is a root controller, and production safety runs before Nest is created. The maps include these non-module runtime units where they affect behaviour.
