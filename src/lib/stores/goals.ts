import type {
  GoalActionCandidate,
  GoalCreateInput,
  GoalGraphEdge,
  GoalMap,
  GoalMapCreateInput,
  GoalMapPatchInput,
  GoalNode,
  GoalPatchInput,
  GoalRelationsInput,
  GoalsResponse,
  MarkdownWriteResult
} from "../../shared/types";
import { isPrimaryGoalTitle } from "../../shared/goalRules";
import type { SupabaseAdminClient } from "../supabase/admin";

export type GoalDbRow = {
  id: string;
  goal_map_id: string;
  legacy_id: string;
  workspace_id: string;
  title: string;
  file_path: string;
  status: GoalNode["status"];
  horizon: string;
  domain_title: string;
  priority: number;
  clarity: number;
  progress: number | null;
  color: string;
  map_x: number | null;
  map_y: number | null;
  map_positions: Record<string, { x: number; y: number }> | null;
  sections: Partial<GoalNode["sections"]> | null;
  tags: string[] | null;
  last_reviewed: string | null;
  last_progress: string | null;
};

export type GoalMapDbRow = {
  id: string;
  workspace_id: string;
  name: string;
  sort_order: number | null;
};

export type GoalRelationDbRow = {
  id: string;
  workspace_id: string;
  source_goal_id: string;
  target_goal_id: string;
  relation_type: "parent" | "supports" | "depends_on" | "conflicts_with";
};

const VALID_STATUSES = new Set(["active", "paused", "done", "archived"]);

function asWikilink(title: string) {
  const normalized = titleFromWikilink(title);
  return normalized ? `[[${normalized}]]` : "";
}

function titleFromWikilink(value: string | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "");
}

function referenceKey(value: string) {
  return titleFromWikilink(value).replace(/\s+/g, "").toLocaleLowerCase();
}

function defaultSections(row: GoalDbRow): GoalNode["sections"] {
  const sections = row.sections ?? {};
  return {
    summary: String(sections.summary ?? ""),
    directions: Array.isArray(sections.directions) ? sections.directions.map(String) : [],
    directionHeading:
      sections.directionHeading === "中期目标" || sections.directionHeading === "涓湡鐩爣"
        ? (sections.directionHeading as GoalNode["sections"]["directionHeading"])
        : "子方向",
    successSignals: Array.isArray(sections.successSignals) ? sections.successSignals.map(String) : [],
    actionCandidates: Array.isArray(sections.actionCandidates)
      ? sections.actionCandidates
          .map((item) =>
            typeof item === "string"
              ? { text: item, done: false }
              : { text: String((item as GoalActionCandidate).text ?? ""), done: Boolean((item as GoalActionCandidate).done) }
          )
          .filter((item) => item.text)
      : [],
    reviewQuestions: Array.isArray(sections.reviewQuestions) ? sections.reviewQuestions.map(String) : []
  };
}

function isPrimaryRoot(row: GoalDbRow, parentTitle: string) {
  return !parentTitle && (isPrimaryGoalTitle(row.title) || (row.tags ?? []).includes("goal-domain"));
}

function progressValue(goal: GoalNode) {
  const next = Number(goal.progress ?? goal.clarity * 20);
  return Number.isFinite(next) ? Math.max(0, Math.min(100, Math.round(next))) : 0;
}

function normalizedImportance(goals: GoalNode[]) {
  if (!goals.length) return new Map<string, number>();
  const weights = goals.map((goal) => Math.max(0, Number(goal.priority) || 0));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return new Map(goals.map((goal, index) => [goal.id, total > 0 ? weights[index] / total : 1 / goals.length]));
}

function applyWeightedProgress(goals: GoalNode[]) {
  const visit = (goal: GoalNode): number => {
    if (!goal.children.length) return progressValue(goal);
    const weights = normalizedImportance(goal.children);
    const next = goal.children.reduce((sum, child) => sum + visit(child) * (weights.get(child.id) ?? 0), 0);
    goal.progress = Math.round(next);
    return goal.progress;
  };

  goals.forEach(visit);
}

