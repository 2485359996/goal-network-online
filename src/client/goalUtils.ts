import type { GoalMap, GoalNode } from "../shared/types";
import { isPrimaryGoalNode } from "../shared/goalRules";

export type ImportanceOverrides = Record<string, number>;
export type ProgressOverrides = Record<string, number>;
export type ColorOverrides = Record<string, string>;

export function mediaQueryMatches(query: string, fallback = false) {
  return typeof window === "undefined" ? fallback : window.matchMedia(query).matches;
}

export function titleFromLink(value: string | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "");
}

export function formatEmpty(value: string | number | undefined) {
  return value === undefined || value === "" ? "未设置" : value;
}

export function percentValue(value: number | undefined, fallback = 0) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return clamp(Math.round(next <= 5 && next > 0 ? next * 20 : next), 0, 100);
}

export function shouldApplyGoalsResponse(requestId: number, latestRequestId: number) {
  return requestId === latestRequestId;
}

export function priorityWeight(value: number | undefined, fallback = 1) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

export function normalizedImportance(goals: GoalNode[], overrides: ImportanceOverrides = {}) {
  if (goals.length === 0) return {};

  const weights = goals.map((goal) =>
    goal.id in overrides ? clamp(Number(overrides[goal.id]), 0, 100) : priorityWeight(goal.priority)
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const exactValues = weights.map((weight) => (total > 0 ? (weight / total) * 100 : 100 / goals.length));
  const roundedValues = exactValues.map(Math.floor);
  let remaining = 100 - roundedValues.reduce((sum, value) => sum + value, 0);
  const byRemainder = exactValues
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const item of byRemainder) {
    if (remaining <= 0) break;
    roundedValues[item.index] += 1;
    remaining -= 1;
  }

  return Object.fromEntries(goals.map((goal, index) => [goal.id, roundedValues[index]]));
}

export function progressValue(goal: GoalNode) {
  return percentValue(goal.progress, percentValue(goal.clarity, 0));
}

export function weightedGoalProgress(
  goal: GoalNode,
  importanceOverrides: ImportanceOverrides = {},
  progressOverrides: ProgressOverrides = {}
): number {
  if ((goal.children || []).length === 0) {
    return goal.id in progressOverrides ? clamp(Math.round(Number(progressOverrides[goal.id])), 0, 100) : progressValue(goal);
  }

  const childImportance = normalizedImportance(goal.children, importanceOverrides);
  const weighted = goal.children.reduce((sum, child) => {
    return sum + weightedGoalProgress(child, importanceOverrides, progressOverrides) * ((childImportance[child.id] ?? 0) / 100);
  }, 0);
  return clamp(Math.round(weighted), 0, 100);
}

