"use client";

import {
  BookOpen,
  Briefcase,
  CheckCircle2,
  CirclePlus,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Ellipsis,
  FileText,
  FolderTree,
  Gauge,
  GitBranch,
  GraduationCap,
  GripHorizontal,
  GripVertical,
  Heart,
  Home,
  Leaf,
  ListPlus,
  Loader2,
  Monitor,
  Moon,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Star,
  Sun,
  Trash2,
  User,
  Users,
  X
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionCreateInput,
  GoalActionCandidate,
  GoalCreateInput,
  GoalMap,
  GoalNode,
  GoalPatchInput,
  GoalsResponse,
  GoalStatus
} from "../shared/types";
import { createBrowserSupabaseClient } from "../lib/supabase/client";
import { isPrimaryGoalNode, isPrimaryGoalTitle, normalizedGoalTitle } from "../shared/goalRules";
import { AiAssistantDialog } from "./AiAssistantDialog";
import { CreateGoalDialog, type CreateGoalDialogContext } from "./CreateGoalDialog";
import { useModalDialog } from "./useModalDialog";
import {
  applyThemePreference,
  nextThemePreference,
  readStoredTheme,
  resolvedTheme,
  writeStoredTheme,
  type ThemePreference
} from "./theme";

const emptyGoals: GoalsResponse = {
  goalMaps: [],
  goals: [],
  flatGoals: [],
  graph: { nodes: [], edges: [] }
};

const ACTIVE_GOAL_MAP_STORAGE_KEY = "goal-network.activeGoalMapId";

function mediaQueryMatches(query: string, fallback = false) {
  return typeof window === "undefined" ? fallback : window.matchMedia(query).matches;
}

const STACKED_LAYOUT_QUERY = "(max-width: 1120px)";

const statusLabels: Record<GoalStatus, string> = {
  active: "推进中",
  paused: "暂停",
  done: "完成",
  archived: "归档"
};

const themeLabels: Record<ThemePreference, string> = {
  system: "系统设定",
  light: "浅色",
  dark: "深色"
};

type EditDraft = {
  importance: number;
  progress: number;
  notes: string;
  actions: GoalActionCandidate[];
};

type ImportanceOverrides = Record<string, number>;
type ProgressOverrides = Record<string, number>;
type MapPosition = { x: number; y: number };
type MapPositionOverrides = Record<string, MapPosition>;
type PendingEdit = {
  goal: GoalNode;
  draft: EditDraft;
};
type DraftCache = Record<string, EditDraft>;

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `请求失败：${response.status}`);
  }
  return response.json() as Promise<T>;
}

function titleFromLink(value: string | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "");
}

function formatEmpty(value: string | number | undefined) {
  return value === undefined || value === "" ? "未设置" : value;
}

function percentValue(value: number | undefined, fallback = 0) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return clamp(Math.round(next <= 5 && next > 0 ? next * 20 : next), 0, 100);
}

