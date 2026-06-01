import type {
  GoalActionCandidate,
  GoalCreateInput,
  GoalGraphEdge,
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

export function buildGoalsResponse(
  goalRows: GoalDbRow[],
  relationRows: GoalRelationDbRow[],
  workspaceId: string
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

async function goalByTitle(client: SupabaseAdminClient, workspaceId: string, title: string) {
  const key = referenceKey(title);
  const { data, error } = await client.from("goals").select("*").eq("workspace_id", workspaceId);
  if (error) throw error;
  return ((data ?? []) as GoalDbRow[]).find((row) => referenceKey(row.title) === key) ?? null;
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

async function enqueueAuditAndSync(client: SupabaseAdminClient, workspaceId: string, actorUserId: string, action: string, entityId: string, payload: unknown) {
  await client.from("audit_events").insert({
    workspace_id: workspaceId,
    actor_user_id: actorUserId,
    action,
    entity_type: "goal",
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
    const [goals, relations] = await Promise.all([
      this.client.from("goals").select("*").eq("workspace_id", this.workspaceId),
      this.client.from("goal_relations").select("*").eq("workspace_id", this.workspaceId)
    ]);
    if (goals.error) throw goals.error;
    if (relations.error) throw relations.error;
    return buildGoalsResponse((goals.data ?? []) as GoalDbRow[], (relations.data ?? []) as GoalRelationDbRow[], this.workspaceId);
  }

  async createGoal(input: GoalCreateInput): Promise<MarkdownWriteResult> {
    const title = input.title.trim();
    if (!title) throw new Error("Goal title cannot be empty");
    const duplicate = await goalByTitle(this.client, this.workspaceId, title);
    if (duplicate) throw new Error(`Goal already exists: ${title}`);

    const parentTitle = titleFromWikilink(input.parent);
    const parent = parentTitle ? await goalByTitle(this.client, this.workspaceId, parentTitle) : null;
    if (parentTitle && !parent) throw new Error(`Parent goal not found: ${parentTitle}`);

    const domainTitle = titleFromWikilink(input.domain || parent?.domain_title || title);
    const primaryRoot = isPrimaryGoalTitle(title) && !parentTitle;
    const legacyId = await uniqueLegacyId(this.client, this.workspaceId, parentTitle, title);
    const row = {
      workspace_id: this.workspaceId,
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
        const parent = await goalByTitle(this.client, this.workspaceId, resolvedParentTitle);
        if (!parent) throw new Error(`Parent goal not found: ${resolvedParentTitle}`);
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
