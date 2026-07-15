---
name: add-feature
description: Add a new feature to ContactHub without introducing bugs or regressions — enforces shape parity between the React frontend and the Express LAN server, keeps the localStorage fallback in `src/lib/api.ts` working, and runs the type-check / build before claiming success.
whenToUse: Use when the user asks to "add", "implement", "build", or "extend" a feature in ContactHub. Triggers on requests like "add a new field to the employee form", "add an audit-log export endpoint", "add a new admin page", "wire up a new role", "create a new CRUD service".
argumentHint: "<feature description>"
---

# Add a New Feature to ContactHub (issue-free)

Workflow for adding a feature to this React + TypeScript + Vite SPA and
its companion Express LAN server, **without** introducing regressions.
The app has two persistence paths (LAN HTTP + localStorage fallback)
that MUST stay in sync. Both shapes are real production paths.

## When to invoke this skill

Trigger this skill for any non-trivial feature request: new page, new
field, new endpoint, new service, new permission, new UI section. Skip
it for trivial one-line typo fixes or cosmetic-only edits.

## Steps

1. **Read the request carefully and clarify unknowns first.** If the
   request is ambiguous about scope, role (admin vs user), persistence
   (LAN vs localStorage), or routing, ask one tight clarifying question
   before writing code. Do NOT guess — guessing has been the source of
   every recent bug in this repo.

2. **Map the touch points before editing.** Use grep / file_search to
   confirm exactly which files participate:
   - Routing → `src/App.tsx` (admin vs user, `AdminRoute` / `UserRoute`)
   - Auth / role → `src/contexts/AuthContext.tsx`,
     `src/components/ProtectedRoute.tsx`, `src/components/RoleGuard.tsx`
   - API client → `src/lib/api.ts` (LAN `http()` + `api.__local` fallback)
   - Service layer → `src/services/*.ts` (one file per domain)
   - Data shapes → `src/data/mockData.ts` (TypeScript interfaces)
   - Pages → `src/pages/admin/*` and `src/pages/user/*`
   - Server endpoints → `server/index.js` (single file, all routes)
   - Layout / nav → `src/components/AppLayout.tsx`

3. **Plan the data shape first, then the code.** Write down every
   field the new feature needs. Decide for each field:
   - **Server shape (camelCase)** — e.g. `fullName`, `isActive`,
     `lastLogin`. Match the conventions already used in `server/index.js`
     (`publicUser()`, `employeeToFrontend()`, etc.).
   - **localStorage fallback shape (snake_case)** — used by
     `api.__local`. Different conventions are intentional; the mapper
     in the service layer translates both.
   - The mapper MUST accept both shapes (see
     `src/services/employeeService.ts` `mapEmployee` and
     `src/services/adminService.ts` `mapSystemUser` as reference
     patterns). Do NOT write a mapper that only reads one shape — that
     breaks the offline fallback.

4. **Add the server endpoint in `server/index.js` if needed.** Follow
   existing patterns:
   - Use `authMiddleware` for any endpoint that needs a session.
   - Use `adminOnly` for admin-only endpoints (defense in depth — the
     frontend also gates with `RoleGuard`).
   - Return camelCase via `publicUser()` / `employeeToFrontend()`
     helpers — do NOT return raw DB rows.
   - Mutating endpoints must call `saveData(db)` before responding.
   - User-visible mutations must call `logActivity(...)` so
     `/api/v1/admin/audit-logs` keeps working.
   - Keep `sessionSecret` preserved in the JSON file (already handled
     by `loadData`).

5. **Add the service-layer method.** One file in `src/services/` per
   domain. The method should:
   - Use `api.get<T>` / `api.post<T>` etc., not raw `fetch`.
   - Wrap the response in a mapper that accepts both camelCase and
     snake_case (see existing `mapEmployee`, `mapSystemUser`).
   - Return a stable TS interface from `src/data/mockData.ts` (add the
     interface there if it's a new domain).

6. **Add the page or component in `src/pages/`.** Wire the route in
   `src/App.tsx` using `AdminRoute` / `UserRoute` wrappers. Add a nav
   entry in `src/components/AppLayout.tsx` so the page is reachable.
   Use shadcn/ui primitives from `src/components/ui/*` — do NOT pull
   new dependencies unless strictly necessary.

7. **Preserve the offline fallback.** `src/lib/api.ts` falls back to
   per-browser localStorage when the server is unreachable. Any new
   service method that POSTs / PATCHes / DELETEs must also have a
   matching branch under `api.__local.request(...)` so a single user
   without the server still gets full functionality. Mismatched
   coverage here is a known regression source.

8. **Sanity-check error handling.** Existing lessons learned:
   - Never call `new Date(undefined).toISOString()` — guard with a
     `toIsoDate()` helper or nullish coalescing.
   - Wrap CRUD handlers in try/catch and surface the real error in a
     toast (see `src/pages/admin/DepartmentManagement.tsx`).
   - Don't log the user out on transient network errors. Only clear
     tokens on HTTP **401** (already handled in `api.ts` and
     `authService.ts` after recent fixes).

9. **Verify before claiming done.** Run, in order:
   - `npm run lint` — must pass with zero errors.
   - `npm run build` — must succeed (this is the user's hard gate;
     they've reported "build failed" multiple times).
   - `npm run dev` — manually click through the new feature in the
     browser if local.
   - `npm run docker:rebuild` — only if the change touches the
     server, Dockerfile, or compose file.

10. **Summarize the change.** In your final reply, list:
    - Files created / modified (with one-line reason each)
    - The new route / endpoint paths
    - The exact verification commands the user can run
    - Any deliberate deviations from the request and why

## Inputs

- `{{argument}}` — natural-language description of the feature, e.g.
  "add a 'last contacted' date field to employees and show it on the
  user directory page".

## Output

- Working code committed to the repo
- Routes registered in `src/App.tsx` (if a new page)
- Server endpoints in `server/index.js` (if backend changes needed)
- Mappers that handle BOTH camelCase (LAN) and snake_case
  (localStorage) shapes
- A passing `npm run build` and `npm run lint`
- A short summary of files touched + verification steps

## Examples

- `/add-feature add a "last contacted" date to employees`
  → New `lastContacted` field on the employee type; `server/index.js`
    reads/writes it; `mapEmployee` and the offline branch handle
    both shapes; new column on `AdminDirectory` and `UserDirectoryPage`.
- `/add-feature add an audit-log export endpoint`
  → New `app.get('/api/v1/admin/audit-logs/export', ...)` in
    `server/index.js`; matching `auditService.exportLogs()`; small UI
    button on `ActivityLogPage`.
- `/add-feature add a "favorites" toggle on the user directory`
  → New localStorage-only path under `api.__local` (LAN sharing of
    favorites is out of scope per project goals); UI toggle on
    `UserDirectoryPage`.