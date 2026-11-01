# Directory interview Q&A

[Back to Directory index](README.md)

---

**Q1. Why not store names on tickets?**
> Names change and collide; evidence must point to a stable identity. We store the IdP subject and resolve names for display.

**Q2. Where do names come from?**
> From each person's own verified token, upserted when they call `/me`. A bank can also sync from HR (SCIM).

**Q3. Why is the directory update best-effort?**
> It's decoration. Blocking sign-in because a display-name insert failed would turn a cosmetic issue into an outage.

**Q4. How do you avoid 50 lookups for a 50-row table?**
> A tiny batcher collects requests for 10 ms and sends one POST with up to 200 IDs; each ID is then cached by TanStack Query for 10 minutes.

**Q5. Can someone use lookup to enumerate staff in other entities?**
> No. The query is limited to the caller's entity and country, machine identities are refused, and unknown IDs are omitted.

**Q6. Is the people picker a security control?**
> No. It's convenience. The backend must validate the assignee itself; that check is a known gap with a planned fix.

## Limitations
1. People who never opened the console have no name (an HR sync would fix that).
2. No delisting of leavers (rows stay; `last_seen_at` could drive cleanup).
