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
  GoalNode,
  GoalPatchInput,
  GoalsResponse,
  GoalStatus
} from "../shared/types";
import { createBrowserSupabaseClient } from "../lib/supabase/client";
import { isPrimaryGoalNode, isPrimaryGoalTitle, normalizedGoalTitle } from "../shared/goalRules";
import { AiAssistantDialog } from "./AiAssistantDialog";
import {
  applyThemePreference,
  nextThemePreference,
  readStoredTheme,
  resolvedTheme,
  writeStoredTheme,
  type ThemePreference
} from "./theme";

const emptyGoals: GoalsResponse = {
  goals: [],
  flatGoals: [],
  graph: { nodes: [], edges: [] }
};

const statusLabels: Record<GoalStatus, string> = {
  active: "推进中",
  paused: "暂停",
  done: "完成",
  archived: "归档"
};

const center = { x: 450, y: 450 };

const themeLabels: Record<ThemePreference, string> = {
  system: "系统设定",
  light: "浅色",
  dark: "深色"
};

type SectorLayout = {
  node: GoalNode;
  depth: number;
  startAngle: number;
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
  parentId: string;
  importance: number;
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

function maxTreeDepth(goals: GoalNode[]): number {
  if (goals.length === 0) return 0;
  return Math.max(...goals.map((goal) => 1 + maxTreeDepth(goal.children || [])));
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

function polarToCartesian(angle: number, radius: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: center.x + radius * Math.cos(radians),
    y: center.y + radius * Math.sin(radians)
  };
}

function arcPath(startAngle: number, endAngle: number, innerRadius: number, outerRadius: number) {
  const safeEnd = endAngle - startAngle >= 359.99 ? startAngle + 359.99 : endAngle;
  const largeArc = safeEnd - startAngle > 180 ? 1 : 0;
  const outerStart = polarToCartesian(startAngle, outerRadius);
  const outerEnd = polarToCartesian(safeEnd, outerRadius);
  const innerEnd = polarToCartesian(safeEnd, innerRadius);
  const innerStart = polarToCartesian(startAngle, innerRadius);
  return [
    `M ${outerStart.x.toFixed(3)} ${outerStart.y.toFixed(3)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x.toFixed(3)} ${outerEnd.y.toFixed(3)}`,
    `L ${innerEnd.x.toFixed(3)} ${innerEnd.y.toFixed(3)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x.toFixed(3)} ${innerStart.y.toFixed(3)}`,
    "Z"
  ].join(" ");
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

function getRings(depth: number) {
  if (depth <= 0) return [];
  if (depth <= 3) {
    return [
      { innerRadius: 104, outerRadius: 244 },
      { innerRadius: 252, outerRadius: 360 },
      { innerRadius: 368, outerRadius: 430 }
    ].slice(0, depth);
  }

  const innerStart = 100;
  const maxOuter = 432;
  const gap = 7;
  const thickness = Math.max(42, (maxOuter - innerStart - gap * (depth - 1)) / depth);
  return Array.from({ length: depth }, (_, index) => {
    const innerRadius = innerStart + index * (thickness + gap);
    return { innerRadius, outerRadius: innerRadius + thickness };
  });
}

function buildSectors(goals: GoalNode[], importanceOverrides: ImportanceOverrides = {}) {
  const rings = getRings(maxTreeDepth(goals));
  const sectors: SectorLayout[] = [];

  const visit = (children: GoalNode[], depth: number, startAngle: number, endAngle: number, parentId: string) => {
    const ring = rings[depth - 1];
    if (!ring || children.length === 0) return;

    const childImportance = normalizedImportance(children, importanceOverrides);
    let cursor = startAngle;
    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      const importance = childImportance[child.id] ?? 0;
      const share = ((endAngle - startAngle) * importance) / 100;
      const childEnd = isLast ? endAngle : cursor + share;
      sectors.push({
        node: child,
        depth,
        startAngle: cursor,
        endAngle: childEnd,
        innerRadius: ring.innerRadius,
        outerRadius: ring.outerRadius,
        parentId,
        importance
      });
      visit(child.children || [], depth + 1, cursor, childEnd, child.id);
      cursor = childEnd;
    });
  };

  visit(goals, 1, 0, 360, "root");
  return sectors;
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

export function parentMapFocusId(goals: GoalNode[], focusId: string) {
  if (focusId === "root") return "root";
  return parentGoal(goals, focusId)?.id || "root";
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

function uniqueTitle(base: string, goals: GoalNode[]) {
  const titles = new Set(goals.map((goal) => goal.title));
  if (!titles.has(base)) return base;
  let index = 2;
  while (titles.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

export function GoalApp() {
  const [goals, setGoals] = useState<GoalsResponse>(emptyGoals);
  const [selectedId, setSelectedId] = useState("root");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [importancePreview, setImportancePreview] = useState<ImportanceOverrides>({});
  const [progressPreview, setProgressPreview] = useState<ProgressOverrides>({});
  const [mapPositionPreview, setMapPositionPreview] = useState<MapPositionOverrides>({});
  const [focusId, setFocusId] = useState("root");
  const [scopeListCollapsed, setScopeListCollapsed] = useState(true);
  const [deleteCandidate, setDeleteCandidate] = useState<GoalNode | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiGoal, setAiGoal] = useState<GoalNode | null>(null);
  const [detailWidth, setDetailWidth] = useState(500);
  const [mapPaneHeight, setMapPaneHeight] = useState(520);
  const [stackedLayout, setStackedLayout] = useState(() => window.matchMedia("(max-width: 1120px)").matches);
  const [resizingPanelAxis, setResizingPanelAxis] = useState<"width" | "height" | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readStoredTheme());
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
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

    writeStoredTheme(themePreference);
    syncTheme();
    mediaQuery.addEventListener("change", syncTheme);
    return () => mediaQuery.removeEventListener("change", syncTheme);
  }, [themePreference]);

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

  const visibleTree = useMemo(() => filterGoalTree(goals.goals, false), [goals.goals]);
  const visibleFlatGoals = useMemo(() => flattenGoals(visibleTree), [visibleTree]);
  const selectedGoal = useMemo(
    () => visibleFlatGoals.find((goal) => goal.id === selectedId),
    [selectedId, visibleFlatGoals]
  );
  const selectedGoalFull = useMemo(() => goals.flatGoals.find((goal) => goal.id === selectedId), [goals.flatGoals, selectedId]);
  const activeAiGoal = useMemo(() => (aiGoal ? goals.flatGoals.find((goal) => goal.id === aiGoal.id) ?? aiGoal : null), [aiGoal, goals.flatGoals]);
  const selectedParent = useMemo(() => parentGoal(goals.goals, selectedId), [goals.goals, selectedId]);
  const focusGoal = useMemo(() => (focusId === "root" ? undefined : findGoalById(visibleTree, focusId)), [focusId, visibleTree]);
  const focusParentId = useMemo(() => parentMapFocusId(visibleTree, focusId), [focusId, visibleTree]);
  const mapGoals = useMemo(() => (focusGoal ? focusGoal.children || [] : visibleTree), [focusGoal, visibleTree]);
  const mapContextId = focusGoal?.id || "root";
  const domainTitles = useMemo(() => uniqueDomainTitles(goals.flatGoals), [goals.flatGoals]);

  useEffect(() => {
    if (selectedId !== "root" && !selectedGoal) setSelectedId("root");
  }, [selectedGoal, selectedId]);

  useEffect(() => {
    if (focusId !== "root" && !focusGoal) setFocusId("root");
  }, [focusGoal, focusId]);

  useEffect(() => {
    setImportancePreview((current) => (Object.keys(current).length ? {} : current));
    setProgressPreview((current) => (Object.keys(current).length ? {} : current));
  }, [selectedId]);

  const clampDetailWidth = useCallback((value: number) => {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const maxWidth = Math.max(320, Math.min(760, workspaceWidth - 280));
    return clamp(Math.round(value), 320, maxWidth);
  }, []);

  const clampMapPaneHeight = useCallback((value: number) => {
    const maxHeight = Math.max(320, Math.min(720, window.innerHeight - 220));
    return clamp(Math.round(value), 320, maxHeight);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1120px)");
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
    const resizingHeight = window.matchMedia("(max-width: 1120px)").matches;
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
        priority: Number(input.priority),
        clarity: Number(input.clarity)
      };
      if (!primaryGoal) payload.progress = Number(input.progress ?? 0);
      await api("/api/goals", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const next = await loadGoals();
      const createdGoal = next.flatGoals.find((goal) => goal.title === input.title.trim());
      if (createdGoal) {
        pendingEditRef.current = null;
        delete draftCacheRef.current[createdGoal.id];
        setSelectedId(createdGoal.id);
        const parentTitle = normalizedGoalTitle(input.parent);
        if (parentTitle) {
          const parentNode = next.flatGoals.find((goal) => goal.title === parentTitle);
          if (parentNode) setFocusId(parentNode.id);
        }
      } else {
        setSelectedId("root");
      }
      return next;
    }, "目标已创建");
  };

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
    const deletedIds = collectDescendants(goal, new Set([goal.id]));

    const deleted = await runWrite(async () => {
      pendingEditRef.current = null;
      await api(`/api/goals/${encodeURIComponent(goal.id)}`, {
        method: "DELETE"
      });
      await loadGoals();
      setSelectedId("root");
      if (deletedIds.has(focusId)) setFocusId("root");
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

  const createQuickGoal = useCallback(async (mode: "subgoal" | "sibling") => {
    if (!selectedGoalFull) return;
    await queuePendingEditSave();
    const parent = mode === "subgoal" ? selectedGoalFull : selectedParent;
    if (mode === "sibling" && !parent) return;
    const source = selectedGoalFull || parent;
    const title = uniqueTitle("新目标", goals.flatGoals);
    await createGoal({
      title,
      parent: parent?.title || "",
      domain: titleFromLink(source?.domain) || titleFromLink(parent?.domain) || domainTitles[0] || title,
      horizon: source?.horizon || "medium",
      priority: 50,
      clarity: 1,
      progress: 0
    });
  }, [createGoal, domainTitles, goals.flatGoals, queuePendingEditSave, selectedGoalFull, selectedParent]);

  const renameSelectedGoal = async () => {
    if (!selectedGoalFull) return;
    const nextTitle = window.prompt("重命名目标", selectedGoalFull.title)?.trim();
    if (!nextTitle || nextTitle === selectedGoalFull.title) return;
    await runWrite(async () => {
      await api(`/api/goals/${encodeURIComponent(selectedGoalFull.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ title: nextTitle })
      });
      const next = await loadGoals();
      const renamedGoal = next.flatGoals.find((item) => item.title === nextTitle);
      const nextId = renamedGoal?.id || (next.flatGoals.some((item) => item.id === selectedGoalFull.id) ? selectedGoalFull.id : "root");
      setSelectedId(nextId);
      if (focusId === selectedGoalFull.id) setFocusId(nextId);
    }, "目标已重命名");
  };

  const changeMapFocus = useCallback((id: string) => {
    queuePendingEditSave();
    setFocusId(id);
    setSelectedId(id);
    setImportancePreview({});
    setProgressPreview({});
    setMapPositionPreview({});
  }, [queuePendingEditSave]);

  const openParentMap = useCallback(() => {
    changeMapFocus(focusParentId);
  }, [changeMapFocus, focusParentId]);
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
            onClick={() => setThemePreference((current) => nextThemePreference(current))}
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
          <MapScopeList
            topGoals={visibleTree}
            focusId={focusId}
            collapsed={scopeListCollapsed}
            onToggle={() => setScopeListCollapsed((current) => !current)}
            onFocus={changeMapFocus}
          />
          <MapActions
            selectedGoal={selectedGoalFull}
            saving={saving}
            canAddSibling={Boolean(selectedParent)}
            canResetPosition={hasCustomMapPosition(selectedGoalFull, mapContextId)}
            onAddSubgoal={() => void createQuickGoal("subgoal")}
            onAddSibling={() => void createQuickGoal("sibling")}
            onRename={() => void renameSelectedGoal()}
            onResetPosition={resetSelectedMapPosition}
            onDelete={() => selectedGoalFull && setDeleteCandidate(selectedGoalFull)}
          />
          {loading ? (
            <div className="loading-state">
              <Loader2 className="spin" />
              正在读取 Obsidian 目标
            </div>
          ) : (
            <GoalMap
              goals={mapGoals}
              selectedId={selectedId}
              importanceOverrides={importancePreview}
              progressOverrides={progressPreview}
              positionOverrides={mapPositionPreview}
              mapContextId={mapContextId}
              centerId={focusGoal?.id || "root"}
              centerTitle={focusGoal?.title || "目标网络"}
              emptyLabel={focusGoal ? "这个目标还没有子目标" : "暂无可显示目标"}
              onSelect={selectGoal}
              onOpenMap={changeMapFocus}
              onOpenParentMap={focusGoal ? openParentMap : undefined}
              onPreviewPosition={previewMapPosition}
              onCommitPosition={saveMapPosition}
            />
          )}
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
          cachedDraft={selectedGoal ? draftCacheRef.current[selectedGoal.id] : undefined}
          topGoals={visibleTree}
          flatGoals={visibleFlatGoals}
          domains={domainTitles}
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
  topGoals,
  focusId,
  collapsed,
  onToggle,
  onFocus
}: {
  topGoals: GoalNode[];
  focusId: string;
  collapsed: boolean;
  onToggle: () => void;
  onFocus: (id: string) => void;
}) {
  return (
    <aside className={`map-scope-list${collapsed ? " collapsed" : ""}`} aria-label="目标视角列表">
      <button
        type="button"
        className="scope-toggle"
        aria-label={collapsed ? "打开目标列表" : "折叠目标列表"}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        {collapsed ? <ChevronRight /> : <ChevronLeft />}
      </button>
      {!collapsed && (
        <div className="scope-content">
          <p className="scope-title">目标视角</p>
          <button
            type="button"
            className={focusId === "root" ? "scope-item active" : "scope-item"}
            onClick={() => onFocus("root")}
          >
            <span>整体目标</span>
            <small>{topGoals.length} 个一级目标</small>
          </button>
          <div className="scope-divider" />
          {topGoals.map((goal) => (
            <button
              key={goal.id}
              type="button"
              className={focusId === goal.id ? "scope-item active" : "scope-item"}
              onClick={() => onFocus(goal.id)}
            >
              <span>{goal.title}</span>
              <small>{goal.children.length} 个子目标</small>
            </button>
          ))}
          {topGoals.length === 0 && <p className="muted-text">还没有一级目标。</p>}
        </div>
      )}
    </aside>
  );
}

function MapActions({
  selectedGoal,
  saving,
  canAddSibling,
  canResetPosition,
  onAddSubgoal,
  onAddSibling,
  onRename,
  onResetPosition,
  onDelete
}: {
  selectedGoal: GoalNode | undefined;
  saving: boolean;
  canAddSibling: boolean;
  canResetPosition: boolean;
  onAddSubgoal: () => void;
  onAddSibling: () => void;
  onRename: () => void;
  onResetPosition: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const disabled = saving || !selectedGoal;

  return (
    <div className="map-actions">
      <button type="button" className="icon-button" title="添加子目标" aria-label="添加子目标" disabled={disabled} onClick={onAddSubgoal}>
        <ListPlus />
      </button>
      <button type="button" className="icon-button" title="添加同级目标" aria-label="添加同级目标" disabled={disabled || !canAddSibling} onClick={onAddSibling}>
        <CirclePlus />
      </button>
      <div className="menu-wrap">
        <button
          type="button"
          className="icon-button"
          title="菜单与快捷操作"
          aria-label="菜单与快捷操作"
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

  const childCount = collectDescendants(goal).size;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
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

export type GoalscapeSlotKey = "life" | "growth" | "career" | "extra";

export type GoalscapeSlot = {
  key: GoalscapeSlotKey;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

type GoalscapeNodeLayout = {
  node: GoalNode;
  parentId: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  progress: number;
  importance: number;
  slotKey: GoalscapeSlotKey;
  variant: number;
};

export function canOpenGoalSubmap(layout: Pick<GoalscapeNodeLayout, "node" | "depth">) {
  return layout.depth === 1 || (layout.node.children || []).length > 0;
}

export const goalscapeCenter = { x: 560, y: 410, width: 142, height: 120 };

const goalscapeViewBox = { width: 1200, height: 760 };

const goalscapeSlotStyles: Record<GoalscapeSlotKey, Pick<GoalscapeSlot, "width" | "height" | "color">> = {
  life: { width: 210, height: 150, color: "#10b981" },
  growth: { width: 236, height: 166, color: "#6366f1" },
  career: { width: 216, height: 130, color: "#0284c7" },
  extra: { width: 184, height: 122, color: "#64748b" }
};

export const goalscapePrimarySlots: GoalscapeSlot[] = [
  { key: "life", x: 310, y: 380, ...goalscapeSlotStyles.life },
  { key: "growth", x: 705, y: 255, ...goalscapeSlotStyles.growth },
  { key: "career", x: 622, y: 585, ...goalscapeSlotStyles.career }
];

type GoalscapeSlotPosition = {
  key?: GoalscapeSlotKey;
  x: number;
  y: number;
};

const goalscapeFourGoalPositions: GoalscapeSlotPosition[] = [
  { key: "life", x: 300, y: 210 },
  { key: "growth", x: 835, y: 225 },
  { key: "career", x: 845, y: 585 },
  { key: "extra", x: 300, y: 585 }
];

const goalscapePreferenceAngles: Record<Exclude<GoalscapeSlotKey, "extra">, number> = {
  life: 190,
  growth: 315,
  career: 50
};

const goalscapeRing = {
  radiusX: 365,
  radiusY: 235,
  startAngle: -90
};

function goalscapeSlotFromPosition(position: GoalscapeSlotPosition, key: GoalscapeSlotKey): GoalscapeSlot {
  return {
    key,
    x: position.x,
    y: position.y,
    ...goalscapeSlotStyles[key]
  };
}

function normalizeGoalscapeAngle(angle: number) {
  return ((angle % 360) + 360) % 360;
}

function goalscapeAngleDistance(a: number, b: number) {
  const distance = Math.abs(normalizeGoalscapeAngle(a) - normalizeGoalscapeAngle(b));
  return Math.min(distance, 360 - distance);
}

function goalscapeSlotAngle(slot: Pick<GoalscapeSlot, "x" | "y">) {
  return normalizeGoalscapeAngle((Math.atan2(slot.y - goalscapeCenter.y, slot.x - goalscapeCenter.x) * 180) / Math.PI);
}

function generatedGoalscapePositions(total: number): GoalscapeSlotPosition[] {
  return Array.from({ length: total }, (_, index) => {
    const angle = goalscapeRing.startAngle + index * (360 / total);
    const radians = (angle * Math.PI) / 180;
    const staggerScale = total > 8 && index % 2 === 1 ? 0.86 : 1;
    return {
      x: goalscapeCenter.x + Math.cos(radians) * goalscapeRing.radiusX * staggerScale,
      y: goalscapeCenter.y + Math.sin(radians) * goalscapeRing.radiusY * staggerScale
    };
  });
}

function goalscapePositionsForCount(total: number): GoalscapeSlotPosition[] {
  if (total === 4) return goalscapeFourGoalPositions;
  return generatedGoalscapePositions(total);
}

function fallbackGoalscapeSlot(index: number, total: number) {
  const positions = goalscapePositionsForCount(Math.max(4, total));
  return goalscapeSlotFromPosition(positions[index % positions.length], "extra");
}

function goalscapeSlotPreference(goal: GoalNode): GoalscapeSlotKey | undefined {
  const text = `${goal.title} ${titleFromLink(goal.domain)}`;
  if (text.includes("幸福") || text.includes("生活") || text.includes("家庭")) return "life";
  if (text.includes("个人") || text.includes("成长") || text.includes("认知") || text.includes("知识")) return "growth";
  if (text.includes("职业") || text.includes("交付") || text.includes("作品") || text.includes("机会")) return "career";
  return undefined;
}

function isGoalscapeSemanticSlot(key: GoalscapeSlotKey | undefined): key is Exclude<GoalscapeSlotKey, "extra"> {
  return key === "life" || key === "growth" || key === "career";
}

function assignGoalscapeFixedSlots(goals: GoalNode[]) {
  const slots = new Map<string, GoalscapeSlot>();
  const available = [...goalscapePrimarySlots];
  const claimed = new Set<GoalscapeSlotKey>();

  goals.forEach((goal) => {
    const preferred = goalscapeSlotPreference(goal);
    const slot = preferred ? available.find((item) => item.key === preferred && !claimed.has(item.key)) : undefined;
    if (!slot) return;
    slots.set(goal.id, slot);
    claimed.add(slot.key);
  });

  goals.forEach((goal) => {
    if (slots.has(goal.id)) return;
    const slot = available.find((item) => !claimed.has(item.key));
    if (!slot) return;
    slots.set(goal.id, slot);
    claimed.add(slot.key);
  });

  return slots;
}

type GoalscapePositionCandidate = {
  position: GoalscapeSlotPosition;
  index: number;
  angle: number;
};

function nearestGoalscapePosition(
  candidates: GoalscapePositionCandidate[],
  angle: number
): GoalscapePositionCandidate | undefined {
  return [...candidates].sort(
    (a, b) => goalscapeAngleDistance(a.angle, angle) - goalscapeAngleDistance(b.angle, angle) || a.index - b.index
  )[0];
}

export function assignGoalscapeSlots(goals: GoalNode[]) {
  if (goals.length <= goalscapePrimarySlots.length) return assignGoalscapeFixedSlots(goals);

  const slots = new Map<string, GoalscapeSlot>();
  const available = goalscapePositionsForCount(goals.length).map((position, index) => ({
    position,
    index,
    angle: goalscapeSlotAngle(position)
  }));

  const claim = (goal: GoalNode, candidate: GoalscapePositionCandidate, key: GoalscapeSlotKey) => {
    slots.set(goal.id, goalscapeSlotFromPosition(candidate.position, key));
    available.splice(available.indexOf(candidate), 1);
  };

  goals.forEach((goal) => {
    const preferred = goalscapeSlotPreference(goal);
    if (!isGoalscapeSemanticSlot(preferred)) return;
    const candidate = nearestGoalscapePosition(available, goalscapePreferenceAngles[preferred]);
    if (candidate) claim(goal, candidate, preferred);
  });

  goals.forEach((goal) => {
    if (slots.has(goal.id)) return;
    const candidate = available.shift();
    if (!candidate) return;
    const key = goalscapeSlotPreference(goal) || candidate.position.key || "extra";
    slots.set(goal.id, goalscapeSlotFromPosition(candidate.position, key));
  });

  return slots;
}

export function goalscapeChildOffset(slot: Pick<GoalscapeSlot, "x" | "y">, childIndex: number, totalChildren: number) {
  const count = Math.max(1, totalChildren);
  const index = clamp(childIndex, 0, count - 1);
  const spread =
    count === 1 ? 0 :
    count === 2 ? 72 :
    count === 3 ? 116 :
    count === 4 ? 138 :
    count === 5 ? 154 :
    count === 6 ? 168 :
    Math.min(220, 138 + (count - 4) * 18);
  const step = count <= 1 ? 0 : spread / (count - 1);
  const angle = goalscapeSlotAngle(slot) - spread / 2 + step * index;
  const radius = count >= 5 ? 198 : count >= 4 ? 190 : count === 3 ? 184 : 176;
  const radians = (angle * Math.PI) / 180;
  const x = slot.x + Math.cos(radians) * radius;
  const y = slot.y + Math.sin(radians) * radius;
  const safeX = clamp(x, 96, goalscapeViewBox.width - 96);
  const safeY = clamp(y, 78, goalscapeViewBox.height - 78);
  return { x: safeX - slot.x, y: safeY - slot.y };
}

export function goalscapeNodeDensity(progress: number) {
  return 0.12 + 0.68 * (clamp(progress, 0, 100) / 100);
}

export function goalscapeStarlightCoreRadius(baseRadius: number, progress: number) {
  return baseRadius * (0.2 + 0.8 * (clamp(progress, 0, 100) / 100));
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

const goalscapeCenterPearlSize = { width: 128, height: 108, variant: 0 };
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

export function buildGoalscapeLayout(
  goals: GoalNode[],
  importanceOverrides: ImportanceOverrides,
  progressOverrides: ProgressOverrides,
  positionOverrides: MapPositionOverrides = {},
  mapContextId = "root"
) {
  const topImportance = normalizedImportance(goals, importanceOverrides);
  const slots = assignGoalscapeSlots(goals);
  const layouts: GoalscapeNodeLayout[] = [];

  goals.forEach((goal, index) => {
    const slot = slots.get(goal.id) || fallbackGoalscapeSlot(index, goals.length);
    const position = goalMapPosition(goal, { x: slot.x, y: slot.y }, positionOverrides, mapContextId);
    const color = goalscapeNodeColor(goal, slot.color);
    const importance = topImportance[goal.id] ?? 0;
    layouts.push({
      node: goal,
      parentId: "root",
      depth: 1,
      x: position.x,
      y: position.y,
      width: slot.width,
      height: slot.height,
      color,
      progress: weightedGoalProgress(goal, importanceOverrides, progressOverrides),
      importance,
      slotKey: slot.key,
      variant: index
    });

    const children = goal.children;
    const childImportance = normalizedImportance(children, importanceOverrides);
    children.forEach((child, childIndex) => {
      const offset = goalscapeChildOffset(position, childIndex, children.length);
      const childPosition = goalMapPosition(child, { x: position.x + offset.x, y: position.y + offset.y }, positionOverrides, mapContextId);
      const childColor = goalscapeNodeColor(child, color);
      layouts.push({
        node: child,
        parentId: goal.id,
        depth: 2,
        x: childPosition.x,
        y: childPosition.y,
        width: childIndex === 0 && slot.key === "growth" ? 154 : 128,
        height: childIndex === 0 && slot.key === "growth" ? 98 : 82,
        color: childColor,
        progress: weightedGoalProgress(child, importanceOverrides, progressOverrides),
        importance: childImportance[child.id] ?? 0,
        slotKey: slot.key,
        variant: childIndex + index + 1
      });
    });
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
  color
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  id: string;
  color: string;
}) {
  const d = goalscapeConnectionPath(from, to);
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const dArch = `M ${from.x} ${from.y} C ${midX} ${from.y - 18}, ${midX} ${midY - 18}, ${to.x} ${to.y}`;

  return (
    <g key={id} className="goalscape-bridge-group" style={{ "--node-color": color } as React.CSSProperties & { "--node-color": string }}>
      <path d={d} className="goalscape-bridge-glow" stroke={color} strokeWidth="5.5" />
      <path d={dArch} className="goalscape-bridge-glow" stroke={color} strokeWidth="1.2" opacity="0.6" />
      <path d={d} className="goalscape-bridge-cables" strokeWidth="0.8" />
      <path d={d} className="goalscape-bridge-laser" strokeWidth="1.5" />
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
  onOpenMap,
  onOpenParentMap,
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
  onOpenMap: (id: string) => void;
  onOpenParentMap?: () => void;
  onPreviewPosition: (id: string, position: MapPosition) => void;
  onCommitPosition: (id: string, position: MapPosition) => void;
}) {
  const layouts = useMemo(
    () => buildGoalscapeLayout(goals, importanceOverrides, progressOverrides, positionOverrides, mapContextId),
    [goals, importanceOverrides, progressOverrides, positionOverrides, mapContextId]
  );
  const family = useMemo(() => selectedFamily(goals, selectedId), [goals, selectedId]);
  const topLayouts = useMemo(() => layouts.filter((item) => item.depth === 1), [layouts]);
  const childLayouts = useMemo(() => layouts.filter((item) => item.depth === 2), [layouts]);
  const topLayoutById = useMemo(() => new Map(topLayouts.map((item) => [item.node.id, item])), [topLayouts]);
  const visibleLayouts = useMemo(() => [...topLayouts, ...childLayouts], [topLayouts, childLayouts]);
  const centerGoal = useMemo(() => goals.find((item) => item.id === centerId) ?? null, [goals, centerId]);
  const centerPearlTint = useMemo(() => goalscapeCenterPearlTint(centerId, centerGoal), [centerId, centerGoal]);
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
  const centerLabel = useMemo(() => goalscapeLabelLines(centerTitle, 5, 2), [centerTitle]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    pointerStart: MapPosition;
    nodeStart: MapPosition;
    current: MapPosition;
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
    const next = clampGoalscapePosition({
      x: drag.nodeStart.x + point.x - drag.pointerStart.x,
      y: drag.nodeStart.y + point.y - drag.pointerStart.y
    });
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
    <svg ref={svgRef} className="goal-map goalscape-map" viewBox="0 0 1200 760" role="img" aria-labelledby="map-title map-desc">
      <title id="map-title">{centerTitle}目标地图</title>
      <desc id="map-desc">用发光岛屿节点展示目标层级，并用连接线表达目标关系。</desc>
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
        {layouts.map((layout, index) => {
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

      <g className="goalscape-orbits" aria-hidden="true">
        <ellipse cx={goalscapeCenter.x} cy={goalscapeCenter.y} rx="440" ry="290" />
        <ellipse cx={goalscapeCenter.x} cy={goalscapeCenter.y} rx="348" ry="228" />
        <ellipse cx={goalscapeCenter.x} cy={goalscapeCenter.y} rx="256" ry="170" />
      </g>

      <g className="goalscape-connections" aria-hidden="true">
        {topLayouts.map((layout) => (
          <GoalscapeBridge
            key={`center-${layout.node.id}`}
            from={goalscapeCenter}
            to={layout}
            id={`center-${layout.node.id}`}
            color={layout.color}
          />
        ))}
        {childLayouts.map((layout) => {
          const parent = topLayoutById.get(layout.parentId);
          return parent ? (
            <GoalscapeBridge
              key={`child-${layout.node.id}`}
              from={parent}
              to={layout}
              id={`child-${layout.node.id}`}
              color={layout.color}
            />
          ) : null;
        })}
      </g>

      <g
        className={selectedId === centerId ? "goalscape-center active" : "goalscape-center"}
        role="button"
        tabIndex={0}
        focusable="true"
        style={{ "--center-glow": centerPearlTint.glow } as React.CSSProperties & { "--center-glow": string }}
        onClick={() => onSelect(centerId)}
        onDoubleClick={(event) => {
          if (!onOpenParentMap) return;
          event.preventDefault();
          event.stopPropagation();
          onOpenParentMap();
        }}
        onKeyDown={(event) => selectOnKey(event, centerId)}
        aria-label={centerTitle}
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

      {layouts.map((layout, index) => {
        const active = selectedId === layout.node.id;
        const related = !family || family.has(layout.node.id);
        const opensSubmap = canOpenGoalSubmap(layout);
        const Icon = goalIconComponent(layout.node);
        const label = goalscapeLabelLines(layout.node.title, layout.depth === 1 ? 6 : 7, layout.depth === 1 ? 2 : 2);
        const bottleGradientId = `goalscape-bottle-gradient-${index}`;
        const liquidGradientId = `goalscape-liquid-gradient-${index}`;
        const clipPathId = `goalscape-node-clip-${index}`;
        const nodePath = goalscapeBlobPath(layout.x, layout.y, layout.width, layout.height, layout.variant);
        const progressFill = goalscapeProgressFillGeometry(layout.y, layout.height, layout.progress);
        return (
          <g
            key={layout.node.id}
            className={`goalscape-node depth-${layout.depth}${active ? " active" : ""}${related ? "" : " dim"}${draggingId === layout.node.id ? " dragging" : ""}`}
            role="button"
            tabIndex={0}
            focusable="true"
            aria-label={`${layout.node.title}，进度 ${layout.progress}%${opensSubmap ? "，双击打开目标地图" : ""}`}
            style={{ "--node-color": layout.color } as React.CSSProperties & { "--node-color": string }}
            onPointerDown={(event) => startNodeDrag(event, layout)}
            onClick={(event) => {
              if (suppressClickRef.current === layout.node.id) {
                suppressClickRef.current = null;
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              onSelect(layout.node.id);
            }}
            onDoubleClick={(event) => {
              if (!opensSubmap) return;
              event.preventDefault();
              event.stopPropagation();
              onOpenMap(layout.node.id);
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
                r={goalscapeStarlightCoreRadius(layout.depth === 1 ? 16 : 10, layout.progress)}
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
                x={layout.x - 20}
                y={layout.y - (layout.depth === 1 ? 54 : 42)}
                width="40"
                height="40"
                className="goalscape-icon-object"
              >
                <div className="goalscape-icon-wrap">
                  <Icon className="goalscape-node-icon" aria-hidden="true" />
                </div>
              </foreignObject>
              <text
                className={layout.depth === 1 ? "goalscape-node-title domain" : "goalscape-node-title child"}
                x={layout.x}
                y={layout.y + (layout.depth === 1 ? 7 : 9)}
              >
                {label.map((line, lineIndex) => (
                  <tspan key={line + lineIndex} x={layout.x} dy={lineIndex === 0 ? 0 : layout.depth === 1 ? 24 : 18}>
                    {line}
                  </tspan>
                ))}
              </text>
              <text className="goalscape-node-progress" x={layout.x} y={layout.y + layout.height * (layout.depth === 1 ? 0.31 : 0.43)}>
                {layout.progress}%
              </text>
            </g>
          </g>
        );
      })}

      {goals.length === 0 && (
        <text className="empty-map-text" x={goalscapeCenter.x} y={goalscapeCenter.y + 138}>
          {emptyLabel}
        </text>
      )}
    </svg>
  );
});

const GoalDetailPanel = React.memo(function GoalDetailPanel({
  selectedGoal,
  cachedDraft,
  topGoals,
  flatGoals,
  domains,
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
  cachedDraft?: EditDraft;
  topGoals: GoalNode[];
  flatGoals: GoalNode[];
  domains: string[];
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
  const rootProgressAverage = useMemo(
    () => averageProgress(flatGoals, importanceOverrides, progressOverrides),
    [flatGoals, importanceOverrides, progressOverrides]
  );
  const selectedPath = useMemo(() => (selectedGoal ? goalPath(topGoals, selectedGoal.id) : []), [selectedGoal, topGoals]);
  const breadcrumbGoals = selectedGoal ? (selectedPath.length ? selectedPath : [selectedGoal]) : [];
  const selectedSiblingImportance = useMemo(
    () => (selectedGoal ? normalizedImportance(siblingGoals(topGoals, selectedGoal.id))[selectedGoal.id] ?? 100 : 100),
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
            <p className="eyebrow">整体目标</p>
            <h2>目标网络</h2>
          </div>
          <span className="status-badge active">地图</span>
        </div>

        <section className="root-intro" aria-label="目标网络介绍">
          <h3>把人生方向变成清晰可推进的地图</h3>
          <p>
            目标网络帮你把长期愿景、阶段目标和下一步行动连接在一起。你可以一眼看清重心在哪里、哪些目标正在推进，
            也能随时调整优先级，让每天的选择都更靠近真正重要的结果。
          </p>
        </section>

        <div className="metric-grid">
          <div className="metric">
            <span>顶层目标</span>
            <strong>{topGoals.length}</strong>
          </div>
          <div className="metric">
            <span>全部节点</span>
            <strong>{flatGoals.length}</strong>
          </div>
          <div className="metric">
            <span>平均进度</span>
            <strong>{rootProgressAverage}%</strong>
          </div>
          <div className="metric">
            <span>目标域</span>
            <strong>{domains.length || "未设置"}</strong>
          </div>
        </div>

        <section>
          <h3>顶层目标</h3>
          <div className="child-list">
            {topGoals.map((goal) => (
              <button key={goal.id} type="button" className="child-pill" onClick={() => onSelect(goal.id)}>
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
    <aside className="detail-panel" aria-live="polite">
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
        <span>
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
            <button key={child.id} type="button" className="child-pill" onClick={() => onSelect(child.id)}>
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
