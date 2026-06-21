import { createHash } from "node:crypto";
import { ApiError } from "../lib/api/context";
import { SupabaseGoalStore } from "../lib/stores/goals";
import type { SupabaseAdminClient } from "../lib/supabase/admin";
import {
  aiBranchContextSummarySchema,
  type AiBranchContextSummary,
  type AiEndpoint,
  type AiGoalContext
} from "../shared/aiContracts";
import type { GoalNode, GoalStatus, GoalsResponse } from "../shared/types";

export const AI_CONTEXT_SUMMARY_VERSION = 1;

const BRANCH_SUMMARY_ENDPOINTS = new Set<AiEndpoint>(["diagnose-branch", "suggest-weekly-actions", "agent"]);
const BRANCH_SUMMARY_SCOPE = "branch";
const BRANCH_SUMMARY_GOAL_LIMIT = 20;
const BRANCH_SUMMARY_ARRAY_LIMIT = 5;
const BRANCH_SUMMARY_TEXT_LIMIT = 180;
const GOAL_STATUSES: GoalStatus[] = ["active", "paused", "done", "archived"];

type BuildServerAiRequestOptions = {
  client: SupabaseAdminClient;
  workspaceId: string;
  actorUserId: string;
  readGoals?: () => Promise<GoalsResponse>;
  cache?: AiContextSummaryCache;
};

type BranchSummaryCacheKey = {
  workspaceId: string;
  goalId: string;
  scope: typeof BRANCH_SUMMARY_SCOPE;
  sourceHash: string;
};

export type AiContextSummaryCache = {
  read: (key: BranchSummaryCacheKey) => Promise<AiBranchContextSummary | null>;
  write: (key: BranchSummaryCacheKey, summary: AiBranchContextSummary) => Promise<void>;
};

export async function buildServerAiRequest(
  endpoint: AiEndpoint,
  request: unknown,
  options: BuildServerAiRequestOptions
): Promise<unknown> {
  if (endpoint === "draft-goal") return request;

  const goalId = goalIdFromRequest(request);
  if (!goalId) return request;

  const goalsResponse = options.readGoals
    ? await options.readGoals()
    : await new SupabaseGoalStore(options.client, options.workspaceId, options.actorUserId).readGoals();
  const goal = goalsResponse.flatGoals.find((candidate) => candidate.id === goalId);
  if (!goal) throw new ApiError("Goal not found", 404);

  const nextRequest: Record<string, unknown> = {
    ...(request && typeof request === "object" ? request : {}),
    goalId: goal.id,
    goal: goalContextFromNode(goal),
    parentChain: parentChain(goal, goalsResponse.flatGoals).map(goalContextFromNode),
    children: goal.children.map(goalContextFromNode),
    siblings: siblingGoals(goal, goalsResponse.flatGoals).map(goalContextFromNode)
  };

  if (BRANCH_SUMMARY_ENDPOINTS.has(endpoint)) {
    nextRequest.branchSummary = await branchSummaryForGoal(goal, {
      workspaceId: options.workspaceId,
      cache: options.cache ?? new SupabaseAiContextSummaryCache(options.client)
    });
    delete nextRequest.branchGoals;
  }

  return nextRequest;
}

export function goalContextFromNode(goal: GoalNode): AiGoalContext {
  return {
    id: goal.id,
    title: goal.title,
    status: goal.status,
    horizon: goal.horizon,
    domain: goal.domain,
    parent: goal.parent,
    priority: goal.priority,
    clarity: goal.clarity,
    progress: goal.progress,
    color: goal.color,
    summary: goal.sections.summary,
    directions: goal.sections.directions,
    successSignals: goal.sections.successSignals,
    actionCandidates: goal.sections.actionCandidates,
    reviewQuestions: goal.sections.reviewQuestions
  };
}

export async function branchSummaryForGoal(
  goal: GoalNode,
  options: {
    workspaceId: string;
    cache?: AiContextSummaryCache;
  }
): Promise<AiBranchContextSummary> {
  const branchGoals = flattenBranch(goal);
  const sourceHash = branchSourceHash(branchGoals);
  const cacheKey: BranchSummaryCacheKey = {
    workspaceId: options.workspaceId,
    goalId: goal.id,
    scope: BRANCH_SUMMARY_SCOPE,
    sourceHash
  };

  const cached = await options.cache?.read(cacheKey);
  if (cached) return cached;

  const summary = buildBranchContextSummary(goal, sourceHash);
  await options.cache?.write(cacheKey, summary);
  return summary;
}

