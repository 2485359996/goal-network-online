import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../supabase/admin";
import { createServerSupabaseClient } from "../supabase/server";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

export function apiErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "details", "hint", "code"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return "Request failed";
}

export function jsonError(error: unknown) {
  const status = error instanceof ApiError ? error.status : 400;
  return NextResponse.json({ error: apiErrorMessage(error) }, { status });
}

type ApiMembership = {
  workspace_id: string;
  role: string;
  created_at?: string | null;
};

const ROLE_PRIORITY = new Map([
  ["owner", 4],
  ["admin", 3],
  ["member", 2],
  ["viewer", 1]
]);

function createdAtMillis(value: string | null | undefined) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function selectApiMembership(memberships: ApiMembership[], ownedWorkspaceIds: Set<string>) {
  return [...memberships].sort((a, b) => {
    const ownedPriority = Number(ownedWorkspaceIds.has(b.workspace_id)) - Number(ownedWorkspaceIds.has(a.workspace_id));
    if (ownedPriority !== 0) return ownedPriority;
    const rolePriority = (ROLE_PRIORITY.get(b.role) ?? 0) - (ROLE_PRIORITY.get(a.role) ?? 0);
    if (rolePriority !== 0) return rolePriority;
    return createdAtMillis(b.created_at) - createdAtMillis(a.created_at);
  })[0] ?? null;
}

export async function getApiContext() {
  const authClient = await createServerSupabaseClient();
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) throw new ApiError("Unauthorized", 401);

  const admin = getSupabaseAdmin();
  const existing = await admin
    .from("memberships")
    .select("workspace_id, role, created_at")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: false });
  if (existing.error) throw existing.error;

  const memberships = (existing.data ?? []) as ApiMembership[];
  if (memberships.length) {
    const workspaceIds = Array.from(new Set(memberships.map((membership) => membership.workspace_id)));
    const owned = await admin.from("workspaces").select("id").eq("owner_user_id", data.user.id).in("id", workspaceIds);
    if (owned.error) throw owned.error;
    const selected = selectApiMembership(
      memberships,
      new Set(((owned.data ?? []) as Array<{ id: string }>).map((workspace) => workspace.id))
    );
    if (!selected) throw new ApiError("Workspace not found", 404);
    return {
      admin,
      user: data.user,
      workspaceId: selected.workspace_id,
      role: selected.role
    };
  }

  const workspace = await admin
    .from("workspaces")
    .insert({
      name: "Default Workspace",
      owner_user_id: data.user.id
    })
    .select("id")
    .single();
  if (workspace.error) throw workspace.error;
  const membership = await admin.from("memberships").insert({
    workspace_id: workspace.data.id,
    user_id: data.user.id,
    role: "owner"
  });
  if (membership.error) throw membership.error;

  return {
    admin,
    user: data.user,
    workspaceId: workspace.data.id as string,
    role: "owner"
  };
}

export function assertCanWrite(role: string) {
  if (!["owner", "admin", "member"].includes(role)) throw new ApiError("Forbidden", 403);
}
