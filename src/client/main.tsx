"use client";

import {
  BookOpen,
  Briefcase,
  ChartPie,
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
  safeLocalStorage,
  writeStoredTheme,
  type ThemePreference
} from "./theme";
import {
  averageProgress,
  blend,
  buildParentMap,
  clamp,
  collectDescendants,
  domainAccentToken,
  domainBaseColor,
  filterGoalTree,
  filterGoalsByGoalMap,
  findGoalById,
  flattenGoals,
  formatEmpty,
  goalMapCenterTitle,
  goalPath,
  mediaQueryMatches,
  normalizedImportance,
  parentGoal,
  rebalanceImportance,
  shouldApplyGoalsResponse,
  shouldShowFirstGoalMapCta,
  siblingGoals,
  titleFromLink,
  uniqueDomainTitles,
  weightedGoalProgress,
  type ImportanceOverrides,
  type ProgressOverrides
} from "./goalUtils";
import {
  buildSunburstLayout,
  buildGoalscapeLayout,
  clampGoalscapePosition,
  constrainGoalscapePositionToOrbit,
  DEFAULT_SUNBURST_VISIBLE_DEPTH,
  goalHasMapPosition,
  goalIconComponent,
  goalMapPosition,
  goalscapeBlobPath,
  goalscapeCenter,
  goalscapeCenterPearlSize,
  goalscapeCenterPearlTint,
  goalscapeCenterVisualMode,
  goalscapeConnectionPath,
  goalscapeLabelLines,
  goalscapeLabelMaxChars,
  goalscapeNodeColor,
  goalscapeNodeDensity,
  goalscapeNodeVisualMetrics,
  goalscapeOrbitForDepth,
  goalscapeProgressFillGeometry,
  goalscapeStarlightCoreRadius,
  goalscapeTopNodeBaseSize,
  goalscapeTopNodeSize,
  hasCustomMapPosition,
  hasMapPositionOverride,
  mapPositionPreviewForContext,
  nextSunburstVisibleDepth,
  pruneSavedMapPositionPreviews,
  sunburstCenterRadius,
  sunburstArcPath,
  sunburstProgressArcPath,
  sunburstProgressEdgePath,
  withMapPositionPreview,
  withoutMapPositionPreview,
  type GoalscapeCenterPearlTint,
  type GoalscapeNodeLayout,
  type GoalscapeOrbit,
  type MapPosition,
  type MapPositionOverrides,
  type MapPositionPreviewOverrides,
  type SunburstSegmentLayout
} from "./goalscapeLayout";

// Re-export the goal-data helpers that the goalscape layout test imports from "./main".
export {
  filterGoalsByGoalMap,
  goalMapCenterTitle,
  shouldApplyGoalsResponse,
  shouldShowFirstGoalMapCta,
  weightedGoalProgress
} from "./goalUtils";
// Re-export the goalscape geometry/layout API consumed by the layout test from "./main".
export {
  buildSunburstLayout,
  buildGoalscapeLayout,
  clampGoalscapePosition,
  constrainGoalscapePositionToOrbit,
  DEFAULT_SUNBURST_VISIBLE_DEPTH,
  goalHasMapPosition,
  goalscapeCenter,
  goalscapeCenterPearlSize,
  goalscapeCenterVisualMode,
  goalscapeNodeDensity,
  goalscapeOrbitForDepth,
  goalscapeProgressFillGeometry,
  goalscapeStarlightCoreRadius,
  mapPositionPreviewForContext,
  nextSunburstVisibleDepth,
  pruneSavedMapPositionPreviews,
  sunburstArcPath,
  sunburstProgressArcPath,
  sunburstProgressEdgePath,
  withMapPositionPreview,
  withoutMapPositionPreview
} from "./goalscapeLayout";

const emptyGoals: GoalsResponse = {
  goalMaps: [],
  goals: [],
  flatGoals: [],
  graph: { nodes: [], edges: [] }
};

const ACTIVE_GOAL_MAP_STORAGE_KEY = "goal-network.activeGoalMapId";
export const GOAL_PRESENTATION_STORAGE_KEY = "goal-network.presentationByGoalMapId";
const FLOATING_AI_ASSISTANT_POSITION_STORAGE_KEY = "goal-network.floatingAiAssistantPosition";
const FLOATING_AI_ASSISTANT_SIZE = 56;
const FLOATING_AI_ASSISTANT_MARGIN = 16;
export const SUNBURST_VIEW_BOX = { x: 100, y: -14, width: 1000, height: 788 } as const;
type SunburstDepthControlPoint = { x: number; y: number };
type SunburstDepthControlTriangle = readonly [SunburstDepthControlPoint, SunburstDepthControlPoint, SunburstDepthControlPoint];
type FloatingAiAssistantPosition = { x: number; y: number };
export const SUNBURST_DEPTH_CONTROL_GEOMETRY = {
  arcPath: "M 950 88 C 990 117 1018 162 1036 224",
  increaseTriangle: [
    { x: 1004, y: 118 },
    { x: 1030, y: 124 },
    { x: 1024, y: 150 }
  ],
  decreaseTriangle: [
    { x: 1001.3, y: 166.9 },
    { x: 984.4, y: 163 },
    { x: 988.3, y: 146 }
  ]
} as const satisfies {
  arcPath: string;
  increaseTriangle: SunburstDepthControlTriangle;
  decreaseTriangle: SunburstDepthControlTriangle;
};

const STACKED_LAYOUT_QUERY = "(max-width: 1120px)";

export type GoalPresentationMode = "sphere" | "sunburst";

function parseGoalPresentationMap(value: string | null): Record<string, GoalPresentationMode> {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, GoalPresentationMode> = {};
    for (const [goalMapId, mode] of Object.entries(parsed)) {
      if (mode === "sphere" || mode === "sunburst") result[goalMapId] = mode;
    }
    return result;
  } catch {
    return {};
  }
}

export function readGoalPresentationMode(goalMapId: string, storage = safeLocalStorage()): GoalPresentationMode {
  if (!goalMapId || !storage) return "sphere";

  try {
    return parseGoalPresentationMap(storage.getItem(GOAL_PRESENTATION_STORAGE_KEY))[goalMapId] ?? "sphere";
  } catch {
    return "sphere";
  }
}

export function writeGoalPresentationMode(goalMapId: string, mode: GoalPresentationMode, storage = safeLocalStorage()) {
  if (!goalMapId || !storage) return;

  try {
    const current = parseGoalPresentationMap(storage.getItem(GOAL_PRESENTATION_STORAGE_KEY));
    storage.setItem(GOAL_PRESENTATION_STORAGE_KEY, JSON.stringify({ ...current, [goalMapId]: mode }));
  } catch {
    // Ignore unavailable localStorage; the server schema remains unchanged.
  }
}

