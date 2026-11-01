# Configuration frontend (admin console)

[Back to Configuration index](README.md)

---

## 1. Page and sections

[admin-page.tsx#L17-L45](../../apps/web/src/features/admin/admin-page.tsx#L17-L45): lazy-loaded at `/admin/:section`, needs `administer`. Each section has its **own URL** (`/admin/routing`, `/admin/templates`...); an unknown section redirects to routing. `keepMounted={false}` unmounts hidden sections.

| URL segment | Component | Doc |
|---|---|---|
| `routing` | [routing-section.tsx](../../apps/web/src/features/admin/sections/routing-section.tsx) | [routing admin](../assignment-and-routing/routing-admin.md) |
| `intake` | [intake-section.tsx](../../apps/web/src/features/admin/sections/intake-section.tsx) | [intake](../intake/channel-intake.md) |
| `service-levels` | [service-levels-section.tsx](../../apps/web/src/features/admin/sections/service-levels-section.tsx) | [SLA](../sla/how-it-works.md#6-administration) |
| `compliance` | [compliance-section.tsx](../../apps/web/src/features/admin/sections/compliance-section.tsx) | [compliance](../compliance/frontend.md) |
| `workflows` | [workflows-section.tsx](../../apps/web/src/features/admin/sections/workflows-section.tsx) | [workflow](../workflow/definitions.md#6-the-editor) |
| `templates` | [templates-section.tsx](../../apps/web/src/features/admin/sections/templates-section.tsx) | [communications](../communications/frontend.md) |
| `integration` | [integration-section.tsx](../../apps/web/src/features/admin/sections/integration-section.tsx) | [outbox](../outbox/receipts-and-operations.md) |

## 2. `admin-kit.tsx`: one pattern for every section

[admin-kit.tsx](../../apps/web/src/features/admin/admin-kit.tsx):

```ts
export function useConfigList<T>(name, load, { args, enabled }) {     // L21-L24
  return useQuery({ queryKey: queryKeys.config(name, ...args), queryFn: () => load(user), enabled });
}
export function useConfigSave<T>(save, refresh: string[], message) {  // L27-L37
  return useMutation({ mutationFn: (item) => save(user, item),
    onSuccess: async (_r, item) => { await Promise.all(refresh.map((n) => queryClient.invalidateQueries({ queryKey: queryKeys.config(n) }))); notifySuccess(message(item)); } });
}
```

| Piece | Plain meaning |
|---|---|
| `useConfigList('sla', getSlaPolicies)` | Load a list, cached under `['config','sla']` |
| `useConfigSave(saveSlaPolicy, ['sla'], msg)` | Save, then refresh the named lists and show a toast |
| `EditorModal` ([L55-L70](../../apps/web/src/features/admin/admin-kit.tsx#L55-L70)) | One pop-up form shell (title, Save/Cancel, saving state) |
| `useScopeOptions` ([L40-L47](../../apps/web/src/features/admin/admin-kit.tsx#L40-L47)) | Queue and category keys for dropdowns |
| `KEY_PATTERN` ([L78](../../apps/web/src/features/admin/admin-kit.tsx#L78)) | Same key regex as the API, for early feedback |

Each section only says **what** to load and save; the **how** (caching, refresh, toasts, error handling through the global mutation handler) is shared.

Every section follows: **SectionCard** (title, explanation, "New") → table with "Edit" → **EditorModal** → Save → the list refreshes.

## 3. Interview answer

> Administration is a lazy route with one URL per section. A small kit wraps TanStack Query, so each section declares its list loader and save function, and the kit handles cache keys, invalidation after save, toasts and the editor modal. The forms mirror the API's validation for quick feedback, but the server re-validates permission, scope, references and graph rules and records the before-value in audit.
