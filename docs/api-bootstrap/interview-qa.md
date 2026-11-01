# API bootstrap interview Q&A

[Back to API bootstrap index](README.md)

---

**Q1. Walk me through `main.ts`.**
> Production safety first; then Nest on Fastify with header-redacting logs, a 1 MiB body limit and explicit trust-proxy; Helmet with a JSON-only CSP and HSTS; a per-client rate limit excluding health, metrics and SSE; per-request `AsyncLocalStorage`; an empty-JSON-body parser; the `/v1` prefix; allow-listed CORS with only our custom headers; and a global whitelist/forbid/transform `ValidationPipe`.

**Q2. Why Fastify instead of Express?**
> Higher throughput and lower overhead, first-class hooks and a pino logger with redaction. Nest abstracts most differences.

**Q3. Why such a strict CSP on an API?**
> The API never serves HTML, so `default-src 'none'` and `frame-ancestors 'none'` cost nothing and neutralise any accidental HTML response.

**Q4. What does `forbidNonWhitelisted` protect against?**
> Mass assignment: sending extra fields like `createdBy` or `status` hoping the service spreads them into SQL. Unknown fields cause a 400.

**Q5. What does `@Global()` mean, and isn't it risky?**
> It makes the module's exports injectable without importing. I use it for infrastructure (DB, audit, outbox, live, notifications) and keep domain modules explicit so ownership stays visible. It has nothing to do with route visibility.

**Q6. Where do guards sit relative to interceptors and pipes?**
> Middleware/hooks → guards → interceptors (before) → pipes → handler → interceptors (after) → filters. A guard's 401 never reaches the interceptors. Errors thrown by pipes, the handler or services flow back through them, which is how the global interceptor audits service 403s.

**Q7. How do background workers start?**
> `onModuleInit` hooks, each opt-in by environment. The same image can be API-only or a worker, and `onModuleDestroy` stops timers and closes connections for graceful shutdown.

**Q8. Why AsyncLocalStorage?**
> To give the audit writer per-request facts (IP, user agent, token ID, ACR) without adding parameters to every method.

**Q9. What would you improve?**
> A SQLSTATE-aware exception filter, `ParseUUIDPipe` on every ID route, and a distributed rate limiter (the current one is per instance).