export function buildBranchContextSummary(goal: GoalNode, sourceHash = branchSourceHash(flattenBranch(goal))): AiBranchContextSummary {
  const branchGoals = flattenBranch(goal);
  const selectedGoals = selectSummaryGoals(goal, branchGoals);
  const progressValues = branchGoals.flatMap((item) => (typeof item.progress === "number" ? [item.progress] : []));
  const clarityValues = branchGoals.map((item) => item.clarity).filter((value) => Number.isFinite(value));
  const statusCounts = countByStatus(branchGoals);
  const relationCounts = branchGoals.reduce(
    (acc, item) => ({
      supports: acc.supports + item.supports.length,
      depends_on: acc.depends_on + item.depends_on.length,
      conflicts_with: acc.conflicts_with + item.conflicts_with.length
    }),
    { supports: 0, depends_on: 0, conflicts_with: 0 }
  );
  const actionCounts = branchGoals.reduce(
    (acc, item) => {
      const counts = actionCountsForGoal(item);
      acc.open += counts.open;
      acc.completed += counts.completed;
      return acc;
    },
    { open: 0, completed: 0 }
  );

  return aiBranchContextSummarySchema.parse({
    summaryVersion: AI_CONTEXT_SUMMARY_VERSION,
    sourceHash,
    scope: BRANCH_SUMMARY_SCOPE,
    rootGoalId: goal.id,
    rootGoalTitle: goal.title,
    goalCount: branchGoals.length,
    omittedGoalCount: Math.max(0, branchGoals.length - selectedGoals.length),
    statusCounts,
    horizonCounts: countByString(branchGoals.map((item) => item.horizon || "unset")),
    averageClarity: roundedAverage(clarityValues),
    averageProgress: roundedAverage(progressValues),
    openActionCount: actionCounts.open,
    completedActionCount: actionCounts.completed,
    relationCounts,
    riskSignals: riskSignalsForBranch(branchGoals, relationCounts, actionCounts.open),
    recentSignals: recentSignalsForBranch(branchGoals),
    goals: selectedGoals.map(summaryGoalFromNode)
  });
}

export function branchSourceHash(branchGoals: GoalNode[]) {
  return createHash("sha256").update(stableStringify(branchGoals.map(goalSourceSnapshot))).digest("hex");
}

function goalIdFromRequest(request: unknown) {
  if (!request || typeof request !== "object") return "";
  const value = (request as { goalId?: unknown }).goalId;
  return typeof value === "string" ? value.trim() : "";
}

function parentChain(goal: GoalNode, flatGoals: GoalNode[]) {
  const chain: GoalNode[] = [];
  const seen = new Set<string>([goal.id]);
  let cursor: GoalNode | undefined = goal;

  while (cursor) {
    const parentTitle = titleFromWikilink(cursor.parent);
    if (!parentTitle) break;
    const parent = flatGoals.find((candidate) => candidate.title === parentTitle);
    if (!parent || seen.has(parent.id)) break;
    chain.unshift(parent);
    seen.add(parent.id);
    cursor = parent;
  }

  return chain;
}

function siblingGoals(goal: GoalNode, flatGoals: GoalNode[]) {
  const parentTitle = titleFromWikilink(goal.parent);
  const domainTitle = titleFromWikilink(goal.domain);
  return flatGoals.filter((candidate) => {
    if (candidate.id === goal.id) return false;
    return titleFromWikilink(candidate.parent) === parentTitle && titleFromWikilink(candidate.domain) === domainTitle;
  });
}

function flattenBranch(goal: GoalNode) {
  const result: GoalNode[] = [];
  const visit = (node: GoalNode) => {
    result.push(node);
    node.children.forEach(visit);
  };
  visit(goal);
  return result;
}

function goalSourceSnapshot(goal: GoalNode) {
  return {
    id: goal.id,
    title: goal.title,
    status: goal.status,
    horizon: goal.horizon,
    domain: goal.domain,
    parent: goal.parent,
    priority: goal.priority,
    clarity: goal.clarity,
    progress: goal.progress,
    color: goal.color,
    supports: goal.supports,
    depends_on: goal.depends_on,
    conflicts_with: goal.conflicts_with,
    last_reviewed: goal.last_reviewed,
    last_progress: goal.last_progress,
    sections: {
      summary: goal.sections.summary,
      directions: goal.sections.directions,
      successSignals: goal.sections.successSignals,
      actionCandidates: goal.sections.actionCandidates,
      reviewQuestions: goal.sections.reviewQuestions
    },
    childrenIds: goal.children.map((child) => child.id)
  };
}

function selectSummaryGoals(root: GoalNode, branchGoals: GoalNode[]) {
  if (branchGoals.length <= BRANCH_SUMMARY_GOAL_LIMIT) return branchGoals;
  const rest = branchGoals
    .filter((goal) => goal.id !== root.id)
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title, "zh-CN") || a.id.localeCompare(b.id));
  return [root, ...rest.slice(0, BRANCH_SUMMARY_GOAL_LIMIT - 1)];
}

function summaryGoalFromNode(goal: GoalNode) {
  const counts = actionCountsForGoal(goal);
  return {
    id: goal.id,
    title: goal.title,
    status: goal.status,
    horizon: goal.horizon,
    priority: goal.priority,
    clarity: goal.clarity,
    progress: goal.progress,
    summary: truncateText(goal.sections.summary),
    successSignals: goal.sections.successSignals.slice(0, BRANCH_SUMMARY_ARRAY_LIMIT).map(truncateText),
    openActionCount: counts.open,
    completedActionCount: counts.completed,
    childrenCount: goal.children.length,
    lastReviewed: truncateText(goal.last_reviewed, 80),
    lastProgress: truncateText(goal.last_progress, 120)
  };
}

