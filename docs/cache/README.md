# Cache (Redis, optional and fail-open)

> **Cache**: a fast copy of data that is expensive to fetch, kept for a short time.
> **Fail-open (for a cache)**: if the cache is down or broken, act as if it were empty and go to the real source, rather than failing the request.
> **Non-authoritative**: the cache is never the truth. PostgreSQL is.
> In plain words: a sticky note with today's menu on the fridge. If it falls off, you check the real menu; nobody goes hungry.

## Where it lives

| File | Role |
|---|---|
| [cache/redis-cache.service.ts](../../apps/api/src/cache/redis-cache.service.ts) | `getJson`, `setJson` (TTL required), `delete`, lazy connect, disable on error |
| [cache/cache.module.ts](../../apps/api/src/cache/cache.module.ts) | `@Global` |
| [configuration/configuration.service.ts#L48-L56](../../apps/api/src/configuration/configuration.service.ts#L48-L56) | The one current user: active communication templates (30 s) |
| [test/redis-cache.service.spec.ts](../../apps/api/test/redis-cache.service.spec.ts) | Fails open when not configured |

## How it works

[redis-cache.service.ts](../../apps/api/src/cache/redis-cache.service.ts):

```ts
private readonly client = process.env.REDIS_URL ? createClient({ url: process.env.REDIS_URL }) : null;  // no URL → no cache
private disabled = false;
constructor() { this.client?.on('error', () => { this.disabled = true; }); }          // any error → stop using it
async getJson<T>(key) { if (!(await this.ready())) return null; try { const v = await this.client!.get(key); return v ? JSON.parse(v) : null; } catch { this.disabled = true; return null; } }
async setJson(key, value, ttlSeconds) { ... set(key, JSON.stringify(value), { EX: ttlSeconds }) ... }  // TTL is mandatory
private async ready() { if (!this.client || this.disabled) return false; if (this.client.isReady) return true;
  this.connecting ??= this.client.connect().then(() => undefined).catch(() => { this.disabled = true; });   // connect lazily, once
  await this.connecting; return this.client.isReady && !this.disabled; }
```

| Design choice | Plain reason |
|---|---|
| No `REDIS_URL` → `null` client | Redis is optional; dev and test need nothing |
| **Lazy connect**, shared promise | First use connects once; concurrent callers wait on the same promise |
| Any error → `disabled = true` for this process | A broken Redis doesn't add latency to every request; we stop trying |
| Every read error → `null` (a miss) | Callers always have a fallback |
| TTL is a required argument | Nothing lives forever; staleness is bounded |
| `onModuleDestroy` → `quit()` | Clean shutdown |

### Current use: template list

```ts
const cached = await this.cache.getJson('configuration:communication-templates:v1'); if (cached) return cached;
const templates = ...SELECT active templates...; await this.cache.setJson(KEY, templates, 30); return templates;
// on admin save (after commit): await this.cache.delete(KEY);
```

It is non-sensitive data, the same for every staff member in the deployment, so there are no per-user keys to get wrong. It is invalidated **after** commit, so a reader can't re-cache the old value from an uncommitted state.

## Rules for adding cache entries

1. Only cache what's safe to be stale for the TTL.
2. **If the result depends on who is asking, the key must include every dimension that affects it** (entity, country, queues, roles). Missing one leaks data between users.
3. Never cache tokens, step-up decisions or permissions.
4. Mutations must **re-validate** against PostgreSQL (e.g. `assertTicketSelection`), never trust cached lists.
5. Version the key (`:v1`) so a shape change can't read old data.

## Server cache vs browser cache

| | Redis (server) | TanStack Query (browser) |
|---|---|---|
| Shared by | all users, all instances | one tab, one user |
| Purpose | reduce repeated DB work | request lifecycle, deduping, refetch |
| Authority | never | never; refetch after changes and SSE hints |

## Interview answer

> Redis is optional and non-authoritative. The wrapper connects lazily, requires a TTL on every write, and on any error disables itself so reads become misses and writes no-ops, so the request falls back to PostgreSQL. Today it caches the active template list for 30 seconds and is cleared after an admin save commits. If I cached scoped data, the key would include every authorization dimension, and mutations would still re-validate against the database.

## Q&A

**Why fail-open?** A cache outage should cost performance, never correctness or availability. **Why not cache ticket lists?** They're per-user and scope-dependent, change often, and are already fast with the paging index. The risk of a wrong key outweighs the gain. **What's the risk of `disabled` staying true?** Redis recovering isn't noticed until restart; a periodic re-probe would fix that.

Related: [Configuration](../configuration/backend.md#5-caching-templates) · [Frontend data fetching](../frontend-architecture/data-fetching.md)
