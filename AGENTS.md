This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm** (`pnpm@10.33.0`); the project is ESM (`"type": "module"`).

- `pnpm dev` — Next.js dev server on `127.0.0.1`
- `pnpm build` — **`tsc --noEmit` then `next build`**; type errors fail the build (strict TS)
- `pnpm start` — production server
- `pnpm test` — run the full Vitest suite once
- `pnpm import:vault` — one-time historical data migration helper (`tsx scripts/import-vault.ts`)

Run a single test file or filter by name:
```
pnpm test src/lib/stores/goals.test.ts
pnpm exec vitest run -t "weighted progress"
```
There is no `vitest.config.*`; Vitest runs on defaults. Tests are co-located `*.test.ts` next to the code.

Required env (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `AI_PROVIDER_URL/KEY/MODEL`, `GITHUB_APP_*`. The optional historical migration helper also needs `GOAL_NETWORK_VAULT`, `IMPORT_OWNER_USER_ID`.

## Architecture

This is the **cloud/online edition** of a personal goal-network system ("目标网络"): Next.js 16 (App Router) + React 19 + Supabase (Postgres + Auth + Realtime + Storage) + TypeScript. It visualizes a personal goal tree as a floating "star map" (see PRODUCT.md / DESIGN.md for the design language — 天体/星图 metaphor; **do not** introduce dashboard-style charts or progress bars).

### Supabase runtime backend

The central design fact: **Supabase is the product backend**. Runtime goal operations go through API routes and `SupabaseGoalStore`; goals, relations, maps, actions, records, audit events, and sync jobs live in Postgres.

**`SupabaseGoalStore`** (`src/lib/stores/goals.ts`) is the live runtime store. Every API route uses it. Goals are Postgres rows; the tree and cross-links live in a separate `goal_relations` table (`relation_type`: `parent` / `supports` / `depends_on` / `conflicts_with`). `buildGoalsResponse()` reassembles rows + relations into the nested `GoalsResponse`.

Historical migration/export helpers are not product architecture. Current backend changes should start from the Supabase store, API contracts, and database schema; update migration/export tooling only when the changed shape affects it.

### Domain rules

- **Weighted progress rollup**: leaf goals carry their own `progress`; a parent's progress is the priority-weighted average of its children (`applyWeightedProgress`, used by `SupabaseGoalStore`). **Primary root goals** (职业发展 / 个人成长 / 幸福生活 — `src/shared/goalRules.ts`) have no own progress.
- **Goal maps** (`goal_maps`): a workspace can hold several independent goal networks. `map_positions` (jsonb) stores per-map node coordinates keyed by context id.
- **Goal identity**: `legacy_id` is a stable slug derived from parent + title and is still used by the store to map API-facing goal ids to database rows.

### Request flow

- **Client** (`src/client/main.tsx`, the `GoalApp` — a single ~3.5k-line component) calls JSON `/api/*` routes through the `api<T>()` fetch helper, and subscribes to Supabase Realtime `postgres_changes` to refetch when another session mutates data.
- **API routes** (`app/api/**/route.ts`) all share one pattern: `getApiContext()` → `assertCanWrite(role)` (mutations) → zod-validate body (`src/lib/api/schemas.ts`) → call `SupabaseGoalStore` → `jsonError()` on throw. All declare `runtime = "nodejs"`.
- **Auth & tenancy**: Supabase SSR cookies; `proxy.ts` (Next.js request middleware, with a path matcher) refreshes the session on every matched request via `updateSession`. Login uses server actions (`app/login/actions.ts`). `getApiContext()` resolves the caller's workspace (auto-creating one on first use) and role. Multi-tenancy is enforced by **Postgres RLS** keyed on `memberships` (see the migration); the service-role admin client (`src/lib/supabase/admin.ts`) bypasses RLS for server work.

### Async GitHub sync

Mutations enqueue `audit_events` + `sync_jobs` via `enqueueAuditAndSync`. A Vercel cron (`vercel.json`, daily 02:00 → `/api/cron/drain-jobs`, authorized by `Bearer CRON_SECRET`) calls `drainSyncJobs()`, which claims pending jobs and runs `exportWorkspaceToGitHub`. Jobs retry up to 5 attempts before `failed`.

### AI layer

`src/shared/aiContracts.ts` defines zod request/response contracts for 5 endpoints (`improve-goal`, `suggest-subgoals`, `diagnose-branch`, `suggest-weekly-actions`, `draft-goal`). `src/server/ai.ts` `runAiProvider()` calls an **OpenAI-compatible** `/chat/completions` endpoint with `response_format: json_object`. The dynamic route `app/api/ai/[endpoint]/route.ts` validates both request and response against the contract. UI is `src/client/AiAssistantDialog.tsx`.

### Visualization

`src/client/goalscapeLayout.ts` is the SVG layout engine, with two modes: the floating "goalscape" blob map and a radial "sunburst" map. `src/client/goalUtils.ts` holds pure helpers (progress/importance math, color/domain derivation). These pure modules carry most of the test coverage; the large `main.tsx` component is not unit-tested.

## Database

Schema and RLS live in `supabase/migrations/`. Core tables: `workspaces`, `memberships`, `goal_maps`, `goals`, `goal_relations`, `weekly_actions`, `records`, `sync_jobs`, `audit_events`. RLS policies call `app_private.current_user_workspace_role(workspace_id)`; `goals`/`goal_relations`/`goal_maps`/`weekly_actions`/`records` are added to the `supabase_realtime` publication.

## Conventions & gotchas

- Path alias `@/*` maps to the repo root.
- Chinese is first-class: section headings (子方向, 成功信号, 行动候选, 复盘问题), primary goal titles, and user-facing strings are all Chinese.
- In `src/shared/types.ts`, `directionHeading` includes mojibake fallback literals (`瀛愭柟鍚?`, `涓湡鐩爣`) — these are intentional encoding-tolerance for older imported data, not bugs to "clean up".