function actionCountsForGoal(goal: GoalNode) {
  return goal.sections.actionCandidates.reduce(
    (acc, action) => {
      if (action.done) acc.completed += 1;
      else acc.open += 1;
      return acc;
    },
    { open: 0, completed: 0 }
  );
}

function countByStatus(goals: GoalNode[]) {
  const counts = Object.fromEntries(GOAL_STATUSES.map((status) => [status, 0])) as Record<GoalStatus, number>;
  for (const goal of goals) counts[goal.status] += 1;
  return counts;
}

function countByString(values: string[]) {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function roundedAverage(values: number[]) {
  if (!values.length) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(average * 10) / 10;
}

function riskSignalsForBranch(
  branchGoals: GoalNode[],
  relationCounts: { supports: number; depends_on: number; conflicts_with: number },
  openActionCount: number
) {
  const signals: string[] = [];
  const lowClarityCount = branchGoals.filter((goal) => goal.clarity <= 2 && goal.status === "active").length;
  const pausedCount = branchGoals.filter((goal) => goal.status === "paused").length;
  const highPriorityLowProgressCount = branchGoals.filter((goal) => goal.priority >= 70 && (goal.progress ?? 0) <= 20 && goal.status === "active").length;
  const activeLeafWithoutOpenActionCount = branchGoals.filter(
    (goal) => goal.status === "active" && goal.children.length === 0 && actionCountsForGoal(goal).open === 0
  ).length;
  const neverReviewedCount = branchGoals.filter((goal) => goal.status === "active" && !goal.last_reviewed.trim()).length;

  if (relationCounts.conflicts_with > 0) signals.push(`${relationCounts.conflicts_with} 个冲突关系需要处理`);
  if (lowClarityCount > 0) signals.push(`${lowClarityCount} 个活跃目标清晰度偏低`);
  if (pausedCount > 0) signals.push(`${pausedCount} 个目标处于暂停状态`);
  if (highPriorityLowProgressCount > 0) signals.push(`${highPriorityLowProgressCount} 个高优先级目标进展偏低`);
  if (activeLeafWithoutOpenActionCount > 0) signals.push(`${activeLeafWithoutOpenActionCount} 个活跃叶子目标没有开放行动候选`);
  if (neverReviewedCount > 0) signals.push(`${neverReviewedCount} 个活跃目标没有复盘记录`);
  if (openActionCount === 0) signals.push("当前分支没有开放行动候选");

  return signals.slice(0, 8);
}

function recentSignalsForBranch(branchGoals: GoalNode[]) {
  return branchGoals
    .flatMap((goal) => {
      const signals: string[] = [];
      if (goal.last_progress.trim()) signals.push(`${goal.title}: ${truncateText(goal.last_progress, 100)}`);
      if (goal.last_reviewed.trim()) signals.push(`${goal.title} 最近复盘: ${truncateText(goal.last_reviewed, 80)}`);
      return signals;
    })
    .slice(0, 8);
}

function titleFromWikilink(value: string | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "");
}

function truncateText(value: string, limit = BRANCH_SUMMARY_TEXT_LIMIT) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

class SupabaseAiContextSummaryCache implements AiContextSummaryCache {
  constructor(private readonly client: SupabaseAdminClient) {}

  async read(key: BranchSummaryCacheKey): Promise<AiBranchContextSummary | null> {
    const { data, error } = await this.client
      .from("ai_context_summaries")
      .select("source_hash, summary")
      .eq("workspace_id", key.workspaceId)
      .eq("goal_id", key.goalId)
      .eq("scope", key.scope)
      .eq("summary_version", AI_CONTEXT_SUMMARY_VERSION)
      .maybeSingle();

    if (error) {
      if (isMissingRelationError(error)) return null;
      throw error;
    }
    if (!data || data.source_hash !== key.sourceHash) return null;

    const parsed = aiBranchContextSummarySchema.safeParse(data.summary);
    return parsed.success ? parsed.data : null;
  }

  async write(key: BranchSummaryCacheKey, summary: AiBranchContextSummary): Promise<void> {
    const { error } = await this.client
      .from("ai_context_summaries")
      .upsert({
        workspace_id: key.workspaceId,
        goal_id: key.goalId,
        scope: key.scope,
        summary_version: AI_CONTEXT_SUMMARY_VERSION,
        source_hash: key.sourceHash,
        summary,
        updated_at: new Date().toISOString()
      }, { onConflict: "workspace_id,goal_id,scope,summary_version" });

    if (error && !isMissingRelationError(error)) throw error;
  }
}

function isMissingRelationError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return record.code === "42P01" || String(record.message ?? "").includes("ai_context_summaries");
}
