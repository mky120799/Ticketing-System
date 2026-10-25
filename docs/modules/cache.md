# Cache module

Cache is an optional performance helper. PostgreSQL and the identity/policy path remain authoritative for permissions, ticket state, configuration and audit evidence.

## Wiring and behavior

[`CacheModule`](../../apps/api/src/cache/cache.module.ts) is global and exports [`RedisCacheService`](../../apps/api/src/cache/redis-cache.service.ts). The service creates a Redis client only when `REDIS_URL` exists and connects lazily on first use.

Its small API is intentionally generic:

- `getJson<T>(key)` returns parsed data or `null`;
- `setJson(key, value, ttlSeconds)` always requires an expiry;
- `delete(key)` invalidates a known key.

Connection and command errors mark the cache disabled for that process. Reads then return misses and writes/deletes become no-ops. Nest shutdown calls `quit` only for an open client. This fail-open behavior is safe only because callers recompute from an authoritative service and never interpret a miss/error as permission.

## Safe key and value design

A key for scoped data must include every dimension that affects the result: resource version, actor/role or permission set, legal entity, country, queues and request parameters. Omitting one can leak one user's broader result to another. Prefer caching non-sensitive configuration or derived public labels; do not cache bearer tokens, raw personal text, step-up decisions or mutable authorization grants.

TTL limits staleness, but configuration writes should also delete/version affected keys after their database transaction. If invalidation fails, the authoritative service must revalidate security-sensitive choices at mutation time—for example, Ticket creation calls `assertTicketSelection` even if the UI previously loaded cached queues.

JSON parsing is treated as untrusted cache data. For important structures, validate shape before use and fall back to PostgreSQL when malformed.

## Frontend distinction

Server Redis and browser React Query solve different problems. Redis can reduce repeated backend work across replicas; React Query manages one signed-in browser's request lifecycle. Neither is an authorization store. On logout the frontend clears user-specific queries, and live events invalidate/refetch rather than trusting cache contents.

## Tests and interview answer

Test no URL, successful get/set/delete, TTL forwarding, malformed JSON, connection failure, command failure and graceful shutdown. See [`redis-cache.service.spec.ts`](../../apps/api/test/redis-cache.service.spec.ts).

> I made Redis optional and non-authoritative. The wrapper connects lazily, requires TTLs, returns a cache miss on failure and lets callers load PostgreSQL. Scoped keys must include all authorization dimensions, and sensitive mutations revalidate against the database even if a list was cached. This means a Redis outage degrades performance but cannot grant access or change business behavior.