function sortGoals(goals: GoalNode[]) {
  goals.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title, "zh-CN"));
  goals.forEach((goal) => sortGoals(goal.children));
}

function goalMapFromRow(row: GoalMapDbRow): GoalMap {
  return {
    id: row.id,
    name: row.name,
    sortOrder: Number(row.sort_order) || 0
  };
}

export function buildGoalsResponse(
  goalRows: GoalDbRow[],
  relationRows: GoalRelationDbRow[],
  workspaceId: string,
  goalMapRows: GoalMapDbRow[] = []
): GoalsResponse {
  const byDbId = new Map(goalRows.map((row) => [row.id, row]));
  const parentTitleBySource = new Map<string, string>();

  for (const relation of relationRows) {
    if (relation.relation_type !== "parent") continue;
    const parent = byDbId.get(relation.target_goal_id);
    if (parent) parentTitleBySource.set(relation.source_goal_id, parent.title);
  }

  const nodes = goalRows.map((row): GoalNode => {
    const parentTitle = parentTitleBySource.get(row.id) ?? "";
    const sections = defaultSections(row);
    const primaryRootGoal = isPrimaryRoot(row, parentTitle);
    return {
      id: row.legacy_id,
      goalMapId: row.goal_map_id,
      title: row.title,
      filePath: row.file_path,
      status: VALID_STATUSES.has(row.status) ? row.status : "active",
      horizon: row.horizon,
      domain: asWikilink(row.domain_title || row.title),
      parent: parentTitle ? asWikilink(parentTitle) : "",
      priority: Number(row.priority) || 0,
      clarity: Number(row.clarity) || 1,
      progress: primaryRootGoal ? undefined : Number(row.progress ?? row.clarity * 20),
      color: row.color || "",
      map_x: row.map_x ?? undefined,
      map_y: row.map_y ?? undefined,
      map_positions: row.map_positions ?? undefined,
      supports: [],
      depends_on: [],
      conflicts_with: [],
      last_reviewed: row.last_reviewed ?? "",
      last_progress: row.last_progress ?? "",
      tags: row.tags ?? [],
      sections: {
        ...sections,
        actionCandidates: primaryRootGoal ? [] : sections.actionCandidates
      },
      children: []
    };
  });

  const byLegacyId = new Map(nodes.map((node) => [node.id, node]));
  const legacyByDbId = new Map(goalRows.map((row) => [row.id, row.legacy_id]));

  const graphEdges: GoalGraphEdge[] = [];
  for (const relation of relationRows) {
    const sourceId = legacyByDbId.get(relation.source_goal_id);
    const targetId = legacyByDbId.get(relation.target_goal_id);
    if (!sourceId || !targetId) continue;
    const source = byLegacyId.get(sourceId);
    const target = byLegacyId.get(targetId);
    if (!source || !target) continue;

    if (relation.relation_type === "parent") {
      source.parent = asWikilink(target.title);
      target.children.push(source);
    } else {
      source[relation.relation_type].push(asWikilink(target.title));
    }
    graphEdges.push({
      id: `${sourceId}->${targetId}:${relation.relation_type}`,
      source: sourceId,
      target: targetId,
      type: relation.relation_type
    });
  }

  const childIds = new Set(relationRows.filter((item) => item.relation_type === "parent").map((item) => legacyByDbId.get(item.source_goal_id)));
  const topLevel = nodes.filter((node) => !childIds.has(node.id));
  sortGoals(topLevel);
  applyWeightedProgress(topLevel);

  return {
    workspaceId,
    goalMaps: goalMapRows
      .map(goalMapFromRow)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN")),
    goals: topLevel,
    flatGoals: nodes,
    graph: {
      nodes: nodes.map((goal) => ({
        id: goal.id,
        title: goal.title,
        domain: goal.domain,
        status: goal.status,
        priority: goal.priority,
        clarity: goal.clarity
      })),
      edges: graphEdges
    }
  };
}