function priorityWeight(value: number | undefined, fallback = 1) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function normalizedImportance(goals: GoalNode[], overrides: ImportanceOverrides = {}) {
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

function progressValue(goal: GoalNode) {
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

function normalizeHexColor(value: string | undefined) {
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

function filterGoalTree(goals: GoalNode[], showArchived: boolean): GoalNode[] {
  return goals
    .filter((goal) => showArchived || goal.status !== "archived")
    .map((goal) => ({
      ...goal,
      children: filterGoalTree(goal.children || [], showArchived)
    }));
}

function flattenGoals(goals: GoalNode[]) {
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

function findGoalById(goals: GoalNode[], id: string): GoalNode | undefined {
  for (const goal of goals) {
    if (goal.id === id) return goal;
    const child = findGoalById(goal.children || [], id);
    if (child) return child;
  }
  return undefined;
}

function goalPath(goals: GoalNode[], id: string): GoalNode[] {
  for (const goal of goals) {
    if (goal.id === id) return [goal];
    const childPath = goalPath(goal.children || [], id);
    if (childPath.length) return [goal, ...childPath];
  }
  return [];
}

function buildParentMap(goals: GoalNode[], parentId = "root", result = new Map<string, string>()) {
  for (const goal of goals) {
    result.set(goal.id, parentId);
    buildParentMap(goal.children || [], goal.id, result);
  }
  return result;
}

function collectDescendants(goal: GoalNode | undefined, result = new Set<string>()) {
  if (!goal) return result;
  for (const child of goal.children || []) {
    result.add(child.id);
    collectDescendants(child, result);
  }
  return result;
}

function selectedFamily(goals: GoalNode[], selectedId: string) {
  if (!selectedId || selectedId === "root") return null;
  const selected = findGoalById(goals, selectedId);
  if (!selected) return null;

  const family = collectDescendants(selected, new Set([selected.id]));
  const parents = buildParentMap(goals);
  let current = parents.get(selected.id);
  while (current && current !== "root") {
    family.add(current);
    current = parents.get(current);
  }
  return family;
}

function uniqueDomainTitles(goals: GoalNode[]) {
  const domains = new Set<string>();
  for (const goal of goals) {
    const domain = titleFromLink(goal.domain);
    if (domain) domains.add(domain);
  }
  return Array.from(domains).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function averageProgress(
  goals: GoalNode[],
  importanceOverrides: ImportanceOverrides = {},
  progressOverrides: ProgressOverrides = {}
) {
  const measurable = goals.filter((goal) => !isPrimaryGoalNode(goal));
  if (measurable.length === 0) return 0;
  const total = measurable.reduce((sum, goal) => sum + weightedGoalProgress(goal, importanceOverrides, progressOverrides), 0);
  return Math.round(total / measurable.length);
}

function hexToRgb(hex: string) {
  const raw = hex.replace("#", "");
  const num = parseInt(raw, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function blend(hex: string, target: string, amount: number) {
  const source = hexToRgb(hex);
  const next = hexToRgb(target);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return `rgb(${mix(source.r, next.r)}, ${mix(source.g, next.g)}, ${mix(source.b, next.b)})`;
}

function domainBaseColor(domain: string) {
  const normalized = titleFromLink(domain);
  if (normalized.includes("职业")) return "#0284c7";
  if (normalized.includes("个人") || normalized.includes("成长")) return "#6366f1";
  if (normalized.includes("幸福") || normalized.includes("生活")) return "#10b981";
  return "#64748b";
}

// UI 克罗姆用：返回主题感知的领域色 token 引用，让明暗主题自动切换为对应明度的领域色。
// SVG 星图仍使用 domainBaseColor 的原色 hex（节点取色需要具体数值做液面/星核渐变）。
function domainAccentToken(domain: string) {
  const normalized = titleFromLink(domain);
  if (normalized.includes("职业")) return "var(--career)";
  if (normalized.includes("个人") || normalized.includes("成长")) return "var(--growth)";
  if (normalized.includes("幸福") || normalized.includes("生活")) return "var(--life)";
  return "var(--other)";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function finitePosition(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function clampGoalscapePosition(position: MapPosition): MapPosition {
  return {
    x: clamp(Math.round(position.x), 80, goalscapeViewBox.width - 80),
    y: clamp(Math.round(position.y), 70, goalscapeViewBox.height - 70)
  };
}

function savedGoalMapPosition(goal: GoalNode, mapContextId: string): MapPosition | undefined {
  const scoped = goal.map_positions?.[mapContextId];
  if (scoped) return clampGoalscapePosition(scoped);
  if (mapContextId !== "root") return undefined;
  if (!finitePosition(goal.map_x) || !finitePosition(goal.map_y)) return undefined;
  return clampGoalscapePosition({ x: goal.map_x, y: goal.map_y });
}

function goalMapPosition(goal: GoalNode, fallback: MapPosition, overrides: MapPositionOverrides, mapContextId: string) {
  return overrides[goal.id] ? clampGoalscapePosition(overrides[goal.id]) : savedGoalMapPosition(goal, mapContextId) ?? fallback;
}

function hasCustomMapPosition(goal: GoalNode | undefined, mapContextId: string) {
  return Boolean(goal && savedGoalMapPosition(goal, mapContextId));
}

function siblingGoals(goals: GoalNode[], selectedId: string) {
  const parents = buildParentMap(goals);
  const parentId = parents.get(selectedId) || "root";
  if (parentId === "root") return goals;
  return findGoalById(goals, parentId)?.children || [];
}

function parentGoal(goals: GoalNode[], selectedId: string) {
  const parentId = buildParentMap(goals).get(selectedId);
  return parentId && parentId !== "root" ? findGoalById(goals, parentId) : undefined;
}

function rebalanceImportance(goals: GoalNode[], selectedId: string, nextImportance: number): ImportanceOverrides {
  const siblings = siblingGoals(goals, selectedId);
  if (!siblings.some((goal) => goal.id === selectedId)) return {};

  const selectedImportance = clamp(Math.round(nextImportance), 0, 100);
  const others = siblings.filter((goal) => goal.id !== selectedId);
  const remaining = Math.max(0, 100 - selectedImportance);
  const otherTotal = others.reduce((sum, goal) => sum + priorityWeight(goal.priority), 0);
  const overrides: ImportanceOverrides = { [selectedId]: selectedImportance };

  let allocated = 0;
  others.forEach((goal, index) => {
    const exact = otherTotal > 0 ? (priorityWeight(goal.priority) / otherTotal) * remaining : remaining / Math.max(1, others.length);
    const next = index === others.length - 1 ? remaining - allocated : Math.round(exact);
    overrides[goal.id] = next;
    allocated += next;
  });

  return overrides;
}

export function GoalApp() {
  const [goals, setGoals] = useState<GoalsResponse>(emptyGoals);
  const [selectedId, setSelectedId] = useState("root");
  const [activeGoalMapId, setActiveGoalMapId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [importancePreview, setImportancePreview] = useState<ImportanceOverrides>({});
  const [progressPreview, setProgressPreview] = useState<ProgressOverrides>({});
  const [mapPositionPreview, setMapPositionPreview] = useState<MapPositionOverrides>({});
  const [scopeListCollapsed, setScopeListCollapsed] = useState(true);
  const [deleteCandidate, setDeleteCandidate] = useState<GoalNode | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [createGoalDialogContext, setCreateGoalDialogContext] = useState<CreateGoalDialogContext | null>(null);
  const [createGoalMapOpen, setCreateGoalMapOpen] = useState(false);
  const [renameGoalMapCandidate, setRenameGoalMapCandidate] = useState<GoalMap | null>(null);
  const [deleteGoalMapCandidate, setDeleteGoalMapCandidate] = useState<GoalMap | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiGoal, setAiGoal] = useState<GoalNode | null>(null);
  const [detailWidth, setDetailWidth] = useState(440);
  const [mapPaneHeight, setMapPaneHeight] = useState(520);
  // 这三个初值必须与服务端 SSR 输出一致（确定值），否则水合那一帧渲染的图标/aria/布局会和服务端不符 → hydration mismatch。
  // 客户端真实值在挂载后由各自的 effect 纠正（stacked→layout effect、systemPrefersDark/themePreference→theme effect）。
  const [stackedLayout, setStackedLayout] = useState(false);
  const [resizingPanelAxis, setResizingPanelAxis] = useState<"width" | "height" | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const mapPaneRef = useRef<HTMLElement | null>(null);
  const pendingEditRef = useRef<PendingEdit | null>(null);
  const pendingSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draftCacheRef = useRef<DraftCache>({});

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => {
      setSystemPrefersDark(mediaQuery.matches);
      applyThemePreference(themePreference, { systemPrefersDark: mediaQuery.matches });
    };

    syncTheme();
    mediaQuery.addEventListener("change", syncTheme);
    return () => mediaQuery.removeEventListener("change", syncTheme);
  }, [themePreference]);

  // 挂载后从 localStorage 读取真实主题偏好（初值用 "system" 以匹配服务端），并立即应用，避免比"system→存储值"多一帧中间态。
  useEffect(() => {
    const stored = readStoredTheme();
    setThemePreference(stored);
    applyThemePreference(stored, { systemPrefersDark: mediaQueryMatches("(prefers-color-scheme: dark)") });
  }, []);

  const loadGoals = useCallback(async () => {
    const next = await api<GoalsResponse>("/api/goals");
    setGoals(next);
    return next;
  }, []);

  const reload = useCallback(async () => {
    try {
      const next = await loadGoals();
      setError("");
      return next;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "加载失败");
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, [loadGoals]);

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);

  useEffect(() => {
    const workspaceId = goals.workspaceId;
    if (!workspaceId) return;
    const supabase = createBrowserSupabaseClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`goal-network:${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "goal_maps", filter: `workspace_id=eq.${workspaceId}` }, () => {
        void reload().catch(() => undefined);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "goals", filter: `workspace_id=eq.${workspaceId}` }, () => {
        void reload().catch(() => undefined);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "goal_relations", filter: `workspace_id=eq.${workspaceId}` }, () => {
        void reload().catch(() => undefined);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "weekly_actions", filter: `workspace_id=eq.${workspaceId}` }, () => {
        void reload().catch(() => undefined);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "records", filter: `workspace_id=eq.${workspaceId}` }, () => {
        void reload().catch(() => undefined);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setError((current) => (current === "Realtime disconnected" ? "" : current));
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setError("Realtime disconnected");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [goals.workspaceId, reload]);

  const allVisibleTree = useMemo(() => filterGoalTree(goals.goals, false), [goals.goals]);
  const activeGoalMap = useMemo(() => goals.goalMaps.find((goalMap) => goalMap.id === activeGoalMapId), [activeGoalMapId, goals.goalMaps]);
  const visibleTree = useMemo(
    () => (activeGoalMap ? filterGoalsByGoalMap(allVisibleTree, activeGoalMap.id) : []),
    [activeGoalMap, allVisibleTree]
  );
  const visibleFlatGoals = useMemo(() => flattenGoals(visibleTree), [visibleTree]);
  const selectedGoal = useMemo(
    () => visibleFlatGoals.find((goal) => goal.id === selectedId),
    [selectedId, visibleFlatGoals]
  );
  const selectedGoalFull = useMemo(() => visibleFlatGoals.find((goal) => goal.id === selectedId), [selectedId, visibleFlatGoals]);
  const activeAiGoal = useMemo(() => (aiGoal ? goals.flatGoals.find((goal) => goal.id === aiGoal.id) ?? aiGoal : null), [aiGoal, goals.flatGoals]);
  const selectedParent = useMemo(() => parentGoal(visibleTree, selectedId), [selectedId, visibleTree]);
  const mapGoals = visibleTree;
  const mapContextId = activeGoalMap?.id || "root";
  const mapCenterId = activeGoalMap?.id || "root";
  const domainTitles = useMemo(() => uniqueDomainTitles(visibleFlatGoals), [visibleFlatGoals]);
  const goalMapCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const goal of goals.flatGoals) counts[goal.goalMapId] = (counts[goal.goalMapId] ?? 0) + 1;
    return counts;
  }, [goals.flatGoals]);

  useEffect(() => {
    if (goals.goalMaps.length === 0) {
      if (activeGoalMapId) setActiveGoalMapId("");
      if (selectedId !== "root") setSelectedId("root");
      return;
    }

    const storedId = typeof window === "undefined" ? "" : window.localStorage.getItem(ACTIVE_GOAL_MAP_STORAGE_KEY) ?? "";
    const preferredId = activeGoalMapId || storedId;
    const nextMap = goals.goalMaps.find((goalMap) => goalMap.id === preferredId) ?? goals.goalMaps[0];
    if (nextMap.id !== activeGoalMapId) setActiveGoalMapId(nextMap.id);
    if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_GOAL_MAP_STORAGE_KEY, nextMap.id);
  }, [activeGoalMapId, goals.goalMaps, selectedId]);

  useEffect(() => {
    const centerId = activeGoalMap?.id || "root";
    if (selectedId !== centerId && !selectedGoal) setSelectedId(centerId);
  }, [activeGoalMap, selectedGoal, selectedId]);

  useEffect(() => {
    setImportancePreview((current) => (Object.keys(current).length ? {} : current));
    setProgressPreview((current) => (Object.keys(current).length ? {} : current));
  }, [selectedId]);

  const clampDetailWidth = useCallback((value: number) => {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const maxWidth = Math.max(340, Math.min(560, workspaceWidth - 520));
    return clamp(Math.round(value), 340, maxWidth);
  }, []);

  const clampMapPaneHeight = useCallback((value: number) => {
    const maxHeight = Math.max(320, Math.min(720, window.innerHeight - 220));
    return clamp(Math.round(value), 320, maxHeight);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(STACKED_LAYOUT_QUERY);
    const syncLayout = () => {
      setStackedLayout(mediaQuery.matches);
      if (mediaQuery.matches) {
        setMapPaneHeight((current) => clampMapPaneHeight(current));
      }
    };

    syncLayout();
    mediaQuery.addEventListener("change", syncLayout);
    window.addEventListener("resize", syncLayout);
    return () => {
      mediaQuery.removeEventListener("change", syncLayout);
      window.removeEventListener("resize", syncLayout);
    };
  }, [clampMapPaneHeight]);

  const startPanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    event.preventDefault();
    const resizingHeight = window.matchMedia(STACKED_LAYOUT_QUERY).matches;
    const mapPaneRect = mapPaneRef.current?.getBoundingClientRect();
    if (resizingHeight && !mapPaneRect) return;

    setResizingPanelAxis(resizingHeight ? "height" : "width");
    const workspaceRect = workspace.getBoundingClientRect();

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (resizingHeight) {
        setMapPaneHeight(clampMapPaneHeight(moveEvent.clientY - mapPaneRect!.top));
        return;
      }

      setDetailWidth(clampDetailWidth(workspaceRect.right - moveEvent.clientX));
    };
    const handlePointerUp = () => {
      setResizingPanelAxis(null);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    handlePointerMove(event.nativeEvent);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  const nudgeDetailWidth = (delta: number) => {
    setDetailWidth((current) => clampDetailWidth(current + delta));
  };

  const nudgeMapPaneHeight = (delta: number) => {
    setMapPaneHeight((current) => clampMapPaneHeight(current + delta));
  };

  const runWrite = useCallback(async (work: () => Promise<GoalsResponse | void>, message: string) => {
    setSaving(true);
    setError("");
    try {
      await work();
      setNotice(message);
      window.setTimeout(() => setNotice(""), 2400);
      return true;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const clearCachedDraft = useCallback((goalId: string, savedDraft?: EditDraft) => {
    const cachedDraft = draftCacheRef.current[goalId];
    if (!cachedDraft || !savedDraft || draftsEqual(cachedDraft, savedDraft)) {
      delete draftCacheRef.current[goalId];
    }
    const pending = pendingEditRef.current;
    if (pending?.goal.id === goalId && (!savedDraft || draftsEqual(pending.draft, savedDraft))) {
      pendingEditRef.current = null;
    }
  }, []);

  const saveGoal = useCallback(async (goal: GoalNode, draft: EditDraft, options: { selectAfterSave?: string | false } = {}) => {
    return runWrite(async () => {
      const nextImportance = rebalanceImportance(visibleTree, goal.id, draft.importance);
      const primaryGoal = isPrimaryGoalNode(goal);
      const patch: GoalPatchInput = {
        priority: Number(nextImportance[goal.id] ?? draft.importance),
        summary: draft.notes
      };
      if (!primaryGoal && goal.children.length === 0) {
        patch.clarity = Math.max(1, Math.ceil(Number(draft.progress) / 20));
        patch.progress = Number(draft.progress);
      }
      if (!primaryGoal) {
        patch.actionCandidates = draft.actions;
      }
      await api(`/api/goals/${encodeURIComponent(goal.id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      await Promise.all(
        Object.entries(nextImportance)
          .filter(([id]) => id !== goal.id)
          .map(([id, priority]) =>
            api(`/api/goals/${encodeURIComponent(id)}`, {
              method: "PATCH",
              body: JSON.stringify({ priority })
            })
          )
      );
      const next = await loadGoals();
      setImportancePreview({});
      setProgressPreview({});
      clearCachedDraft(goal.id, draft);
      if (options.selectAfterSave !== false) {
        const nextSelectedId = options.selectAfterSave ?? (next.flatGoals.some((item) => item.id === goal.id) ? goal.id : "root");
        setSelectedId(nextSelectedId);
      }
      return next;
    }, "目标已保存");
  }, [clearCachedDraft, loadGoals, runWrite, visibleTree]);

  const registerPendingEdit = useCallback((goal: GoalNode, draft: EditDraft, dirty: boolean) => {
    if (dirty) {
      pendingEditRef.current = { goal, draft };
      draftCacheRef.current[goal.id] = draft;
      return;
    }
    if (pendingEditRef.current?.goal.id === goal.id) {
      pendingEditRef.current = null;
    }
    delete draftCacheRef.current[goal.id];
  }, []);

  const queuePendingEditSave = useCallback(() => {
    const pending = pendingEditRef.current;
    if (!pending) return pendingSaveQueueRef.current;

    pendingEditRef.current = null;
    pendingSaveQueueRef.current = pendingSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const saved = await saveGoal(pending.goal, pending.draft, { selectAfterSave: false });
        if (!saved && !pendingEditRef.current) {
          pendingEditRef.current = pending;
        }
      });
    return pendingSaveQueueRef.current;
  }, [saveGoal]);

  const selectGoal = useCallback((id: string) => {
    if (id === selectedId) return;
    queuePendingEditSave();
    setSelectedId(id);
  }, [queuePendingEditSave, selectedId]);

  const createGoal = async (input: GoalCreateInput): Promise<boolean> => {
    return runWrite(async () => {
      const primaryGoal = isPrimaryGoalTitle(input.title) && !normalizedGoalTitle(input.parent);
      const payload: GoalCreateInput = {
        ...input,
        goalMapId: input.goalMapId,
        priority: Number(input.priority),
        clarity: Number(input.clarity)
      };
      if (!primaryGoal) payload.progress = Number(input.progress ?? 0);
      await api("/api/goals", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const next = await loadGoals();
      const createdGoal = next.flatGoals.find((goal) => goal.title === input.title.trim() && goal.goalMapId === input.goalMapId);
      if (createdGoal) {
        pendingEditRef.current = null;
        delete draftCacheRef.current[createdGoal.id];
        setSelectedId(createdGoal.id);
      } else {
        setSelectedId(activeGoalMap?.id || "root");
      }
      return next;
    }, "目标已创建");
  };

  const selectGoalMap = useCallback((goalMapId: string) => {
    queuePendingEditSave();
    setActiveGoalMapId(goalMapId);
    setSelectedId(goalMapId);
    setImportancePreview({});
    setProgressPreview({});
    setMapPositionPreview({});
    if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_GOAL_MAP_STORAGE_KEY, goalMapId);
  }, [queuePendingEditSave]);

  const createGoalMap = useCallback(async (name: string): Promise<boolean> => {
    return runWrite(async () => {
      const created = await api<GoalMap>("/api/goal-maps", {
        method: "POST",
        body: JSON.stringify({ name })
      });
      const next = await loadGoals();
      const nextMap = next.goalMaps.find((goalMap) => goalMap.id === created.id) ?? created;
      setActiveGoalMapId(nextMap.id);
      setSelectedId(nextMap.id);
      if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_GOAL_MAP_STORAGE_KEY, nextMap.id);
      return next;
    }, "目标地图已创建");
  }, [loadGoals, runWrite]);

  const patchGoalMap = useCallback(async (goalMap: GoalMap, name: string): Promise<boolean> => {
    return runWrite(async () => {
      const updated = await api<GoalMap>(`/api/goal-maps/${encodeURIComponent(goalMap.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name })
      });
      const next = await loadGoals();
      setActiveGoalMapId(updated.id);
      setSelectedId(updated.id);
      if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_GOAL_MAP_STORAGE_KEY, updated.id);
      return next;
    }, "目标地图已重命名");
  }, [loadGoals, runWrite]);

  const deleteGoalMap = useCallback(async (goalMap: GoalMap): Promise<boolean> => {
    return runWrite(async () => {
      pendingEditRef.current = null;
      await api(`/api/goal-maps/${encodeURIComponent(goalMap.id)}`, {
        method: "DELETE"
      });
      const next = await loadGoals();
      const keptActiveMap = next.goalMaps.find((item) => item.id === activeGoalMapId && item.id !== goalMap.id);
      const nextActiveMap = keptActiveMap ?? next.goalMaps[0];
      const nextActiveId = nextActiveMap?.id ?? "";
      setActiveGoalMapId(nextActiveId);
      setSelectedId(nextActiveId || "root");
      setImportancePreview({});
      setProgressPreview({});
      setMapPositionPreview({});
      if (typeof window !== "undefined") {
        if (nextActiveId) window.localStorage.setItem(ACTIVE_GOAL_MAP_STORAGE_KEY, nextActiveId);
        else window.localStorage.removeItem(ACTIVE_GOAL_MAP_STORAGE_KEY);
      }
      return next;
    }, "目标地图已删除");
  }, [activeGoalMapId, loadGoals, runWrite]);

  const patchGoalFromAi = useCallback(async (goalId: string, patch: GoalPatchInput): Promise<boolean> => {
    return runWrite(async () => {
      await api(`/api/goals/${encodeURIComponent(goalId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      await loadGoals();
    }, "AI 建议已应用");
  }, [loadGoals, runWrite]);

  const createWeeklyActionFromAi = useCallback(async (input: ActionCreateInput): Promise<boolean> => {
    return runWrite(async () => {
      await api("/api/actions/current", {
        method: "POST",
        body: JSON.stringify(input)
      });
      await loadGoals();
    }, "本周行动已创建");
  }, [loadGoals, runWrite]);

  const openAiAssistant = useCallback((goal: GoalNode) => {
    setAiGoal(goal);
    setAiOpen(true);
  }, []);

  const deleteGoal = async (goal: GoalNode) => {
    const deleted = await runWrite(async () => {
      pendingEditRef.current = null;
      await api(`/api/goals/${encodeURIComponent(goal.id)}`, {
        method: "DELETE"
      });
      await loadGoals();
      setSelectedId(activeGoalMap?.id || "root");
    }, "目标已删除");
    if (deleted) setDeleteCandidate(null);
  };

  const previewImportance = useCallback((goalId: string, value: number) => {
    setImportancePreview(rebalanceImportance(visibleTree, goalId, value));
  }, [visibleTree]);

  const previewProgress = useCallback((goalId: string, value: number) => {
    setProgressPreview({ [goalId]: clamp(Math.round(value), 0, 100) });
  }, []);

  const previewMapPosition = useCallback((goalId: string, position: MapPosition) => {
    setMapPositionPreview((current) => ({
      ...current,
      [goalId]: clampGoalscapePosition(position)
    }));
  }, []);

  const saveMapPosition = useCallback((goalId: string, position: MapPosition) => {
    const nextPosition = clampGoalscapePosition(position);
    void runWrite(async () => {
      await api(`/api/goals/${encodeURIComponent(goalId)}`, {
        method: "PATCH",
        body: JSON.stringify({ map_positions: { [mapContextId]: nextPosition } })
      });
      await loadGoals();
      setMapPositionPreview((current) => {
        const next = { ...current };
        delete next[goalId];
        return next;
      });
    }, "目标位置已保存");
  }, [loadGoals, mapContextId, runWrite]);

  const resetSelectedMapPosition = useCallback(() => {
    if (!selectedGoalFull) return;
    const goalId = selectedGoalFull.id;
    void runWrite(async () => {
      await api(`/api/goals/${encodeURIComponent(goalId)}`, {
        method: "PATCH",
        body: JSON.stringify({ map_positions: { [mapContextId]: null } })
      });
      await loadGoals();
      setMapPositionPreview((current) => {
        const next = { ...current };
        delete next[goalId];
        return next;
      });
    }, "目标位置已重置");
  }, [loadGoals, mapContextId, runWrite, selectedGoalFull]);

  const openCreateQuickGoalDialog = useCallback((mode: "subgoal" | "sibling") => {
    if (!activeGoalMap || !selectedGoalFull) return;
    const parent = mode === "subgoal" ? selectedGoalFull : selectedParent;
    if (mode === "sibling" && !parent) return;
    setCreateGoalDialogContext({
      mode,
      goalMap: activeGoalMap,
      parentGoal: parent,
      sourceGoal: selectedGoalFull,
      siblings: mode === "subgoal" ? selectedGoalFull.children : siblingGoals(visibleTree, selectedGoalFull.id),
      existingGoals: goals.flatGoals,
      domainCandidates: domainTitles
    });
  }, [activeGoalMap, domainTitles, goals.flatGoals, selectedGoalFull, selectedParent, visibleTree]);

  const openCreateTopGoalDialog = useCallback(() => {
    if (!activeGoalMap) return;
    setCreateGoalDialogContext({
      mode: "top",
      goalMap: activeGoalMap,
      siblings: visibleTree,
      existingGoals: goals.flatGoals,
      domainCandidates: domainTitles
    });
  }, [activeGoalMap, domainTitles, goals.flatGoals, visibleTree]);

  const submitRename = async (nextTitle: string) => {
    if (!selectedGoalFull) return;
    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === selectedGoalFull.title) {
      setRenameOpen(false);
      return;
    }
    await runWrite(async () => {
      await api(`/api/goals/${encodeURIComponent(selectedGoalFull.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ title: trimmed })
      });
      const next = await loadGoals();
      const renamedGoal = next.flatGoals.find((item) => item.title === trimmed);
      const nextId = renamedGoal?.id || (next.flatGoals.some((item) => item.id === selectedGoalFull.id) ? selectedGoalFull.id : activeGoalMap?.id || "root");
      setSelectedId(nextId);
    }, "目标已重命名");
    setRenameOpen(false);
  };

  const activeCount = useMemo(() => visibleFlatGoals.filter((goal) => goal.status === "active").length, [visibleFlatGoals]);
  const doneCount = useMemo(() => visibleFlatGoals.filter((goal) => goal.status === "done").length, [visibleFlatGoals]);
  const progressAverage = useMemo(() => averageProgress(visibleFlatGoals), [visibleFlatGoals]);
  const syncStatus = saving ? "保存中" : loading ? "读取中" : error ? "同步异常" : "已同步";
  const workspaceStyle = useMemo(
    () =>
      ({
        "--detail-width": `${detailWidth}px`,
        "--map-pane-height": `${mapPaneHeight}px`
      }) as React.CSSProperties & { "--detail-width": string; "--map-pane-height": string },
    [detailWidth, mapPaneHeight]
  );
  const resizingClass = resizingPanelAxis ? ` is-resizing is-resizing-${resizingPanelAxis}` : "";
  const appliedTheme = resolvedTheme(themePreference, systemPrefersDark);
  const nextThemeLabel = themeLabels[nextThemePreference(themePreference)];
  const themeButtonLabel = `主题：${themeLabels[themePreference]}，当前${themeLabels[appliedTheme]}，点击切换为${nextThemeLabel}`;
  const ThemeIcon = themePreference === "system" ? Monitor : themePreference === "light" ? Sun : Moon;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Network />
          </span>
          <div>
            <h1>目标网络</h1>
          </div>
        </div>
        <div className="header-metrics" aria-label="目标网络概览">
          <span>
            <FolderTree />
            {visibleTree.length} 个顶层
          </span>
          <span>
            <Gauge />
            {progressAverage}%
          </span>
          <span>
            <CheckCircle2 />
            {doneCount}/{activeCount + doneCount}
          </span>
          <span className={error ? "sync-pill error" : "sync-pill"}>
            {saving || loading ? <Loader2 className="spin" /> : <RefreshCw />}
            {syncStatus}
          </span>
        </div>
        <div className="header-actions" aria-label="页面操作">
          <button
            type="button"
            className="icon-button theme-toggle"
            title={themeButtonLabel}
            aria-label={themeButtonLabel}
            onClick={() => {
              const next = nextThemePreference(themePreference);
              setThemePreference(next);
              writeStoredTheme(next);
            }}
          >
            <ThemeIcon />
          </button>
          <button type="button" className="icon-button header-refresh" title="刷新目标" aria-label="刷新目标" onClick={() => void reload()} disabled={loading || saving}>
            <RefreshCw />
          </button>
        </div>
      </header>
      {(notice || error) && <div className={error ? "banner error" : "banner"}>{error || notice}</div>}

      <main ref={workspaceRef} className={`map-workspace${resizingClass}`} style={workspaceStyle}>
        <section ref={mapPaneRef} className={`map-pane ${scopeListCollapsed ? "scope-collapsed" : "scope-open"}`} aria-label="Goalscape 风格目标地图">
          {!shouldShowFirstGoalMapCta(goals.goalMaps, loading) && activeGoalMap && (
            <div className="map-pane-toolbar" aria-label="Map tools">
              <MapScopeList
                goalMaps={goals.goalMaps}
                activeGoalMapId={activeGoalMap.id}
                goalCounts={goalMapCounts}
                collapsed={scopeListCollapsed}
                saving={saving}
                onToggle={() => setScopeListCollapsed((current) => !current)}
                onSelectMap={selectGoalMap}
                onCreateMap={() => setCreateGoalMapOpen(true)}
                onRenameMap={setRenameGoalMapCandidate}
                onDeleteMap={setDeleteGoalMapCandidate}
              />
              <MapActions
                activeGoalMap={activeGoalMap}
                mapCenterSelected={selectedId === mapCenterId && !selectedGoalFull}
                selectedGoal={selectedGoalFull}
                saving={saving}
                canAddSibling={Boolean(selectedParent)}
                canResetPosition={hasCustomMapPosition(selectedGoalFull, mapContextId)}
                onAddTopGoal={openCreateTopGoalDialog}
                onAddSubgoal={() => openCreateQuickGoalDialog("subgoal")}
                onAddSibling={() => openCreateQuickGoalDialog("sibling")}
                onRenameMap={() => activeGoalMap && setRenameGoalMapCandidate(activeGoalMap)}
                onRename={() => selectedGoalFull && setRenameOpen(true)}
                onResetPosition={resetSelectedMapPosition}
                onDelete={() => selectedGoalFull && setDeleteCandidate(selectedGoalFull)}
              />
            </div>
          )}
          <div className="map-canvas">
            {loading ? (
            <div className="loading-state">
              <Loader2 className="spin" />
              正在读取 Obsidian 目标
            </div>
          ) : shouldShowFirstGoalMapCta(goals.goalMaps, loading) ? (
            <div className="first-map-empty" role="status">
              <button type="button" className="first-map-cta" onClick={() => setCreateGoalMapOpen(true)} disabled={saving}>
                <Sparkles />
                开始你的第一个目标
              </button>
            </div>
          ) : activeGoalMap ? (
            <GoalMap
              goals={mapGoals}
              selectedId={selectedId}
              importanceOverrides={importancePreview}
              progressOverrides={progressPreview}
              positionOverrides={mapPositionPreview}
              mapContextId={mapContextId}
              centerId={mapCenterId}
              centerTitle={goalMapCenterTitle(activeGoalMap)}
              emptyLabel={visibleTree.length === 0 ? "这张目标地图还没有目标" : ""}
              onSelect={selectGoal}
              onPreviewPosition={previewMapPosition}
              onCommitPosition={saveMapPosition}
            />
          ) : null}
            {!loading && activeGoalMap && visibleTree.length === 0 && (
            <div className="empty-scape map-empty-scape" role="status">
              <button type="button" className="empty-scape-cta secondary" onClick={openCreateTopGoalDialog} disabled={saving}>
                <CirclePlus />
                添加第一个目标
              </button>
            </div>
            )}
          </div>
        </section>

        <div
          className={`pane-resizer ${stackedLayout ? "horizontal" : "vertical"}`}
          role="separator"
          aria-label={stackedLayout ? "调整上方地图窗口高度" : "调整右侧窗口宽度"}
          aria-orientation={stackedLayout ? "horizontal" : "vertical"}
          aria-valuenow={stackedLayout ? mapPaneHeight : detailWidth}
          tabIndex={0}
          onPointerDown={startPanelResize}
          onKeyDown={(event) => {
            if (stackedLayout) {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                nudgeMapPaneHeight(-24);
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                nudgeMapPaneHeight(24);
              }
              return;
            }

            if (event.key === "ArrowLeft") {
              event.preventDefault();
              nudgeDetailWidth(24);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              nudgeDetailWidth(-24);
            }
          }}
        >
          <span className="resizer-grip" aria-hidden="true">
            {stackedLayout ? <GripHorizontal /> : <GripVertical />}
          </span>
        </div>

        <GoalDetailPanel
          selectedGoal={selectedGoal}
          activeGoalMap={activeGoalMap}
          cachedDraft={selectedGoal ? draftCacheRef.current[selectedGoal.id] : undefined}
          topGoals={visibleTree}
          saving={saving}
          importanceOverrides={importancePreview}
          progressOverrides={progressPreview}
          onSelect={selectGoal}
          onSave={saveGoal}
          onPreviewImportance={previewImportance}
          onPreviewProgress={previewProgress}
          onDraftChange={registerPendingEdit}
          onOpenAi={openAiAssistant}
        />
      </main>
      {aiOpen && activeAiGoal && (
        <AiAssistantDialog
          goal={activeAiGoal}
          flatGoals={goals.flatGoals}
          saving={saving}
          onClose={() => setAiOpen(false)}
          onBeforeGenerate={queuePendingEditSave}
          onPatchGoal={patchGoalFromAi}
          onCreateGoal={createGoal}
          onCreateWeeklyAction={createWeeklyActionFromAi}
        />
      )}
      {createGoalDialogContext && (
        <CreateGoalDialog
          context={createGoalDialogContext}
          saving={saving}
          onCancel={() => setCreateGoalDialogContext(null)}
          onBeforeSubmit={queuePendingEditSave}
          onBeforeGenerate={queuePendingEditSave}
          onCreate={createGoal}
        />
      )}
      <RenameGoalDialog
        goal={renameOpen ? selectedGoalFull ?? null : null}
        saving={saving}
        onCancel={() => setRenameOpen(false)}
        onConfirm={(title) => void submitRename(title)}
      />
      <GoalMapNameDialog
        open={createGoalMapOpen}
        title="新建目标地图"
        initialName=""
        saving={saving}
        submitLabel="创建"
        onCancel={() => setCreateGoalMapOpen(false)}
        onConfirm={(name) => {
          void createGoalMap(name).then((created) => {
            if (created) setCreateGoalMapOpen(false);
          });
        }}
      />
      <GoalMapNameDialog
        open={Boolean(renameGoalMapCandidate)}
        title="重命名目标地图"
        initialName={renameGoalMapCandidate?.name || ""}
        saving={saving}
        submitLabel="重命名"
        onCancel={() => setRenameGoalMapCandidate(null)}
        onConfirm={(name) => {
          if (!renameGoalMapCandidate) return;
          void patchGoalMap(renameGoalMapCandidate, name).then((renamed) => {
            if (renamed) setRenameGoalMapCandidate(null);
          });
        }}
      />
      <DeleteGoalMapDialog
        goalMap={deleteGoalMapCandidate}
        goalCount={deleteGoalMapCandidate ? goalMapCounts[deleteGoalMapCandidate.id] ?? 0 : 0}
        saving={saving}
        onCancel={() => setDeleteGoalMapCandidate(null)}
        onConfirm={() => {
          if (!deleteGoalMapCandidate) return;
          void deleteGoalMap(deleteGoalMapCandidate).then((deleted) => {
            if (deleted) setDeleteGoalMapCandidate(null);
          });
        }}
      />
      <DeleteGoalDialog
        goal={deleteCandidate}
        saving={saving}
        onCancel={() => setDeleteCandidate(null)}
        onConfirm={() => deleteCandidate && void deleteGoal(deleteCandidate)}
      />
    </div>
  );
}

function MapScopeList({
  goalMaps,
  activeGoalMapId,
  goalCounts,
  collapsed,
  saving,
  onToggle,
  onSelectMap,
  onCreateMap,
  onRenameMap,
  onDeleteMap
}: {
  goalMaps: GoalMap[];
  activeGoalMapId: string;
  goalCounts: Record<string, number>;
  collapsed: boolean;
  saving: boolean;
  onToggle: () => void;
  onSelectMap: (id: string) => void;
  onCreateMap: () => void;
  onRenameMap: (goalMap: GoalMap) => void;
  onDeleteMap: (goalMap: GoalMap) => void;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const openMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (collapsed) setOpenMenuId(null);
  }, [collapsed]);

  useEffect(() => {
    if (!openMenuId) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!openMenuRef.current?.contains(event.target as Node)) setOpenMenuId(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpenMenuId(null);
      }
    };
    openMenuRef.current?.querySelector<HTMLElement>(".menu-item:not([disabled])")?.focus();
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [openMenuId]);

  return (
    <aside className={`map-scope-list${collapsed ? " collapsed" : ""}`} aria-label="目标地图列表">
      <button
        type="button"
        className="scope-toggle"
        aria-label={collapsed ? "打开目标地图列表" : "折叠目标地图列表"}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        {collapsed ? <ChevronRight /> : <ChevronLeft />}
      </button>
      {!collapsed && (
        <div className="scope-content">
          <p className="scope-title">目标地图</p>
          {goalMaps.map((goalMap) => {
            const active = activeGoalMapId === goalMap.id;
            const menuOpen = openMenuId === goalMap.id;
            return (
              <div key={goalMap.id} className="scope-map-entry" style={{ "--scope-accent": "var(--accent)" } as React.CSSProperties}>
                <button
                  type="button"
                  className={active ? "scope-item active" : "scope-item"}
                  onClick={() => onSelectMap(goalMap.id)}
                >
                  <span>{goalMap.name}</span>
                  <small>{goalCounts[goalMap.id] ?? 0} 个目标</small>
                </button>
                <div className="scope-item-menu-wrap" ref={menuOpen ? openMenuRef : null}>
                  <button
                    type="button"
                    className="scope-item-menu-trigger"
                    title="目标地图操作"
                    aria-label={`目标地图「${goalMap.name}」操作`}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenMenuId((current) => (current === goalMap.id ? null : goalMap.id));
                    }}
                  >
                    <Ellipsis />
                  </button>
                  {menuOpen && (
                    <div className="quick-menu scope-map-menu" role="menu">
                      <button
                        type="button"
                        className="menu-item"
                        disabled={saving}
                        onClick={() => {
                          setOpenMenuId(null);
                          onRenameMap(goalMap);
                        }}
                      >
                        <Pencil />
                        重命名地图
                      </button>
                      <button
                        type="button"
                        className="menu-item danger-menu-item"
                        disabled={saving}
                        onClick={() => {
                          setOpenMenuId(null);
                          onDeleteMap(goalMap);
                        }}
                      >
                        <Trash2 />
                        删除地图
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div className="scope-divider" />
          <button type="button" className="scope-create" onClick={onCreateMap}>
            <Plus />
            <span>新建目标地图</span>
          </button>
        </div>
      )}
    </aside>
  );
}

function MapActions({
  activeGoalMap,
  mapCenterSelected,
  selectedGoal,
  saving,
  canAddSibling,
  canResetPosition,
  onAddTopGoal,
  onAddSubgoal,
  onAddSibling,
  onRenameMap,
  onRename,
  onResetPosition,
  onDelete
}: {
  activeGoalMap: GoalMap | undefined;
  mapCenterSelected: boolean;
  selectedGoal: GoalNode | undefined;
  saving: boolean;
  canAddSibling: boolean;
  canResetPosition: boolean;
  onAddTopGoal: () => void;
  onAddSubgoal: () => void;
  onAddSibling: () => void;
  onRenameMap: () => void;
  onRename: () => void;
  onResetPosition: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const disabled = saving || !selectedGoal;
  const mapDisabled = saving || !activeGoalMap;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuWrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    menuWrapRef.current?.querySelector<HTMLElement>(".menu-item:not([disabled])")?.focus();
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  if (mapCenterSelected) {
    return (
      <div className="map-actions">
        <button type="button" className="icon-button" title="添加顶层目标" aria-label="添加顶层目标" disabled={mapDisabled} onClick={onAddTopGoal}>
          <ListPlus />
        </button>
        <div className="menu-wrap" ref={menuWrapRef}>
          <button
            type="button"
            ref={triggerRef}
            className="icon-button"
            title="目标地图菜单"
            aria-label="目标地图菜单"
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={mapDisabled}
            onClick={() => setOpen((current) => !current)}
          >
            <Ellipsis />
          </button>
          {open && (
            <div className="quick-menu" role="menu">
              <button
                type="button"
                className="menu-item"
                disabled={mapDisabled}
                onClick={() => {
                  setOpen(false);
                  onRenameMap();
                }}
              >
                <Pencil />
                重命名地图
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="map-actions">
      <button type="button" className="icon-button" title="添加子目标" aria-label="添加子目标" disabled={disabled} onClick={onAddSubgoal}>
        <ListPlus />
      </button>
      <button type="button" className="icon-button" title="添加同级目标" aria-label="添加同级目标" disabled={disabled || !canAddSibling} onClick={onAddSibling}>
        <CirclePlus />
      </button>
      <div className="menu-wrap" ref={menuWrapRef}>
        <button
          type="button"
          ref={triggerRef}
          className="icon-button"
          title="菜单与快捷操作"
          aria-label="菜单与快捷操作"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <Ellipsis />
        </button>
        {open && (
          <div className="quick-menu" role="menu">
            <button
              type="button"
              className="menu-item"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onRename();
              }}
            >
              <Pencil />
              重命名
            </button>
            <button
              type="button"
              className="menu-item"
              disabled={disabled || !canResetPosition}
              onClick={() => {
                setOpen(false);
                onResetPosition();
              }}
            >
              <RefreshCw />
              重置位置
            </button>
            <button
              type="button"
              className="menu-item danger-menu-item"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              <Trash2 />
              彻底删除
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DeleteGoalDialog({
  goal,
  saving,
  onCancel,
  onConfirm
}: {
  goal: GoalNode | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!goal) return null;
  return <DeleteGoalDialogBody goal={goal} saving={saving} onCancel={onCancel} onConfirm={onConfirm} />;
}

function DeleteGoalDialogBody({
  goal,
  saving,
  onCancel,
  onConfirm
}: {
  goal: GoalNode;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { dialogRef, onBackdropPointerDown, onBackdropClick } = useModalDialog<HTMLElement>({
    onDismiss: onCancel,
    canDismiss: !saving
  });
  const childCount = collectDescendants(goal).size;

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onBackdropPointerDown} onClick={onBackdropClick}>
      <section ref={dialogRef} tabIndex={-1} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
        <div className="dialog-head">
          <div>
            <p className="eyebrow">删除目标</p>
            <h2 id="delete-dialog-title">彻底删除「{goal.title}」？</h2>
          </div>
          <button type="button" className="icon-button compact" aria-label="取消删除" disabled={saving} onClick={onCancel}>
            <X />
          </button>
        </div>
        <p className="dialog-copy">
          这会直接删除对应 Markdown 文件{childCount ? `，并一并删除 ${childCount} 个子目标` : ""}。此操作无法在应用内撤销。
        </p>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" disabled={saving} onClick={onCancel}>
            取消
          </button>
          <button type="button" className="danger-button" disabled={saving} onClick={onConfirm}>
            {saving ? <Loader2 className="spin" /> : <Trash2 />}
            彻底删除
          </button>
        </div>
      </section>
    </div>
  );
}

function DeleteGoalMapDialog({
  goalMap,
  goalCount,
  saving,
  onCancel,
  onConfirm
}: {
  goalMap: GoalMap | null;
  goalCount: number;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!goalMap) return null;
  return (
    <DeleteGoalMapDialogBody goalMap={goalMap} goalCount={goalCount} saving={saving} onCancel={onCancel} onConfirm={onConfirm} />
  );
}

function DeleteGoalMapDialogBody({
  goalMap,
  goalCount,
  saving,
  onCancel,
  onConfirm
}: {
  goalMap: GoalMap;
  goalCount: number;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { dialogRef, onBackdropPointerDown, onBackdropClick } = useModalDialog<HTMLElement>({
    onDismiss: onCancel,
    canDismiss: !saving
  });

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onBackdropPointerDown} onClick={onBackdropClick}>
      <section ref={dialogRef} tabIndex={-1} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-goal-map-dialog-title">
        <div className="dialog-head">
          <div>
            <p className="eyebrow">删除目标地图</p>
            <h2 id="delete-goal-map-dialog-title">彻底删除「{goalMap.name}」？</h2>
          </div>
          <button type="button" className="icon-button compact" aria-label="取消删除" disabled={saving} onClick={onCancel}>
            <X />
          </button>
        </div>
        <p className="dialog-copy">
          这会删除这张目标地图{goalCount ? `，并一并删除其中 ${goalCount} 个目标` : ""}。此操作无法在应用内撤销。
        </p>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" disabled={saving} onClick={onCancel}>
            取消
          </button>
          <button type="button" className="danger-button" disabled={saving} onClick={onConfirm}>
            {saving ? <Loader2 className="spin" /> : <Trash2 />}
            彻底删除
          </button>
        </div>
      </section>
    </div>
  );
}

function GoalMapNameDialog({
  open,
  title,
  initialName,
  saving,
  submitLabel,
  onCancel,
  onConfirm
}: {
  open: boolean;
  title: string;
  initialName: string;
  saving: boolean;
  submitLabel: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  if (!open) return null;
  return (
    <GoalMapNameDialogBody
      title={title}
      initialName={initialName}
      saving={saving}
      submitLabel={submitLabel}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function GoalMapNameDialogBody({
  title,
  initialName,
  saving,
  submitLabel,
  onCancel,
  onConfirm
}: {
  title: string;
  initialName: string;
  saving: boolean;
  submitLabel: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const { dialogRef, onBackdropPointerDown, onBackdropClick } = useModalDialog<HTMLElement>({
    onDismiss: onCancel,
    canDismiss: !saving
  });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(initialName);

  useEffect(() => {
    setName(initialName);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [initialName]);

  const trimmed = name.trim();
  const canSubmit = !saving && trimmed.length > 0 && trimmed !== initialName.trim();

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onBackdropPointerDown} onClick={onBackdropClick}>
      <section ref={dialogRef} tabIndex={-1} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="goal-map-dialog-title">
        <div className="dialog-head">
          <div>
            <p className="eyebrow">目标地图</p>
            <h2 id="goal-map-dialog-title">{title}</h2>
          </div>
          <button type="button" className="icon-button compact" aria-label="取消" disabled={saving} onClick={onCancel}>
            <X />
          </button>
        </div>
        <form
          className="rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) onConfirm(trimmed);
          }}
        >
          <label className="rename-field">
            <span className="field-label">地图名称</span>
            <input
              ref={inputRef}
              type="text"
              value={name}
              maxLength={120}
              placeholder="输入目标地图名称"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button type="button" className="secondary-button" disabled={saving} onClick={onCancel}>
              取消
            </button>
            <button type="submit" className="primary-button" disabled={!canSubmit}>
              {saving ? <Loader2 className="spin" /> : <Pencil />}
              {submitLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RenameGoalDialog({
  goal,
  saving,
  onCancel,
  onConfirm
}: {
  goal: GoalNode | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (title: string) => void;
}) {
  if (!goal) return null;
  return <RenameGoalDialogBody goal={goal} saving={saving} onCancel={onCancel} onConfirm={onConfirm} />;
}

function RenameGoalDialogBody({
  goal,
  saving,
  onCancel,
  onConfirm
}: {
  goal: GoalNode;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (title: string) => void;
}) {
  const { dialogRef, onBackdropPointerDown, onBackdropClick } = useModalDialog<HTMLElement>({
    onDismiss: onCancel,
    canDismiss: !saving
  });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState(goal.title);

  // useModalDialog 会先把焦点收进弹窗（首个可聚焦元素是关闭按钮），随后这里再把焦点移到输入框并选中全文，
  // 让用户直接改写——还原 prompt() 的「打开即可编辑」手感，但保留焦点环与归还。
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = title.trim();
  const canSubmit = !saving && trimmed.length > 0 && trimmed !== goal.title;

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onBackdropPointerDown} onClick={onBackdropClick}>
      <section ref={dialogRef} tabIndex={-1} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-dialog-title">
        <div className="dialog-head">
          <div>
            <p className="eyebrow">重命名目标</p>
            <h2 id="rename-dialog-title">重命名「{goal.title}」</h2>
          </div>
          <button type="button" className="icon-button compact" aria-label="取消重命名" disabled={saving} onClick={onCancel}>
            <X />
          </button>
        </div>
        <form
          className="rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) onConfirm(trimmed);
          }}
        >
          <label className="rename-field">
            <span className="field-label">目标名称</span>
            <input
              ref={inputRef}
              type="text"
              value={title}
              maxLength={120}
              placeholder="输入新的目标名称"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button type="button" className="secondary-button" disabled={saving} onClick={onCancel}>
              取消
            </button>
            <button type="submit" className="primary-button" disabled={!canSubmit}>
              {saving ? <Loader2 className="spin" /> : <Pencil />}
              重命名
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

type GoalscapeSectorRole = "primary" | "descendant";

type GoalscapeNodeLayout = {
  node: GoalNode;
  parentId: string;
  depth: number;
  treeDepth: number;
  visibleDepth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  progress: number;
  importance: number;
  variant: number;
  treeDistance: number;
  perspectiveScale: number;
  opacity: number;
  zIndex: number;
  linkParentId: string;
  sectorStartAngle: number;
  sectorEndAngle: number;
  sectorMidAngle: number;
  sectorRole: GoalscapeSectorRole;
  childCount?: number;
};

export type GoalscapeOrbit = {
  depth: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
};

export const goalscapeCenter = { x: 600, y: 380, width: 142, height: 120 };

const goalscapeViewBox = { width: 1200, height: 760 };

export function goalscapeOrbitForDepth(depth: number, visibleDepth = 2): GoalscapeOrbit {
  const safeDepth = Math.max(1, Math.round(depth));
  const safeVisibleDepth = Math.max(1, Math.round(visibleDepth));
  const inner = { rx: 170, ry: 120 };
  const edge = { rx: 470, ry: 300 };
  const ratio =
    safeVisibleDepth === 1
      ? 0.5
      : clamp((Math.min(safeDepth, safeVisibleDepth) - 1) / (safeVisibleDepth - 1), 0, 1);

  return {
    depth: safeDepth,
    cx: goalscapeCenter.x,
    cy: goalscapeCenter.y,
    rx: inner.rx + (edge.rx - inner.rx) * ratio,
    ry: inner.ry + (edge.ry - inner.ry) * ratio
  };
}

export function constrainGoalscapePositionToOrbit(position: MapPosition, orbit: GoalscapeOrbit): MapPosition {
  const clamped = clampGoalscapePosition(position);
  const deltaX = clamped.x - orbit.cx;
  const deltaY = clamped.y - orbit.cy;

  if (Math.hypot(deltaX, deltaY) < 0.001) {
    return { x: orbit.cx, y: orbit.cy - orbit.ry };
  }

  const scale = 1 / Math.sqrt(deltaX ** 2 / orbit.rx ** 2 + deltaY ** 2 / orbit.ry ** 2);
  return {
    x: orbit.cx + deltaX * scale,
    y: orbit.cy + deltaY * scale
  };
}

export function goalscapeNodeDensity(progress: number) {
  return 0.12 + 0.68 * (clamp(progress, 0, 100) / 100);
}

export function goalscapeStarlightCoreRadius(baseRadius: number, progress: number) {
  return baseRadius * (0.2 + 0.8 * (clamp(progress, 0, 100) / 100));
}

function goalscapeChildNodeSize(
  parentSize: Pick<GoalscapeNodeLayout, "width" | "height">,
  childIndex: number,
  depth = 2,
  densityScale = 1,
  focusScale = 1
) {
  const depthScale = clamp(0.8 - Math.max(0, depth - 2) * 0.075, 0.58, 0.8);
  const siblingTaper = 1 - Math.min(childIndex, 4) * 0.015;
  const scale = clamp(depthScale * siblingTaper * densityScale * focusScale, 0.42, 1.08);
  const minWidth = depth === 1 ? 82 : depth === 2 ? 68 : depth === 3 ? 54 : 46;
  const minHeight = depth === 1 ? 66 : depth === 2 ? 54 : depth === 3 ? 44 : 36;
  return {
    width: Math.round(clamp(parentSize.width * scale, minWidth, parentSize.width * 1.08)),
    height: Math.round(clamp(parentSize.height * scale, minHeight, parentSize.height * 1.08))
  };
}

function goalscapeNodeVisualMetrics(layout: Pick<GoalscapeNodeLayout, "width" | "height" | "depth">) {
  const iconMin = layout.depth === 1 ? 28 : layout.depth === 2 ? 22 : 17;
  const iconMax = layout.depth === 1 ? 32 : layout.depth === 2 ? 26 : 22;
  const titleMin = layout.depth === 1 ? 16 : layout.depth === 2 ? 12 : 10;
  const titleMax = layout.depth === 1 ? 18 : layout.depth === 2 ? 13 : 12;
  const iconSize = Math.round(clamp(layout.width * 0.26, iconMin, iconMax));
  const titleSize = Math.round(clamp(layout.width * (layout.depth === 1 ? 0.145 : 0.14), titleMin, titleMax));
  const progressSize = Math.round(clamp(layout.width * 0.095, layout.depth >= 3 ? 8 : 10, 12));
  return {
    iconSize,
    iconGlyphSize: Math.round(iconSize * 0.58),
    iconY: layout.depth === 1 ? layout.height * 0.48 : layout.depth === 2 ? layout.height * 0.46 : layout.height * 0.44,
    titleY: layout.depth === 1 ? layout.height * 0.03 : layout.depth === 2 ? layout.height * 0.06 : layout.height * 0.08,
    titleLineGap: layout.depth === 1 ? Math.round(titleSize * 1.18) : Math.round(titleSize * 1.14),
    titleSize,
    progressSize,
    progressY: layout.height * (layout.depth === 1 ? 0.42 : layout.depth === 2 ? 0.44 : 0.46),
    coreRadius: clamp(layout.width * 0.095, layout.depth === 1 ? 10 : layout.depth === 2 ? 7 : 5, layout.depth === 1 ? 12 : 9)
  };
}

export function goalscapeProgressFillGeometry(centerY: number, height: number, progress: number) {
  const safeProgress = clamp(progress, 0, 100);
  const fillHeight = height * (safeProgress / 100);
  const bottom = centerY + height / 2;
  return {
    y: bottom - fillHeight,
    height: fillHeight,
    surfaceY: bottom - fillHeight
  };
}

export type GoalscapeCenterPearlTint = {
  primary: string;
  secondary: string;
  tertiary: string;
  iridescent: string;
  energy: string;
  glow: string;
  isRoot: boolean;
};

export function goalscapeCenterPearlTint(centerId: string, goal?: GoalNode | null): GoalscapeCenterPearlTint {
  if (centerId === "root" || !goal) {
    return {
      primary: "#e0e7ff",
      secondary: "#a7f3d0",
      tertiary: "#bae6fd",
      iridescent: "#ddd6fe",
      energy: "#fbbf24",
      glow: "#fff7ed",
      isRoot: true
    };
  }

  const base = goalscapeNodeColor(goal, domainBaseColor(goal.domain || goal.title));
  return {
    primary: blend(base, "#ffffff", 0.72),
    secondary: blend(base, "#ffffff", 0.88),
    tertiary: blend(base, "#12233e", 0.12),
    iridescent: blend(base, "#fbbf24", 0.22),
    energy: blend(base, "#fbbf24", 0.45),
    glow: blend(base, "#fff7ed", 0.55),
    isRoot: false
  };
}

export const goalscapeCenterPearlSize = { width: 128, height: 108, variant: 0 };
const goalscapeAstrolabeOuterRadius = 86;
const goalscapeAstrolabeInnerRadius = 72;

function GoalscapeCenterAstrolabe({ cx, cy }: { cx: number; cy: number }) {
  const ticks = Array.from({ length: 72 }, (_, index) => {
    const angle = (index * 360) / 72 - 90;
    const radians = (angle * Math.PI) / 180;
    const major = index % 6 === 0;
    const outerRadius = goalscapeAstrolabeOuterRadius;
    const innerRadius = major ? goalscapeAstrolabeInnerRadius : goalscapeAstrolabeOuterRadius - 5;

    return {
      x1: cx + Math.cos(radians) * innerRadius,
      y1: cy + Math.sin(radians) * innerRadius,
      x2: cx + Math.cos(radians) * outerRadius,
      y2: cy + Math.sin(radians) * outerRadius,
      major
    };
  });

  const runes = Array.from({ length: 8 }, (_, index) => {
    const angle = (index * 360) / 8 - 90;
    const radians = (angle * Math.PI) / 180;
    const radius = goalscapeAstrolabeOuterRadius + 4;

    return {
      x: cx + Math.cos(radians) * radius,
      y: cy + Math.sin(radians) * radius,
      rotation: angle + 90
    };
  });

  return (
    <g className="goalscape-center-astrolabe" style={{ transformOrigin: `${cx}px ${cy}px` }}>
      <circle
        cx={cx}
        cy={cy}
        r={goalscapeAstrolabeOuterRadius}
        fill="none"
        stroke="url(#goalscape-hub-gold-rim)"
        strokeWidth="1.4"
        opacity="0.48"
      />
      <circle
        cx={cx}
        cy={cy}
        r={goalscapeAstrolabeInnerRadius - 6}
        fill="none"
        stroke="rgba(255, 255, 255, 0.35)"
        strokeWidth="0.7"
        strokeDasharray="1.5 5"
      />
      {ticks.map((tick, index) => (
        <line
          key={`tick-${index}`}
          x1={tick.x1}
          y1={tick.y1}
          x2={tick.x2}
          y2={tick.y2}
          stroke={tick.major ? "rgba(251, 191, 36, 0.72)" : "rgba(251, 191, 36, 0.35)"}
          strokeWidth={tick.major ? 1.3 : 0.7}
          strokeLinecap="round"
        />
      ))}
      {runes.map((rune, index) => (
        <g key={`rune-${index}`} transform={`translate(${rune.x} ${rune.y}) rotate(${rune.rotation})`}>
          <path
            d="M0 -5 L2.5 0 L0 5 L-2.5 0 Z M0 -5 V5"
            fill="none"
            stroke="rgba(251, 191, 36, 0.58)"
            strokeWidth="0.9"
            strokeLinecap="round"
          />
        </g>
      ))}
    </g>
  );
}

function goalscapeNodeColor(goal: GoalNode, fallback: string) {
  return normalizeHexColor(goal.color) || domainBaseColor(goal.domain || goal.title) || fallback;
}

const goalscapeMaxVisibleDepth = 4;
const goalscapeMinOrbitGap = 90;
const goalscapeCollapseMinWidth = 52;
const goalscapeCollapseMinHeight = 40;
const goalscapeFocusSectorMidAngle = -35;
const goalscapeFocusPathWeightScale = 2.4;
const goalscapeFocusSiblingWeightScale = 0.55;

type GoalscapeTreeStats = {
  maxDepth: number;
  counts: Map<number, number>;
};

type GoalscapeSector = {
  startAngle: number;
  endAngle: number;
};

const goalscapeFullSector: GoalscapeSector = { startAngle: -90, endAngle: 270 };

type GoalscapeFocusContext = {
  activeSelectionId?: string;
  selectedPathIds: Set<string>;
  selectedDescendantIds: Set<string>;
  selectedSubtreeIds: Set<string>;
  maxTreeDepth: number;
};

function goalscapeSectorMidAngle(sector: GoalscapeSector) {
  return (sector.startAngle + sector.endAngle) / 2;
}

function goalscapeSectorSpan(sector: GoalscapeSector) {
  return Math.max(0.001, sector.endAngle - sector.startAngle);
}

function collectGoalscapeTreeStats(goals: GoalNode[], depth = 1, stats: GoalscapeTreeStats = { maxDepth: 0, counts: new Map() }) {
  for (const goal of goals) {
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    stats.counts.set(depth, (stats.counts.get(depth) ?? 0) + 1);
    collectGoalscapeTreeStats(goal.children || [], depth + 1, stats);
  }
  return stats;
}

function goalscapeOrbitCircumference(orbit: Pick<GoalscapeOrbit, "rx" | "ry">) {
  return Math.PI * (3 * (orbit.rx + orbit.ry) - Math.sqrt((3 * orbit.rx + orbit.ry) * (orbit.rx + 3 * orbit.ry)));
}

function goalscapeOrbitCapacity(depth: number, visibleDepth: number) {
  const orbit = goalscapeOrbitForDepth(depth, visibleDepth);
  return Math.max(1, Math.floor(goalscapeOrbitCircumference(orbit) / goalscapeMinOrbitGap));
}

function goalscapeVisibleDepth(stats: GoalscapeTreeStats) {
  if (stats.maxDepth === 0) return 3;

  let visibleDepth = Math.min(goalscapeMaxVisibleDepth, Math.max(3, stats.maxDepth));
  while (visibleDepth > 3) {
    let overflowDepth = 0;
    for (let depth = 1; depth <= visibleDepth; depth += 1) {
      const count = stats.counts.get(depth) ?? 0;
      if (count > goalscapeOrbitCapacity(depth, visibleDepth)) {
        overflowDepth = depth;
        break;
      }
    }
    if (overflowDepth === 0) return visibleDepth;
    if (overflowDepth <= 3) return 3;
    visibleDepth = overflowDepth - 1;
  }

  return Math.max(3, visibleDepth);
}

function goalscapeRingDensityScale(count: number, depth: number, visibleDepth: number) {
  const capacity = goalscapeOrbitCapacity(depth, visibleDepth);
  const pressure = Math.max(1, count) / capacity;
  if (pressure <= 0.72) return 1;
  return clamp(1 - (pressure - 0.72) * 0.28, 0.7, 1);
}

function goalscapeSubtreeLeafCount(goal: GoalNode): number {
  const children = goal.children || [];
  if (children.length === 0) return 1;
  return children.reduce((sum, child) => sum + goalscapeSubtreeLeafCount(child), 0);
}

function countGoalscapeDescendants(goal: GoalNode): number {
  return (goal.children || []).reduce((sum, child) => sum + 1 + countGoalscapeDescendants(child), 0);
}

function goalscapePointOnOrbit(angle: number, depth: number, visibleDepth: number): MapPosition {
  const orbit = goalscapeOrbitForDepth(depth, visibleDepth);
  return goalscapePointOnSpecificOrbit(angle, orbit);
}

function goalscapePointOnSpecificOrbit(angle: number, orbit: GoalscapeOrbit): MapPosition {
  const radians = (angle * Math.PI) / 180;
  const deltaX = Math.cos(radians);
  const deltaY = Math.sin(radians);
  const scale = 1 / Math.sqrt(deltaX ** 2 / orbit.rx ** 2 + deltaY ** 2 / orbit.ry ** 2);
  return {
    x: orbit.cx + deltaX * scale,
    y: orbit.cy + deltaY * scale
  };
}

function goalscapeAngleForPosition(position: MapPosition) {
  return (Math.atan2(position.y - goalscapeCenter.y, position.x - goalscapeCenter.x) * 180) / Math.PI;
}

function goalscapeAngleInSector(angle: number, sector: GoalscapeSector) {
  const candidates = [angle - 720, angle - 360, angle, angle + 360, angle + 720];
  return candidates.find((candidate) => candidate >= sector.startAngle && candidate <= sector.endAngle);
}

function clampGoalscapeAngleToSector(angle: number, sector: GoalscapeSector, padding = 0) {
  if (goalscapeSectorSpan(sector) >= 359.5) return angle;

  const safePadding = Math.min(Math.max(0, padding), goalscapeSectorSpan(sector) / 2.5);
  const range = {
    startAngle: sector.startAngle + safePadding,
    endAngle: sector.endAngle - safePadding
  };
  const inside = goalscapeAngleInSector(angle, range);
  if (inside !== undefined) return inside;

  return [angle - 720, angle - 360, angle, angle + 360, angle + 720]
    .map((candidate) => ({
      angle: clamp(candidate, range.startAngle, range.endAngle),
      distance:
        candidate < range.startAngle
          ? range.startAngle - candidate
          : candidate > range.endAngle
            ? candidate - range.endAngle
            : 0
    }))
    .sort((a, b) => a.distance - b.distance)[0].angle;
}

function constrainGoalscapePositionToSectorOrbit(
  position: MapPosition,
  orbit: GoalscapeOrbit,
  sector: GoalscapeSector,
  padding = 4
): MapPosition {
  const orbitPosition = constrainGoalscapePositionToOrbit(position, orbit);
  const angle = clampGoalscapeAngleToSector(goalscapeAngleForPosition(orbitPosition), sector, padding);
  return goalscapePointOnSpecificOrbit(angle, orbit);
}

function goalscapeWeightedSpans(weights: number[], totalSpan: number, minSpan: number) {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0) || weights.length;
  const rawSpans = weights.map((weight) => (totalSpan * Math.max(0, weight || 1)) / totalWeight);
  const floor = Math.max(0, Math.min(minSpan, totalSpan / weights.length));
  const floored = rawSpans.map((span) => span < floor);
  const floorTotal = floored.filter(Boolean).length * floor;
  if (floorTotal >= totalSpan) return Array.from({ length: weights.length }, () => totalSpan / weights.length);

  const remainingRaw = rawSpans.reduce((sum, span, index) => sum + (floored[index] ? 0 : span), 0);
  const remainingSpan = totalSpan - floorTotal;
  return rawSpans.map((span, index) => (floored[index] ? floor : (span / remainingRaw) * remainingSpan));
}

function goalscapeSectorWeights(goals: GoalNode[], focusContext: GoalscapeFocusContext) {
  const hasSelectedPathSibling = Boolean(
    focusContext.activeSelectionId && goals.some((goal) => focusContext.selectedPathIds.has(goal.id))
  );

  return goals.map((goal) => {
    const base = goalscapeSubtreeLeafCount(goal);
    if (!hasSelectedPathSibling) return base;
    return base * (focusContext.selectedPathIds.has(goal.id) ? goalscapeFocusPathWeightScale : goalscapeFocusSiblingWeightScale);
  });
}

function goalscapeSectorsForSiblings(goals: GoalNode[], parentSector: GoalscapeSector, focusContext: GoalscapeFocusContext) {
  const result = new Map<string, GoalscapeSector>();
  if (goals.length === 0) return result;

  if (goals.length === 1) {
    result.set(goals[0].id, parentSector);
    return result;
  }

  const spans = goalscapeWeightedSpans(
    goalscapeSectorWeights(goals, focusContext),
    goalscapeSectorSpan(parentSector),
    Math.min(40, goalscapeSectorSpan(parentSector) / goals.length)
  );
  let cursor = parentSector.startAngle;
  goals.forEach((goal, index) => {
    const span = spans[index] ?? goalscapeSectorSpan(parentSector) / goals.length;
    result.set(goal.id, { startAngle: cursor, endAngle: cursor + span });
    cursor += span;
  });
  return result;
}

function rotateGoalscapeSector(sector: GoalscapeSector, delta: number): GoalscapeSector {
  return {
    startAngle: sector.startAngle + delta,
    endAngle: sector.endAngle + delta
  };
}

function buildGoalscapeSectorIndex(goals: GoalNode[], focusContext: GoalscapeFocusContext) {
  const sectors = new Map<string, GoalscapeSector>();
  const visit = (nodes: GoalNode[], parentSector: GoalscapeSector) => {
    const siblingSectors = goalscapeSectorsForSiblings(nodes, parentSector, focusContext);
    for (const node of nodes) {
      const sector = siblingSectors.get(node.id) || parentSector;
      sectors.set(node.id, sector);
      visit(node.children || [], sector);
    }
  };

  visit(goals, goalscapeFullSector);
  const selectedSector = focusContext.activeSelectionId ? sectors.get(focusContext.activeSelectionId) : undefined;
  if (!selectedSector) return sectors;

  const delta = goalscapeFocusSectorMidAngle - goalscapeSectorMidAngle(selectedSector);
  return new Map(Array.from(sectors.entries()).map(([id, sector]) => [id, rotateGoalscapeSector(sector, delta)]));
}

function buildGoalscapeDescendantSet(goal: GoalNode | undefined) {
  if (!goal) return undefined;
  const descendants = new Set<string>();
  const visit = (nodes: GoalNode[]) => {
    for (const node of nodes) {
      descendants.add(node.id);
      visit(node.children || []);
    }
  };
  visit(goal.children || []);
  return descendants;
}

function buildGoalscapeSelectedPathIds(goals: GoalNode[], selectedId: string | undefined) {
  const path = new Set<string>();
  if (!selectedId || selectedId === "root" || !findGoalById(goals, selectedId)) return path;

  const parents = buildParentMap(goals);
  let current: string | undefined = selectedId;
  while (current && current !== "root") {
    path.add(current);
    current = parents.get(current);
  }
  return path;
}

function buildGoalscapeSubtreeSet(goal: GoalNode | undefined, descendants: Set<string> | undefined) {
  const subtree = new Set<string>();
  if (!goal) return subtree;
  subtree.add(goal.id);
  for (const descendant of descendants || []) subtree.add(descendant);
  return subtree;
}

function buildGoalscapeFocusContext(goals: GoalNode[], selectedId: string | undefined, maxTreeDepth: number): GoalscapeFocusContext {
  const selectedGoal = selectedId && selectedId !== "root" ? findGoalById(goals, selectedId) : undefined;
  const selectedDescendantIds = buildGoalscapeDescendantSet(selectedGoal) || new Set<string>();
  return {
    activeSelectionId: selectedGoal?.id,
    selectedPathIds: buildGoalscapeSelectedPathIds(goals, selectedGoal?.id),
    selectedDescendantIds,
    selectedSubtreeIds: buildGoalscapeSubtreeSet(selectedGoal, selectedDescendantIds),
    maxTreeDepth
  };
}

function countGoalscapeRenderDepths(goals: GoalNode[], treeDepth = 1, counts = new Map<number, number>()) {
  for (const goal of goals) {
    counts.set(treeDepth, (counts.get(treeDepth) ?? 0) + 1);
    countGoalscapeRenderDepths(goal.children || [], treeDepth + 1, counts);
  }
  return counts;
}

function goalscapeSelectionEmphasis(goalId: string, focusContext: GoalscapeFocusContext) {
  if (!focusContext.activeSelectionId) {
    return {
      treeDistance: 0,
      scale: 1,
      perspectiveScale: 1,
      opacity: 1,
      zIndexBoost: 0,
      inwardShift: 0,
      inSelectedSubtree: false,
      inSelectedPath: false
    };
  }

  const inSelectedSubtree = focusContext.selectedSubtreeIds.has(goalId);
  const inSelectedPath = focusContext.selectedPathIds.has(goalId);
  if (inSelectedSubtree) {
    const isSelectedNode = goalId === focusContext.activeSelectionId;
    return {
      treeDistance: 0,
      scale: isSelectedNode ? 1.18 : 1.14,
      perspectiveScale: isSelectedNode ? 1.08 : 1.05,
      opacity: 1,
      zIndexBoost: isSelectedNode ? 120 : 90,
      inwardShift: isSelectedNode ? 0.3 : 0.18,
      inSelectedSubtree,
      inSelectedPath
    };
  }

  if (inSelectedPath) {
    return {
      treeDistance: 1,
      scale: 0.78,
      perspectiveScale: 0.9,
      opacity: 0.82,
      zIndexBoost: 30,
      inwardShift: 0.04,
      inSelectedSubtree,
      inSelectedPath
    };
  }

  return {
    treeDistance: 2,
    scale: 0.62,
    perspectiveScale: 0.82,
    opacity: 0.76,
    zIndexBoost: -30,
    inwardShift: 0,
    inSelectedSubtree,
    inSelectedPath
  };
}

function goalscapeShiftTowardCenter(position: MapPosition, amount: number): MapPosition {
  if (amount <= 0) return position;
  return {
    x: position.x + (goalscapeCenter.x - position.x) * amount,
    y: position.y + (goalscapeCenter.y - position.y) * amount
  };
}

function shouldCollapseGoalscapeChildren(
  layout: Pick<GoalscapeNodeLayout, "node" | "depth" | "treeDepth" | "width" | "height">,
  visibleDepth: number
) {
  const children = layout.node.children || [];
  if (children.length === 0) return false;

  if (layout.treeDepth >= visibleDepth) return true;
  if (children.length > goalscapeOrbitCapacity(layout.treeDepth + 1, visibleDepth)) return true;
  return layout.width < goalscapeCollapseMinWidth || layout.height < goalscapeCollapseMinHeight;
}

function isGoalscapeOutermostLeaf(goal: GoalNode, treeDepth: number, focusContext: GoalscapeFocusContext) {
  return focusContext.maxTreeDepth > 1 && treeDepth === focusContext.maxTreeDepth && (goal.children || []).length === 0;
}

function shouldRenderGoalscapeNode(goal: GoalNode, treeDepth: number, focusContext: GoalscapeFocusContext) {
  if (!isGoalscapeOutermostLeaf(goal, treeDepth, focusContext)) return true;
  return Boolean(focusContext.activeSelectionId && focusContext.selectedSubtreeIds.has(goal.id));
}

function addGoalscapeHiddenChildCount(layout: GoalscapeNodeLayout, hiddenGoal: GoalNode) {
  layout.childCount = (layout.childCount ?? 0) + 1 + countGoalscapeDescendants(hiddenGoal);
}

const goalscapeTopNodeBaseSize = { width: 118, height: 92 };

function goalscapeTopNodeSize(densityScale: number, focusScale: number) {
  const scale = clamp(densityScale * focusScale, 0.54, 1.12);
  return {
    width: Math.round(clamp(goalscapeTopNodeBaseSize.width * scale, 58, goalscapeTopNodeBaseSize.width * 1.12)),
    height: Math.round(clamp(goalscapeTopNodeBaseSize.height * scale, 48, goalscapeTopNodeBaseSize.height * 1.12))
  };
}

export function buildGoalscapeLayout(
  goals: GoalNode[],
  importanceOverrides: ImportanceOverrides,
  progressOverrides: ProgressOverrides,
  positionOverrides: MapPositionOverrides = {},
  mapContextId = "root",
  selectedId?: string
) {
  const stats = collectGoalscapeTreeStats(goals);
  const focusContext = buildGoalscapeFocusContext(goals, selectedId, stats.maxDepth);
  const renderDepthCounts = countGoalscapeRenderDepths(goals);
  const visibleDepth = goalscapeVisibleDepth(stats);
  const topImportance = normalizedImportance(goals, importanceOverrides);
  const sectorIndex = buildGoalscapeSectorIndex(goals, focusContext);
  const layouts: GoalscapeNodeLayout[] = [];

  const appendChildren = (parentLayout: GoalscapeNodeLayout, parentSector: GoalscapeSector) => {
    const children = parentLayout.node.children || [];
    if (children.length === 0) return;

    if (shouldCollapseGoalscapeChildren(parentLayout, visibleDepth)) {
      parentLayout.childCount = countGoalscapeDescendants(parentLayout.node);
      return;
    }

    const childImportance = normalizedImportance(children, importanceOverrides);
    children.forEach((child, childIndex) => {
      const treeDepth = parentLayout.treeDepth + 1;
      if (!shouldRenderGoalscapeNode(child, treeDepth, focusContext)) {
        addGoalscapeHiddenChildCount(parentLayout, child);
        return;
      }

      const depth = treeDepth;
      const sector = sectorIndex.get(child.id) || parentSector;
      const sectorRole: GoalscapeSectorRole = "descendant";
      const childAngle = goalscapeSectorMidAngle(sector);
      const childOrbit = goalscapeOrbitForDepth(depth, visibleDepth);
      const fallback = goalscapePointOnOrbit(childAngle, depth, visibleDepth);
      const emphasis = goalscapeSelectionEmphasis(child.id, focusContext);
      const childPosition = goalscapeShiftTowardCenter(constrainGoalscapePositionToSectorOrbit(
        goalMapPosition(child, fallback, positionOverrides, mapContextId),
        childOrbit,
        sector
      ), emphasis.inwardShift);
      const densityScale = goalscapeRingDensityScale(renderDepthCounts.get(depth) ?? children.length, depth, visibleDepth);
      const childSize = goalscapeChildNodeSize(parentLayout, childIndex, depth, densityScale, emphasis.scale);
      const childColor = goalscapeNodeColor(child, parentLayout.color);
      const childLayout: GoalscapeNodeLayout = {
        node: child,
        parentId: parentLayout.node.id,
        depth,
        treeDepth,
        visibleDepth,
        x: childPosition.x,
        y: childPosition.y,
        width: childSize.width,
        height: childSize.height,
        color: childColor,
        progress: weightedGoalProgress(child, importanceOverrides, progressOverrides),
        importance: childImportance[child.id] ?? 0,
        variant: layouts.length + childIndex,
        treeDistance: focusContext.activeSelectionId ? emphasis.treeDistance : treeDepth,
        perspectiveScale: emphasis.perspectiveScale,
        opacity: emphasis.opacity,
        zIndex: Math.round(1000 - depth * 10 + emphasis.zIndexBoost),
        linkParentId: parentLayout.node.id,
        sectorStartAngle: sector.startAngle,
        sectorEndAngle: sector.endAngle,
        sectorMidAngle: childAngle,
        sectorRole
      };

      layouts.push(childLayout);
      appendChildren(childLayout, sector);
    });
  };

  goals.forEach((goal, index) => {
    const treeDepth = 1;
    if (!shouldRenderGoalscapeNode(goal, treeDepth, focusContext)) return;

    const depth = treeDepth;
    const orbit = goalscapeOrbitForDepth(depth, visibleDepth);
    const sector = sectorIndex.get(goal.id) || goalscapeFullSector;
    const sectorRole: GoalscapeSectorRole = "primary";
    const angle = goalscapeSectorMidAngle(sector);
    const fallback = goalscapePointOnOrbit(angle, depth, visibleDepth);
    const emphasis = goalscapeSelectionEmphasis(goal.id, focusContext);
    const position = goalscapeShiftTowardCenter(constrainGoalscapePositionToSectorOrbit(
      goalMapPosition(goal, fallback, positionOverrides, mapContextId),
      orbit,
      sector
    ), emphasis.inwardShift);
    const densityScale = goalscapeRingDensityScale(renderDepthCounts.get(depth) ?? goals.length, depth, visibleDepth);
    const size = goalscapeTopNodeSize(densityScale, emphasis.scale);
    const color = goalscapeNodeColor(goal, "#64748b");
    const importance = topImportance[goal.id] ?? 0;
    const layout: GoalscapeNodeLayout = {
      node: goal,
      parentId: "root",
      depth,
      treeDepth,
      visibleDepth,
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      color,
      progress: weightedGoalProgress(goal, importanceOverrides, progressOverrides),
      importance,
      variant: index,
      treeDistance: focusContext.activeSelectionId ? emphasis.treeDistance : treeDepth,
      perspectiveScale: emphasis.perspectiveScale,
      opacity: emphasis.opacity,
      zIndex: Math.round(1000 - depth * 10 + emphasis.zIndexBoost),
      linkParentId: "root",
      sectorStartAngle: sector.startAngle,
      sectorEndAngle: sector.endAngle,
      sectorMidAngle: angle,
      sectorRole
    };

    layouts.push(layout);
    appendChildren(layout, sector);
  });

  return layouts;
}

function goalscapeBlobPath(x: number, y: number, width: number, height: number, variant: number) {
  const rx = width / 2;
  const ry = height / 2;
  const wobble = ((variant % 5) - 2) * 0.025;
  return [
    `M ${(x - rx * 0.12).toFixed(1)} ${(y - ry).toFixed(1)}`,
    `C ${(x + rx * 0.62).toFixed(1)} ${(y - ry * (1.16 + wobble)).toFixed(1)} ${(x + rx * 1.08).toFixed(1)} ${(y - ry * 0.46).toFixed(1)} ${(x + rx * 0.96).toFixed(1)} ${(y + ry * 0.08).toFixed(1)}`,
    `C ${(x + rx * 0.9).toFixed(1)} ${(y + ry * 0.72).toFixed(1)} ${(x + rx * 0.28).toFixed(1)} ${(y + ry * 1.04).toFixed(1)} ${(x - rx * 0.18).toFixed(1)} ${(y + ry * 0.92).toFixed(1)}`,
    `C ${(x - rx * 0.82).toFixed(1)} ${(y + ry * 0.82).toFixed(1)} ${(x - rx * 1.06).toFixed(1)} ${(y + ry * 0.22).toFixed(1)} ${(x - rx * 0.9).toFixed(1)} ${(y - ry * 0.36).toFixed(1)}`,
    `C ${(x - rx * 0.72).toFixed(1)} ${(y - ry * 0.86).toFixed(1)} ${(x - rx * 0.42).toFixed(1)} ${(y - ry * 1.02).toFixed(1)} ${(x - rx * 0.12).toFixed(1)} ${(y - ry).toFixed(1)}`,
    "Z"
  ].join(" ");
}

function goalscapeConnectionPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${midY}, ${to.x} ${to.y}`;
}

function goalscapeSectorBandPath(layout: GoalscapeNodeLayout) {
  const span = Math.min(goalscapeSectorSpan({ startAngle: layout.sectorStartAngle, endAngle: layout.sectorEndAngle }), 359.5);
  const startAngle = layout.sectorStartAngle;
  const endAngle = layout.sectorStartAngle + span;
  const outer = goalscapeOrbitForDepth(layout.depth, layout.visibleDepth);
  const inner =
    layout.depth === 1
      ? { depth: 0, cx: goalscapeCenter.x, cy: goalscapeCenter.y, rx: 104, ry: 76 }
      : goalscapeOrbitForDepth(layout.depth - 1, layout.visibleDepth);
  const startOuter = goalscapePointOnSpecificOrbit(startAngle, outer);
  const endOuter = goalscapePointOnSpecificOrbit(endAngle, outer);
  const endInner = goalscapePointOnSpecificOrbit(endAngle, inner);
  const startInner = goalscapePointOnSpecificOrbit(startAngle, inner);
  const largeArc = span > 180 ? 1 : 0;

  return [
    `M ${startInner.x.toFixed(1)} ${startInner.y.toFixed(1)}`,
    `L ${startOuter.x.toFixed(1)} ${startOuter.y.toFixed(1)}`,
    `A ${outer.rx.toFixed(1)} ${outer.ry.toFixed(1)} 0 ${largeArc} 1 ${endOuter.x.toFixed(1)} ${endOuter.y.toFixed(1)}`,
    `L ${endInner.x.toFixed(1)} ${endInner.y.toFixed(1)}`,
    `A ${inner.rx.toFixed(1)} ${inner.ry.toFixed(1)} 0 ${largeArc} 0 ${startInner.x.toFixed(1)} ${startInner.y.toFixed(1)}`,
    "Z"
  ].join(" ");
}

function goalscapeSectorOpacity(layout: GoalscapeNodeLayout) {
  return clamp(0.18 - Math.max(0, layout.depth - 1) * 0.035, 0.075, 0.18);
}

function goalscapeLabelLines(title: string, maxChars: number, maxLines: number) {
  const chars = Array.from(title.replace(/\s+/g, ""));
  if (chars.length <= maxChars) return [title];

  const lines: string[] = [];
  for (let index = 0; index < chars.length && lines.length < maxLines; index += maxChars) {
    lines.push(chars.slice(index, index + maxChars).join(""));
  }
  if (chars.length > maxChars * maxLines) {
    const last = lines[lines.length - 1] || "";
    lines[lines.length - 1] = `${Array.from(last).slice(0, Math.max(1, maxChars - 3)).join("")}...`;
  }
  return lines;
}

function goalIconComponent(goal: GoalNode) {
  const text = `${goal.title} ${titleFromLink(goal.domain)}`;
  if (text.includes("家庭")) return Home;
  if (text.includes("社交") || text.includes("朋友") || text.includes("人脉")) return Users;
  if (text.includes("健康") || text.includes("身体")) return Leaf;
  if (text.includes("幸福") || text.includes("生活")) return Heart;
  if (text.includes("职业")) return Briefcase;
  if (text.includes("外部") || text.includes("网站") || text.includes("展示")) return Monitor;
  if (text.includes("交付") || text.includes("行动")) return ClipboardCheck;
  if (text.includes("能力") || text.includes("学习")) return GraduationCap;
  if (text.includes("机会") || text.includes("投资")) return Star;
  if (text.includes("知识") || text.includes("认知") || text.includes("体系")) return BookOpen;
  if (text.includes("信息") || text.includes("博客") || text.includes("文章")) return FileText;
  if (text.includes("个人") || text.includes("成长")) return User;
  return Network;
}

function GoalscapeBridge({
  from,
  to,
  id,
  color,
  width = 7,
  opacity = 1
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  id: string;
  color: string;
  width?: number;
  opacity?: number;
}) {
  const d = goalscapeConnectionPath(from, to);

  return (
    <g
      key={id}
      className="goalscape-bridge-group"
      style={
        { "--node-color": color, "--deck-width": width, "--bridge-opacity": opacity } as React.CSSProperties & {
          "--node-color": string;
          "--deck-width": number;
          "--bridge-opacity": number;
        }
      }
    >
      <path d={d} className="goalscape-bridge-glow" stroke={color} />
      <path d={d} className="goalscape-bridge-cables" />
      <path d={d} className="goalscape-bridge-laser" />
    </g>
  );
}

const GoalMap = React.memo(function GoalMap({
  goals,
  selectedId,
  importanceOverrides,
  progressOverrides,
  positionOverrides,
  mapContextId,
  centerId,
  centerTitle,
  emptyLabel,
  onSelect,
  onPreviewPosition,
  onCommitPosition
}: {
  goals: GoalNode[];
  selectedId: string;
  importanceOverrides: ImportanceOverrides;
  progressOverrides: ProgressOverrides;
  positionOverrides: MapPositionOverrides;
  mapContextId: string;
  centerId: string;
  centerTitle: string;
  emptyLabel: string;
  onSelect: (id: string) => void;
  onPreviewPosition: (id: string, position: MapPosition) => void;
  onCommitPosition: (id: string, position: MapPosition) => void;
}) {
  const layouts = useMemo(
    () => buildGoalscapeLayout(goals, importanceOverrides, progressOverrides, positionOverrides, mapContextId, selectedId),
    [goals, importanceOverrides, progressOverrides, positionOverrides, mapContextId, selectedId]
  );
  const family = useMemo(() => selectedFamily(goals, selectedId), [goals, selectedId]);
  const centerNodeId = centerId;
  const centerDisplayTitle = centerTitle;
  const visibleLayouts = useMemo(
    () => [...layouts].sort((a, b) => a.zIndex - b.zIndex || a.depth - b.depth || a.node.id.localeCompare(b.node.id)),
    [layouts]
  );
  const layoutById = useMemo(() => new Map(visibleLayouts.map((item) => [item.node.id, item])), [visibleLayouts]);
  const parentById = useMemo(() => buildParentMap(goals), [goals]);
  const visibleDepth = layouts[0]?.visibleDepth ?? 2;
  const visibleOrbitDepths = useMemo(
    () => Array.from(new Set(visibleLayouts.map((layout) => layout.depth))).sort((a, b) => a - b),
    [visibleLayouts]
  );
  const visibleSectorBands = useMemo(
    () =>
      [...layouts].sort(
        (a, b) =>
          a.depth - b.depth ||
          goalscapeSectorSpan({ startAngle: b.sectorStartAngle, endAngle: b.sectorEndAngle }) -
            goalscapeSectorSpan({ startAngle: a.sectorStartAngle, endAngle: a.sectorEndAngle }) ||
          a.node.id.localeCompare(b.node.id)
      ),
    [layouts]
  );
  const centerPearlTint = useMemo(() => goalscapeCenterPearlTint(centerNodeId, null), [centerNodeId]);
  const centerPearlPath = useMemo(
    () =>
      goalscapeBlobPath(
        goalscapeCenter.x,
        goalscapeCenter.y,
        goalscapeCenterPearlSize.width,
        goalscapeCenterPearlSize.height,
        goalscapeCenterPearlSize.variant
      ),
    []
  );
  const centerLabel = useMemo(() => goalscapeLabelLines(centerDisplayTitle, 5, 2), [centerDisplayTitle]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    pointerStart: MapPosition;
    nodeStart: MapPosition;
    current: MapPosition;
    orbit: GoalscapeOrbit;
    sector: GoalscapeSector;
    moved: boolean;
    frame: number | null;
  } | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const pointFromPointer = useCallback((event: PointerEvent | React.PointerEvent<SVGGElement>) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return clampGoalscapePosition(point.matrixTransform(matrix.inverse()));
  }, []);

  const moveDrag = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = pointFromPointer(event);
    if (!point) return;
    const next = constrainGoalscapePositionToSectorOrbit(
      {
        x: drag.nodeStart.x + point.x - drag.pointerStart.x,
        y: drag.nodeStart.y + point.y - drag.pointerStart.y
      },
      drag.orbit,
      drag.sector
    );
    drag.current = next;
    if (Math.hypot(next.x - drag.nodeStart.x, next.y - drag.nodeStart.y) > 3) drag.moved = true;
    if (drag.frame === null) {
      drag.frame = window.requestAnimationFrame(() => {
        const currentDrag = dragRef.current;
        if (!currentDrag) return;
        currentDrag.frame = null;
        onPreviewPosition(currentDrag.id, currentDrag.current);
      });
    }
  }, [onPreviewPosition, pointFromPointer]);

  function finishDrag(event?: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    if (drag.frame !== null) window.cancelAnimationFrame(drag.frame);
    dragRef.current = null;
    setDraggingId(null);
    window.removeEventListener("pointermove", moveDrag);
    window.removeEventListener("pointerup", finishDrag);
    window.removeEventListener("pointercancel", finishDrag);
    if (drag.moved) {
      suppressClickRef.current = drag.id;
      onPreviewPosition(drag.id, drag.current);
      onCommitPosition(drag.id, drag.current);
    }
  }

  useEffect(() => () => {
    const drag = dragRef.current;
    if (drag && drag.frame !== null) window.cancelAnimationFrame(drag.frame);
    window.removeEventListener("pointermove", moveDrag);
    window.removeEventListener("pointerup", finishDrag);
    window.removeEventListener("pointercancel", finishDrag);
  }, []);

  const startNodeDrag = useCallback((event: React.PointerEvent<SVGGElement>, layout: GoalscapeNodeLayout) => {
    if (event.button !== 0) return;
    const pointerStart = pointFromPointer(event);
    if (!pointerStart) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      id: layout.node.id,
      pointerId: event.pointerId,
      pointerStart,
      nodeStart: { x: layout.x, y: layout.y },
      current: { x: layout.x, y: layout.y },
      orbit: goalscapeOrbitForDepth(layout.depth, layout.visibleDepth),
      sector: { startAngle: layout.sectorStartAngle, endAngle: layout.sectorEndAngle },
      moved: false,
      frame: null
    };
    setDraggingId(layout.node.id);
    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
  }, [finishDrag, moveDrag, pointFromPointer]);

  const selectOnKey = useCallback((event: React.KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  }, [onSelect]);

  return (
    <svg
      ref={svgRef}
      className={`goal-map goalscape-map${layouts.length > 20 ? " dense" : ""}${selectedId !== centerId ? " focused" : ""}`}
      viewBox="0 0 1200 760"
      role="img"
      aria-labelledby="map-title map-desc"
      onClick={() => onSelect(centerId)}
    >
      <title id="map-title">{centerDisplayTitle}目标地图</title>
      <desc id="map-desc">Pearl goals are arranged in circular sectors. Selecting a goal emphasizes its subtree in place.</desc>
      <defs>
        {/* Glow level filters for starlight cores */}
        <filter id="goalscape-glow-level-0" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="goalscape-glow-level-1" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.2" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="goalscape-glow-level-2" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="5.5" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="goalscape-glow-level-3" x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="goalscape-glow-level-4" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="11" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="goalscape-glow-level-5" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="15" result="blurOuter" />
          <feGaussianBlur stdDeviation="6" result="blurInner" />
          <feMerge><feMergeNode in="blurOuter"/><feMergeNode in="blurInner"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>

        <filter id="goalscape-soft-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="0 0 0 0 0.20 0 0 0 0 0.48 0 0 0 0 1 0 0 0 0.72 0"
            result="blueGlow"
          />
          <feMerge>
            <feMergeNode in="blueGlow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="goalscape-hub-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="16" result="blurOuter" />
          <feGaussianBlur stdDeviation="6" result="blurInner" />
          <feColorMatrix
            in="blurOuter"
            type="matrix"
            values="0 0 0 0 0.96  0 0 0 0 0.62  0 0 0 0 0.15  0 0 0 0.36 0"
            result="glowDeep"
          />
          <feColorMatrix
            in="blurInner"
            type="matrix"
            values="0 0 0 0 0.98  0 0 0 0 0.68  0 0 0 0 0.12  0 0 0 0.72 0"
            result="glowIntense"
          />
          <feMerge>
            <feMergeNode in="glowDeep" />
            <feMergeNode in="glowIntense" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="goalscape-hub-glass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(250, 250, 249, 0.94)" />
          <stop offset="35%" stopColor="rgba(241, 245, 249, 0.90)" />
          <stop offset="70%" stopColor="rgba(224, 242, 254, 0.85)" />
          <stop offset="100%" stopColor="rgba(255, 255, 255, 0.78)" />
        </linearGradient>
        <linearGradient id="goalscape-hub-gold-rim" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#d97706" />
          <stop offset="30%" stopColor="#f59e0b" />
          <stop offset="70%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#fef08a" />
        </linearGradient>
        <radialGradient id="goalscape-pearl-metallic" cx="32%" cy="30%" r="68%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="22%" stopColor="#f4f4f5" />
          <stop offset="55%" stopColor="#e4e4e7" />
          <stop offset="85%" stopColor="#a1a1aa" />
          <stop offset="100%" stopColor="#52525b" />
        </radialGradient>
        <radialGradient id="goalscape-hub-energy" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(251, 191, 36, 0.85)" />
          <stop offset="50%" stopColor="rgba(245, 158, 11, 0.45)" />
          <stop offset="100%" stopColor="rgba(217, 119, 6, 0)" />
        </radialGradient>
        <radialGradient id="goalscape-center-pearl-fill" cx="34%" cy="28%" r="72%">
          <stop offset="0%" stopColor="#fffef9" />
          <stop offset="28%" stopColor={centerPearlTint.primary} />
          <stop offset="55%" stopColor={centerPearlTint.secondary} />
          <stop offset="78%" stopColor={centerPearlTint.tertiary} />
          <stop offset="100%" stopColor="rgba(255, 255, 255, 0.16)" />
        </radialGradient>
        <radialGradient id="goalscape-center-pearl-iridescent" cx="68%" cy="72%" r="48%">
          <stop offset="0%" stopColor={centerPearlTint.iridescent} stopOpacity="0.42" />
          <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
        </radialGradient>
        {visibleLayouts.map((layout, index) => {
          const nodePath = goalscapeBlobPath(layout.x, layout.y, layout.width, layout.height, layout.variant);
          return (
            <React.Fragment key={`${layout.node.id}-bottle-defs`}>
              <clipPath id={`goalscape-node-clip-${index}`}>
                <path d={nodePath} />
              </clipPath>
              <linearGradient id={`goalscape-bottle-gradient-${index}`} x1="18%" y1="5%" x2="86%" y2="96%">
                <stop offset="0%" stopColor="rgba(255, 255, 255, 0.96)" />
                <stop offset="52%" stopColor={blend(layout.color, "#ffffff", 0.88)} />
                <stop offset="100%" stopColor={blend(layout.color, "#ffffff", 0.72)} />
              </linearGradient>
              <linearGradient id={`goalscape-liquid-gradient-${index}`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={blend(layout.color, "#ffffff", 0.38)} />
                <stop offset="58%" stopColor={layout.color} />
                <stop offset="100%" stopColor={blend(layout.color, "#12233e", 0.18)} />
              </linearGradient>
            </React.Fragment>
          );
        })}
      </defs>

      <g className="goalscape-sectors" aria-hidden="true">
        {visibleSectorBands.map((layout) => (
          <path
            key={`${layout.node.id}-sector`}
            className="goalscape-sector-band"
            data-depth={layout.depth}
            data-role={layout.sectorRole}
            d={goalscapeSectorBandPath(layout)}
            style={
              {
                "--sector-color": layout.color,
                "--sector-opacity": goalscapeSectorOpacity(layout)
              } as React.CSSProperties & {
                "--sector-color": string;
                "--sector-opacity": number;
              }
            }
          />
        ))}
      </g>

      <g className="goalscape-orbits" aria-hidden="true">
        {visibleOrbitDepths.map((depth) => {
          const orbit = goalscapeOrbitForDepth(depth, visibleDepth);
          return <ellipse key={depth} data-depth={depth} cx={orbit.cx} cy={orbit.cy} rx={orbit.rx} ry={orbit.ry} />;
        })}
      </g>

      <g className="goalscape-connections" aria-hidden="true">
        {visibleLayouts.map((layout) => {
          let parentId = layout.linkParentId;
          let parent = parentId === "root" || parentId === centerNodeId ? goalscapeCenter : layoutById.get(parentId);
          while (!parent && parentId && parentId !== "root") {
            parentId = parentById.get(parentId) || "root";
            parent = parentId === "root" || parentId === centerNodeId ? goalscapeCenter : layoutById.get(parentId);
          }
          return parent ? (
            <GoalscapeBridge
              key={`${layout.linkParentId}-${layout.node.id}`}
              from={parent}
              to={layout}
              id={`${layout.linkParentId}-${layout.node.id}`}
              color={layout.color}
              width={(layout.depth === 1 ? 7 : Math.max(3, 6.2 - layout.depth * 0.85)) * clamp(layout.perspectiveScale, 0.55, 1.08)}
              opacity={clamp(layout.opacity + 0.08, 0.25, 1)}
            />
          ) : null;
        })}
      </g>

      <g
        className={selectedId === centerNodeId ? "goalscape-center active" : "goalscape-center"}
        role="button"
        tabIndex={0}
        focusable="true"
        style={{ "--center-glow": centerPearlTint.glow } as React.CSSProperties & { "--center-glow": string }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(centerId);
        }}
        onKeyDown={(event) => selectOnKey(event, centerId)}
        aria-label={selectedId !== centerId ? `${centerDisplayTitle}，点击返回地图中心` : centerDisplayTitle}
      >
        <GoalscapeCenterAstrolabe cx={goalscapeCenter.x} cy={goalscapeCenter.y} />

        <g className="goalscape-center-visual">
          <path
            className="goalscape-center-glow"
            d={goalscapeBlobPath(
              goalscapeCenter.x,
              goalscapeCenter.y,
              goalscapeCenterPearlSize.width + 18,
              goalscapeCenterPearlSize.height + 14,
              goalscapeCenterPearlSize.variant
            )}
            fill="none"
            stroke="var(--center-glow, #fff7ed)"
            strokeWidth="5"
            filter="url(#goalscape-hub-glow)"
            opacity="0.82"
          />

          <path
            className="goalscape-center-glass"
            d={centerPearlPath}
            fill="url(#goalscape-center-pearl-fill)"
            stroke="rgba(255, 255, 255, 0.58)"
            strokeWidth="1.6"
          />

          <path
            className="goalscape-center-iridescent"
            d={centerPearlPath}
            fill="url(#goalscape-center-pearl-iridescent)"
            pointerEvents="none"
          />

          <ellipse
            className="goalscape-center-shine-primary"
            cx={goalscapeCenter.x - 22}
            cy={goalscapeCenter.y - 28}
            rx="34"
            ry="18"
            fill="rgba(255, 255, 255, 0.52)"
            transform={`rotate(-18 ${goalscapeCenter.x - 22} ${goalscapeCenter.y - 28})`}
            pointerEvents="none"
          />
          <path
            className="goalscape-center-shine-edge"
            d={`M ${goalscapeCenter.x - 48} ${goalscapeCenter.y + 34} A 52 52 0 0 0 ${goalscapeCenter.x + 48} ${goalscapeCenter.y + 34} A 44 44 0 0 1 ${goalscapeCenter.x - 48} ${goalscapeCenter.y + 34} Z`}
            fill="rgba(255, 255, 255, 0.12)"
            pointerEvents="none"
          />
          <ellipse
            className="goalscape-center-shine-env"
            cx={goalscapeCenter.x + 24}
            cy={goalscapeCenter.y + 18}
            rx="16"
            ry="10"
            fill={centerPearlTint.tertiary}
            opacity="0.22"
            transform={`rotate(24 ${goalscapeCenter.x + 24} ${goalscapeCenter.y + 18})`}
            pointerEvents="none"
          />

          <path
            className="goalscape-center-rim"
            d={goalscapeBlobPath(
              goalscapeCenter.x,
              goalscapeCenter.y,
              goalscapeCenterPearlSize.width - 14,
              goalscapeCenterPearlSize.height - 12,
              goalscapeCenterPearlSize.variant + 2
            )}
            fill="none"
            stroke="rgba(255, 255, 255, 0.52)"
            strokeWidth="1.2"
            pointerEvents="none"
          />

          <text
            className="goalscape-center-title"
            x={goalscapeCenter.x}
            y={goalscapeCenter.y + (centerLabel.length > 1 ? -6 : 6)}
          >
            {centerLabel.map((line, lineIndex) => (
              <tspan key={`${line}-${lineIndex}`} x={goalscapeCenter.x} dy={lineIndex === 0 ? 0 : 20}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
      </g>

      {visibleLayouts.map((layout, index) => {
        const active = selectedId === layout.node.id;
        const related = !family || family.has(layout.node.id);
        const depthTone = layout.perspectiveScale >= 0.98 ? " front" : layout.opacity <= 0.58 ? " back" : "";
        const Icon = goalIconComponent(layout.node);
        const visualMetrics = goalscapeNodeVisualMetrics(layout);
        const label = goalscapeLabelLines(layout.node.title, layout.depth === 1 ? 5 : 6, 2);
        const bottleGradientId = `goalscape-bottle-gradient-${index}`;
        const liquidGradientId = `goalscape-liquid-gradient-${index}`;
        const clipPathId = `goalscape-node-clip-${index}`;
        const nodePath = goalscapeBlobPath(layout.x, layout.y, layout.width, layout.height, layout.variant);
        const progressFill = goalscapeProgressFillGeometry(layout.y, layout.height, layout.progress);
        const childCount = layout.childCount ?? 0;
        const badgeLabel = childCount > 99 ? "+99" : `+${childCount}`;
        const badgeRadius = clamp(9 + badgeLabel.length * 2.1, 12, 18);
        const badgeX = layout.x + layout.width * 0.34;
        const badgeY = layout.y - layout.height * 0.36;
        return (
          <g
            key={layout.node.id}
            className={`goalscape-node depth-${layout.depth}${depthTone}${active ? " active" : ""}${related ? "" : " dim"}${draggingId === layout.node.id ? " dragging" : ""}`}
            role="button"
            tabIndex={0}
            focusable="true"
            data-sector-role={layout.sectorRole}
            aria-label={`${layout.node.title}，进度 ${layout.progress}%${childCount ? `，折叠 ${childCount} 个后代` : ""}`}
            style={
              {
                "--node-color": layout.color,
                "--node-icon-size": `${visualMetrics.iconSize}px`,
                "--node-icon-glyph-size": `${visualMetrics.iconGlyphSize}px`,
                "--node-title-size": `${visualMetrics.titleSize}px`,
                "--node-progress-size": `${visualMetrics.progressSize}px`,
                "--node-depth-scale": layout.perspectiveScale,
                opacity: layout.opacity
              } as React.CSSProperties & {
                "--node-color": string;
                "--node-icon-size": string;
                "--node-icon-glyph-size": string;
                "--node-title-size": string;
                "--node-progress-size": string;
                "--node-depth-scale": number;
              }
            }
            onPointerDown={(event) => startNodeDrag(event, layout)}
            onClick={(event) => {
              if (suppressClickRef.current === layout.node.id) {
                suppressClickRef.current = null;
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              event.stopPropagation();
              onSelect(layout.node.id);
            }}
            onKeyDown={(event) => selectOnKey(event, layout.node.id)}
          >
            {/* Inner group with isolated floating animation delay */}
            <g className="goalscape-node-visual" style={{ animationDelay: `${-index * 0.7}s` }}>
              <path className="goalscape-node-halo" d={goalscapeBlobPath(layout.x, layout.y, layout.width + 20, layout.height + 18, layout.variant)} />
              
              {/* Dynamic translucency shell */}
              <path
                className="goalscape-node-shape"
                d={nodePath}
                fill={`url(#${bottleGradientId})`}
                fillOpacity={goalscapeNodeDensity(layout.progress)}
                strokeOpacity={0.4 + 0.6 * (layout.progress / 100)}
              />

              <rect
                className="goalscape-node-progress-fill"
                x={layout.x - layout.width / 2 - 4}
                y={progressFill.y}
                width={layout.width + 8}
                height={progressFill.height}
                clipPath={`url(#${clipPathId})`}
                fill={`url(#${liquidGradientId})`}
                opacity={0.26 + 0.5 * (layout.progress / 100)}
              />
              {layout.progress > 0 && layout.progress < 100 && (
                <line
                  className="goalscape-node-progress-surface"
                  x1={layout.x - layout.width * 0.34}
                  x2={layout.x + layout.width * 0.34}
                  y1={progressFill.surfaceY}
                  y2={progressFill.surfaceY}
                  clipPath={`url(#${clipPathId})`}
                />
              )}

              {/* Glowing Starlight Core */}
              <circle
                cx={layout.x}
                cy={layout.y}
                r={goalscapeStarlightCoreRadius(visualMetrics.coreRadius, layout.progress)}
                className="goal-starlight-core"
                fill={layout.color}
                filter={`url(#goalscape-glow-level-${Math.min(5, Math.floor(layout.progress / 20))})`}
              />

              {/* Saturn gold achievements ring & cross star shimmer if progress is 100% */}
              {layout.progress === 100 && (
                <>
                  <ellipse
                    cx={layout.x}
                    cy={layout.y}
                    rx={layout.width * 0.72}
                    ry={layout.height * 0.28}
                    transform={`rotate(-15 ${layout.x} ${layout.y})`}
                    className="goal-saturn-ring"
                  />
                  <path
                    d={`M ${layout.x} ${layout.y - 12} Q ${layout.x} ${layout.y} ${layout.x + 12} ${layout.y} Q ${layout.x} ${layout.y} ${layout.x} ${layout.y + 12} Q ${layout.x} ${layout.y} ${layout.x - 12} ${layout.y} Q ${layout.x} ${layout.y} ${layout.x} ${layout.y - 12} Z`}
                    className="goal-supernova-sparkle"
                  />
                </>
              )}

              <path className="goalscape-node-glass" d={nodePath} />
              <path
                className="goalscape-node-rim"
                d={goalscapeBlobPath(layout.x, layout.y, layout.width - 12, layout.height - 10, layout.variant + 2)}
                strokeOpacity={0.4 + 0.5 * (layout.progress / 100)}
              />
              <foreignObject
                x={layout.x - visualMetrics.iconSize / 2}
                y={layout.y - visualMetrics.iconY}
                width={visualMetrics.iconSize}
                height={visualMetrics.iconSize}
                className="goalscape-icon-object"
              >
                <div className="goalscape-icon-wrap">
                  <Icon className="goalscape-node-icon" aria-hidden="true" />
                </div>
              </foreignObject>
              <text
                className={layout.depth === 1 ? "goalscape-node-title domain" : "goalscape-node-title child"}
                x={layout.x}
                y={layout.y + visualMetrics.titleY}
              >
                {label.map((line, lineIndex) => (
                  <tspan key={line + lineIndex} x={layout.x} dy={lineIndex === 0 ? 0 : visualMetrics.titleLineGap}>
                    {line}
                  </tspan>
                ))}
              </text>
              <text className="goalscape-node-progress" x={layout.x} y={layout.y + visualMetrics.progressY}>
                {layout.progress}%
              </text>
              {childCount > 0 && (
                <g className="goalscape-node-badge" aria-hidden="true">
                  <circle cx={badgeX} cy={badgeY} r={badgeRadius} />
                  <text x={badgeX} y={badgeY + 4}>
                    {badgeLabel}
                  </text>
                </g>
              )}
            </g>
          </g>
        );
      })}

      {goals.length === 0 && emptyLabel && (
        <text className="empty-map-text" x={goalscapeCenter.x} y={goalscapeCenter.y + 138}>
          {emptyLabel}
        </text>
      )}
    </svg>
  );
});

const GoalDetailPanel = React.memo(function GoalDetailPanel({
  selectedGoal,
  activeGoalMap,
  cachedDraft,
  topGoals,
  saving,
  importanceOverrides,
  progressOverrides,
  onSelect,
  onSave,
  onPreviewImportance,
  onPreviewProgress,
  onDraftChange,
  onOpenAi
}: {
  selectedGoal: GoalNode | undefined;
  activeGoalMap?: GoalMap;
  cachedDraft?: EditDraft;
  topGoals: GoalNode[];
  saving: boolean;
  importanceOverrides: ImportanceOverrides;
  progressOverrides: ProgressOverrides;
  onSelect: (id: string) => void;
  onSave: (goal: GoalNode, draft: EditDraft) => Promise<boolean>;
  onPreviewImportance: (goalId: string, value: number) => void;
  onPreviewProgress: (goalId: string, value: number) => void;
  onDraftChange: (goal: GoalNode, draft: EditDraft, dirty: boolean) => void;
  onOpenAi: (goal: GoalNode) => void;
}) {
  const rootImportance = useMemo(() => normalizedImportance(topGoals), [topGoals]);
  const selectedPath = useMemo(() => (selectedGoal ? goalPath(topGoals, selectedGoal.id) : []), [selectedGoal, topGoals]);
  const breadcrumbGoals = selectedGoal ? (selectedPath.length ? selectedPath : [selectedGoal]) : [];
  const domainAccent = selectedGoal ? domainAccentToken(selectedGoal.domain || selectedGoal.title) : undefined;
  const selectedSiblingImportance = useMemo(
    () => (selectedGoal ? normalizedImportance(siblingGoals(topGoals, selectedGoal.id))[selectedGoal.id] ?? 100 : 100),
    [selectedGoal, topGoals]
  );
  const hasSiblings = useMemo(
    () => (selectedGoal ? siblingGoals(topGoals, selectedGoal.id).length > 1 : false),
    [selectedGoal, topGoals]
  );
  const childImportance = useMemo<ImportanceOverrides>(
    () => (selectedGoal ? normalizedImportance(selectedGoal.children) : {}),
    [selectedGoal]
  );
  const editFormId = selectedGoal ? `goal-editor-${encodeURIComponent(selectedGoal.id)}` : "";
  const saveSelectedGoal = useCallback(
    (draft: EditDraft) => (selectedGoal ? onSave(selectedGoal, draft) : Promise.resolve(false)),
    [onSave, selectedGoal]
  );

  if (!selectedGoal) {
    return (
      <aside className="detail-panel" aria-live="polite">
        <div className="detail-head root-head">
          <div className="goal-heading">
            <p className="eyebrow">目标地图</p>
            <h2>{goalMapCenterTitle(activeGoalMap)}</h2>
          </div>
          <span className="status-badge active">地图</span>
        </div>

        <section>
          <h3>顶层目标</h3>
          <div className="child-list">
            {topGoals.map((goal) => (
              <button
                key={goal.id}
                type="button"
                className="child-pill"
                style={{ "--pill-accent": domainAccentToken(goal.domain || goal.title) } as React.CSSProperties}
                onClick={() => onSelect(goal.id)}
              >
                <span>{goal.title}</span>
                <small>{rootImportance[goal.id] ?? 0}%</small>
              </button>
            ))}
            {topGoals.length === 0 && <p className="muted-text">还没有顶层目标。</p>}
          </div>
        </section>
      </aside>
    );
  }

  return (
    <aside
      className="detail-panel"
      aria-live="polite"
      style={domainAccent ? ({ "--domain-accent": domainAccent } as React.CSSProperties) : undefined}
    >
      <div className="detail-head">
        <div className="goal-heading">
          <div className="goal-path" aria-label="目标路径">
            {breadcrumbGoals.map((goal, index) => (
              <React.Fragment key={goal.id}>
                {index > 0 && <ChevronRight aria-hidden="true" />}
                <span>{goal.title}</span>
              </React.Fragment>
            ))}
          </div>
          <h2>{selectedGoal.title}</h2>
        </div>
        <div className="detail-head-actions">
          <button type="submit" form={editFormId} className="primary-button compact-save-button" disabled={saving}>
            {saving ? <Loader2 className="spin" /> : <Save />}
            保存
          </button>
          <span className={`status-badge ${selectedGoal.status}`}>{statusLabels[selectedGoal.status]}</span>
        </div>
      </div>

      <div className="insight-row" aria-label="目标摘要">
        <span className="insight-domain">
          <GitBranch />
          {formatEmpty(titleFromLink(selectedGoal.domain))}
        </span>
        <span>
          <Gauge />
          {weightedGoalProgress(selectedGoal, importanceOverrides, progressOverrides)}%
        </span>
      </div>

      <GoalEditForm
        formId={editFormId}
        goal={selectedGoal}
        cachedDraft={cachedDraft}
        importance={selectedSiblingImportance}
        hasSiblings={hasSiblings}
        saving={saving}
        onPreviewImportance={onPreviewImportance}
        onPreviewProgress={onPreviewProgress}
        onDraftChange={onDraftChange}
        onSave={saveSelectedGoal}
      />

      <section>
        <h3>子目标</h3>
        <div className="child-list">
          {selectedGoal.children.map((child) => (
            <button
              key={child.id}
              type="button"
              className="child-pill"
              style={{ "--pill-accent": domainAccentToken(child.domain || child.title) } as React.CSSProperties}
              onClick={() => onSelect(child.id)}
            >
              <span>{child.title}</span>
              <small>{childImportance[child.id] ?? 0}%</small>
            </button>
          ))}
          {selectedGoal.children.length === 0 && <p className="muted-text">还没有子目标。</p>}
        </div>
        <div className="ai-entry-row">
          <button type="button" className="icon-button" title="AI 助手" aria-label="AI 助手" disabled={saving} onClick={() => onOpenAi(selectedGoal)}>
            <Sparkles />
          </button>
        </div>
      </section>
    </aside>
  );
});

const editDraftKeys: (keyof EditDraft)[] = [
  "importance",
  "progress",
  "notes",
  "actions"
];

function draftsEqual(first: EditDraft, second: EditDraft) {
  return editDraftKeys.every((key) =>
    key === "actions" ? JSON.stringify(first.actions) === JSON.stringify(second.actions) : first[key] === second[key]
  );
}

const GoalEditForm = React.memo(function GoalEditForm({
  formId,
  goal,
  cachedDraft,
  importance,
  hasSiblings,
  saving,
  onPreviewImportance,
  onPreviewProgress,
  onDraftChange,
  onSave
}: {
  formId: string;
  goal: GoalNode;
  cachedDraft?: EditDraft;
  importance: number;
  hasSiblings: boolean;
  saving: boolean;
  onPreviewImportance: (goalId: string, value: number) => void;
  onPreviewProgress: (goalId: string, value: number) => void;
  onDraftChange: (goal: GoalNode, draft: EditDraft, dirty: boolean) => void;
  onSave: (draft: EditDraft) => Promise<boolean>;
}) {
  const baselineDraft = useMemo(() => draftFromGoal(goal, importance), [goal, importance]);
  const initialDraft = cachedDraft ?? baselineDraft;
  const [draft, setDraft] = useState<EditDraft>(() => initialDraft);
  const [notesOpen, setNotesOpen] = useState(true);
  const primaryGoal = isPrimaryGoalNode(goal);
  const progressEditable = !primaryGoal && goal.children.length === 0;

  useEffect(() => {
    setDraft(initialDraft);
    onDraftChange(goal, initialDraft, Boolean(cachedDraft));
  }, [cachedDraft, goal, initialDraft, onDraftChange]);

  useEffect(() => {
    setNotesOpen(true);
  }, [goal.id]);

  const updateDraft = (patch: Partial<EditDraft>) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      onDraftChange(goal, next, !draftsEqual(next, baselineDraft));
      return next;
    });
  };

  return (
    <form
      id={formId}
      className="goal-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(draft).then((saved) => {
          if (saved) onDraftChange(goal, draft, false);
        });
      }}
    >
      <section className="editor-section">
        <RangeField
          label="重要性"
          value={draft.importance}
          min={0}
          max={100}
          suffix="%"
          onChange={(value) => {
            updateDraft({ importance: value });
            onPreviewImportance(goal.id, value);
          }}
        />
        {hasSiblings && (
          <p className="field-hint">调整后会在同级目标间按 100% 自动重新分配占比。</p>
        )}
        {progressEditable && (
          <RangeField
            label="进度"
            value={draft.progress}
            min={0}
            max={100}
            suffix="%"
            onChange={(value) => {
              updateDraft({ progress: value });
              onPreviewProgress(goal.id, value);
            }}
          />
        )}
      </section>

      <section className={notesOpen ? "editor-section notes-actions-drawer is-open" : "editor-section notes-actions-drawer is-collapsed"}>
        <div className="drawer-head">
          <h3>{primaryGoal ? "备注" : "备注与行动"}</h3>
          <button
            type="button"
            className="icon-button compact drawer-toggle"
            title={notesOpen ? "折叠备注与行动" : "展开备注与行动"}
            aria-label={notesOpen ? "折叠备注与行动" : "展开备注与行动"}
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen((current) => !current)}
          >
            <ChevronRight className={notesOpen ? "drawer-chevron open" : "drawer-chevron"} />
          </button>
        </div>
        <div className="notes-actions-content" hidden={!notesOpen}>
          <TextAreaBlock label="备注" value={draft.notes} hideLabel onChange={(value) => updateDraft({ notes: value })} />
          {!primaryGoal && <ActionCandidatesField actions={draft.actions} onChange={(actions) => updateDraft({ actions })} />}
        </div>
      </section>
    </form>
  );
});

function draftFromGoal(goal: GoalNode, importance: number): EditDraft {
  return {
    importance,
    progress: weightedGoalProgress(goal),
    notes: goal.sections.summary,
    actions: goal.sections.actionCandidates.map((action) => ({ ...action }))
  };
}

function RangeField({
  label,
  value,
  min = 0,
  max = 100,
  suffix = "",
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span className="field-label">
        {label}
        <strong>
          {value}
          {suffix}
        </strong>
      </span>
      <div className="range-row">
        <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      </div>
    </label>
  );
}

function ActionCandidatesField({
  actions,
  onChange
}: {
  actions: GoalActionCandidate[];
  onChange: (actions: GoalActionCandidate[]) => void;
}) {
  const [editing, setEditing] = useState(false);

  const updateAction = (index: number, patch: Partial<GoalActionCandidate>) => {
    onChange(actions.map((action, currentIndex) => (currentIndex === index ? { ...action, ...patch } : action)));
  };

  const addAction = () => {
    setEditing(true);
    onChange([...actions, { text: "", done: false }]);
  };

  const removeAction = (index: number) => {
    onChange(actions.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
      <div className="actions-field">
        <div className="actions-head">
        <span>行动</span>
        <div>
          <button
            type="button"
            className="icon-button compact"
            title={editing ? "完成编辑" : "编辑行动"}
            aria-label={editing ? "完成编辑" : "编辑行动"}
            onClick={() => setEditing((current) => !current)}
          >
            <Pencil />
          </button>
          {editing && (
            <button type="button" className="icon-button compact" title="添加行动" aria-label="添加行动" onClick={addAction}>
              <Plus />
            </button>
          )}
        </div>
      </div>

      <div className="action-list">
        {actions.map((action, index) => (
          <div key={`action-${index}`} className={action.done ? "action-row done" : "action-row"}>
            <label className="action-check">
              <input
                type="checkbox"
                checked={action.done}
                onChange={(event) => updateAction(index, { done: event.target.checked })}
              />
              <span />
            </label>
            {editing ? (
              <input
                className="action-input"
                value={action.text}
                placeholder="新的行动"
                onChange={(event) => updateAction(index, { text: event.target.value })}
              />
            ) : (
              <span className="action-text">{action.text || "未命名行动"}</span>
            )}
            {editing && (
              <button type="button" className="icon-button compact danger-icon" title="删除行动" aria-label="删除行动" onClick={() => removeAction(index)}>
                <X />
              </button>
            )}
          </div>
        ))}
        {actions.length === 0 && <p className="muted-text">还没有行动。</p>}
      </div>
    </div>
  );
}

function TextAreaBlock({
  label,
  value,
  hideLabel = false,
  onChange
}: {
  label: string;
  value: string;
  hideLabel?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {!hideLabel && label}
      <textarea rows={4} value={value} aria-label={hideLabel ? label : undefined} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
