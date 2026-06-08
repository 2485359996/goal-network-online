import { getSupabaseAdmin } from "../src/lib/supabase/admin";
import { VaultService, titleFromWikilink } from "../src/server/markdown";
import { markdownPath } from "../src/lib/stores/goals";
import type { GoalNode } from "../src/shared/types";

const ownerUserId = process.env.IMPORT_OWNER_USER_ID?.trim();
const vaultRoot = process.env.GOAL_NETWORK_VAULT;
const workspaceName = process.env.IMPORT_WORKSPACE_NAME?.trim() || "Imported Goal Network";
const defaultGoalMapName = "目标网络";

function relationTitle(value: string) {
  return titleFromWikilink(value).trim();
}

function sections(goal: GoalNode) {
  return {
    summary: goal.sections.summary,
    directions: goal.sections.directions,
    directionHeading: goal.sections.directionHeading,
    successSignals: goal.sections.successSignals,
    actionCandidates: goal.sections.actionCandidates,
    reviewQuestions: goal.sections.reviewQuestions
  };
}

async function main() {
  const admin = getSupabaseAdmin();
  const vault = new VaultService(vaultRoot);
  const sourceGoals = await vault.readGoals();

  let workspaceId = "";
  let hasOwnerMembership = false;
  if (ownerUserId) {
    const existing = await admin
      .from("memberships")
      .select("workspace_id")
      .eq("user_id", ownerUserId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw existing.error;
    workspaceId = String(existing.data?.workspace_id ?? "");
    hasOwnerMembership = Boolean(workspaceId);
  }

  if (!workspaceId) {
    const workspace = await admin
      .from("workspaces")
      .insert({
        name: workspaceName,
        owner_user_id: ownerUserId || null
      })
      .select("id")
      .single();
    if (workspace.error) throw workspace.error;
    workspaceId = workspace.data.id as string;
  }

  if (ownerUserId && !hasOwnerMembership) {
    const membership = await admin.from("memberships").insert({
      workspace_id: workspaceId,
      user_id: ownerUserId,
      role: "owner"
    });
    if (membership.error) throw membership.error;
  }

  const existingGoalMap = await admin
    .from("goal_maps")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("name", defaultGoalMapName)
    .maybeSingle();
  if (existingGoalMap.error) throw existingGoalMap.error;

  let goalMapId = String(existingGoalMap.data?.id ?? "");
  if (!goalMapId) {
    const goalMap = await admin
      .from("goal_maps")
      .insert({
        workspace_id: workspaceId,
        name: defaultGoalMapName,
        sort_order: 0
      })
      .select("id")
      .single();
    if (goalMap.error) throw goalMap.error;
    goalMapId = goalMap.data.id as string;
  }

  const titleToDbId = new Map<string, string>();
  for (const goal of sourceGoals.flatGoals) {
    const parentTitle = relationTitle(goal.parent);
    const row = await admin
      .from("goals")
      .insert({
        workspace_id: workspaceId,
        goal_map_id: goalMapId,
        legacy_id: goal.id,
        title: goal.title,
        file_path: goal.filePath || markdownPath(goal.title, relationTitle(goal.domain) || goal.title, parentTitle),
        status: goal.status,
        horizon: goal.horizon,
        domain_title: relationTitle(goal.domain) || goal.title,
        priority: goal.priority,
        clarity: goal.clarity,
        progress: goal.progress ?? null,
        color: goal.color,
        map_x: goal.map_x ?? null,
        map_y: goal.map_y ?? null,
        map_positions: goal.map_positions ?? null,
        sections: sections(goal),
        tags: goal.tags,
        last_reviewed: goal.last_reviewed,
        last_progress: goal.last_progress
      })
      .select("id")
      .single();
    if (row.error) throw row.error;
    titleToDbId.set(goal.title, row.data.id as string);
  }

  const relationRows: Array<Record<string, string>> = [];
  for (const goal of sourceGoals.flatGoals) {
    const sourceGoalId = titleToDbId.get(goal.title);
    if (!sourceGoalId) continue;
    const relationGroups = {
      parent: goal.parent ? [goal.parent] : [],
      supports: goal.supports,
      depends_on: goal.depends_on,
      conflicts_with: goal.conflicts_with
    };
    for (const [relation_type, values] of Object.entries(relationGroups)) {
      for (const value of values) {
        const targetGoalId = titleToDbId.get(relationTitle(value));
        if (!targetGoalId) continue;
        relationRows.push({
          workspace_id: workspaceId,
          source_goal_id: sourceGoalId,
          target_goal_id: targetGoalId,
          relation_type
        });
      }
    }
  }
  if (relationRows.length) {
    const relations = await admin.from("goal_relations").insert(relationRows);
    if (relations.error) throw relations.error;
  }

  const actions = await vault.readCurrentActions().catch(() => null);
  if (actions) {
    const actionRows = actions.actions.map((action, index) => ({
      workspace_id: workspaceId,
      action_id: action.id,
      week: actions.week,
      description: action.description,
      goal_title: action.goal,
      due: action.due || null,
      done: action.done,
      sort_order: index + 1
    }));
    if (actionRows.length) {
      const result = await admin.from("weekly_actions").insert(actionRows);
      if (result.error) throw result.error;
    }
  }

  const records = await vault.readRecords().catch(() => []);
  if (records.length) {
    const result = await admin.from("records").insert(
      records.map((record) => ({
        id: record.id,
        workspace_id: workspaceId,
        type: record.type,
        title: record.title,
        file_path: record.filePath,
        date: record.date || null,
        created: record.created || null,
        week: record.week || null,
        status: record.status || "",
        goals: record.goals,
        source: record.source || "",
        review_scope: record.review_scope || "",
        progress_state: record.progress_state || "",
        horizon: record.horizon || "",
        body: {}
      }))
    );
    if (result.error) throw result.error;
  }

  console.log(
    JSON.stringify(
      {
        workspaceId,
        goals: sourceGoals.flatGoals.length,
        relations: relationRows.length,
        actions: actions?.actions.length ?? 0,
        records: records.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
