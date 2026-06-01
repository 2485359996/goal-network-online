import type { ActionCreateInput, ActionPatchInput, MarkdownWriteResult, WeeklyAction, WeeklyActionsResponse } from "../../shared/types";
import type { SupabaseAdminClient } from "../supabase/admin";

function isoWeek(date = new Date()) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function actionIdFor(week: string, index: number) {
  return `action-${week}-${String(index).padStart(3, "0")}`;
}

type WeeklyActionRow = {
  id: string;
  action_id: string;
  week: string;
  description: string;
  goal_title: string;
  due: string | null;
  done: boolean;
  sort_order: number;
};

export class SupabaseActionStore {
  constructor(
    private readonly client: SupabaseAdminClient,
    private readonly workspaceId: string,
    private readonly actorUserId: string
  ) {}

  async readCurrentActions(week = isoWeek()): Promise<WeeklyActionsResponse> {
    const { data, error } = await this.client
      .from("weekly_actions")
      .select("*")
      .eq("workspace_id", this.workspaceId)
      .eq("week", week)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    const actions = ((data ?? []) as WeeklyActionRow[]).map((row, index): WeeklyAction => ({
      id: row.action_id,
      description: row.description,
      goal: row.goal_title,
      due: row.due ?? "",
      done: row.done,
      line: index + 1,
      hasStableId: true
    }));
    return {
      week,
      filePath: `actions/${week}.md`,
      focus: [],
      actions
    };
  }

  async createAction(input: ActionCreateInput, week = isoWeek()): Promise<MarkdownWriteResult> {
    const current = await this.readCurrentActions(week);
    const nextNumber = current.actions.length + 1;
    const actionId = actionIdFor(week, nextNumber);
    const { error } = await this.client.from("weekly_actions").insert({
      workspace_id: this.workspaceId,
      action_id: actionId,
      week,
      description: input.description.trim(),
      goal_title: input.goal,
      due: input.due || null,
      done: false,
      sort_order: nextNumber
    });
    if (error) throw error;
    await this.client.from("audit_events").insert({
      workspace_id: this.workspaceId,
      actor_user_id: this.actorUserId,
      action: "weekly_action.create",
      entity_type: "weekly_action",
      entity_id: actionId,
      payload: input
    });
    return { ok: true, filePath: `actions/${week}.md`, message: "Action created" };
  }

  async patchAction(actionId: string, input: ActionPatchInput): Promise<MarkdownWriteResult> {
    const patch: Record<string, unknown> = {};
    if (input.description !== undefined) patch.description = input.description;
    if (input.goal !== undefined) patch.goal_title = input.goal;
    if (input.due !== undefined) patch.due = input.due || null;
    if (input.done !== undefined) patch.done = input.done;
    const { error } = await this.client
      .from("weekly_actions")
      .update(patch)
      .eq("workspace_id", this.workspaceId)
      .eq("action_id", actionId);
    if (error) throw error;
    await this.client.from("audit_events").insert({
      workspace_id: this.workspaceId,
      actor_user_id: this.actorUserId,
      action: "weekly_action.update",
      entity_type: "weekly_action",
      entity_id: actionId,
      payload: input
    });
    return { ok: true, filePath: "actions/current.md", message: "Action updated" };
  }
}