function cleanLines(items: string[] | undefined) {
  return (items ?? []).map((item) => item.trim()).filter(Boolean);
}

function actionCandidates(items: GoalCreateInput["actionCandidates"] | GoalPatchInput["actionCandidates"]): GoalActionCandidate[] {
  return (items ?? [])
    .map((item) => (typeof item === "string" ? { text: item.trim(), done: false } : { text: item.text.trim(), done: Boolean(item.done) }))
    .filter((item) => item.text);
}

function slugPart(value: string) {
  return value.trim().replace(/\s+/g, "-");
}

async function uniqueLegacyId(client: SupabaseAdminClient, workspaceId: string, parentTitle: string, title: string, exceptId?: string) {
  const base = `goal-${parentTitle ? `${slugPart(parentTitle)}-` : ""}${slugPart(title)}`;
  const { data, error } = await client.from("goals").select("legacy_id").eq("workspace_id", workspaceId);
  if (error) throw error;
  const existing = new Set((data ?? []).map((row: { legacy_id: string }) => row.legacy_id).filter((id) => id !== exceptId));
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

async function goalByLegacyId(client: SupabaseAdminClient, workspaceId: string, legacyId: string) {
  const { data, error } = await client.from("goals").select("*").eq("workspace_id", workspaceId).eq("legacy_id", legacyId).maybeSingle();
  if (error) throw error;
  return data as GoalDbRow | null;
}

async function goalByTitle(client: SupabaseAdminClient, workspaceId: string, title: string, goalMapId?: string) {
  const key = referenceKey(title);
  const { data, error } = await client.from("goals").select("*").eq("workspace_id", workspaceId);
  if (error) throw error;
  return ((data ?? []) as GoalDbRow[]).find((row) => referenceKey(row.title) === key && (!goalMapId || row.goal_map_id === goalMapId)) ?? null;
}

async function goalMapById(client: SupabaseAdminClient, workspaceId: string, id: string) {
  const { data, error } = await client.from("goal_maps").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as GoalMapDbRow | null;
}

async function goalMapByName(client: SupabaseAdminClient, workspaceId: string, name: string) {
  const key = referenceKey(name);
  const { data, error } = await client.from("goal_maps").select("*").eq("workspace_id", workspaceId);
  if (error) throw error;
  return ((data ?? []) as GoalMapDbRow[]).find((row) => referenceKey(row.name) === key) ?? null;
}

async function parentTitleForGoal(client: SupabaseAdminClient, workspaceId: string, sourceGoalId: string) {
  const { data, error } = await client
    .from("goal_relations")
    .select("target_goal_id")
    .eq("workspace_id", workspaceId)
    .eq("source_goal_id", sourceGoalId)
    .eq("relation_type", "parent")
    .maybeSingle();
  if (error) throw error;
  if (!data?.target_goal_id) return "";

  const parent = await client
    .from("goals")
    .select("title")
    .eq("workspace_id", workspaceId)
    .eq("id", data.target_goal_id)
    .maybeSingle();
  if (parent.error) throw parent.error;
  return String(parent.data?.title ?? "");
}

async function enqueueAuditAndSync(
  client: SupabaseAdminClient,
  workspaceId: string,
  actorUserId: string,
  action: string,
  entityId: string,
  payload: unknown,
  entityType = "goal"
) {
  await client.from("audit_events").insert({
    workspace_id: workspaceId,
    actor_user_id: actorUserId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    payload
  });
  await client.from("sync_jobs").insert({
    workspace_id: workspaceId,
    kind: "github_export_pending",
    status: "pending",
    payload: { reason: action, entityId }
  });
}

export class SupabaseGoalStore {
  constructor(
    private readonly client: SupabaseAdminClient,
    private readonly workspaceId: string,
    private readonly actorUserId: string
  ) {}

  async readGoals(): Promise<GoalsResponse> {
    const [goalMaps, goals, relations] = await Promise.all([
      this.client.from("goal_maps").select("*").eq("workspace_id", this.workspaceId).order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
      this.client.from("goals").select("*").eq("workspace_id", this.workspaceId),
      this.client.from("goal_relations").select("*").eq("workspace_id", this.workspaceId)
    ]);
    if (goalMaps.error) throw goalMaps.error;
    if (goals.error) throw goals.error;
    if (relations.error) throw relations.error;
    return buildGoalsResponse(
      (goals.data ?? []) as GoalDbRow[],
      (relations.data ?? []) as GoalRelationDbRow[],
      this.workspaceId,
      (goalMaps.data ?? []) as GoalMapDbRow[]
    );
  }

  async createGoalMap(input: GoalMapCreateInput): Promise<GoalMap> {
    const name = input.name.trim();
    if (!name) throw new Error("Goal map name cannot be empty");
    const duplicate = await goalMapByName(this.client, this.workspaceId, name);
    if (duplicate) throw new Error(`Goal map already exists: ${name}`);

    const existing = await this.client.from("goal_maps").select("sort_order").eq("workspace_id", this.workspaceId);
    if (existing.error) throw existing.error;
    const sortOrder =
      ((existing.data ?? []) as Array<{ sort_order: number | null }>).reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), -1) + 1;
    const { data, error } = await this.client
      .from("goal_maps")
      .insert({
        workspace_id: this.workspaceId,
        name,
        sort_order: sortOrder
      })
      .select("*")
      .single();
    if (error) throw error;
    await enqueueAuditAndSync(this.client, this.workspaceId, this.actorUserId, "goal_map.create", data.id, { name }, "goal_map");
    return goalMapFromRow(data as GoalMapDbRow);
  }

  async patchGoalMap(id: string, input: GoalMapPatchInput): Promise<GoalMap> {
    const current = await goalMapById(this.client, this.workspaceId, id);
    if (!current) throw new Error(`Goal map not found: ${id}`);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new Error("Goal map name cannot be empty");
      const duplicate = await goalMapByName(this.client, this.workspaceId, name);
      if (duplicate && duplicate.id !== current.id) throw new Error(`Goal map already exists: ${name}`);
      patch.name = name;
    }

    const { data, error } = await this.client.from("goal_maps").update(patch).eq("workspace_id", this.workspaceId).eq("id", current.id).select("*").single();
    if (error) throw error;
    await enqueueAuditAndSync(this.client, this.workspaceId, this.actorUserId, "goal_map.update", current.id, input, "goal_map");
    return goalMapFromRow(data as GoalMapDbRow);
  }

  async deleteGoalMap(id: string): Promise<MarkdownWriteResult> {
    const current = await goalMapById(this.client, this.workspaceId, id);
    if (!current) throw new Error(`Goal map not found: ${id}`);

    const goals = await this.client.from("goals").select("id").eq("workspace_id", this.workspaceId).eq("goal_map_id", current.id);
    if (goals.error) throw goals.error;
    const goalIds = ((goals.data ?? []) as Array<{ id: string }>).map((goal) => goal.id);

    if (goalIds.length) {
      const sourceRelations = await this.client.from("goal_relations").delete().eq("workspace_id", this.workspaceId).in("source_goal_id", goalIds);
      if (sourceRelations.error) throw sourceRelations.error;
      const targetRelations = await this.client.from("goal_relations").delete().eq("workspace_id", this.workspaceId).in("target_goal_id", goalIds);
      if (targetRelations.error) throw targetRelations.error;
      const deletedGoals = await this.client.from("goals").delete().eq("workspace_id", this.workspaceId).eq("goal_map_id", current.id);
      if (deletedGoals.error) throw deletedGoals.error;
    }

    const { error } = await this.client.from("goal_maps").delete().eq("workspace_id", this.workspaceId).eq("id", current.id);
    if (error) throw error;
    await enqueueAuditAndSync(
      this.client,
      this.workspaceId,
      this.actorUserId,
      "goal_map.delete",
      current.id,
      { name: current.name, deletedGoalCount: goalIds.length },
      "goal_map"
    );
    return { ok: true, filePath: "", message: "Goal map deleted" };
  }

  async createGoal(input: GoalCreateInput): Promise<MarkdownWriteResult> {
    const title = input.title.trim();
    if (!title) throw new Error("Goal title cannot be empty");
    const goalMapId = input.goalMapId.trim();
    if (!goalMapId) throw new Error("Goal map is required");
    const goalMap = await goalMapById(this.client, this.workspaceId, goalMapId);
    if (!goalMap) throw new Error(`Goal map not found: ${goalMapId}`);
    const duplicate = await goalByTitle(this.client, this.workspaceId, title);
    if (duplicate) throw new Error(`Goal already exists: ${title}`);

    const parentTitle = titleFromWikilink(input.parent);
    const parent = parentTitle ? await goalByTitle(this.client, this.workspaceId, parentTitle, goalMapId) : null;
    if (parentTitle && !parent) throw new Error(`Parent goal not found in current goal map: ${parentTitle}`);

    const domainTitle = titleFromWikilink(input.domain || parent?.domain_title || title);
    const primaryRoot = isPrimaryGoalTitle(title) && !parentTitle;
    const legacyId = await uniqueLegacyId(this.client, this.workspaceId, parentTitle, title);
    const row = {
      workspace_id: this.workspaceId,
      goal_map_id: goalMapId,
      legacy_id: legacyId,
      title,
      file_path: markdownPath(title, domainTitle, parentTitle),
      status: "active",
      horizon: input.horizon || "medium",
      domain_title: domainTitle,
      priority: input.priority ?? 50,
      clarity: input.clarity ?? 1,
      progress: primaryRoot ? null : input.progress ?? 0,
      color: input.color ?? "",
      sections: {
        summary: input.summary?.trim() ?? "",
        directions: cleanLines(input.directions),
        directionHeading: primaryRoot ? "中期目标" : "子方向",
        successSignals: cleanLines(input.successSignals),
        actionCandidates: primaryRoot ? [] : actionCandidates(input.actionCandidates),
        reviewQuestions: cleanLines(input.reviewQuestions)
      },
      tags: primaryRoot ? ["goal-network", "goal-domain"] : ["goal-network"],
      last_reviewed: "",
      last_progress: ""
    };

    const { data, error } = await this.client.from("goals").insert(row).select("*").single();
    if (error) throw error;
    if (parent) {
      const relation = {
        workspace_id: this.workspaceId,
        source_goal_id: data.id,
        target_goal_id: parent.id,
        relation_type: "parent"
      };
      const parentResult = await this.client.from("goal_relations").insert(relation);
      if (parentResult.error) throw parentResult.error;
    }
    await enqueueAuditAndSync(this.client, this.workspaceId, this.actorUserId, "goal.create", data.id, { title });
    return { ok: true, filePath: row.file_path, message: "Goal created" };
  }

  async patchGoal(id: string, input: GoalPatchInput): Promise<MarkdownWriteResult> {
    const current = await goalByLegacyId(this.client, this.workspaceId, id);
    if (!current) throw new Error(`Goal not found: ${id}`);
    const nextTitle = input.title?.trim();
    if (nextTitle && referenceKey(nextTitle) !== referenceKey(current.title)) {
      const duplicate = await goalByTitle(this.client, this.workspaceId, nextTitle);
      if (duplicate) throw new Error(`Goal already exists: ${nextTitle}`);
    }

    let resolvedParentTitle = await parentTitleForGoal(this.client, this.workspaceId, current.id);
    if (input.parent !== undefined) {
      resolvedParentTitle = titleFromWikilink(input.parent);
      await this.client.from("goal_relations").delete().eq("workspace_id", this.workspaceId).eq("source_goal_id", current.id).eq("relation_type", "parent");
      if (resolvedParentTitle) {
        const parent = await goalByTitle(this.client, this.workspaceId, resolvedParentTitle, current.goal_map_id);
        if (!parent) throw new Error(`Parent goal not found in current goal map: ${resolvedParentTitle}`);
        const insertParent = await this.client.from("goal_relations").insert({
          workspace_id: this.workspaceId,
          source_goal_id: current.id,
          target_goal_id: parent.id,
          relation_type: "parent"
        });
        if (insertParent.error) throw insertParent.error;
      }
    }

    const existingSections = defaultSections(current);
    const sections = {
      ...existingSections,
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.directions !== undefined ? { directions: cleanLines(input.directions) } : {}),
      ...(input.successSignals !== undefined ? { successSignals: cleanLines(input.successSignals) } : {}),
      ...(input.actionCandidates !== undefined ? { actionCandidates: actionCandidates(input.actionCandidates) } : {}),
      ...(input.reviewQuestions !== undefined ? { reviewQuestions: cleanLines(input.reviewQuestions) } : {})
    };
    const title = nextTitle || current.title;
    const domainTitle = input.domain !== undefined ? titleFromWikilink(input.domain) : current.domain_title === current.title && nextTitle ? nextTitle : current.domain_title;
    const parentForPath = resolvedParentTitle;
    const primaryRoot = isPrimaryGoalTitle(title) && !parentForPath;
    if (primaryRoot) sections.actionCandidates = [];

    const patch: Record<string, unknown> = {
      title,
      domain_title: domainTitle,
      file_path: markdownPath(title, domainTitle, parentForPath),
      sections,
      updated_at: new Date().toISOString()
    };
    for (const key of ["status", "horizon", "color", "last_reviewed", "last_progress"] as const) {
      if (input[key] !== undefined) patch[key] = input[key];
    }
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.clarity !== undefined) patch.clarity = input.clarity;
    if (primaryRoot) patch.progress = null;
    else if (input.progress !== undefined) patch.progress = input.progress;
    if (input.map_x !== undefined) patch.map_x = input.map_x;
    if (input.map_y !== undefined) patch.map_y = input.map_y;
    if (input.map_positions !== undefined) patch.map_positions = mergeMapPositions(current.map_positions, input.map_positions);

    const { error } = await this.client.from("goals").update(patch).eq("workspace_id", this.workspaceId).eq("id", current.id);
    if (error) throw error;
    await enqueueAuditAndSync(this.client, this.workspaceId, this.actorUserId, "goal.update", current.id, { id, input });
    return { ok: true, filePath: String(patch.file_path), message: "Goal updated" };
  }

  async setGoalMapPositions(
    positions: Array<{ id: string; position: { x: number; y: number } }>,
    mapContextId: string
  ): Promise<MarkdownWriteResult> {
    const byGoalId = new Map<string, { x: number; y: number }>();
    for (const item of positions) {
      const id = item.id.trim();
      if (!id) continue;
      byGoalId.set(id, { x: Number(item.position.x), y: Number(item.position.y) });
    }
    const goalIds = Array.from(byGoalId.keys());
    const contextId = mapContextId.trim();
    if (!goalIds.length) throw new Error("Goal positions are required");
    if (!contextId) throw new Error("Map context is required");

    const result = await this.client.rpc("set_goal_map_positions", {
      p_workspace_id: this.workspaceId,
      p_actor_user_id: this.actorUserId,
      p_map_context_id: contextId,
      p_positions: goalIds.map((id) => ({
        id,
        position: byGoalId.get(id)!
      }))
    });
    if (result.error) throw result.error;

    return { ok: true, filePath: "", message: "Goal map positions saved" };
  }

  async clearGoalMapPositions(ids: string[], mapContextId: string): Promise<MarkdownWriteResult> {
    const goalIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    const contextId = mapContextId.trim();
    if (!goalIds.length) throw new Error("Goal ids are required");
    if (!contextId) throw new Error("Map context is required");

    const result = await this.client.rpc("clear_goal_map_positions", {
      p_workspace_id: this.workspaceId,
      p_actor_user_id: this.actorUserId,
      p_map_context_id: contextId,
      p_ids: goalIds
    });
    if (result.error) throw result.error;

    return { ok: true, filePath: "", message: "Goal map positions cleared" };
  }

  async deleteGoal(id: string): Promise<MarkdownWriteResult> {
    const current = await goalByLegacyId(this.client, this.workspaceId, id);
    if (!current) throw new Error(`Goal not found: ${id}`);
    const relations = await this.client.from("goal_relations").select("*").eq("workspace_id", this.workspaceId).eq("relation_type", "parent");
    if (relations.error) throw relations.error;
    const childrenByParent = new Map<string, string[]>();
    for (const relation of (relations.data ?? []) as GoalRelationDbRow[]) {
      const list = childrenByParent.get(relation.target_goal_id) ?? [];
      list.push(relation.source_goal_id);
      childrenByParent.set(relation.target_goal_id, list);
    }
    const ids = new Set<string>();
    const collect = (dbId: string) => {
      ids.add(dbId);
      for (const child of childrenByParent.get(dbId) ?? []) collect(child);
    };
    collect(current.id);
    const { error } = await this.client.from("goals").delete().eq("workspace_id", this.workspaceId).in("id", Array.from(ids));
    if (error) throw error;
    await enqueueAuditAndSync(this.client, this.workspaceId, this.actorUserId, "goal.delete", current.id, { id, deletedCount: ids.size });
    return { ok: true, filePath: current.file_path, message: "Goal deleted" };
  }

  async patchGoalRelations(id: string, input: GoalRelationsInput): Promise<MarkdownWriteResult> {
    const current = await goalByLegacyId(this.client, this.workspaceId, id);
    if (!current) throw new Error(`Goal not found: ${id}`);
    const deleteResult = await this.client
      .from("goal_relations")
      .delete()
      .eq("workspace_id", this.workspaceId)
      .eq("source_goal_id", current.id)
      .in("relation_type", ["supports", "depends_on", "conflicts_with"]);
    if (deleteResult.error) throw deleteResult.error;

    const rows: Array<Omit<GoalRelationDbRow, "id">> = [];
    for (const relationType of ["supports", "depends_on", "conflicts_with"] as const) {
      for (const title of input[relationType]) {
        const target = await goalByTitle(this.client, this.workspaceId, title);
        if (!target) continue;
        rows.push({
          workspace_id: this.workspaceId,
          source_goal_id: current.id,
          target_goal_id: target.id,
          relation_type: relationType
        });
      }
    }
    if (rows.length) {
      const insert = await this.client.from("goal_relations").insert(rows);
      if (insert.error) throw insert.error;
    }
    await enqueueAuditAndSync(this.client, this.workspaceId, this.actorUserId, "goal.relations.update", current.id, input);
    return { ok: true, filePath: current.file_path, message: "Goal relations updated" };
  }
}

function mergeMapPositions(
  current: GoalDbRow["map_positions"],
  patch: NonNullable<GoalPatchInput["map_positions"]>
) {
  const next = { ...(current ?? {}) };
  for (const [contextId, value] of Object.entries(patch)) {
    if (value === null) delete next[contextId];
    else next[contextId] = { x: Number(value.x), y: Number(value.y) };
  }
  return Object.keys(next).length ? next : null;
}

export function markdownPath(title: string, domainTitle: string, parentTitle: string) {
  const safeTitle = title.trim();
  const safeDomain = domainTitle.trim() || safeTitle;
  const safeParent = parentTitle.trim();
  if (!safeParent || referenceKey(safeParent) === referenceKey(safeDomain)) return `目标/${safeDomain}/${safeTitle}.md`;
  return `目标/${safeDomain}/${safeParent}/${safeTitle}.md`;
}
