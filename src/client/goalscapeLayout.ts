import {
  BookOpen,
  Briefcase,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Heart,
  Home,
  Leaf,
  Monitor,
  Network,
  Star,
  User,
  Users
} from "lucide-react";
import type { GoalNode } from "../shared/types";
import {
  blend,
  clamp,
  domainBaseColor,
  hasOwn,
  normalizeHexColor,
  normalizedImportance,
  titleFromLink,
  weightedGoalProgress,
  type ImportanceOverrides,
  type ProgressOverrides
} from "./goalUtils";

export type MapPosition = { x: number; y: number };
export type MapPositionOverrides = Record<string, MapPosition>;
export type MapPositionPreviewOverrides = Record<string, MapPositionOverrides>;

export type GoalscapeNodeLayout = {
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
  angle: number;
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

export function hasMapPositionOverride(overrides: MapPositionOverrides, goalId: string) {
  return hasOwn(overrides, goalId);
}

export function goalMapPosition(goal: GoalNode, fallback: MapPosition, overrides: MapPositionOverrides, mapContextId: string) {
  return hasMapPositionOverride(overrides, goal.id)
    ? clampGoalscapePosition(overrides[goal.id])
    : savedGoalMapPosition(goal, mapContextId) ?? fallback;
}

export function goalHasMapPosition(goal: GoalNode | undefined, mapContextId: string, position: MapPosition) {
  const saved = goal ? savedGoalMapPosition(goal, mapContextId) : undefined;
  const expected = clampGoalscapePosition(position);
  return Boolean(saved && saved.x === expected.x && saved.y === expected.y);
}

export function mapPositionPreviewForContext(previews: MapPositionPreviewOverrides, mapContextId: string): MapPositionOverrides {
  return previews[mapContextId] ?? {};
}

export function withMapPositionPreview(
  previews: MapPositionPreviewOverrides,
  mapContextId: string,
  goalId: string,
  position: MapPosition
): MapPositionPreviewOverrides {
  return {
    ...previews,
    [mapContextId]: {
      ...(previews[mapContextId] ?? {}),
      [goalId]: clampGoalscapePosition(position)
    }
  };
}

export function withoutMapPositionPreview(
  previews: MapPositionPreviewOverrides,
  mapContextId: string,
  goalId: string
): MapPositionPreviewOverrides {
  const contextPreviews = previews[mapContextId];
  if (!contextPreviews || !hasOwn(contextPreviews, goalId)) return previews;
  const nextContextPreviews = { ...contextPreviews };
  delete nextContextPreviews[goalId];
  const next = { ...previews };
  if (Object.keys(nextContextPreviews).length === 0) delete next[mapContextId];
  else next[mapContextId] = nextContextPreviews;
  return next;
}

export function pruneSavedMapPositionPreviews(
  previews: MapPositionPreviewOverrides,
  flatGoals: GoalNode[]
): MapPositionPreviewOverrides {
  const goalsById = new Map(flatGoals.map((goal) => [goal.id, goal]));
  let changed = false;
  const next: MapPositionPreviewOverrides = {};

  for (const [mapContextId, contextPreviews] of Object.entries(previews)) {
    const nextContextPreviews = { ...contextPreviews };
    let contextChanged = false;

    for (const [goalId, position] of Object.entries(contextPreviews)) {
      if (goalHasMapPosition(goalsById.get(goalId), mapContextId, position)) {
        delete nextContextPreviews[goalId];
        changed = true;
        contextChanged = true;
      }
    }

    if (Object.keys(nextContextPreviews).length > 0) {
      next[mapContextId] = contextChanged ? nextContextPreviews : contextPreviews;
    }
  }

  return changed ? next : previews;
}

export function hasCustomMapPosition(goal: GoalNode | undefined, mapContextId: string) {
  return Boolean(goal && savedGoalMapPosition(goal, mapContextId));
}

export function goalscapeOrbitForDepth(depth: number, visibleDepth = 2): GoalscapeOrbit {
  const safeDepth = Math.max(1, Math.round(depth));
  const safeVisibleDepth = Math.max(1, Math.round(visibleDepth));
  const inner = { rx: 174, ry: 174 };
  const edge = { rx: 300, ry: 300 };
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

export function goalscapeChildNodeSize(
  parentSize: Pick<GoalscapeNodeLayout, "width" | "height">,
  childIndex: number,
  depth = 2,
  densityScale = 1,
  focusScale = 1
) {
  const depthScale = clamp(0.76 - Math.max(0, depth - 2) * 0.08, 0.52, 0.76);
  const siblingTaper = 1 - Math.min(childIndex, 5) * 0.02;
  const scale = clamp(depthScale * siblingTaper * densityScale * focusScale, 0.4, 1);
  const minWidth = depth === 1 ? 84 : depth === 2 ? 64 : depth === 3 ? 50 : 44;
  const minHeight = depth === 1 ? 68 : depth === 2 ? 50 : depth === 3 ? 40 : 34;
  return {
    width: Math.round(clamp(parentSize.width * scale, minWidth, parentSize.width)),
    height: Math.round(clamp(parentSize.height * scale, minHeight, parentSize.height))
  };
}

export function goalscapeNodeVisualMetrics(layout: Pick<GoalscapeNodeLayout, "width" | "height" | "depth">) {
  const iconMin = layout.depth === 1 ? 30 : layout.depth === 2 ? 21 : 16;
  const iconMax = layout.depth === 1 ? 34 : layout.depth === 2 ? 25 : 20;
  const titleMin = layout.depth === 1 ? 15 : layout.depth === 2 ? 11 : 9;
  const titleMax = layout.depth === 1 ? 18 : layout.depth === 2 ? 13 : 11;
  const iconSize = Math.round(clamp(layout.width * 0.255, iconMin, iconMax));
  const titleSize = Math.round(clamp(layout.width * (layout.depth === 1 ? 0.14 : 0.135), titleMin, titleMax));
  return {
    iconSize,
    iconGlyphSize: Math.round(iconSize * 0.56),
    iconY: layout.depth === 1 ? layout.height * 0.49 : layout.depth === 2 ? layout.height * 0.47 : layout.height * 0.45,
    titleY: layout.depth === 1 ? layout.height * 0.04 : layout.depth === 2 ? layout.height * 0.07 : layout.height * 0.09,
    titleLineGap: layout.depth === 1 ? Math.round(titleSize * 1.16) : Math.round(titleSize * 1.12),
    titleSize,
    coreRadius: clamp(layout.width * 0.1, layout.depth === 1 ? 10 : layout.depth === 2 ? 7 : 5, layout.depth === 1 ? 13 : 9)
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

export function goalscapeCenterVisualMode(centerId: string, goal?: GoalNode | null) {
  return centerId !== "root" && goal ? "goal" : "map";
}

export function goalscapeCenterPearlTint(centerId: string, goal?: GoalNode | null): GoalscapeCenterPearlTint {
  if (!goal || goalscapeCenterVisualMode(centerId, goal) === "map") {
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

export function goalscapeNodeColor(goal: GoalNode, fallback: string) {
  return normalizeHexColor(goal.color) || domainBaseColor(goal.domain || goal.title) || fallback;
}

const goalscapeMaxRenderedTreeDepth = 2;
const goalscapeMinOrbitGap = 90;
const goalscapeCollapseMinWidth = 52;
const goalscapeCollapseMinHeight = 40;

type GoalscapeTreeStats = {
  maxDepth: number;
  counts: Map<number, number>;
};

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
  void stats;
  return goalscapeMaxRenderedTreeDepth;
}

function goalscapeRingDensityScale(count: number, depth: number, visibleDepth: number) {
  const capacity = goalscapeOrbitCapacity(depth, visibleDepth);
  const pressure = Math.max(1, count) / capacity;
  if (pressure <= 0.72) return 1;
  return clamp(1 - (pressure - 0.72) * 0.28, 0.7, 1);
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

function goalscapeTopLevelAngle(index: number, count: number) {
  void count;
  const stableAngles = [-90, 30, 150, -30, 90, -150, 0, 60, 120, 180, -60, -120];
  if (index < stableAngles.length) return stableAngles[index];
  return -90 + ((index - stableAngles.length) * 137.5) % 360;
}

function goalscapeStableChildOffset(index: number) {
  if (index <= 0) return 0;
  const magnitude = Math.ceil(index / 2) * 30;
  return index % 2 === 1 ? -magnitude : magnitude;
}

function goalscapeChildAngle(parentAngle: number, index: number, siblingCount: number, parentLaneSpan = 360) {
  if (siblingCount <= 1) return parentAngle;
  const laneSpread = Math.min(156, Math.max(18, parentLaneSpan));
  const naturalMaxOffset = Math.ceil((siblingCount - 1) / 2) * 30;
  if (naturalMaxOffset <= laneSpread / 2 + 0.001) return parentAngle + goalscapeStableChildOffset(index);

  const desiredSpread = clamp((siblingCount - 1) * 30, 48, 156);
  const spread = Math.min(desiredSpread, Math.max(18, parentLaneSpan));
  return parentAngle - spread / 2 + (spread * index) / (siblingCount - 1);
}

function countGoalscapeRenderDepths(goals: GoalNode[], treeDepth = 1, counts = new Map<number, number>()) {
  for (const goal of goals) {
    counts.set(treeDepth, (counts.get(treeDepth) ?? 0) + 1);
    countGoalscapeRenderDepths(goal.children || [], treeDepth + 1, counts);
  }
  return counts;
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

export const goalscapeTopNodeBaseSize = { width: 124, height: 96 };

export function goalscapeTopNodeSize(densityScale: number, focusScale: number) {
  const scale = clamp(densityScale * focusScale, 0.54, 1.12);
  return {
    width: Math.round(clamp(goalscapeTopNodeBaseSize.width * scale, 62, goalscapeTopNodeBaseSize.width * 1.08)),
    height: Math.round(clamp(goalscapeTopNodeBaseSize.height * scale, 50, goalscapeTopNodeBaseSize.height * 1.08))
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
  void selectedId;
  const stats = collectGoalscapeTreeStats(goals);
  const renderDepthCounts = countGoalscapeRenderDepths(goals);
  const visibleDepth = goalscapeVisibleDepth(stats);
  const topImportance = normalizedImportance(goals, importanceOverrides);
  const layouts: GoalscapeNodeLayout[] = [];

  const appendChildren = (parentLayout: GoalscapeNodeLayout, followsPreviewedAncestor = false) => {
    const children = parentLayout.node.children || [];
    if (children.length === 0) return;

    if (shouldCollapseGoalscapeChildren(parentLayout, visibleDepth)) {
      parentLayout.childCount = countGoalscapeDescendants(parentLayout.node);
      return;
    }

    const childImportance = normalizedImportance(children, importanceOverrides);
    children.forEach((child, childIndex) => {
      const treeDepth = parentLayout.treeDepth + 1;
      const depth = treeDepth;
      const parentLaneSpan = parentLayout.depth === 1 ? (360 / Math.max(1, goals.length)) * 0.78 : 156;
      const childAngle = goalscapeChildAngle(parentLayout.angle, childIndex, children.length, parentLaneSpan);
      const childOrbit = goalscapeOrbitForDepth(depth, visibleDepth);
      const fallback = goalscapePointOnOrbit(childAngle, depth, visibleDepth);
      const childPosition = constrainGoalscapePositionToOrbit(
        followsPreviewedAncestor ? fallback : goalMapPosition(child, fallback, positionOverrides, mapContextId),
        childOrbit
      );
      const densityScale = goalscapeRingDensityScale(renderDepthCounts.get(depth) ?? children.length, depth, visibleDepth);
      const childSize = goalscapeChildNodeSize(parentLayout, childIndex, depth, densityScale, 1);
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
        treeDistance: treeDepth,
        perspectiveScale: 1,
        opacity: 1,
        zIndex: Math.round(1000 - depth * 10),
        linkParentId: parentLayout.node.id,
        angle: goalscapeAngleForPosition(childPosition)
      };

      layouts.push(childLayout);
      appendChildren(childLayout, followsPreviewedAncestor || hasMapPositionOverride(positionOverrides, child.id));
    });
  };

  goals.forEach((goal, index) => {
    const treeDepth = 1;
    const depth = treeDepth;
    const orbit = goalscapeOrbitForDepth(depth, visibleDepth);
    const angle = goalscapeTopLevelAngle(index, goals.length);
    const fallback = goalscapePointOnOrbit(angle, depth, visibleDepth);
    const position = constrainGoalscapePositionToOrbit(goalMapPosition(goal, fallback, positionOverrides, mapContextId), orbit);
    const densityScale = goalscapeRingDensityScale(renderDepthCounts.get(depth) ?? goals.length, depth, visibleDepth);
    const size = goalscapeTopNodeSize(densityScale, 1);
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
      treeDistance: treeDepth,
      perspectiveScale: 1,
      opacity: 1,
      zIndex: Math.round(1000 - depth * 10),
      linkParentId: "root",
      angle: goalscapeAngleForPosition(position)
    };

    layouts.push(layout);
    appendChildren(layout, hasMapPositionOverride(positionOverrides, goal.id));
  });

  return layouts;
}

export function goalscapeBlobPath(x: number, y: number, width: number, height: number, variant: number) {
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

export function goalscapeConnectionPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${midY}, ${to.x} ${to.y}`;
}

export function goalscapeLabelLines(title: string, maxChars: number, maxLines: number) {
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

export function goalscapeLabelMaxChars(
  layout: Pick<GoalscapeNodeLayout, "width" | "depth">,
  visualMetrics: ReturnType<typeof goalscapeNodeVisualMetrics>
) {
  const usableWidth = layout.width * (layout.depth === 1 ? 0.72 : 0.78);
  const averageGlyphWidth = visualMetrics.titleSize * 0.74;
  const computed = Math.floor(usableWidth / averageGlyphWidth);
  return Math.round(clamp(computed, layout.depth === 1 ? 4 : 5, layout.depth === 1 ? 7 : 8));
}

export function goalIconComponent(goal: GoalNode) {
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
