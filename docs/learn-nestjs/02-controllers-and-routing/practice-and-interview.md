# Lesson 2 practice and interview drill

[Core chapter](README.md) · [Code walkthrough](code-walkthrough.md) · **Practice and interview** · [Course index](../README.md)

## 1. Derive routes without running the app

Assume the global prefix is `v1` and the controller prefix is `tickets`.

| Decorator | Final route |
|---|---|
| `@Get()` | `GET /v1/tickets` |
| `@Get('search')` | `GET /v1/tickets/search` |
| `@Patch(':ticketId')` | `PATCH /v1/tickets/:ticketId` |
| `@Post(':ticketId/approvals/:approvalId/decision')` | `POST /v1/tickets/:ticketId/approvals/:approvalId/decision` |
| `@Delete(':ticketId/upload-links/:linkId')` | `DELETE /v1/tickets/:ticketId/upload-links/:linkId` |

Now identify the source of every argument in the selected handler before opening its implementation.

## 2. Refactoring drill: thin the controller

Broken controller:

```ts
@Post(':id/close')
async close(@Param('id') id: string, @Req() req: FastifyRequest) {
  const row = await this.db.query('SELECT * FROM tickets WHERE id=$1', [id]);
  if (row.status !== 'resolved') throw new ConflictException();
  await this.db.query('UPDATE tickets SET status=\'closed\' WHERE id=$1', [id]);
  await this.audit.write(/* ... */);
  return { ok: true };
}
```

Move loading, resource authorization, state validation, transaction and audit to `TicketsService.close`. Keep the controller responsible for route/input/context mapping. The reason is not just style: workers or another controller must not be able to call a weaker version of the use case.

## 3. Failure-prediction drill

For `POST /v1/tickets/not-a-uuid/notes` with no token and an invalid body, predict the first response.

Answer: class-level `AuthGuard` runs before body DTO validation, so a missing token produces 401. Whether `ticketId` itself gets a 400 depends on a parameter pipe; this route currently accepts it as a string and service lookup later produces resource behavior.

## 4. `@Res` drill

Explain the difference:

```ts
method(@Res() reply: FastifyReply) {
  return { ok: true };
}
```

```ts
method(@Res({ passthrough: true }) reply: FastifyReply) {
  reply.header('X-Next-Cursor', '...');
  return { ok: true };
}
```

With passthrough, Nest still owns response serialization. Without it, the handler opts into library-specific response handling and should explicitly send through `reply`; returning normally can leave unclear behavior.

## 5. Interview answer at three depths

### 30 seconds

> Controllers are thin HTTP adapters. Decorators define the verb and route, parameter decorators extract body/path/query/header values, pipes validate boundary data, and the controller passes trusted identity and correlation context to a service. Business rules, SQL and resource authorization stay in the service.

### Two minutes

> The API uses a global `/v1` prefix. `TicketsController` contributes `/tickets`, then method decorators add each operation. A class-level `AuthGuard` establishes `request.user`; global validation turns a decorated DTO into a checked boundary object. For ticket listing, the controller also uses a passthrough Fastify reply to expose `X-Next-Cursor` while letting Nest serialize the returned items. Static routes such as `/search` are kept distinct from broad `/:ticketId` routes. The controller forwards user, correlation id and inputs to `TicketsService`, which owns policy and transactions.

### Code-level follow-up

Write and narrate:

```ts
@Post(':ticketId/notes')
addNote(
  @Req() request: FastifyRequest,
  @Param('ticketId', ParseUUIDPipe) ticketId: string,
  @Body() dto: AddNoteDto,
) {
  return this.tickets.addNote(
    request.user!,
    ticketId,
    dto,
    request.correlationId!,
  );
}
```

Mention that UUID syntax is not resource existence, and `request.user` is produced by the guard rather than trusted from the body.

## 6. Common follow-up questions

1. **Why not authorize entirely in the controller?** Service methods are also called from workers/other adapters and need one authoritative resource-policy boundary.
2. **What does `@Controller('tickets')` do?** Adds class-level route metadata and groups handlers; it does not instantiate the class by itself.
3. **How does `@Body()` become a class DTO?** The parameter's reflected metatype plus the global transformation/validation pipe; Lesson 3 covers the mechanics.
4. **Can route hiding in React protect an endpoint?** No. The controller/guard/service must enforce security for every request.
5. **Why use a header for idempotency?** It is request protocol metadata, not business payload, and allows retries to identify one logical operation.

## 7. Hands-on exercise

Design `POST /v1/tickets/:ticketId/tags` with:

- `AuthGuard` inherited at controller level;
- `ParseUUIDPipe` on the ticket id;
- `AddTagDto` in the body;
- actor and correlation id from the request;
- a service call that owns authorization and transaction behavior;
- an intentional 201 or 200 decision.

Then write the matching frontend call signature. Do not include actor id or roles in the body.

## 8. Self-assessment

You are interview-ready when, given any endpoint, you can derive the complete route, classify every input as trusted/untrusted, state which layer rejects malformed data, and identify the exact service call without opening the controller.
