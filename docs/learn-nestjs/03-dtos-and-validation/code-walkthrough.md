# Lesson 3 code walkthrough: runtime validation and transformation

[Core chapter](README.md) · **Code walkthrough** · [Practice and interview](practice-and-interview.md) · [Course index](../README.md)

TypeScript disappears when JavaScript runs. This walkthrough shows how the global `ValidationPipe`, class constructors and validation decorators turn untrusted JSON/query strings into checked boundary values.

## 1. The global validation contract

`main.ts` installs:

```ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
}));
```

These options have separate jobs:

| Option | Effect |
|---|---|
| `transform` | constructs the DTO/metatype and enables class-transformer conversions |
| `whitelist` | recognizes fields that have validation metadata |
| `forbidNonWhitelisted` | rejects unknown fields instead of silently discarding them |

The last option prevents a client from thinking an unrecognized security-sensitive field such as `approved: true` was accepted.

## 2. How Nest discovers `CreateTicketDto`

The controller parameter is compiled with design-type metadata:

```ts
create(@Body() dto: CreateTicketDto) {}
```

At runtime, Nest knows the metatype is the `CreateTicketDto` class. The global pipe transforms the plain body into that class shape, executes its decorators and throws a 400 before the controller if constraints fail. An interface would not work here because it has no runtime constructor or decorator metadata.

## 3. Read a DTO as an executable boundary contract

Selected `CreateTicketDto` fields:

| Field | Decorators | What they reject |
|---|---|---|
| `priority` | `@IsIn(PRIORITIES)` | values outside the controlled vocabulary |
| `subject` | `@IsString() @Length(3, 200)` | non-text and unbounded text |
| `description` | `@IsString() @Length(3, 10000)` | empty/oversized content |
| `country` | `@IsString() @Length(2, 2)` | wrong shape; it does not prove a real ISO country |
| `references` | `@IsArray() @ArrayMaxSize(10)` | non-array and excessive fan-out |
| `customFields` | `@IsOptional() @IsObject()` | non-object values; deeper schema is not enforced here |

Validation answers “is the input shape acceptable?” It does not answer “may this user create a restricted ticket?” or “does this queue exist?” Those require policy/configuration checks in the service.

## 4. Nested validation needs three pieces

```ts
@IsArray()
@ArrayMaxSize(10)
@ValidateNested({ each: true })
@Type(() => ReferenceDto)
references!: ReferenceDto[];
```

- `@IsArray` proves the container type.
- `@ValidateNested({ each: true })` asks class-validator to inspect each item.
- `@Type(() => ReferenceDto)` tells class-transformer which runtime class to construct for each plain object.

Omitting `@Type` is a common bug: nested objects remain plain objects, so the expected nested class metadata may not be applied correctly. Omitting `each: true` does not validate each array element.

## 5. Query parameters begin as strings

`SearchTicketsQuery` converts `limit` explicitly:

```ts
export class SearchTicketsQuery {
  @IsString()
  @Length(1, 80)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 25;
}
```

For `?limit=20`, Fastify supplies text. `@Type(() => Number)` produces numeric `20`, then `@IsInt`, `@Min` and `@Max` validate it. Never assume a TypeScript annotation converted a URL string.

Also handle `NaN`: transformation can produce it, but numeric validators should reject it.

## 6. PATCH DTOs and absent values

`UpdateTicketDto` marks every field optional because PATCH represents a partial change:

```ts
@IsOptional()
@IsIn(PRIORITIES)
priority?: Priority;
```

`@IsOptional()` skips subsequent validators only when the value is absent/null according to validator semantics. If present, it must satisfy every constraint. The service must distinguish “not provided” from an explicit value and build an allow-listed update rather than spreading the entire object blindly.

For creation DTOs, do not mark required business inputs optional merely to silence validation errors.

## 7. Format checks are not trust checks

Examples:

- `@IsUUID()` proves syntax, not that the row exists or is visible.
- `@IsISO8601()` proves date-string shape, not that a stale-write precondition matches.
- `@Matches(/^[a-f0-9]{64}$/i)` proves checksum format, not uploaded bytes.
- `@IsIn(['clean', 'malicious', 'error'])` proves vocabulary, not that the caller is an authorized scanner identity.
- `@Length(8, 255)` bounds an opaque reference, not that it belongs to the customer.

State and trust validation happen after shape validation.

## 8. Defensive template validation

Communication templates use a restrictive regular expression so only known placeholders can be stored. This is stronger than accepting arbitrary `{{...}}` and trying to sanitize later. The body permits `ticketRef`, `status` and `uploadLink`; the subject permits only `ticketRef` and `status`.

This is still one layer. Rendering must use a controlled substitution function, output channels must escape appropriately, and authorization must restrict who can update templates.

## 9. Validation, domain rules and database constraints

Use all three layers for different guarantees:

| Layer | Example | Protects against |
|---|---|---|
| DTO/pipe | rating is integer 1–5 | malformed request |
| service/domain | ticket must be resolved | invalid business transition |
| database | unique `(ticket_id, actor_id)` | concurrent duplicate rows |

Repeating a critical constraint in more than one layer can improve error clarity, but only the database can serialize competing writes reliably.

## 10. Error path

```text
raw body/query
-> Fastify parses bytes/JSON
-> guard establishes identity
-> ValidationPipe transforms and validates parameters
-> failure throws BadRequestException
-> interceptor error path can observe it
-> Nest exception layer serializes statusCode/error/message
```

Because guards run before pipes, a protected endpoint with both a missing token and invalid body responds 401 first. This prevents unnecessary validation work and avoids exposing endpoint details to an unauthenticated caller.

## 11. Code-review checklist

- DTO is a class, not an interface.
- Every accepted property has explicit validation metadata.
- Text, arrays and numbers have bounds.
- Enumerations are allow-lists, not arbitrary strings.
- Nested arrays use `@ValidateNested` and `@Type`.
- Query conversions are explicit.
- PATCH fields are optional deliberately.
- Actor, roles and ownership are never accepted as DTO authority.
- Domain checks and database constraints still exist after DTO validation.