function clampFloatingAiAssistantPosition(position: FloatingAiAssistantPosition, size = FLOATING_AI_ASSISTANT_SIZE) {
  if (typeof window === "undefined") return position;
  const maxX = Math.max(FLOATING_AI_ASSISTANT_MARGIN, window.innerWidth - size - FLOATING_AI_ASSISTANT_MARGIN);
  const maxY = Math.max(FLOATING_AI_ASSISTANT_MARGIN, window.innerHeight - size - FLOATING_AI_ASSISTANT_MARGIN);
  return {
    x: clamp(Math.round(position.x), FLOATING_AI_ASSISTANT_MARGIN, maxX),
    y: clamp(Math.round(position.y), FLOATING_AI_ASSISTANT_MARGIN, maxY)
  };
}

function defaultFloatingAiAssistantPosition(size = FLOATING_AI_ASSISTANT_SIZE) {
  if (typeof window === "undefined") return { x: FLOATING_AI_ASSISTANT_MARGIN, y: FLOATING_AI_ASSISTANT_MARGIN };
  return clampFloatingAiAssistantPosition({
    x: window.innerWidth - size - 28,
    y: window.innerHeight - size - 28
  }, size);
}

function readFloatingAiAssistantPosition(size = FLOATING_AI_ASSISTANT_SIZE) {
  const storage = safeLocalStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(FLOATING_AI_ASSISTANT_POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloatingAiAssistantPosition>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return clampFloatingAiAssistantPosition({ x: Number(parsed.x), y: Number(parsed.y) }, size);
  } catch {
    return null;
  }
}

function writeFloatingAiAssistantPosition(position: FloatingAiAssistantPosition) {
  const storage = safeLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(FLOATING_AI_ASSISTANT_POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Drag position is a convenience preference only.
  }
}

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

