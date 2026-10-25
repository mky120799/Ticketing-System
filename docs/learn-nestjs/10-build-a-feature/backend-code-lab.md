# Lesson 10 backend code lab: ticket ratings

[Core chapter](README.md) · **Backend lab** · [Frontend lab](frontend-code-lab.md) · [Tests and interview](practice-and-interview.md) · [Course index](../README.md)

This is a guided feature design, not a claim that ticket ratings already exist in the repository. Implement it on a branch if you want the hands-on exercise. The code follows the project's current module, policy, PostgreSQL, audit and outbox conventions.

## 1. Freeze the contract before writing code

```http
POST /v1/tickets/{ticketId}/ratings
Authorization: Bearer <staff access token>
Content-Type: application/json
X-Correlation-Id: <uuid-or-bounded-value>

{
  "rating": 5,
  "comment": "Clear and helpful"
}
```

Response:

```json
{
  "id": "rating-uuid",
  "rating": 5,
  "comment": "Clear and helpful",
  "actorId": "staff-subject",
  "createdAt": "2026-10-23T10:00:00.000Z"
}
```

Failure contract:

| Status | Stable meaning |
|---|---|
| 400 | UUID/body shape invalid or unknown field supplied |
| 401 | staff identity not established |
| 403 | caller lacks permission/resource scope |
| 404 | ticket absent or deliberately hidden |
| 409 `ticket_not_resolved` | current ticket state does not permit rating |
| 409 `rating_already_exists` | actor has already rated this ticket |

The API derives `actorId` from `request.user.subject`. It never accepts identity, role or ticket status from the body.

## 2. Migration and database invariants

Add a new numbered migration after the current latest migration. Equivalent SQL:

```sql
CREATE TABLE ticket_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NULL CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_ratings_ticket_actor_unique
    UNIQUE (ticket_id, actor_id)
);

CREATE INDEX ticket_ratings_ticket_created_idx
  ON ticket_ratings (ticket_id, created_at DESC);
```

Why each constraint exists:

- foreign key prevents an orphan rating;
- `smallint` plus CHECK preserves range even outside the API;
- comment CHECK protects direct/integration writes;
- unique constraint is the final concurrent one-rating guarantee;
- index supports reading ratings with ticket detail.

Do not enforce “ticket is resolved” with a cross-table CHECK—PostgreSQL CHECK constraints cannot safely express mutable cross-row state. Lock/read the ticket in the service transaction.

Migration rollout order:

1. deploy additive table/index migration;
2. deploy API that starts writing it;
3. deploy frontend exposing it;
4. retain backward-compatible reads during rolling deployment.

## 3. DTO

Create `apps/api/src/ratings/rating.dto.ts`:

```ts
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  comment?: string;
}
```

No actor/ticket/status fields appear because the route and verified/current server data supply them. The global pipe rejects extra fields.

## 4. Module boundary

Create `ratings.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RatingsController } from './ratings.controller.js';
import { RatingsService } from './ratings.service.js';

@Module({
  imports: [AuthModule],
  controllers: [RatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
```

Export only if ticket detail or another legitimate module injects this service. Otherwise omit `exports`. `PgService`, `AuditService` and `OutboxService` are available from global infrastructure modules already composed by `AppModule`; `AuthModule` stays explicit for guard/policy visibility.

Add `RatingsModule` to `AppModule.imports`.

## 5. Controller

```ts
import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthGuard } from '../auth/auth.guard.js';
import { CreateRatingDto } from './rating.dto.js';
import { RatingsService } from './ratings.service.js';

@Controller('tickets')
@UseGuards(AuthGuard)
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Post(':ticketId/ratings')
  create(
    @Req() request: FastifyRequest,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: CreateRatingDto,
  ) {
    return this.ratings.create(
      request.user!,
      ticketId,
      dto,
      request.correlationId!,
    );
  }
}
```

The controller intentionally contains no SQL, policy or duplicate logic.

## 6. Service transaction

Create a local PostgreSQL error guard:

```ts
function isUniqueViolation(error: unknown, constraint: string): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && error.code === '23505'
    && 'constraint' in error && error.constraint === constraint;
}
```

