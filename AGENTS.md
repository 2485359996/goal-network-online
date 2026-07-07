This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm** (`pnpm@10.33.0`); the project is ESM (`"type": "module"`).

- `pnpm dev` — Next.js dev server on `127.0.0.1`
- `pnpm build` — **`tsc --noEmit` then `next build`**; type errors fail the build (strict TS)
- `pnpm start` — production server
- `pnpm test` — run the full Vitest suite once

Run a single test file or filter by name:
```
pnpm test src/lib/stores/goals.test.ts
pnpm exec vitest run -t "weighted progress"
```
There is no `vitest.config.*`; Vitest runs on defaults. Tests are co-located `*.test.ts` next to the code.

Required env (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `AI_PROVIDER_URL/KEY/MODEL`, `GITHUB_APP_*`.

## Architecture

This is the **cloud/online edition** of a personal goal-network system ("目标网络"): Next.js 16 (App Router) + React 19 + Supabase (Postgres + Auth + Realtime + Storage) + TypeScript. It visualizes personal goal trees as celestial maps: the SVG goalscape/star map, a radial sunburst, and a 3D goal mesh. Keep the 天体/星图 metaphor; **do not** introduce dashboard-style charts, KPI panels, or progress bars as the primary visual language.

### Supabase runtime backend

The central design fact: **Supabase is the product backend**. Runtime goal operations go through API routes and `SupabaseGoalStore`; goals, parent relations, maps, actions, records, audit events, and sync jobs live in Postgres.

**`SupabaseGoalStore`** (`src/lib/stores/goals.ts`) is the live runtime store. Every API route uses it. Goals are Postgres rows; the tree lives in the `goal_relations` table with `relation_type = 'parent'` only. Historical horizontal relation types (`supports`, `depends_on`, `conflicts_with`) were removed; treat old references to them as stale unless a task explicitly reintroduces that product surface. `buildGoalsResponse()` reassembles goal rows + parent relations into the nested `GoalsResponse`.

Historical migration/export helpers are not product architecture. Current backend changes should start from the Supabase store, API contracts, and database schema; update migration/export tooling only when the changed shape affects it.

### Domain rules

- **Weighted progress rollup**: leaf goals carry their own `progress`; a parent's progress is the priority-weighted average of its children (`applyWeightedProgress`, used by `SupabaseGoalStore`). **Primary root goals** (职业发展 / 个人成长 / 幸福生活 — `src/shared/goalRules.ts`) have no own progress.
- **Goal maps** (`goal_maps`): a workspace can hold several independent goal networks. `map_positions` (jsonb) stores per-map node coordinates keyed by context id.
- **Goal identity**: `legacy_id` is a stable slug derived from parent + title and is still used by the store to map API-facing goal ids to database rows.
- **Goal relations**: current runtime supports parent/child hierarchy only. If horizontal goal relations are reintroduced, update the database check constraint, shared types, API schemas/routes, AI contracts/context, GitHub export/import paths, docs, and tests together.

### Request flow

- **Client** (`src/client/main.tsx`, the `GoalApp` — a large ~4.9k-line component) calls JSON `/api/*` routes through the `api<T>()` fetch helper, and subscribes to Supabase Realtime `postgres_changes` to refetch when another session mutates data.
- **API routes** (`app/api/**/route.ts`) all share one pattern: `getApiContext()` → `assertCanWrite(role)` (mutations) → zod-validate body (`src/lib/api/schemas.ts`) → call `SupabaseGoalStore` → `jsonError()` on throw. All declare `runtime = "nodejs"`.
- **Auth & tenancy**: Supabase SSR cookies; `proxy.ts` (Next.js request middleware, with a path matcher) refreshes the session on every matched request via `updateSession`. Login uses server actions (`app/login/actions.ts`). `getApiContext()` resolves the caller's workspace (auto-creating one on first use) and role. Multi-tenancy is enforced by **Postgres RLS** keyed on `memberships` (see the migration); the service-role admin client (`src/lib/supabase/admin.ts`) bypasses RLS for server work.

### Async GitHub sync

Mutations enqueue `audit_events` + `sync_jobs` via `enqueueAuditAndSync`. A Vercel cron (`vercel.json`, daily 02:00 → `/api/cron/drain-jobs`, authorized by `Bearer CRON_SECRET`) calls `drainSyncJobs()`, which claims pending jobs and runs `exportWorkspaceToGitHub`. Jobs retry up to 5 attempts before `failed`.

### AI layer

`src/shared/aiContracts.ts` defines zod request/response contracts for 5 endpoints (`improve-goal`, `suggest-subgoals`, `diagnose-branch`, `suggest-weekly-actions`, `draft-goal`). `src/server/ai.ts` `runAiProvider()` calls an **OpenAI-compatible** `/chat/completions` endpoint with `response_format: json_object`. The dynamic route `app/api/ai/[endpoint]/route.ts` validates both request and response against the contract. UI is `src/client/AiAssistantDialog.tsx`. Branch summaries no longer include horizontal relation counts.

### Visualization

`src/client/goalscapeLayout.ts` is the SVG layout engine for the floating "goalscape" blob map and the radial "sunburst" map. `src/client/GoalMeshMap.tsx` renders the 3D mesh mode with `3d-force-graph` and Three.js. `src/client/goalUtils.ts` holds pure helpers (progress/importance math, color/domain derivation). These pure modules carry most of the test coverage; the large `main.tsx` component is only covered by focused source-contract tests.

## Database

Schema and RLS live in `supabase/migrations/`. Core tables: `workspaces`, `memberships`, `goal_maps`, `goals`, `goal_relations`, `weekly_actions`, `records`, `sync_jobs`, `audit_events`. `goal_relations.relation_type` is constrained to `parent`. RLS policies call `app_private.current_user_workspace_role(workspace_id)`; `goals`/`goal_relations`/`goal_maps`/`weekly_actions`/`records` are added to the `supabase_realtime` publication.

## Conventions & gotchas

- Path alias `@/*` maps to the repo root.
- Chinese is first-class: section headings (子方向, 成功信号, 行动候选, 复盘问题), primary goal titles, and user-facing strings are all Chinese.
- In `src/shared/types.ts`, `directionHeading` includes mojibake fallback literals (`瀛愭柟鍚?`, `涓湡鐩爣`) — these are intentional encoding-tolerance for older imported data, not bugs to "clean up".