function nextGoalsRequestId(ref: React.MutableRefObject<number>) {
  const requestId = ref.current + 1;
  ref.current = requestId;
  return requestId;
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
  const [mapPositionPreview, setMapPositionPreview] = useState<MapPositionPreviewOverrides>({});
  const [focusRootId, setFocusRootId] = useState<string | null>(null);
  const [presentationMode, setPresentationMode] = useState<GoalPresentationMode>("sphere");
  const [sunburstVisibleDepth, setSunburstVisibleDepth] = useState(DEFAULT_SUNBURST_VISIBLE_DEPTH);
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
  const goalsRequestIdRef = useRef(0);

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
    const requestId = nextGoalsRequestId(goalsRequestIdRef);
    const next = await api<GoalsResponse>("/api/goals");
    if (shouldApplyGoalsResponse(requestId, goalsRequestIdRef.current)) setGoals(next);
    return next;
  }, []);

  const reload = useCallback(async () => {
    const requestId = nextGoalsRequestId(goalsRequestIdRef);
    try {
      const next = await api<GoalsResponse>("/api/goals");
      if (shouldApplyGoalsResponse(requestId, goalsRequestIdRef.current)) {
        setGoals(next);
        setError("");
      }
      return next;
    } catch (nextError) {
      if (shouldApplyGoalsResponse(requestId, goalsRequestIdRef.current)) {
        setError(nextError instanceof Error ? nextError.message : "加载失败");
      }
      throw nextError;
    } finally {
      if (shouldApplyGoalsResponse(requestId, goalsRequestIdRef.current)) setLoading(false);
    }
  }, []);

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
  const focusGoal = useMemo(
    () => (focusRootId ? findGoalById(visibleTree, focusRootId) ?? null : null),
    [focusRootId, visibleTree]
  );
  const focusedPath = useMemo(() => (focusRootId ? goalPath(visibleTree, focusRootId) : []), [focusRootId, visibleTree]);
  const selectedGoal = useMemo(
    () => visibleFlatGoals.find((goal) => goal.id === selectedId),
    [selectedId, visibleFlatGoals]
  );
  const selectedGoalFull = useMemo(() => visibleFlatGoals.find((goal) => goal.id === selectedId), [selectedId, visibleFlatGoals]);
  const activeAiGoal = useMemo(() => (aiGoal ? goals.flatGoals.find((goal) => goal.id === aiGoal.id) ?? aiGoal : null), [aiGoal, goals.flatGoals]);
  const selectedParent = useMemo(() => parentGoal(visibleTree, selectedId), [selectedId, visibleTree]);
  const mapGoals = focusGoal ? focusGoal.children ?? [] : visibleTree;
  const mapContextId = focusGoal ? focusGoal.id : activeGoalMap?.id || "root";
  const mapCenterId = focusGoal ? focusGoal.id : activeGoalMap?.id || "root";
  const floatingAiGoal = useMemo(
    () => selectedGoalFull ?? (selectedId === mapCenterId ? visibleTree[0] : undefined),
    [mapCenterId, selectedGoalFull, selectedId, visibleTree]
  );
  const mapCenterTitle = focusGoal ? focusGoal.title : goalMapCenterTitle(activeGoalMap);
  const mapEmptyLabel = loading
    ? ""
    : focusGoal && mapGoals.length === 0
      ? "这个目标还没有子目标"
      : // Empty root map is handled by the .empty-scape CTA overlay below; keep the
        // in-SVG label empty so the two empty states don't render at the same time.
        "";
  const activeMapPositionPreview = useMemo(
    () => mapPositionPreviewForContext(mapPositionPreview, mapContextId),
    [mapPositionPreview, mapContextId]
  );
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
    if (!activeGoalMapId) {
      setPresentationMode("sphere");
      setSunburstVisibleDepth(DEFAULT_SUNBURST_VISIBLE_DEPTH);
      return;
    }

    setPresentationMode(readGoalPresentationMode(activeGoalMapId));
    setSunburstVisibleDepth(DEFAULT_SUNBURST_VISIBLE_DEPTH);
  }, [activeGoalMapId]);

  useEffect(() => {
    if (!focusRootId) return;
    if (!findGoalById(visibleTree, focusRootId)) setFocusRootId(null);
  }, [focusRootId, visibleTree]);

  useEffect(() => {
    setImportancePreview((current) => (Object.keys(current).length ? {} : current));
    setProgressPreview((current) => (Object.keys(current).length ? {} : current));
  }, [selectedId]);

  useEffect(() => {
    setMapPositionPreview((current) => pruneSavedMapPositionPreviews(current, goals.flatGoals));
  }, [goals.flatGoals]);

  const clampDetailWidth = useCallback((value: number) => {
    const workspaceWidth =
      workspaceRef.current?.getBoundingClientRect().width ?? (typeof window === "undefined" ? 1080 : window.innerWidth);
    const maxWidth = Math.max(340, Math.min(560, workspaceWidth - 520));
    return clamp(Math.round(value), 340, maxWidth);
  }, []);

  const clampMapPaneHeight = useCallback((value: number) => {
    const viewportHeight = typeof window === "undefined" ? 940 : window.innerHeight;
    const maxHeight = Math.max(320, Math.min(720, viewportHeight - 220));
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

  const selectPresentationMode = useCallback((mode: GoalPresentationMode) => {
    if (mode === presentationMode) return;
    queuePendingEditSave();
    setPresentationMode(mode);
    if (activeGoalMapId) writeGoalPresentationMode(activeGoalMapId, mode);
    if (mode === "sunburst") {
      setFocusRootId(null);
      setMapPositionPreview({});
    }
  }, [activeGoalMapId, presentationMode, queuePendingEditSave]);

  const selectGoal = useCallback((id: string) => {
    if (id === selectedId) return;
    queuePendingEditSave();
    setSelectedId(id);
  }, [queuePendingEditSave, selectedId]);

  const drillGoal = useCallback((id: string) => {
    queuePendingEditSave();
    setFocusRootId(id);
    setSelectedId(id);
  }, [queuePendingEditSave]);

  const ascendGoal = useCallback(() => {
    if (!focusRootId) return;
    const parentId = buildParentMap(visibleTree).get(focusRootId);
    setFocusRootId(parentId && parentId !== "root" ? parentId : null);
    setSelectedId(focusRootId);
  }, [focusRootId, visibleTree]);

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
      const created = await api<{ id?: string } | null>("/api/goals", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const next = await loadGoals();
      // Prefer the server-assigned id; fall back to a title+map match only when the
      // response carries no id (goal titles are not guaranteed unique within a map).
      const createdGoal =
        (created?.id ? next.flatGoals.find((goal) => goal.id === created.id) : undefined) ??
        next.flatGoals.find((goal) => goal.title === input.title.trim() && goal.goalMapId === input.goalMapId);
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
    setFocusRootId(null);
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
    setMapPositionPreview((current) => withMapPositionPreview(current, mapContextId, goalId, position));
  }, [mapContextId]);

  const saveMapPosition = useCallback((goalId: string, position: MapPosition) => {
    const nextPosition = clampGoalscapePosition(position);
    void runWrite(async () => {
      await api(`/api/goals/${encodeURIComponent(goalId)}`, {
        method: "PATCH",
        body: JSON.stringify({ map_positions: { [mapContextId]: nextPosition } })
      });
      await loadGoals();
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
      setMapPositionPreview((current) => withoutMapPositionPreview(current, mapContextId, goalId));
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

  const openCreateSiblingGoalDialog = useCallback(() => {
    if (!selectedGoalFull) return;
    if (!selectedParent) {
      openCreateTopGoalDialog();
      return;
    }
    openCreateQuickGoalDialog("sibling");
  }, [openCreateQuickGoalDialog, openCreateTopGoalDialog, selectedGoalFull, selectedParent]);

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
      // Renaming never changes the goal id, so keep the current selection by id.
      // (A title lookup could resolve to a different goal that shares the new title.)
      const nextId = next.flatGoals.some((item) => item.id === selectedGoalFull.id)
        ? selectedGoalFull.id
        : activeGoalMap?.id || "root";
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
        <section
          ref={mapPaneRef}
          className={`map-pane ${scopeListCollapsed ? "scope-collapsed" : "scope-open"}${presentationMode === "sunburst" ? " sunburst-active" : ""}`}
          aria-label="Goalscape 风格目标地图"
        >
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
              {focusRootId && presentationMode === "sphere" && (
                <nav className="map-breadcrumb" aria-label="目标层级路径">
                  <button
                    type="button"
                    className="breadcrumb-item"
                    onClick={() => {
                      queuePendingEditSave();
                      setFocusRootId(null);
                      setSelectedId(activeGoalMap.id);
                    }}
                  >
                    {goalMapCenterTitle(activeGoalMap)}
                  </button>
                  {focusedPath.map((goal, index) => (
                    <React.Fragment key={goal.id}>
                      <ChevronRight aria-hidden="true" />
                      <button
                        type="button"
                        tabIndex={index === focusedPath.length - 1 ? -1 : undefined}
                        className={`breadcrumb-item${index === focusedPath.length - 1 ? " active" : ""}`}
                        onClick={() => {
                          if (index >= focusedPath.length - 1) return;
                          queuePendingEditSave();
                          setFocusRootId(goal.id);
                          setSelectedId(goal.id);
                        }}
                        aria-current={index === focusedPath.length - 1 ? "page" : undefined}
                      >
                        {goal.title}
                      </button>
                    </React.Fragment>
                  ))}
                </nav>
              )}
              <PresentationModeToggle mode={presentationMode} onChange={selectPresentationMode} />
              <MapActions
                activeGoalMap={activeGoalMap}
                mapCenterSelected={selectedId === mapCenterId && !selectedGoalFull}
                selectedGoal={selectedGoalFull}
                saving={saving}
                canAddSibling={Boolean(selectedGoalFull)}
                canResetPosition={presentationMode === "sphere" && hasCustomMapPosition(selectedGoalFull, mapContextId)}
                onAddTopGoal={openCreateTopGoalDialog}
                onAddSubgoal={() => openCreateQuickGoalDialog("subgoal")}
                onAddSibling={openCreateSiblingGoalDialog}
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
          ) : activeGoalMap && presentationMode === "sphere" ? (
            <GoalMap
              goals={mapGoals}
              selectedId={selectedId}
              importanceOverrides={importancePreview}
              progressOverrides={progressPreview}
              positionOverrides={activeMapPositionPreview}
              mapContextId={mapContextId}
              centerId={mapCenterId}
              centerTitle={mapCenterTitle}
              centerGoal={focusGoal}
              emptyLabel={mapEmptyLabel}
              onSelect={selectGoal}
              onDrill={drillGoal}
              onAscend={ascendGoal}
              onPreviewPosition={previewMapPosition}
              onCommitPosition={saveMapPosition}
            />
          ) : activeGoalMap && presentationMode === "sunburst" ? (
            <SunburstGoalMap
              goals={visibleTree}
              selectedId={selectedId}
              centerId={mapCenterId}
              centerTitle={goalMapCenterTitle(activeGoalMap)}
              importanceOverrides={importancePreview}
              progressOverrides={progressPreview}
              visibleDepth={sunburstVisibleDepth}
              onSelect={selectGoal}
              onVisibleDepthChange={setSunburstVisibleDepth}
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
          aria-valuemin={stackedLayout ? 320 : 340}
          aria-valuemax={stackedLayout ? clampMapPaneHeight(Number.MAX_SAFE_INTEGER) : clampDetailWidth(Number.MAX_SAFE_INTEGER)}
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
        />
      </main>
      <FloatingAiAssistantButton goal={floatingAiGoal} open={aiOpen} onOpen={openAiAssistant} />
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

const FloatingAiAssistantButton = React.memo(function FloatingAiAssistantButton({
  goal,
  open,
  onOpen
}: {
  goal: GoalNode | undefined;
  open: boolean;
  onOpen: (goal: GoalNode) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: FloatingAiAssistantPosition;
    moved: boolean;
    size: number;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [position, setPosition] = useState<FloatingAiAssistantPosition | null>(null);

  useEffect(() => {
    const size = buttonRef.current?.offsetWidth || FLOATING_AI_ASSISTANT_SIZE;
    setPosition(readFloatingAiAssistantPosition(size) ?? defaultFloatingAiAssistantPosition(size));
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const size = buttonRef.current?.offsetWidth || FLOATING_AI_ASSISTANT_SIZE;
      setPosition((current) => (current ? clampFloatingAiAssistantPosition(current, size) : current));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (!goal) return null;

  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;

    if (!drag.moved) return;
    const nextPosition = clampFloatingAiAssistantPosition({
      x: drag.origin.x + event.clientX - drag.startX,
      y: drag.origin.y + event.clientY - drag.startY
    }, drag.size);
    suppressClickRef.current = true;
    setPosition(nextPosition);
    writeFloatingAiAssistantPosition(nextPosition);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className={open ? "floating-ai-assistant active" : "floating-ai-assistant"}
      style={position ? { left: `${position.x}px`, top: `${position.y}px`, right: "auto", bottom: "auto" } : undefined}
      title={`AI 助手：${goal.title}`}
      aria-label={`AI 助手：${goal.title}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Clear stale suppression so a click after a pointercancel-ended drag isn't swallowed.
        suppressClickRef.current = false;
        const rect = event.currentTarget.getBoundingClientRect();
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          origin: { x: rect.left, y: rect.top },
          moved: false,
          size: rect.width || FLOATING_AI_ASSISTANT_SIZE
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
        drag.moved = true;
        event.preventDefault();
        setPosition(clampFloatingAiAssistantPosition({
          x: drag.origin.x + deltaX,
          y: drag.origin.y + deltaY
        }, drag.size));
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onClick={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          event.preventDefault();
          return;
        }
        onOpen(goal);
      }}
    >
      <Sparkles aria-hidden="true" />
    </button>
  );
});

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

function PresentationModeToggle({
  mode,
  onChange
}: {
  mode: GoalPresentationMode;
  onChange: (mode: GoalPresentationMode) => void;
}) {
  return (
    <div className="presentation-toggle" role="group" aria-label="目标呈现方式">
      <button
        type="button"
        className={mode === "sphere" ? "presentation-option active" : "presentation-option"}
        aria-pressed={mode === "sphere"}
        onClick={() => onChange("sphere")}
      >
        <Network aria-hidden="true" />
        <span>目标圆球</span>
      </button>
      <button
        type="button"
        className={mode === "sunburst" ? "presentation-option active" : "presentation-option"}
        aria-pressed={mode === "sunburst"}
        onClick={() => onChange("sunburst")}
      >
        <ChartPie aria-hidden="true" />
        <span>目标旭日图</span>
      </button>
    </div>
  );
}

export function mapAddActionAvailability({
  mapCenterSelected,
  hasActiveGoalMap,
  hasSelectedGoal,
  canAddSibling,
  saving
}: {
  mapCenterSelected: boolean;
  hasActiveGoalMap: boolean;
  hasSelectedGoal: boolean;
  canAddSibling: boolean;
  saving: boolean;
}) {
  const subgoalDisabled = saving || (mapCenterSelected ? !hasActiveGoalMap : !hasSelectedGoal);
  const siblingDisabled = saving || !hasSelectedGoal || !canAddSibling;
  return {
    subgoalDisabled,
    siblingDisabled,
    subgoalUsesTopGoal: mapCenterSelected
  };
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
  const addActions = mapAddActionAvailability({
    mapCenterSelected,
    hasActiveGoalMap: Boolean(activeGoalMap),
    hasSelectedGoal: Boolean(selectedGoal),
    canAddSibling,
    saving
  });

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
        <button
          type="button"
          className="icon-button"
          title="添加子目标"
          aria-label="添加子目标"
          disabled={addActions.subgoalDisabled}
          onClick={addActions.subgoalUsesTopGoal ? onAddTopGoal : onAddSubgoal}
        >
          <ListPlus />
        </button>
        <button
          type="button"
          className="icon-button"
          title="添加同级目标"
          aria-label="添加同级目标"
          disabled={addActions.siblingDisabled}
          onClick={onAddSibling}
        >
          <CirclePlus />
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
                role="menuitem"
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
      <button type="button" className="icon-button" title="添加子目标" aria-label="添加子目标" disabled={addActions.subgoalDisabled} onClick={onAddSubgoal}>
        <ListPlus />
      </button>
      <button type="button" className="icon-button" title="添加同级目标" aria-label="添加同级目标" disabled={addActions.siblingDisabled} onClick={onAddSibling}>
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
              role="menuitem"
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
              role="menuitem"
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
              role="menuitem"
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

function sunburstPoint(radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: goalscapeCenter.x + radius * Math.cos(radians),
    y: goalscapeCenter.y + radius * Math.sin(radians)
  };
}

function sunburstSegmentLabel(segment: SunburstSegmentLayout) {
  const angle = (segment.startAngle + segment.endAngle) / 2;
  const radius = (segment.innerRadius + segment.outerRadius) / 2;
  const point = sunburstPoint(radius, angle);
  const lines = goalscapeLabelLines(segment.node.title, segment.depth <= 2 ? 8 : 6, 1);
  return {
    x: point.x,
    y: point.y,
    lines
  };
}

function trianglePath(points: SunburstDepthControlTriangle) {
  return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y} L ${points[2].x} ${points[2].y} Z`;
}

export function sunburstDepthControlState(visibleDepth: number, maxDepth: number) {
  const safeMaxDepth = Math.max(1, Math.round(maxDepth));
  const currentDepth = clamp(Math.round(visibleDepth), 1, safeMaxDepth);
  const decreaseDepth = nextSunburstVisibleDepth(currentDepth, safeMaxDepth, -1);
  const increaseDepth = nextSunburstVisibleDepth(currentDepth, safeMaxDepth, 1);

  return {
    canDecrease: decreaseDepth < currentDepth,
    canIncrease: increaseDepth > currentDepth,
    decreaseDepth,
    increaseDepth
  };
}

const SunburstGoalMap = React.memo(function SunburstGoalMap({
  goals,
  selectedId,
  centerId,
  centerTitle,
  importanceOverrides,
  progressOverrides,
  visibleDepth,
  onSelect,
  onVisibleDepthChange
}: {
  goals: GoalNode[];
  selectedId: string;
  centerId: string;
  centerTitle: string;
  importanceOverrides: ImportanceOverrides;
  progressOverrides: ProgressOverrides;
  visibleDepth: number;
  onSelect: (id: string) => void;
  onVisibleDepthChange: React.Dispatch<React.SetStateAction<number>>;
}) {
  const layout = useMemo(
    () => buildSunburstLayout(goals, importanceOverrides, progressOverrides, visibleDepth),
    [goals, importanceOverrides, progressOverrides, visibleDepth]
  );
  const centerGoal = layout.center.node;
  const centerDisplayTitle = centerGoal?.title || centerTitle;
  const centerProgress = centerGoal ? weightedGoalProgress(centerGoal, importanceOverrides, progressOverrides) : averageProgress(goals, importanceOverrides, progressOverrides);
  const centerProgressRadius = sunburstCenterRadius - 5;
  const centerProgressCircumference = 2 * Math.PI * centerProgressRadius;
  const centerProgressDashOffset = centerProgressCircumference * (1 - clamp(centerProgress, 0, 100) / 100);
  const CenterIcon = centerGoal ? goalIconComponent(centerGoal) : ChartPie;
  const centerSelected = centerGoal ? selectedId === centerGoal.id : selectedId === centerId;
  const controlState = sunburstDepthControlState(layout.visibleDepth, layout.maxDepth);

  const changeVisibleDepth = useCallback(
    (delta: 1 | -1) => {
      onVisibleDepthChange((current) => nextSunburstVisibleDepth(current, layout.maxDepth, delta));
    },
    [layout.maxDepth, onVisibleDepthChange]
  );

  const selectSegment = useCallback(
    (segment: SunburstSegmentLayout) => {
      if (segment.collapsed) {
        changeVisibleDepth(1);
        return;
      }
      onSelect(segment.node.id);
    },
    [changeVisibleDepth, onSelect]
  );

  const handleSegmentKey = useCallback(
    (event: React.KeyboardEvent<SVGGElement>, segment: SunburstSegmentLayout) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectSegment(segment);
    },
    [selectSegment]
  );

  const handleDepthControlKey = useCallback(
    (event: React.KeyboardEvent<SVGGElement>, delta: 1 | -1, disabled: boolean) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (disabled) return;
      changeVisibleDepth(delta);
    },
    [changeVisibleDepth]
  );

  return (
    <svg
      className="goal-map sunburst-map"
      viewBox={`${SUNBURST_VIEW_BOX.x} ${SUNBURST_VIEW_BOX.y} ${SUNBURST_VIEW_BOX.width} ${SUNBURST_VIEW_BOX.height}`}
      role="img"
      aria-labelledby="sunburst-title sunburst-desc"
      onClick={() => onSelect(centerGoal?.id || centerId)}
    >
      <title id="sunburst-title">{centerDisplayTitle}目标旭日图</title>
      <desc id="sunburst-desc">目标按同级重要性分配角度，子目标沿父目标扇区向外展开。</desc>
      <defs>
        <filter id="sunburst-selected-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="sunburst-sky-glow" gradientUnits="userSpaceOnUse" cx="600" cy="380" r="392">
          <stop offset="0%" stopColor="var(--sun-sky, rgba(255, 244, 224, 0.22))" />
          <stop offset="62%" stopColor="var(--sun-sky-fade, rgba(255, 244, 224, 0.05))" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <radialGradient id="sunburst-core-glow" gradientUnits="userSpaceOnUse" cx="600" cy="380" r="120">
          <stop offset="0%" stopColor="var(--sun-core-hi, rgba(255, 250, 240, 0.96))" />
          <stop offset="46%" stopColor="var(--sun-core-mid, rgba(255, 242, 220, 0.42))" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <filter id="sunburst-aura-blur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
      </defs>

      <circle className="sunburst-sky-wash" cx={goalscapeCenter.x} cy={goalscapeCenter.y} r="392" fill="url(#sunburst-sky-glow)" aria-hidden="true" />
      <circle className="sunburst-background-ring" cx={goalscapeCenter.x} cy={goalscapeCenter.y} r="392" aria-hidden="true" />

      <g
        className={centerSelected ? "sunburst-center active" : "sunburst-center"}
        role="button"
        tabIndex={0}
        focusable="true"
        aria-label={`${centerDisplayTitle}，进度 ${centerProgress}%`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(centerGoal?.id || centerId);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelect(centerGoal?.id || centerId);
        }}
      >
        <title>{centerDisplayTitle}</title>
        <circle className="sunburst-center-aura" cx={goalscapeCenter.x} cy={goalscapeCenter.y} r={sunburstCenterRadius + 16} aria-hidden="true" />
        <circle
          cx={goalscapeCenter.x}
          cy={goalscapeCenter.y}
          r={sunburstCenterRadius - 10}
          className="sunburst-center-core"
          fillOpacity={0.44 + 0.42 * (centerProgress / 100)}
          style={
            {
              "--center-color": layout.center.color,
              "--center-progress": centerProgress / 100
            } as React.CSSProperties & { "--center-color": string; "--center-progress": number }
          }
        />
        <circle className="sunburst-center-coreglow" cx={goalscapeCenter.x} cy={goalscapeCenter.y} r={sunburstCenterRadius - 10} fill="url(#sunburst-core-glow)" aria-hidden="true" />
        <circle className="sunburst-center-progress-track" cx={goalscapeCenter.x} cy={goalscapeCenter.y} r={centerProgressRadius} aria-hidden="true" />
        <circle
          className="sunburst-center-progress-ring"
          cx={goalscapeCenter.x}
          cy={goalscapeCenter.y}
          r={centerProgressRadius}
          strokeDasharray={centerProgressCircumference.toFixed(2)}
          strokeDashoffset={centerProgressDashOffset.toFixed(2)}
          transform={`rotate(-90 ${goalscapeCenter.x} ${goalscapeCenter.y})`}
          aria-hidden="true"
        />
        <foreignObject x={goalscapeCenter.x - 18} y={goalscapeCenter.y - 38} width="36" height="36" className="sunburst-center-icon-object">
          <div className="sunburst-center-icon">
            <CenterIcon aria-hidden="true" />
          </div>
        </foreignObject>
        <text className="sunburst-center-title" x={goalscapeCenter.x} y={goalscapeCenter.y + 16}>
          {goalscapeLabelLines(centerDisplayTitle, 6, 2).map((line, index) => (
            <tspan key={`${line}-${index}`} x={goalscapeCenter.x} dy={index === 0 ? 0 : 17}>
              {line}
            </tspan>
          ))}
        </text>
        <text className="sunburst-center-progress-text" x={goalscapeCenter.x} y={goalscapeCenter.y + 66}>
          {centerProgress}%
        </text>
      </g>

      <g className="sunburst-segments">
        {layout.segments.map((segment) => {
          const active = selectedId === segment.node.id && !segment.collapsed;
          const label = sunburstSegmentLabel(segment);
          const depthClass = `depth-${Math.min(segment.depth, 6)}`;
          const segmentPath = sunburstArcPath(segment);
          const progressPath = segment.collapsed ? "" : sunburstProgressArcPath(segment);
          const progressEdgePath = segment.collapsed ? "" : sunburstProgressEdgePath(segment);
          return (
            <g
              key={segment.id}
              className={`sunburst-segment ${depthClass}${active ? " active" : ""}${segment.collapsed ? " collapsed" : ""}`}
              role="button"
              tabIndex={0}
              focusable="true"
              aria-label={`${segment.node.title}，第 ${segment.depth} 层，进度 ${segment.progress}%${segment.collapsed ? `，折叠 ${segment.hiddenDescendantCount} 个目标` : ""}`}
              style={
                {
                  "--segment-color": segment.color,
                  "--segment-progress": segment.progress / 100,
                  "--enter-delay": `${(segment.depth - 1) * 90 + ((segment.startAngle + 90) / 360) * 260}ms`
                } as React.CSSProperties & {
                  "--segment-color": string;
                  "--segment-progress": number;
                  "--enter-delay": string;
                }
              }
              onClick={(event) => {
                event.stopPropagation();
                selectSegment(segment);
              }}
              onKeyDown={(event) => handleSegmentKey(event, segment)}
            >
              <title>{segment.collapsed ? `${segment.node.title}，${segment.hiddenDescendantCount} 个目标已折叠` : segment.node.title}</title>
              <path className="sunburst-segment-shape" d={segmentPath} />
              {progressPath && <path className="sunburst-segment-progress" d={progressPath} aria-hidden="true" />}
              {progressEdgePath && <path className="sunburst-segment-progress-edge" d={progressEdgePath} aria-hidden="true" />}
              {segment.progress === 100 && !segment.collapsed && <path className="sunburst-segment-complete" d={segmentPath} aria-hidden="true" />}
              <path className="sunburst-segment-boundary" d={segmentPath} aria-hidden="true" />
              {segment.labelVisible && !segment.collapsed && (
                <text className="sunburst-segment-label" x={label.x} y={label.y}>
                  {label.lines.map((line, index) => (
                    <tspan key={`${segment.id}-${line}-${index}`} x={label.x} dy={index === 0 ? 0 : 13}>
                      {line}
                    </tspan>
                  ))}
                  <tspan className="sunburst-segment-percent" x={label.x} dy={13}>
                    {segment.progress}%
                  </tspan>
                </text>
              )}
            </g>
          );
        })}
      </g>

      {layout.maxDepth > 1 && (
        <g className="sunburst-depth-control" aria-label="显示层级密度">
          <path className="sunburst-depth-arc" d={SUNBURST_DEPTH_CONTROL_GEOMETRY.arcPath} aria-hidden="true" />
          <g
            className={controlState.canIncrease ? "sunburst-depth-button increase" : "sunburst-depth-button increase disabled"}
            role="button"
            tabIndex={controlState.canIncrease ? 0 : -1}
            focusable={controlState.canIncrease ? "true" : "false"}
            aria-disabled={!controlState.canIncrease}
            aria-label={`放大到第 ${controlState.increaseDepth} 层`}
            onClick={(event) => {
              event.stopPropagation();
              if (!controlState.canIncrease) return;
              changeVisibleDepth(1);
            }}
            onKeyDown={(event) => handleDepthControlKey(event, 1, !controlState.canIncrease)}
          >
            <title>{`放大到第 ${controlState.increaseDepth} 层`}</title>
            <path d={trianglePath(SUNBURST_DEPTH_CONTROL_GEOMETRY.increaseTriangle)} />
          </g>
          <g
            className={controlState.canDecrease ? "sunburst-depth-button decrease" : "sunburst-depth-button decrease disabled"}
            role="button"
            tabIndex={controlState.canDecrease ? 0 : -1}
            focusable={controlState.canDecrease ? "true" : "false"}
            aria-disabled={!controlState.canDecrease}
            aria-label={`缩小到第 ${controlState.decreaseDepth} 层`}
            onClick={(event) => {
              event.stopPropagation();
              if (!controlState.canDecrease) return;
              changeVisibleDepth(-1);
            }}
            onKeyDown={(event) => handleDepthControlKey(event, -1, !controlState.canDecrease)}
          >
            <title>{`缩小到第 ${controlState.decreaseDepth} 层`}</title>
            <path d={trianglePath(SUNBURST_DEPTH_CONTROL_GEOMETRY.decreaseTriangle)} />
          </g>
        </g>
      )}
    </svg>
  );
});

const GoalMap = React.memo(function GoalMap({
  goals,
  selectedId,
  importanceOverrides,
  progressOverrides,
  positionOverrides,
  mapContextId,
  centerId,
  centerTitle,
  centerGoal,
  emptyLabel,
  onSelect,
  onDrill,
  onAscend,
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
  centerGoal?: GoalNode | null;
  emptyLabel: string;
  onSelect: (id: string) => void;
  onDrill: (id: string) => void;
  onAscend: () => void;
  onPreviewPosition: (id: string, position: MapPosition) => void;
  onCommitPosition: (id: string, position: MapPosition) => void;
}) {
  const layouts = useMemo(
    () => buildGoalscapeLayout(goals, importanceOverrides, progressOverrides, positionOverrides, mapContextId),
    [goals, importanceOverrides, progressOverrides, positionOverrides, mapContextId]
  );
  const centerNodeId = centerId;
  const centerDisplayTitle = centerTitle;
  const centerVisualMode = goalscapeCenterVisualMode(centerNodeId, centerGoal);
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
  const centerPearlTint = useMemo(() => goalscapeCenterPearlTint(centerNodeId, centerGoal), [centerNodeId, centerGoal]);
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
  const centerGoalVisual = useMemo(() => {
    if (centerVisualMode !== "goal" || !centerGoal) return null;
    const width = goalscapeTopNodeBaseSize.width;
    const height = goalscapeTopNodeBaseSize.height;
    const color = goalscapeNodeColor(centerGoal, "#64748b");
    const progress = weightedGoalProgress(centerGoal, importanceOverrides, progressOverrides);
    const metrics = goalscapeNodeVisualMetrics({ width, height, depth: 1 });
    const label = goalscapeLabelLines(centerGoal.title, goalscapeLabelMaxChars({ width, depth: 1 }, metrics), 2);
    return {
      goal: centerGoal,
      x: goalscapeCenter.x,
      y: goalscapeCenter.y,
      width,
      height,
      variant: 0,
      color,
      progress,
      metrics,
      label,
      Icon: goalIconComponent(centerGoal),
      path: goalscapeBlobPath(goalscapeCenter.x, goalscapeCenter.y, width, height, 0),
      haloPath: goalscapeBlobPath(goalscapeCenter.x, goalscapeCenter.y, width + 20, height + 18, 0),
      rimPath: goalscapeBlobPath(goalscapeCenter.x, goalscapeCenter.y, width - 12, height - 10, 2),
      progressFill: goalscapeProgressFillGeometry(goalscapeCenter.y, height, progress)
    };
  }, [centerGoal, centerVisualMode, importanceOverrides, progressOverrides]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    pointerStart: MapPosition;
    nodeStart: MapPosition;
    current: MapPosition;
    orbit: GoalscapeOrbit;
    moved: boolean;
    frame: number | null;
  } | null>(null);
  const dragAbortRef = useRef<AbortController | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const lastNodeClickRef = useRef<{ id: string; time: number } | null>(null);
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
    const next = constrainGoalscapePositionToOrbit(
      {
        x: drag.nodeStart.x + point.x - drag.pointerStart.x,
        y: drag.nodeStart.y + point.y - drag.pointerStart.y
      },
      drag.orbit
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

  const finishDrag = useCallback((event?: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    if (drag.frame !== null) window.cancelAnimationFrame(drag.frame);
    dragRef.current = null;
    dragAbortRef.current?.abort();
    dragAbortRef.current = null;
    setDraggingId(null);
    if (drag.moved) {
      suppressClickRef.current = drag.id;
      onPreviewPosition(drag.id, drag.current);
      onCommitPosition(drag.id, drag.current);
    }
  }, [onCommitPosition, onPreviewPosition]);

  // Detach the live drag listeners on unmount. Aborting the controller held in the ref removes
  // whatever listeners the in-flight drag attached, regardless of handler identity — a []-deps
  // cleanup closing over removeEventListener(moveDrag/finishDrag) would capture the first render's
  // callbacks and silently fail to remove the ones a later render actually attached.
  useEffect(() => () => {
    const drag = dragRef.current;
    if (drag && drag.frame !== null) window.cancelAnimationFrame(drag.frame);
    dragAbortRef.current?.abort();
  }, []);

  const startNodeDrag = useCallback((event: React.PointerEvent<SVGGElement>, layout: GoalscapeNodeLayout) => {
    if (event.button !== 0) return;
    const pointerStart = pointFromPointer(event);
    if (!pointerStart) return;
    event.preventDefault();
    event.stopPropagation();
    // Clear stale suppression so the next click after a pointercancel-ended drag isn't swallowed.
    suppressClickRef.current = null;
    dragRef.current = {
      id: layout.node.id,
      pointerId: event.pointerId,
      pointerStart,
      nodeStart: { x: layout.x, y: layout.y },
      current: { x: layout.x, y: layout.y },
      orbit: goalscapeOrbitForDepth(layout.depth, layout.visibleDepth),
      moved: false,
      frame: null
    };
    setDraggingId(layout.node.id);
    const controller = new AbortController();
    dragAbortRef.current = controller;
    window.addEventListener("pointermove", moveDrag, { signal: controller.signal });
    window.addEventListener("pointerup", finishDrag, { signal: controller.signal });
    window.addEventListener("pointercancel", finishDrag, { signal: controller.signal });
  }, [finishDrag, moveDrag, pointFromPointer]);

  const selectOnKey = useCallback((event: React.KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      onDrill(id);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  }, [onDrill, onSelect]);

  const centerGroupClassName = centerGoalVisual
    ? `goalscape-center goalscape-center-goal goalscape-node depth-1${selectedId === centerNodeId ? " active" : ""}`
    : selectedId === centerNodeId
      ? "goalscape-center active"
      : "goalscape-center";
  const centerGroupStyle = centerGoalVisual
    ? ({
        "--center-glow": centerPearlTint.glow,
        "--node-color": centerGoalVisual.color,
        "--node-icon-size": `${centerGoalVisual.metrics.iconSize}px`,
        "--node-icon-glyph-size": `${centerGoalVisual.metrics.iconGlyphSize}px`,
        "--node-title-size": `${centerGoalVisual.metrics.titleSize}px`,
        "--node-depth-scale": 1
      } as React.CSSProperties & {
        "--center-glow": string;
        "--node-color": string;
        "--node-icon-size": string;
        "--node-icon-glyph-size": string;
        "--node-title-size": string;
        "--node-depth-scale": number;
      })
    : ({ "--center-glow": centerPearlTint.glow } as React.CSSProperties & { "--center-glow": string });
  const CenterGoalIcon = centerGoalVisual?.Icon ?? Network;

  return (
    <svg
      ref={svgRef}
      className={`goal-map goalscape-map${centerVisualMode === "goal" ? " focused" : ""}${layouts.length > 20 ? " dense" : ""}`}
      viewBox="0 0 1200 760"
      role="img"
      aria-labelledby="map-title map-desc"
      onClick={() => onSelect(centerId)}
    >
      <title id="map-title">{centerDisplayTitle}目标地图</title>
      <desc id="map-desc">Pearl goals are arranged on concentric orbital paths. Selecting a goal highlights it in place.</desc>
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
        {centerGoalVisual && (
          <React.Fragment key="goalscape-center-goal-defs">
            <clipPath id="goalscape-center-goal-clip">
              <path d={centerGoalVisual.path} />
            </clipPath>
            <linearGradient id="goalscape-center-goal-bottle" x1="18%" y1="5%" x2="86%" y2="96%">
              <stop offset="0%" stopColor="rgba(255, 255, 255, 0.96)" />
              <stop offset="52%" stopColor={blend(centerGoalVisual.color, "#ffffff", 0.88)} />
              <stop offset="100%" stopColor={blend(centerGoalVisual.color, "#ffffff", 0.72)} />
            </linearGradient>
            <linearGradient id="goalscape-center-goal-liquid" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={blend(centerGoalVisual.color, "#ffffff", 0.38)} />
              <stop offset="58%" stopColor={centerGoalVisual.color} />
              <stop offset="100%" stopColor={blend(centerGoalVisual.color, "#12233e", 0.18)} />
            </linearGradient>
          </React.Fragment>
        )}
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
        className={centerGroupClassName}
        role="button"
        tabIndex={0}
        focusable="true"
        style={centerGroupStyle}
        onClick={(event) => {
          event.stopPropagation();
          onAscend();
          onSelect(centerId);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onAscend();
          onSelect(centerId);
        }}
        aria-label={selectedId !== centerId ? `${centerDisplayTitle}，点击返回地图中心` : centerDisplayTitle}
      >
        {centerGoalVisual ? (
          // SYNC: this focused-center body mirrors the per-node renderer below (search
          // "goalscape-node-visual"). They intentionally duplicate the shape/liquid/core/rim/
          // icon/title visuals — change one and you must mirror it in the other, or the center
          // silently drifts from the map nodes. (Dedupe into a shared component is a follow-up.)
          <g className="goalscape-node-visual goalscape-center-goal-visual">
            <path className="goalscape-node-halo" d={centerGoalVisual.haloPath} />
            <path
              className="goalscape-node-shape"
              d={centerGoalVisual.path}
              fill="url(#goalscape-center-goal-bottle)"
              fillOpacity={goalscapeNodeDensity(centerGoalVisual.progress)}
              strokeOpacity={0.4 + 0.6 * (centerGoalVisual.progress / 100)}
            />
            <rect
              className="goalscape-node-progress-fill"
              x={centerGoalVisual.x - centerGoalVisual.width / 2 - 4}
              y={centerGoalVisual.progressFill.y}
              width={centerGoalVisual.width + 8}
              height={centerGoalVisual.progressFill.height}
              clipPath="url(#goalscape-center-goal-clip)"
              fill="url(#goalscape-center-goal-liquid)"
              opacity={0.18 + 0.38 * (centerGoalVisual.progress / 100)}
            />
            {centerGoalVisual.progress > 0 && centerGoalVisual.progress < 100 && (
              <line
                className="goalscape-node-progress-surface"
                x1={centerGoalVisual.x - centerGoalVisual.width * 0.34}
                x2={centerGoalVisual.x + centerGoalVisual.width * 0.34}
                y1={centerGoalVisual.progressFill.surfaceY}
                y2={centerGoalVisual.progressFill.surfaceY}
                clipPath="url(#goalscape-center-goal-clip)"
              />
            )}
            <circle
              cx={centerGoalVisual.x}
              cy={centerGoalVisual.y}
              r={goalscapeStarlightCoreRadius(centerGoalVisual.metrics.coreRadius, centerGoalVisual.progress)}
              className="goal-starlight-core"
              fill={centerGoalVisual.color}
              filter={`url(#goalscape-glow-level-${Math.min(5, Math.floor(centerGoalVisual.progress / 20))})`}
            />
            {centerGoalVisual.progress === 100 && (
              <>
                <ellipse
                  cx={centerGoalVisual.x}
                  cy={centerGoalVisual.y}
                  rx={centerGoalVisual.width * 0.72}
                  ry={centerGoalVisual.height * 0.28}
                  transform={`rotate(-15 ${centerGoalVisual.x} ${centerGoalVisual.y})`}
                  className="goal-saturn-ring"
                />
                <path
                  d={`M ${centerGoalVisual.x} ${centerGoalVisual.y - 12} Q ${centerGoalVisual.x} ${centerGoalVisual.y} ${centerGoalVisual.x + 12} ${centerGoalVisual.y} Q ${centerGoalVisual.x} ${centerGoalVisual.y} ${centerGoalVisual.x} ${centerGoalVisual.y + 12} Q ${centerGoalVisual.x} ${centerGoalVisual.y} ${centerGoalVisual.x - 12} ${centerGoalVisual.y} Q ${centerGoalVisual.x} ${centerGoalVisual.y} ${centerGoalVisual.x} ${centerGoalVisual.y - 12} Z`}
                  className="goal-supernova-sparkle"
                />
              </>
            )}
            <path className="goalscape-node-glass" d={centerGoalVisual.path} />
            <path
              className="goalscape-node-rim"
              d={centerGoalVisual.rimPath}
              strokeOpacity={0.4 + 0.5 * (centerGoalVisual.progress / 100)}
            />
            <foreignObject
              x={centerGoalVisual.x - centerGoalVisual.metrics.iconSize / 2}
              y={centerGoalVisual.y - centerGoalVisual.metrics.iconY}
              width={centerGoalVisual.metrics.iconSize}
              height={centerGoalVisual.metrics.iconSize}
              className="goalscape-icon-object"
            >
              <div className="goalscape-icon-wrap">
                <CenterGoalIcon className="goalscape-node-icon" aria-hidden="true" />
              </div>
            </foreignObject>
            <text
              className="goalscape-node-title domain"
              x={centerGoalVisual.x}
              y={centerGoalVisual.y + centerGoalVisual.metrics.titleY}
            >
              {centerGoalVisual.label.map((line, lineIndex) => (
                <tspan key={line + lineIndex} x={centerGoalVisual.x} dy={lineIndex === 0 ? 0 : centerGoalVisual.metrics.titleLineGap}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        ) : (
          <>
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
          </>
        )}
      </g>

      {visibleLayouts.map((layout, index) => {
        const active = selectedId === layout.node.id;
        const depthTone = layout.perspectiveScale >= 0.98 ? " front" : layout.opacity <= 0.58 ? " back" : "";
        const Icon = goalIconComponent(layout.node);
        const visualMetrics = goalscapeNodeVisualMetrics(layout);
        const label = goalscapeLabelLines(layout.node.title, goalscapeLabelMaxChars(layout, visualMetrics), 2);
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
            className={`goalscape-node depth-${layout.depth}${depthTone}${active ? " active" : ""}${draggingId === layout.node.id ? " dragging" : ""}`}
            role="button"
            tabIndex={0}
            focusable="true"
            aria-label={`${layout.node.title}，进度 ${layout.progress}%${childCount ? `，折叠 ${childCount} 个后代` : ""}`}
              style={
                {
                  "--node-color": layout.color,
                  "--node-icon-size": `${visualMetrics.iconSize}px`,
                  "--node-icon-glyph-size": `${visualMetrics.iconGlyphSize}px`,
                  "--node-title-size": `${visualMetrics.titleSize}px`,
                  "--node-depth-scale": layout.perspectiveScale,
                  opacity: layout.opacity
                } as React.CSSProperties & {
                  "--node-color": string;
                  "--node-icon-size": string;
                  "--node-icon-glyph-size": string;
                  "--node-title-size": string;
                  "--node-depth-scale": number;
                }
              }
            onPointerDown={(event) => startNodeDrag(event, layout)}
            onClick={(event) => {
              if (suppressClickRef.current === layout.node.id) {
                suppressClickRef.current = null;
                lastNodeClickRef.current = null;
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              event.stopPropagation();
              const now = window.performance.now();
              const lastClick = lastNodeClickRef.current;
              // Single source of truth for drill: a second click on the same node within
              // 360ms drills in, a single click selects. (Replaces the old onDoubleClick,
              // which fired onDrill a second time.) Reset after drill so a 3rd click can't re-fire.
              if (lastClick?.id === layout.node.id && now - lastClick.time <= 360) {
                lastNodeClickRef.current = null;
                onDrill(layout.node.id);
                return;
              }
              lastNodeClickRef.current = { id: layout.node.id, time: now };
              onSelect(layout.node.id);
            }}
            onKeyDown={(event) => selectOnKey(event, layout.node.id)}
          >
            {/* Inner group with isolated floating animation delay */}
            {/* SYNC: this node-visual body mirrors the focused-center renderer above
                (centerGoalVisual). Keep the shared shape/liquid/core/rim/icon/title visuals in
                step across both, or the center node drifts from the map nodes. */}
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
                opacity={0.18 + 0.38 * (layout.progress / 100)}
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
  onDraftChange
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

        <section className="detail-section">
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

      <section className="detail-section subgoal-section">
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
  const primaryGoal = isPrimaryGoalNode(goal);
  const progressEditable = !primaryGoal && goal.children.length === 0;

  useEffect(() => {
    setDraft(initialDraft);
    onDraftChange(goal, initialDraft, Boolean(cachedDraft));
  }, [cachedDraft, goal, initialDraft, onDraftChange]);

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

      <section className="editor-section notes-actions-drawer">
        <div className="drawer-head">
          <h3>{primaryGoal ? "备注" : "备注与行动"}</h3>
        </div>
        <div className="notes-actions-content">
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