export function normalizeHexColor(value: string | undefined) {
  const raw = String(value ?? "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(raw)) return "";
  const lower = raw.toLowerCase();
  if (lower === "#1187a2") return "#0284c7";
  if (lower === "#7958c8") return "#6366f1";
  if (lower === "#45945c") return "#10b981";
  if (lower === "#4fbf83") return "#10b981";
  if (lower === "#687385") return "#64748b";
  return raw;
}

export const GOAL_THEME_COLORS = [
  { value: "#0284c7", label: "蓝色" },
  { value: "#6366f1", label: "靛紫" },
  { value: "#10b981", label: "绿松" },
  { value: "#f59e0b", label: "琥珀" },
  { value: "#e11d48", label: "玫红" },
  { value: "#0d9488", label: "青绿" },
  { value: "#8b5cf6", label: "紫罗兰" }
] as const;

export function goalThemeColorForIndex(index: number) {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return GOAL_THEME_COLORS[safeIndex % GOAL_THEME_COLORS.length].value;
}

export function nextGoalThemeColor(goals: Array<Pick<GoalNode, "color">>) {
  const usedColors = new Set(goals.map((goal) => normalizeHexColor(goal.color)).filter(Boolean));
  const unusedColor = GOAL_THEME_COLORS.find((color) => !usedColors.has(color.value));
  return unusedColor?.value ?? goalThemeColorForIndex(goals.length);
}

export function resolveGoalThemeColor(goal: Pick<GoalNode, "color" | "domain" | "title"> | undefined, fallback = "") {
  const explicitColor = normalizeHexColor(goal?.color);
  if (explicitColor) return explicitColor;

  const fallbackColor = normalizeHexColor(fallback);
  if (fallbackColor) return fallbackColor;

  return domainBaseColor(goal?.domain || goal?.title || "");
}

export function filterGoalTree(goals: GoalNode[], showArchived: boolean): GoalNode[] {
  return goals
    .filter((goal) => showArchived || goal.status !== "archived")
    .map((goal) => ({
      ...goal,
      children: filterGoalTree(goal.children || [], showArchived)
    }));
}

export function flattenGoals(goals: GoalNode[]) {
  const result: GoalNode[] = [];
  const visit = (goal: GoalNode) => {
    result.push(goal);
    goal.children.forEach(visit);
  };
  goals.forEach(visit);
  return result;
}

export function filterGoalsByGoalMap(goals: GoalNode[], goalMapId: string): GoalNode[] {
  if (!goalMapId) return [];
  return goals
    .filter((goal) => goal.goalMapId === goalMapId)
    .map((goal) => ({
      ...goal,
      children: filterGoalsByGoalMap(goal.children || [], goalMapId)
    }));
}

export function goalMapCenterTitle(goalMap: Pick<GoalMap, "name"> | undefined) {
  return goalMap?.name.trim() || "目标地图";
}

export function shouldShowFirstGoalMapCta(goalMaps: GoalMap[], loading: boolean) {
  return !loading && goalMaps.length === 0;
}

export function findGoalById(goals: GoalNode[], id: string): GoalNode | undefined {
  for (const goal of goals) {
    if (goal.id === id) return goal;
    const child = findGoalById(goal.children || [], id);
    if (child) return child;
  }
  return undefined;
}

export function goalPath(goals: GoalNode[], id: string): GoalNode[] {
  for (const goal of goals) {
    if (goal.id === id) return [goal];
    const childPath = goalPath(goal.children || [], id);
    if (childPath.length) return [goal, ...childPath];
  }
  return [];
}

export function buildParentMap(goals: GoalNode[], parentId = "root", result = new Map<string, string>()) {
  for (const goal of goals) {
    result.set(goal.id, parentId);
    buildParentMap(goal.children || [], goal.id, result);
  }
  return result;
}

export function collectDescendants(goal: GoalNode | undefined, result = new Set<string>()) {
  if (!goal) return result;
  for (const child of goal.children || []) {
    result.add(child.id);
    collectDescendants(child, result);
  }
  return result;
}

export function uniqueDomainTitles(goals: GoalNode[]) {
  const domains = new Set<string>();
  for (const goal of goals) {
    const domain = titleFromLink(goal.domain);
    if (domain) domains.add(domain);
  }
  return Array.from(domains).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function averageProgress(
  goals: GoalNode[],
  importanceOverrides: ImportanceOverrides = {},
  progressOverrides: ProgressOverrides = {}
) {
  const measurable = goals.filter((goal) => !isPrimaryGoalNode(goal));
  if (measurable.length === 0) return 0;
  const total = measurable.reduce((sum, goal) => sum + weightedGoalProgress(goal, importanceOverrides, progressOverrides), 0);
  return Math.round(total / measurable.length);
}

export function hexToRgb(hex: string) {
  const raw = hex.replace("#", "");
  const num = parseInt(raw, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

export function blend(hex: string, target: string, amount: number) {
  const source = hexToRgb(hex);
  const next = hexToRgb(target);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return `rgb(${mix(source.r, next.r)}, ${mix(source.g, next.g)}, ${mix(source.b, next.b)})`;
}

export function domainBaseColor(domain: string) {
  const normalized = titleFromLink(domain);
  if (normalized.includes("职业")) return "#0284c7";
  if (normalized.includes("个人") || normalized.includes("成长")) return "#6366f1";
  if (normalized.includes("幸福") || normalized.includes("生活")) return "#10b981";
  return "#64748b";
}

// UI 克罗姆用：返回主题感知的领域色 token 引用，让明暗主题自动切换为对应明度的领域色。
// SVG 星图仍使用 domainBaseColor 的原色 hex（节点取色需要具体数值做液面/星核渐变）。
export function domainAccentToken(domain: string) {
  const normalized = titleFromLink(domain);
  if (normalized.includes("职业")) return "var(--career)";
  if (normalized.includes("个人") || normalized.includes("成长")) return "var(--growth)";
  if (normalized.includes("幸福") || normalized.includes("生活")) return "var(--life)";
  return "var(--other)";
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function hasOwn(target: object, key: string) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

export function finitePosition(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function siblingGoals(goals: GoalNode[], selectedId: string) {
  const parents = buildParentMap(goals);
  const parentId = parents.get(selectedId) || "root";
  if (parentId === "root") return goals;
  return findGoalById(goals, parentId)?.children || [];
}

export function parentGoal(goals: GoalNode[], selectedId: string) {
  const parentId = buildParentMap(goals).get(selectedId);
  return parentId && parentId !== "root" ? findGoalById(goals, parentId) : undefined;
}

export function rebalanceImportance(goals: GoalNode[], selectedId: string, nextImportance: number): ImportanceOverrides {
  const siblings = siblingGoals(goals, selectedId);
  if (!siblings.some((goal) => goal.id === selectedId)) return {};

  const selectedImportance = clamp(Math.round(nextImportance), 0, 100);
  const others = siblings.filter((goal) => goal.id !== selectedId);
  const overrides: ImportanceOverrides = { [selectedId]: selectedImportance };
  if (others.length === 0) return overrides;

  // Distribute the remaining budget across the other siblings with the largest-remainder
  // method so every share stays non-negative and the shares sum exactly to `remaining`. The
  // old round-each-then-give-the-last-the-leftover approach could overshoot and hand the last
  // sibling a negative value, which the server rejects (priority must be >= 0) and fails the save.
  const remaining = Math.max(0, 100 - selectedImportance);
  const weights = others.map((goal) => priorityWeight(goal.priority));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const exactValues = weights.map((weight) =>
    weightTotal > 0 ? (weight / weightTotal) * remaining : remaining / others.length
  );
  const roundedValues = exactValues.map(Math.floor);
  let leftover = remaining - roundedValues.reduce((sum, value) => sum + value, 0);
  const byRemainder = exactValues
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const item of byRemainder) {
    if (leftover <= 0) break;
    roundedValues[item.index] += 1;
    leftover -= 1;
  }

  others.forEach((goal, index) => {
    overrides[goal.id] = roundedValues[index];
  });

  return overrides;
}
