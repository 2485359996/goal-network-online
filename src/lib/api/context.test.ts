import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError, apiErrorMessage, selectApiMembership } from "./context";

function migrationSource(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("apiErrorMessage", () => {
  it("keeps explicit ApiError messages", () => {
    expect(apiErrorMessage(new ApiError("Forbidden", 403))).toBe("Forbidden");
  });

  it("extracts Supabase object error messages", () => {
    expect(apiErrorMessage({ message: "relation goal_maps does not exist", code: "42P01" })).toBe("relation goal_maps does not exist");
  });

  it("falls back to detail, hint, code, then the generic message", () => {
    expect(apiErrorMessage({ details: "Duplicate key", hint: "Use another name" })).toBe("Duplicate key");
    expect(apiErrorMessage({ hint: "Use another name" })).toBe("Use another name");
    expect(apiErrorMessage({ code: "23505" })).toBe("23505");
    expect(apiErrorMessage({})).toBe("Request failed");
  });
});

describe("API workspace context selection", () => {
  it("prefers a user-owned workspace over a backdated membership row", () => {
    const selected = selectApiMembership(
      [
        { workspace_id: "attacker-workspace", role: "member", created_at: "2000-01-01T00:00:00.000Z" },
        { workspace_id: "victim-workspace", role: "owner", created_at: "2026-01-01T00:00:00.000Z" }
      ],
      new Set(["victim-workspace"])
    );

    expect(selected).toMatchObject({ workspace_id: "victim-workspace", role: "owner" });
  });

  it("falls back to the newest membership when no owned workspace exists", () => {
    const selected = selectApiMembership(
      [
        { workspace_id: "old-workspace", role: "member", created_at: "2024-01-01T00:00:00.000Z" },
        { workspace_id: "new-workspace", role: "member", created_at: "2026-01-01T00:00:00.000Z" }
      ],
      new Set()
    );

    expect(selected).toMatchObject({ workspace_id: "new-workspace" });
  });

  it("revokes direct authenticated membership writes in migrations", () => {
    const initial = migrationSource("supabase/migrations/202605290001_goal_network_online.sql");
    const hardening = migrationSource("supabase/migrations/20260707152045_fix_security_findings.sql");

    expect(initial).toContain("grant select on public.memberships to authenticated;");
    expect(initial).not.toContain("grant select, insert, update, delete on public.memberships to authenticated;");
    expect(hardening).toContain("revoke insert, update, delete on public.memberships from authenticated;");
    expect(hardening).toContain('drop policy if exists "owners can insert memberships" on public.memberships;');
  });
});
