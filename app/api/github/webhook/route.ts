import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../src/lib/supabase/admin";
import { verifyGitHubSignature } from "../../../../src/lib/github/webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyGitHubSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid GitHub webhook signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event") || "unknown";
  const delivery = request.headers.get("x-github-delivery") || "";
  const payload = JSON.parse(rawBody || "{}") as Record<string, unknown>;
  const repository = payload.repository as { full_name?: string } | undefined;

  const admin = getSupabaseAdmin();
  const workspace = repository?.full_name
    ? await admin.from("workspaces").select("id").eq("github_repository_full_name", repository.full_name).maybeSingle()
    : { data: null, error: null };
  if (workspace.error) throw workspace.error;
  if (!workspace.data) {
    return NextResponse.json({ ok: true, ignored: true, reason: "No workspace configured for repository" });
  }

  const result = await admin.from("sync_jobs").insert({
    workspace_id: workspace.data.id,
    kind: "github_import_pending",
    status: "pending",
    payload: { event, delivery, payload }
  });
  if (result.error) throw result.error;
  return NextResponse.json({ ok: true });
}