Service skeleton:

```ts
@Injectable()
export class RatingsService {
  constructor(
    private readonly db: PgService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async create(
    user: UserContext,
    ticketId: string,
    dto: CreateRatingDto,
    correlationId: string,
  ): Promise<RatingView> {
    try {
      return await this.db.transaction(async (client) => {
        const result = await client.query<TicketPolicySubject & { status: string }>(
          `SELECT id, status, queue, branch_code, department,
                  legal_entity, country, sensitivity, created_by, assigned_to
             FROM tickets
            WHERE id = $1
            FOR UPDATE`,
          [ticketId],
        );
        const ticket = result.rows[0];
        if (!ticket) throw new NotFoundException('Ticket not found');

        this.policy.assertTicketAccess(user, ticket, 'ticket:update');
        if (ticket.status !== 'resolved') {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            code: 'ticket_not_resolved',
            message: 'Ratings are available only after resolution.',
          });
        }

        const inserted = await client.query<{
          id: string;
          rating: number;
          comment: string | null;
          actor_id: string;
          created_at: Date;
        }>(
          `INSERT INTO ticket_ratings
             (ticket_id, actor_id, rating, comment)
           VALUES ($1, $2, $3, $4)
           RETURNING id, rating, comment, actor_id, created_at`,
          [ticketId, user.subject, dto.rating, dto.comment?.trim() ?? null],
        );

        await this.audit.write(client, {
          actorId: user.subject,
          action: 'ticket.rating_created',
          targetType: 'ticket',
          targetId: ticketId,
          correlationId,
          outcome: 'success',
          metadata: {
            rating: dto.rating,
            hasComment: Boolean(dto.comment?.trim()),
          },
        });

        await this.outbox.enqueue(client, {
          eventType: 'ticket.rating_created',
          aggregateType: 'ticket',
          aggregateId: ticketId,
          correlationId,
          payload: { ratingId: inserted.rows[0].id, rating: dto.rating },
        });

        return toRatingView(inserted.rows[0]);
      });
    } catch (error) {
      if (isUniqueViolation(
        error,
        'ticket_ratings_ticket_actor_unique',
      )) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'rating_already_exists',
          message: 'You have already rated this ticket.',
        });
      }
      throw error;
    }
  }
}
```

`FOR UPDATE` serializes rating-state verification with concurrent ticket updates that lock/update the same row. The unique constraint handles two same-actor requests even if both are submitted together. The audit and outbox calls receive the same transaction `client`, so all three writes commit or roll back together.

## 7. Response mapping

Do not leak database naming accidentally:

```ts
function toRatingView(row: RatingRow): RatingView {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    actorId: row.actor_id,
    createdAt: row.created_at.toISOString(),
  };
}
```

Decide whether comments should be visible to all ticket readers. If they can contain sensitive material, apply projection/sensitivity rules rather than returning every column by default.

## 8. Read model

Either:

- include `ratings` in the existing authorized ticket-detail query; or
- add `GET /v1/tickets/:ticketId/ratings` that loads the ticket and runs `ticket:read` policy before returning ratings.

Do not create a bare rating-by-id endpoint that omits parent ticket scope. Child-resource authorization inherits the parent ticket's scope and sensitivity.

## 9. Audit and event minimization

Audit metadata includes rating value and whether a comment exists, not the comment body. The immutable evidence trail should not duplicate free text unnecessarily. The outbox event likewise carries only the minimum downstream contract.

Update the event catalogue with:

```text
ticket.rating_created
producer: RatingsService
aggregate: ticket
payload: ratingId, rating
delivery: transactional outbox, at least once
consumer idempotency key: eventId
```

## 10. Backend completion checklist

- migration applies and rolls back safely in a disposable database;
- DTO rejects out-of-range, non-integer, oversized and extra input;
- module resolves all tokens;
- controller gets actor only from guard context;
- service checks resource policy before state mutation;
- current ticket state is locked/read inside transaction;
- uniqueness is database-enforced and mapped to stable 409 code;
- rating, audit and outbox are one transaction;
- response is an explicit projection;
- read path repeats parent authorization;
- module/event/access docs are updated.
