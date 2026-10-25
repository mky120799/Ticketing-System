# Lesson 3 practice and interview drill

[Core chapter](README.md) · [Code walkthrough](code-walkthrough.md) · **Practice and interview** · [Course index](../README.md)

## 1. Predict the validation result

Given a global pipe with transform, whitelist and forbid enabled:

| Input | Expected result | Reason |
|---|---|---|
| `priority: "urgent"` | 400 | not in the priority allow-list |
| extra `isApproved: true` | 400 | non-whitelisted property |
| `limit: "20"` with `@Type(() => Number)` | numeric 20 | transformed before integer checks |
| 11 references | 400 | `@ArrayMaxSize(10)` |
| syntactically valid unknown ticket UUID | passes DTO/pipe | existence is a service/database concern |
| `expectedUpdatedAt` that no longer matches | passes ISO validation, later 409 | state precondition is not shape validation |

## 2. Find the bug: nested DTO

```ts
class OrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  items!: ItemDto[];
}
```

Likely missing `@Type(() => ItemDto)`. Plain JSON items need a runtime class target for transformation and nested decorator metadata.

## 3. Find the bug: trusting the body

```ts
class ApproveDto {
  @IsUUID()
  actorId!: string;

  @IsIn(['supervisor'])
  role!: string;
}
```

These fields can be perfectly valid and completely false. Actor and roles must come from the verified `UserContext`; the body should contain only the decision/reason needed for the use case.

## 4. Write a production-oriented DTO

Requirement: add a tag containing a lower-case key and short label.

```ts
export class AddTicketTagDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{1,31}$/)
  key!: string;

  @IsString()
  @Length(1, 80)
  label!: string;
}
```

Then name the missing non-DTO rules: caller permission, ticket scope, allowed configured tag keys, duplicate handling, transaction/audit and database uniqueness.

## 5. Interview answer at three depths

### 30 seconds

> I use class-based DTOs with class-validator and a global `ValidationPipe`. Transform is enabled, unknown properties are rejected, and all strings, arrays, numbers and enums are bounded. DTOs validate request shape; services enforce permission/state rules and PostgreSQL enforces concurrent invariants.

### Two minutes

> Nest obtains the DTO class from reflected controller parameter metadata. The global pipe transforms the plain payload into that class and runs its decorators before the controller. For nested ticket references I use `@ValidateNested({ each: true })` plus `@Type(() => ReferenceDto)`. Query values start as strings, so numeric fields use explicit transformation before integer/range validation. PATCH DTO fields are optional but validated when present. I do not accept actor, role or ownership as request authority. A valid DTO can still fail policy, workflow or optimistic-concurrency checks in the service.

### Code-level follow-up

Be ready to explain every line:

```ts
class SearchDto {
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

The answer must include the raw query-string type and why a TypeScript `number` annotation alone is insufficient.

## 6. Common follow-ups

1. **Why use classes rather than interfaces?** Classes survive at runtime and carry decorator/reflection metadata.
2. **Does `whitelist` alone reject extra fields?** It strips them; `forbidNonWhitelisted` turns them into an error.
3. **Should a DTO check database existence?** Usually no; async resource/state checks belong in services to preserve transaction and authorization context.
4. **Why bound arrays and strings?** Protect resource use, persistence limits, downstream systems and reviewable business contracts.
5. **Does validation sanitize HTML?** No. Validate shape, render untrusted text safely, and apply context-specific output encoding.
6. **Why keep a DB unique constraint if the service checks first?** Two concurrent requests can both pass an application pre-check.

## 7. Debugging sequence for an unexpected 400

1. Inspect the exact response messages/property names.
2. Confirm the request reached the pipe rather than failing guard/parsing first.
3. Check the controller parameter's DTO class.
4. Compare JSON keys with decorated DTO properties.
5. Check transformation for query/path values.
6. For nested input, inspect `@Type` and `@ValidateNested`.
7. Check whether an omitted field is truly optional.
8. Add a focused E2E test reproducing the payload.

## 8. Hands-on exercise

Design `CreateEscalationRuleDto` containing priority, delay minutes, destination queue and optional active flag. Include explicit enum/range/length decorators. Then list at least four service/database rules the DTO cannot prove.

## 9. Self-assessment

You are ready when you can look at any DTO, predict transformed runtime values and error cases, and clearly separate syntactic validation from permission, state, ownership and concurrency guarantees.
