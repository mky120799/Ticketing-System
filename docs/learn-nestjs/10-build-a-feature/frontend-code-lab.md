# Lesson 10 frontend code lab: rating from the ticket workspace

[Core chapter](README.md) · [Backend lab](backend-code-lab.md) · **Frontend lab** · [Tests and interview](practice-and-interview.md) · [Course index](../README.md)

This lab integrates the hypothetical ratings endpoint into the staff React application using its existing typed API client, session provider, TanStack Query mutation helper, Mantine UI and notification conventions.

## 1. Start from the server contract

Define returned and input types in `apps/web/src/api.ts`:

```ts
export interface TicketRating {
  id: string;
  rating: number;
  comment: string | null;
  actorId: string;
  createdAt: string;
}

export interface CreateRatingInput {
  rating: number;
  comment?: string;
}
```

If ticket detail embeds ratings, extend the existing `Ticket` interface:

```ts
export interface Ticket extends TicketListItem {
  // existing fields...
  ratings?: TicketRating[];
}
```

The frontend type describes the contract but does not validate the server or grant access. Runtime server validation remains authoritative.

## 2. Add one API function

Reuse the shared request helper so bearer token, correlation id, 401 sign-out, step-up events and structured `ApiError` behavior remain consistent:

```ts
export const createTicketRating = (
  user: User,
  ticketId: string,
  input: CreateRatingInput,
): Promise<TicketRating> =>
  post(user, `/tickets/${ticketId}/ratings`, input);
```

Do not call `fetch` directly from the component. That would duplicate security/error behavior and make tests inconsistent.

## 3. Mutation and cache strategy

Use the existing `useTicketMutation` helper:

```ts
const save = useTicketMutation<CreateRatingInput, TicketRating>(
  ticket.id,
  (user, input) => createTicketRating(user, ticket.id, input),
  (result) => `Rating ${result.rating}/5 recorded`,
);
```

On success, the helper calls `refreshTicket`, which updates authoritative ticket detail and relevant list/dashboard caches according to the current cache utility. On 409 it also refetches, so a duplicate or changed state becomes visible.

Avoid optimistic insertion for this feature. The operation depends on current resolved state, server authorization and a uniqueness constraint; waiting for confirmation keeps rollback/error UX simple. Optimistic UI is a latency choice, not a default virtue.

## 4. Component

Create `apps/web/src/features/ticket/rating-panel.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import {
  Button,
  NativeSelect,
  Paper,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import {
  createTicketRating,
  type CreateRatingInput,
  type Ticket,
  type TicketRating,
} from '../../api';
import { notifyError } from '../../lib/notify';
import { useTicketMutation } from '../tickets/use-ticket-queries';

export function RatingPanel({ ticket }: { ticket: Ticket }) {
  const [rating, setRating] = useState('');
  const [comment, setComment] = useState('');

  const save = useTicketMutation<CreateRatingInput, TicketRating>(
    ticket.id,
    (user, input) => createTicketRating(user, ticket.id, input),
    (result) => `Rating ${result.rating}/5 recorded`,
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(rating);
    if (!Number.isInteger(value) || value < 1 || value > 5) return;

    save.mutate(
      {
        rating: value,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      },
      {
        onSuccess: () => {
          setRating('');
          setComment('');
        },
        onError: (error) => notifyError(error, 'Rating was not saved'),
      },
    );
  };

  if (ticket.status !== 'resolved') {
    return (
      <Paper p="md">
        <Text size="sm" c="dimmed">
          Ratings become available after the ticket is resolved.
        </Text>
      </Paper>
    );
  }

  return (
    <Paper p="md" component="form" onSubmit={submit}>
      <Stack gap="sm">
        <NativeSelect
          label="Rating"
          required
          value={rating}
          onChange={(event) => setRating(event.currentTarget.value)}
          data={[
            { value: '', label: 'Choose 1 to 5' },
            ...[1, 2, 3, 4, 5].map((value) => ({
              value: String(value),
              label: `${value} / 5`,
            })),
          ]}
        />
        <Textarea
          label="Comment (optional)"
          maxLength={500}
          value={comment}
          onChange={(event) => setComment(event.currentTarget.value)}
        />
        <Button
          type="submit"
          loading={save.isPending}
          disabled={!rating || save.isPending}
        >
          Save rating
        </Button>
      </Stack>
    </Paper>
  );
}
```

The browser performs basic usability checks, but the DTO/database repeat all meaningful constraints.

## 5. Capability and placement

Render the panel in `ticket-page.tsx` only for a presentation capability such as `can('workTicket')` and a resolved ticket. That prevents confusing controls for obviously ineligible users.

Still expect server 403/404/409 because:

- permissions or entitlements can change after page load;
- ticket scope/state can change concurrently;
- a user can call the API outside the UI;
- frontend capability mapping may lag backend policy.

The UI check is affordance, not security.

## 6. Existing rating display

Render returned ratings as text and names through the directory mapping, not raw HTML:

```tsx
{ticket.ratings?.map((item) => (
  <Paper key={item.id} p="sm" withBorder>
    <Text fw={600}>{item.rating} / 5</Text>
    {item.comment && <Text className="pre-wrap">{item.comment}</Text>}
    <Text size="xs" c="dimmed">
      <PersonName id={item.actorId} /> · {formatDateTime(item.createdAt)}
    </Text>
  </Paper>
))}
```

React escapes text by default. Do not use `dangerouslySetInnerHTML` for the comment.

## 7. Error-specific UX

The shared API client converts server failures to `ApiError`:

| Error | UX behavior |
|---|---|
| 401 | shared client starts sign-out/session recovery |
| 403 | error notification; no automatic retry |
| 404 | ticket refetch/navigation can move to safe not-found state |
| 409 `ticket_not_resolved` | refetch ticket and explain state changed |
| 409 `rating_already_exists` | refetch and show existing rating |
| network/5xx | preserve entered comment and allow deliberate retry |

The generic mutation helper refetches on any 409. The component should not clear local form state on error, so the user does not lose a comment.

For finer messages, branch on `error instanceof ApiError && error.code`, not exact backend prose.

## 8. Accessibility and interaction details

- every input has a visible label;
- form submission works with keyboard/Enter;
- pending state disables duplicate clicks;
- validation is not color-only;
- success and error notifications have accessible dismiss labels through the shared helper;
- focus should remain useful after an error; for larger forms, focus the first invalid field;
- comments preserve line breaks with safe text rendering.

## 9. Live updates

If the backend publishes `ticket.rating_created`, the SSE subscriber should treat it as a hint to invalidate/refetch the ticket query. It should not insert the event payload directly as trusted detail because:

- SSE can reconnect and miss events;
- event payload is intentionally minimal;
- current user scope may have changed;
- duplicate at-least-once events are possible.

## 10. Customer-portal decision

This lab is explicitly a staff feature. If the business requirement is customer satisfaction instead:

- put the route under the portal controller/security boundary;
- derive customer subject from `PortalAuthGuard`;
- verify ownership of the portal request/ticket;
- expose it in `apps/portal`, not the staff capability system;
- design anonymous/privacy/abuse controls separately.

Do not reuse a staff route merely because the payload is similar.

## 11. Frontend completion checklist

- types match the documented response;
- all calls use the shared API client;
- token is only in the Authorization header;
- correlation id is generated by shared request code;
- component uses the session and mutation abstractions;
- pending state blocks double-clicks;
- form clears only on success;
- 409 triggers authoritative refetch;
- frontend capability is treated as presentation only;
- text is safely rendered;
- tests cover success, denial, conflict and keyboard/label behavior.
