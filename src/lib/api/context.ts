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

export async function getApiContext() {
  const authClient = await createServerSupabaseClient();
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) throw new ApiError("Unauthorized", 401);

  const admin = getSupabaseAdmin();
  const existing = await admin
    .from("memberships")
    .select("workspace_id, role")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data) {
    return {
      admin,
      user: data.user,
      workspaceId: existing.data.workspace_id as string,
      role: existing.data.role as string
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
