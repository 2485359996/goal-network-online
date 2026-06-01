import type { MarkdownWriteResult, RecordCreateInput, RecordSummary, RecordType } from "../../shared/types";
import type { SupabaseAdminClient } from "../supabase/admin";

type RecordRow = RecordSummary & {
  workspace_id: string;
  file_path: string;
  body: Record<string, unknown>;
};

function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function timestampId(date = new Date()) {
  return date.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function recordFilePath(type: RecordType, title: string) {
  const folder = type === "progress-log" ? "progress" : type.includes("review") ? "reviews" : "plans";
  return `${folder}/${title}.md`;
}

export class SupabaseRecordStore {
  constructor(
    private readonly client: SupabaseAdminClient,
    private readonly workspaceId: string,
    private readonly actorUserId: string
  ) {}

  async readRecords(): Promise<RecordSummary[]> {
    const { data, error } = await this.client
      .from("records")
      .select("*")
      .eq("workspace_id", this.workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as RecordRow[]).map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      filePath: row.file_path,
      date: row.date ?? "",
      created: row.created ?? "",
      week: row.week ?? "",
      status: row.status ?? "",
      goals: row.goals ?? [],
      source: row.source ?? "",
      review_scope: row.review_scope ?? "",
      progress_state: row.progress_state ?? "",
      horizon: row.horizon ?? ""
    }));
  }

  async createRecord(input: RecordCreateInput): Promise<MarkdownWriteResult> {
    const now = new Date();
    const id = `record-${timestampId(now)}`;
    const date = input.date || isoDate(now);
    const title = input.title || `${input.type}-${date}`;
    const filePath = recordFilePath(input.type, title);
    const { error } = await this.client.from("records").insert({
      id,
      workspace_id: this.workspaceId,
      type: input.type,
      title,
      file_path: filePath,
      date: input.type === "plan" || input.type === "weekly-review" ? null : date,
      created: input.type === "plan" || input.type === "weekly-review" ? date : null,
      week: input.week ?? null,
      status: input.type === "plan" ? "active" : "confirmed",
      goals: input.goals ?? [],
      source: "web-ui",
      review_scope: input.review_scope ?? "",
      progress_state: input.progress_state ?? "",
      horizon: input.horizon ?? "",
      body: {
        summary: input.summary ?? "",
        facts: input.facts ?? "",
        progress: input.progress ?? "",
        blockers: input.blockers ?? "",
        learnings: input.learnings ?? "",
        nextActions: input.nextActions ?? []
      }
    });
    if (error) throw error;
    await this.client.from("audit_events").insert({
      workspace_id: this.workspaceId,
      actor_user_id: this.actorUserId,
      action: "record.create",
      entity_type: "record",
      entity_id: id,
      payload: input
    });
    return { ok: true, filePath, message: "Record created" };
  }
}
