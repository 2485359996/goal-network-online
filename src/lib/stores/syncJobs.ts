import type { SupabaseAdminClient } from "../supabase/admin";

export type SyncJobStatus = "pending" | "processing" | "done" | "failed";

export type SyncJobRow = {
  id: string;
  workspace_id: string;
  kind: "github_export_pending" | "github_import_pending";
  status: SyncJobStatus;
  attempts: number;
  payload: Record<string, unknown>;
  last_error: string | null;
};

export function failedJobPatch(currentAttempts: number, message: string) {
  const attempts = currentAttempts + 1;
  return {
    attempts,
    status: attempts >= 5 ? "failed" : "pending",
    last_error: message,
    locked_at: null,
    locked_by: null
  } satisfies {
    attempts: number;
    status: SyncJobStatus;
    last_error: string;
    locked_at: null;
    locked_by: null;
  };
}

export async function drainSyncJobs(client: SupabaseAdminClient, limit = 20) {
  const { data, error } = await client
    .from("sync_jobs")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const jobs = (data ?? []) as SyncJobRow[];
  const results: Array<{ id: string; status: SyncJobStatus; error?: string }> = [];
  for (const job of jobs) {
    const claim = await client
      .from("sync_jobs")
      .update({
        status: "processing",
        locked_at: new Date().toISOString(),
        locked_by: "vercel-cron"
      })
      .eq("id", job.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (claim.error) throw claim.error;
    if (!claim.data) continue;

    try {
      if (job.kind === "github_export_pending") {
        const { exportWorkspaceToGitHub } = await import("../github/export");
        await exportWorkspaceToGitHub(client, job.workspace_id);
      } else {
        throw new Error("GitHub import jobs are recorded but not processed in this worker yet");
      }
      const done = await client
        .from("sync_jobs")
        .update({ status: "done", locked_at: null, locked_by: null, last_error: null })
        .eq("id", job.id);
      if (done.error) throw done.error;
      results.push({ id: job.id, status: "done" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync job error";
      const failed = failedJobPatch(job.attempts, message);
      const update = await client.from("sync_jobs").update(failed).eq("id", job.id);
      if (update.error) throw update.error;
      results.push({ id: job.id, status: failed.status, error: message });
    }
  }

  return results;
}
