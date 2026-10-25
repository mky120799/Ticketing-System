# Bank Case Platform documentation

This is the navigation hub for the project. Start with the NestJS course if you are learning the framework, then use the module and flow guides to understand how the frontend, API, database, workers and audit trail work together.

## Learning paths

| Path | Start here | What you will learn |
|---|---|---|
| NestJS fundamentals | [Learn NestJS](learn-nestjs/README.md) | Modules, controllers, DTOs, guards, interceptors, lifecycle, providers and testing |
| Authentication and access | [Authentication](modules/authentication/README.md) | Browser OIDC/PKCE, bearer tokens, `AuthGuard`, policies, entitlements and step-up |
| Audit and evidence | [Audit](modules/audit/README.md) | Transactional audit events, hash chains, append-only storage, verification and anchors |
| Frontend architecture | [Frontend](frontend/README.md) | React routes, session context, API client, React Query, capabilities and live updates |
| End-to-end understanding | [Flows](flows/README.md) | Trace user actions from the UI to the database and back |
| Interview preparation | [Interview prep](interview-prep/README.md) | Explain the implementation at 30-second, 2-minute and code levels |
| Completeness audit | [Source coverage](modules/source-coverage.md) | Map all 22 Nest modules, controllers, workers and frontend areas to their guides |

## Reference areas

- [Application modules](modules/README.md)
- [Cross-module implementation maps](modules/reference/README.md)
- [Security](security/README.md)
- [Architecture](architecture/README.md)
- [Operations](operations/README.md)
- [Product and user documentation](product/README.md)
- [Project history and status](project/README.md)

## How to read a module

For any feature, read in this order:

1. The module overview.
2. The linked frontend entry point.
3. The API route/controller and DTO.
4. The guard and policy decision.
5. The service transaction and database tables.
6. Audit/outbox/live-update behavior.
7. The tests and the matching interview answer.
