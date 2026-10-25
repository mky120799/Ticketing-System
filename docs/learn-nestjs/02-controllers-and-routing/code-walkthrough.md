# Lesson 2 code walkthrough: from URL to controller method

[Core chapter](README.md) · **Code walkthrough** · [Practice and interview](practice-and-interview.md) · [Course index](../README.md)

This trace follows `GET /v1/tickets?limit=25` and then compares it with parameterized, public-capability and customer routes.

## 1. Build the final route

Three layers form the URL:

```text
main.ts: app.setGlobalPrefix('v1')
TicketsController: @Controller('tickets')
list method: @Get()
---------------------------------------
GET /v1/tickets
```

For `@Post(':ticketId/notes')`, the final path is `POST /v1/tickets/:ticketId/notes`. Decorators store metadata; Nest reads that metadata during application initialization and registers a Fastify route.

## 2. Follow the list method

The method combines request context, raw query extraction and a passthrough response object:

```ts
@Get()
async list(
  @Req() request: FastifyRequest,
  @Res({ passthrough: true }) reply: FastifyReply,
  @Query('cursor') cursor?: string,
  @Query('limit') limit?: string,
) {
  const page = await this.tickets.list(
    request.user!,
    request.correlationId!,
    cursor,
    limit ? Number(limit) : undefined,
  );
  if (page.nextCursor) reply.header('X-Next-Cursor', page.nextCursor);
  return page.items;
}
```

Parameter origin:

| Parameter | Source | Who prepared it? |
|---|---|---|
| `request` | Fastify request | adapter plus request-context hook and guard |
| `request.user` | normalized identity | `AuthGuard` |
| `request.correlationId` | header or generated id | request-context registration |
| `reply` | Fastify response | adapter |
| `cursor`, `limit` | URL query string | Nest parameter extraction |

`@Res({ passthrough: true })` allows setting a header while Nest still serializes the returned array. Without passthrough, using the raw response object makes the handler responsible for sending the response and can bypass normal Nest response handling.

## 3. Controller responsibilities in this project

Controllers do boundary work:

- combine global/controller/method route metadata;
- select request values with `@Body`, `@Param`, `@Query`, `@Headers` and `@Req`;
- run parameter pipes such as `ParseUUIDPipe`;
- require simple protocol headers such as `Idempotency-Key`;
- set status or response headers;
- pass normalized values to an application service.

Controllers do not own SQL, transaction boundaries, ticket-scope authorization or workflow decisions. Those remain in services so workers and other non-HTTP entry points cannot bypass them.

## 4. Static routes before broad parameter routes

The tickets controller declares:

```ts
@Get('search')
search(...) {}

@Get(':ticketId')
get(...) {}
```

Keeping the specific route visibly before the broad parameter route avoids ambiguity and makes review easier. Otherwise `search` can be treated as a `ticketId` depending on router matching behavior. Apply the same rule to paths such as `communication-templates/all` before `communication-templates/:templateKey`.

## 5. Parameter pipes are local boundary checks

Some routes use:

```ts
@Param('linkId', ParseUUIDPipe) linkId: string
```

This rejects a malformed identifier before service code runs. A plain `@Param('ticketId') ticketId: string` accepts any string at this layer, so the service/query determines not-found behavior. The choice affects error semantics and should be deliberate.

The pipe proves format, not existence, ownership or permission.

## 6. Default and explicit status codes

Nest defaults are useful but should be understood:

| Handler | Default/explicit result |
|---|---|
| `@Get` | 200 |
| `@Post` | 201 by default |
| `@Post` plus `@HttpCode(200)` | 200 |
| thrown `NotFoundException` | 404 |
| validation failure | 400 |

The sensitive reveal action uses `@HttpCode(200)` because it performs an action but returns a current representation rather than announcing a newly created resource.

## 7. Compare three security boundaries

### Staff routes

`TicketsController` has class-level `@UseGuards(AuthGuard)`. Every route gets a staff `UserContext` before the method runs.

### Customer routes

`PortalController` uses `@Controller('portal')` and `@UseGuards(PortalAuthGuard)`. Its request identity is `request.customer`, not `request.user`, preventing accidental mixing of staff and customer assumptions.

### Upload capability route

`UploadsController` is not protected by the staff/customer bearer guard. It accepts an `x-upload-token` capability and deliberately returns a uniform not-found style response for invalid links. “No bearer guard” does not mean “no security boundary.”

## 8. Route to service trace: add a note

```text
POST /v1/tickets/{id}/notes
-> Fastify route registered from @Post(':ticketId/notes')
-> AuthGuard writes request.user
-> ValidationPipe creates/validates AddNoteDto
-> controller extracts ticketId, dto, correlationId
-> TicketsService.addNote(user, ticketId, dto, correlationId)
-> service loads subject, applies policy and writes transaction/audit
-> returned value is serialized by Nest/Fastify
```

Notice what is not accepted from the body: actor id, roles, correlation id or ticket ownership. Trusted request context supplies those values.

## 9. Why the controller injects one service

`TicketsController` injects `TicketsService`, not the database, audit writer, policy service and outbox individually. This keeps the controller at the protocol boundary and lets the service coordinate one use case. A controller with raw SQL or policy branching becomes hard to reuse and test outside HTTP.

## 10. Code-reading checklist

For any route, record:

1. HTTP verb and complete path.
2. Guard at method/controller/global level.
3. Each input and its source.
4. Pipes and DTO class.
5. default or explicit status code/headers.
6. service method and trusted context arguments.
7. likely exception mappings.
8. frontend caller and expected cache effect.

If you cannot name all eight, you have not yet traced the endpoint end to end.
