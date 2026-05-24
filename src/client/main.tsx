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
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Star,
  Trash2,
  User,
  Users,
  X
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  GoalActionCandidate,
  GoalCreateInput,
  GoalNode,
  GoalPatchInput,
  GoalsResponse,
  GoalStatus
} from "../shared/types";
import { isPrimaryGoalNode, isPrimaryGoalTitle, normalizedGoalTitle } from "../shared/goalRules";
import "./styles.css";

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

function normalizeHexColor(value: string | undefined) {
  const raw = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : "";
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
  return Array.from(domains);
}

function averageProgress(goals: GoalNode[]) {
  const measurable = goals.filter((goal) => !isPrimaryGoalNode(goal));
  if (measurable.length === 0) return 0;
  const total = measurable.reduce((sum, goal) => sum + progressValue(goal), 0);
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
  if (normalized.includes("职业")) return "#1187a2";
  if (normalized.includes("个人") || normalized.includes("成长")) return "#7958c8";
  if (normalized.includes("幸福") || normalized.includes("生活")) return "#45945c";
  return "#687385";
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

function labelLines(title: string, depth: number, angleSpan: number, radius: number) {
  const fontSize = depth === 1 ? 17 : depth === 2 ? 12 : 10;
  const arcLength = (Math.max(1, angleSpan) * Math.PI * radius) / 180;
  const maxChars = clamp(Math.floor(arcLength / (fontSize * 0.92)), depth === 1 ? 3 : 2, depth === 1 ? 7 : 6);
  const maxLines = depth === 1 ? 2 : 2;
  const chars = Array.from(title.replace(/\s+/g, ""));
  if (chars.length <= maxChars) return [title];

  const result: string[] = [];
  for (let index = 0; index < chars.length && result.length < maxLines; index += maxChars) {
    result.push(chars.slice(index, index + maxChars).join(""));
  }
  if (chars.length > maxChars * maxLines) {
    const last = result[result.length - 1] || "";
    result[result.length - 1] = `${Array.from(last).slice(0, Math.max(1, maxChars - 1)).join("")}…`;
  }
  return result;
}

function GoalApp() {
  const [goals, setGoals] = useState<GoalsResponse>(emptyGoals);
  const [selectedId, setSelectedId] = useState("root");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [importancePreview, setImportancePreview] = useState<ImportanceOverrides>({});
  const [progressPreview, setProgressPreview] = useState<ProgressOverrides>({});
  const [focusId, setFocusId] = useState("root");
  const [scopeListCollapsed, setScopeListCollapsed] = useState(true);
  const [deleteCandidate, setDeleteCandidate] = useState<GoalNode | null>(null);
  const [detailWidth, setDetailWidth] = useState(500);
  const [mapPaneHeight, setMapPaneHeight] = useState(520);
  const [stackedLayout, setStackedLayout] = useState(() => window.matchMedia("(max-width: 1120px)").matches);
  const [resizingPanelAxis, setResizingPanelAxis] = useState<"width" | "height" | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const mapPaneRef = useRef<HTMLElement | null>(null);
  const pendingEditRef = useRef<PendingEdit | null>(null);
  const pendingSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draftCacheRef = useRef<DraftCache>({});

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

    const events = new EventSource("/api/events");
    events.onmessage = () => {
      void reload().catch(() => undefined);
    };
    events.onerror = () => {
      setError("实时同步连接中断，仍可手动刷新。");
    };
    return () => events.close();
  }, [reload]);

  const visibleTree = useMemo(() => filterGoalTree(goals.goals, false), [goals.goals]);
  const visibleFlatGoals = useMemo(() => flattenGoals(visibleTree), [visibleTree]);
  const selectedGoal = useMemo(
    () => visibleFlatGoals.find((goal) => goal.id === selectedId),
    [selectedId, visibleFlatGoals]
  );
  const selectedGoalFull = useMemo(() => goals.flatGoals.find((goal) => goal.id === selectedId), [goals.flatGoals, selectedId]);
  const selectedParent = useMemo(() => parentGoal(goals.goals, selectedId), [goals.goals, selectedId]);
  const focusGoal = useMemo(() => (focusId === "root" ? undefined : findGoalById(visibleTree, focusId)), [focusId, visibleTree]);
  const focusParentId = useMemo(() => parentMapFocusId(visibleTree, focusId), [focusId, visibleTree]);
  const mapGoals = useMemo(() => (focusGoal ? focusGoal.children || [] : visibleTree), [focusGoal, visibleTree]);
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
      if (!primaryGoal) {
        patch.clarity = Math.max(1, Math.ceil(Number(draft.progress) / 20));
        patch.progress = Number(draft.progress);
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
    if (!pending) return;

    pendingEditRef.current = null;
    pendingSaveQueueRef.current = pendingSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const saved = await saveGoal(pending.goal, pending.draft, { selectAfterSave: false });
        if (!saved && !pendingEditRef.current) {
          pendingEditRef.current = pending;
        }
      });
  }, [saveGoal]);

  const selectGoal = useCallback((id: string) => {
    if (id === selectedId) return;
    queuePendingEditSave();
    setSelectedId(id);
  }, [queuePendingEditSave, selectedId]);

  const createGoal = async (input: GoalCreateInput) => {
    await runWrite(async () => {
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
      const created = next.flatGoals.find((goal) => goal.title === input.title.trim());
      setSelectedId(created?.id || "root");
      return next;
    }, "目标已创建");
  };

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

  const createQuickGoal = async (mode: "subgoal" | "sibling") => {
    const parent = mode === "subgoal" ? selectedGoalFull : selectedParent;
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
  };

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
        <button type="button" className="icon-button header-refresh" title="刷新目标" aria-label="刷新目标" onClick={() => void reload()} disabled={loading || saving}>
          <RefreshCw />
        </button>
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
            onAddSubgoal={() => void createQuickGoal("subgoal")}
            onAddSibling={() => void createQuickGoal("sibling")}
            onRename={() => void renameSelectedGoal()}
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
              centerId={focusGoal?.id || "root"}
              centerTitle={focusGoal?.title || "目标网络"}
              emptyLabel={focusGoal ? "这个目标还没有子目标" : "暂无可显示目标"}
              onSelect={selectGoal}
              onOpenMap={changeMapFocus}
              onOpenParentMap={focusGoal ? openParentMap : undefined}
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
          onSelect={selectGoal}
          onSave={saveGoal}
          onPreviewImportance={previewImportance}
          onPreviewProgress={previewProgress}
          onDraftChange={registerPendingEdit}
        />
      </main>
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
  onAddSubgoal,
  onAddSibling,
  onRename,
  onDelete
}: {
  selectedGoal: GoalNode | undefined;
  saving: boolean;
  onAddSubgoal: () => void;
  onAddSibling: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const disabled = saving || !selectedGoal;

  return (
    <div className="map-actions">
      <button type="button" className="icon-button" title="添加子目标" aria-label="添加子目标" disabled={saving} onClick={onAddSubgoal}>
        <ListPlus />
      </button>
      <button type="button" className="icon-button" title="添加同级目标" aria-label="添加同级目标" disabled={saving} onClick={onAddSibling}>
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

export const goalscapeCenter = { x: 560, y: 410, width: 142, height: 120 };

const goalscapeViewBox = { width: 1200, height: 760 };

const goalscapeSlotStyles: Record<GoalscapeSlotKey, Pick<GoalscapeSlot, "width" | "height" | "color">> = {
  life: { width: 210, height: 150, color: "#4fbf83" },
  growth: { width: 236, height: 166, color: "#7958c8" },
  career: { width: 216, height: 130, color: "#1187a2" },
  extra: { width: 184, height: 122, color: "#687385" }
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
  const visibleChildren = Math.max(1, Math.min(4, totalChildren));
  const index = clamp(childIndex, 0, visibleChildren - 1);
  const spread = visibleChildren === 1 ? 0 : visibleChildren === 2 ? 72 : visibleChildren === 3 ? 116 : 138;
  const step = visibleChildren <= 1 ? 0 : spread / (visibleChildren - 1);
  const angle = goalscapeSlotAngle(slot) - spread / 2 + step * index;
  const radius = visibleChildren >= 4 ? 190 : visibleChildren === 3 ? 184 : 176;
  const radians = (angle * Math.PI) / 180;
  const x = slot.x + Math.cos(radians) * radius;
  const y = slot.y + Math.sin(radians) * radius;
  const safeX = clamp(x, 96, goalscapeViewBox.width - 96);
  const safeY = clamp(y, 78, goalscapeViewBox.height - 78);
  return { x: safeX - slot.x, y: safeY - slot.y };
}

function goalProgress(goal: GoalNode, progressOverrides: ProgressOverrides) {
  return goal.id in progressOverrides ? clamp(Number(progressOverrides[goal.id]), 0, 100) : progressValue(goal);
}

function goalscapeNodeColor(goal: GoalNode, fallback: string) {
  return normalizeHexColor(goal.color) || domainBaseColor(goal.domain || goal.title) || fallback;
}

function buildGoalscapeLayout(
  goals: GoalNode[],
  importanceOverrides: ImportanceOverrides,
  progressOverrides: ProgressOverrides
) {
  const topImportance = normalizedImportance(goals, importanceOverrides);
  const slots = assignGoalscapeSlots(goals);
  const layouts: GoalscapeNodeLayout[] = [];

  goals.forEach((goal, index) => {
    const slot = slots.get(goal.id) || fallbackGoalscapeSlot(index, goals.length);
    const color = goalscapeNodeColor(goal, slot.color);
    const importance = topImportance[goal.id] ?? 0;
    layouts.push({
      node: goal,
      parentId: "root",
      depth: 1,
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
      color,
      progress: goalProgress(goal, progressOverrides),
      importance,
      slotKey: slot.key,
      variant: index
    });

    const children = goal.children.slice(0, 4);
    const childImportance = normalizedImportance(children, importanceOverrides);
    children.forEach((child, childIndex) => {
      const offset = goalscapeChildOffset(slot, childIndex, children.length);
      const childColor = goalscapeNodeColor(child, color);
      layouts.push({
        node: child,
        parentId: goal.id,
        depth: 2,
        x: slot.x + offset.x,
        y: slot.y + offset.y,
        width: childIndex === 0 && slot.key === "growth" ? 154 : 128,
        height: childIndex === 0 && slot.key === "growth" ? 98 : 82,
        color: childColor,
        progress: goalProgress(child, progressOverrides),
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

export function goalscapeLiquidGeometry(x: number, y: number, width: number, height: number, progress: number) {
  const fillRatio = clamp(progress, 0, 100) / 100;
  const overfill = Math.max(8, height * 0.08);
  const bottomY = y + height * 0.58;
  const fullHeight = height + overfill * 2;
  return {
    fillRatio,
    leftX: x - width * 0.58,
    rightX: x + width * 0.58,
    surfaceY: bottomY - fullHeight * fillRatio,
    bottomY
  };
}

function goalscapeLiquidWavePath(x: number, y: number, width: number, height: number, progress: number, variant: number) {
  const geometry = goalscapeLiquidGeometry(x, y, width, height, progress);
  if (geometry.fillRatio <= 0) return "";

  const liquidHeight = geometry.bottomY - geometry.surfaceY;
  const amplitude = Math.min(clamp(height * 0.05, 3, 7), Math.max(1.2, liquidHeight * 0.22));
  const phase = ((variant % 4) - 1.5) * 0.75;
  const span = geometry.rightX - geometry.leftX;

  return [
    `M ${geometry.leftX.toFixed(1)} ${(geometry.surfaceY + phase).toFixed(1)}`,
    `C ${(geometry.leftX + span * 0.22).toFixed(1)} ${(geometry.surfaceY - amplitude).toFixed(1)} ${(geometry.leftX + span * 0.36).toFixed(1)} ${(geometry.surfaceY + amplitude).toFixed(1)} ${(geometry.leftX + span * 0.52).toFixed(1)} ${(geometry.surfaceY + phase * 0.2).toFixed(1)}`,
    `C ${(geometry.leftX + span * 0.68).toFixed(1)} ${(geometry.surfaceY - amplitude * 0.75).toFixed(1)} ${(geometry.leftX + span * 0.84).toFixed(1)} ${(geometry.surfaceY + amplitude * 0.55).toFixed(1)} ${geometry.rightX.toFixed(1)} ${geometry.surfaceY.toFixed(1)}`
  ].join(" ");
}

function goalscapeLiquidPath(x: number, y: number, width: number, height: number, progress: number, variant: number) {
  const geometry = goalscapeLiquidGeometry(x, y, width, height, progress);
  const wave = goalscapeLiquidWavePath(x, y, width, height, progress, variant);
  if (!wave) return "";

  return [
    wave,
    `L ${geometry.rightX.toFixed(1)} ${geometry.bottomY.toFixed(1)}`,
    `L ${geometry.leftX.toFixed(1)} ${geometry.bottomY.toFixed(1)}`,
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

const GoalMap = React.memo(function GoalMap({
  goals,
  selectedId,
  importanceOverrides,
  progressOverrides,
  centerId,
  centerTitle,
  emptyLabel,
  onSelect,
  onOpenMap,
  onOpenParentMap
}: {
  goals: GoalNode[];
  selectedId: string;
  importanceOverrides: ImportanceOverrides;
  progressOverrides: ProgressOverrides;
  centerId: string;
  centerTitle: string;
  emptyLabel: string;
  onSelect: (id: string) => void;
  onOpenMap: (id: string) => void;
  onOpenParentMap?: () => void;
}) {
  const layouts = useMemo(
    () => buildGoalscapeLayout(goals, importanceOverrides, progressOverrides),
    [goals, importanceOverrides, progressOverrides]
  );
  const family = useMemo(() => selectedFamily(goals, selectedId), [goals, selectedId]);
  const topLayouts = useMemo(() => layouts.filter((item) => item.depth === 1), [layouts]);
  const childLayouts = useMemo(() => layouts.filter((item) => item.depth === 2), [layouts]);
  const topLayoutById = useMemo(() => new Map(topLayouts.map((item) => [item.node.id, item])), [topLayouts]);
  const visibleLayouts = useMemo(() => [...topLayouts, ...childLayouts], [topLayouts, childLayouts]);

  const selectOnKey = useCallback((event: React.KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  }, [onSelect]);

  return (
    <svg className="goal-map goalscape-map" viewBox="0 0 1200 760" role="img" aria-labelledby="map-title map-desc">
      <title id="map-title">{centerTitle}目标地图</title>
      <desc id="map-desc">用发光岛屿节点展示目标层级，并用连接线表达目标关系。</desc>
      <defs>
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
          <path key={`center-${layout.node.id}`} d={goalscapeConnectionPath(goalscapeCenter, layout)} />
        ))}
        {childLayouts.map((layout) => {
          const parent = topLayoutById.get(layout.parentId);
          return parent ? <path key={`child-${layout.node.id}`} d={goalscapeConnectionPath(parent, layout)} /> : null;
        })}
      </g>

      <g className="goalscape-connection-points" aria-hidden="true">
        {visibleLayouts.map((layout) => (
          <circle key={`point-${layout.node.id}`} cx={layout.x} cy={layout.y} r={layout.depth === 1 ? 5.5 : 4.2} />
        ))}
      </g>

      <g
        className={selectedId === centerId ? "goalscape-center active" : "goalscape-center"}
        role="button"
        tabIndex={0}
        focusable="true"
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
        <circle className="goalscape-center-halo" cx={goalscapeCenter.x} cy={goalscapeCenter.y} r="92" />
        <path
          className="goalscape-center-core"
          d={goalscapeBlobPath(goalscapeCenter.x, goalscapeCenter.y, goalscapeCenter.width, goalscapeCenter.height, 2)}
        />
        <text className="goalscape-center-title" x={goalscapeCenter.x} y={goalscapeCenter.y + 6}>
          {centerTitle}
        </text>
      </g>

      {layouts.map((layout, index) => {
        const active = selectedId === layout.node.id;
        const related = !family || family.has(layout.node.id);
        const opensSubmap = layout.depth === 1;
        const Icon = goalIconComponent(layout.node);
        const label = goalscapeLabelLines(layout.node.title, layout.depth === 1 ? 6 : 7, layout.depth === 1 ? 2 : 2);
        const clipId = `goalscape-node-clip-${index}`;
        const bottleGradientId = `goalscape-bottle-gradient-${index}`;
        const liquidGradientId = `goalscape-liquid-gradient-${index}`;
        const nodePath = goalscapeBlobPath(layout.x, layout.y, layout.width, layout.height, layout.variant);
        const liquidPath = goalscapeLiquidPath(layout.x, layout.y, layout.width, layout.height, layout.progress, layout.variant);
        const surfacePath = goalscapeLiquidWavePath(layout.x, layout.y, layout.width, layout.height, layout.progress, layout.variant);
        return (
          <g
            key={layout.node.id}
            className={`goalscape-node depth-${layout.depth}${active ? " active" : ""}${related ? "" : " dim"}`}
            role="button"
            tabIndex={0}
            focusable="true"
            aria-label={`${layout.node.title}，进度 ${layout.progress}%${opensSubmap ? "，双击打开目标地图" : ""}`}
            style={{ "--node-color": layout.color } as React.CSSProperties & { "--node-color": string }}
            onClick={() => onSelect(layout.node.id)}
            onDoubleClick={(event) => {
              if (!opensSubmap) return;
              event.preventDefault();
              event.stopPropagation();
              onOpenMap(layout.node.id);
            }}
            onKeyDown={(event) => selectOnKey(event, layout.node.id)}
          >
            <path className="goalscape-node-halo" d={goalscapeBlobPath(layout.x, layout.y, layout.width + 20, layout.height + 18, layout.variant)} />
            <path
              className="goalscape-node-shape"
              d={nodePath}
              fill={`url(#${bottleGradientId})`}
            />
            {liquidPath && (
              <path
                className="goalscape-node-liquid"
                d={liquidPath}
                fill={`url(#${liquidGradientId})`}
                clipPath={`url(#${clipId})`}
              />
            )}
            {surfacePath && (
              <path
                className="goalscape-node-liquid-surface"
                d={surfacePath}
                clipPath={`url(#${clipId})`}
              />
            )}
            <path className="goalscape-node-glass" d={nodePath} />
            <path
              className="goalscape-node-rim"
              d={goalscapeBlobPath(layout.x, layout.y, layout.width - 12, layout.height - 10, layout.variant + 2)}
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
  onSelect,
  onSave,
  onPreviewImportance,
  onPreviewProgress,
  onDraftChange
}: {
  selectedGoal: GoalNode | undefined;
  cachedDraft?: EditDraft;
  topGoals: GoalNode[];
  flatGoals: GoalNode[];
  domains: string[];
  saving: boolean;
  onSelect: (id: string) => void;
  onSave: (goal: GoalNode, draft: EditDraft) => Promise<boolean>;
  onPreviewImportance: (goalId: string, value: number) => void;
  onPreviewProgress: (goalId: string, value: number) => void;
  onDraftChange: (goal: GoalNode, draft: EditDraft, dirty: boolean) => void;
}) {
  const rootImportance = useMemo(() => normalizedImportance(topGoals), [topGoals]);
  const rootProgressAverage = useMemo(() => averageProgress(flatGoals), [flatGoals]);
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
          {progressValue(selectedGoal)}%
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
        {!primaryGoal && (
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
    progress: progressValue(goal),
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

function CreateGoalForm({
  parent,
  domains,
  saving,
  onCreate,
  onDone
}: {
  parent: GoalNode | undefined;
  domains: string[];
  saving: boolean;
  onCreate: (input: GoalCreateInput) => Promise<void>;
  onDone: () => void;
}) {
  const parentTitle = parent?.title || "";
  const inheritedDomain = titleFromLink(parent?.domain) || domains[0] || "";
  const [draft, setDraft] = useState<GoalCreateInput>({
    title: "",
    domain: inheritedDomain,
    parent: parentTitle,
    horizon: "medium",
    priority: 3,
    clarity: 1,
    summary: ""
  });

  useEffect(() => {
    setDraft({
      title: "",
      domain: inheritedDomain,
      parent: parentTitle,
      horizon: "medium",
      priority: 3,
      clarity: 1,
      summary: ""
    });
  }, [inheritedDomain, parentTitle]);

  return (
    <form
      className="create-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onCreate({
          ...draft,
          title: draft.title.trim(),
          priority: Number(draft.priority),
          clarity: Number(draft.clarity)
        }).then(onDone);
      }}
    >
      <div className="form-grid two">
        <label>
          名称
          <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        </label>
        <label>
          周期
          <input value={draft.horizon} onChange={(event) => setDraft({ ...draft, horizon: event.target.value })} />
        </label>
      </div>
      <div className="form-grid two">
        <label>
          目标域
          <select value={draft.domain} onChange={(event) => setDraft({ ...draft, domain: event.target.value })}>
            {(domains.includes(draft.domain) ? domains : [draft.domain, ...domains].filter(Boolean)).map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
        </label>
        <RangeField label="优先级" value={Number(draft.priority) || 3} onChange={(value) => setDraft({ ...draft, priority: value })} />
      </div>
      <RangeField label="清晰度" value={Number(draft.clarity) || 1} onChange={(value) => setDraft({ ...draft, clarity: value })} />
      <label>
        目标定义
        <textarea rows={3} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
      </label>
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onDone}>
          <X />
          取消
        </button>
        <button type="submit" className="primary-button" disabled={saving || !draft.title?.trim() || !draft.domain}>
          {saving ? <Loader2 className="spin" /> : <Plus />}
          创建
        </button>
      </div>
    </form>
  );
}

if (typeof document !== "undefined") {
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<GoalApp />);
}
