"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfigOptions, ForceGraph3DInstance, LinkObject, NodeObject } from "3d-force-graph";
import { useReducedMotion } from "framer-motion";
import { Focus, Maximize2 } from "lucide-react";
import type { BufferGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D } from "three";
import type { GoalNode, GoalStatus } from "../shared/types";
import type { ResolvedTheme } from "./theme";
import {
  averageProgress,
  blend,
  clamp,
  flattenGoals,
  goalThemeColorForIndex,
  normalizedImportance,
  resolveGoalThemeColor,
  titleFromLink,
  weightedGoalProgress,
  type ColorOverrides,
  type ImportanceOverrides,
  type ProgressOverrides
} from "./goalUtils";

type GoalMeshEdgeType = "center" | "parent";
type GoalMeshNodeKind = "map" | "goal";

export type GoalMeshNode = NodeObject & {
  id: string;
  title: string;
  domain: string;
  status: GoalStatus;
  progress: number;
  priority: number;
  depth: number;
  childCount: number;
  branchId: string;
  branchTitle: string;
  color: string;
  val: number;
  kind: GoalMeshNodeKind;
};

export type GoalMeshLink = LinkObject<GoalMeshNode> & {
  id: string;
  source: string | GoalMeshNode;
  target: string | GoalMeshNode;
  type: GoalMeshEdgeType;
};

export type GoalMeshGraph = {
  nodes: GoalMeshNode[];
  links: GoalMeshLink[];
};

type GoalMeshMapProps = {
  goals: GoalNode[];
  selectedId: string;
  centerId: string;
  centerTitle: string;
  theme: ResolvedTheme;
  importanceOverrides: ImportanceOverrides;
  progressOverrides: ProgressOverrides;
  colorOverrides: ColorOverrides;
  onSelect: (id: string) => void;
};

type LinkForce = {
  distance: (value: number | ((link: GoalMeshLink) => number)) => LinkForce;
  strength: (value: number | ((link: GoalMeshLink) => number)) => LinkForce;
};

type ChargeForce = {
  strength: (value: number) => ChargeForce;
};

type GoalMeshEngineGraph = {
  nodes: GoalMeshNode[];
  links: GoalMeshLink[];
};

type GoalMeshCenterInput = {
  id: string;
  title: string;
};

type ThreeModule = typeof import("three");

export type GoalMeshVector = { x: number; y: number; z: number };

export type GoalMeshCameraPose = {
  position: GoalMeshVector;
  lookAt: GoalMeshVector;
  durationMs: number;
  distance: number;
};

export type GoalMeshFocus = {
  selectedId: string;
  hoveredId: string | null;
};

export type GoalMeshNodeVisualStyle = {
  color: string;
  coreColor: string;
  shellColor: string;
  statusColor: string;
  coreOpacity: number;
  shellOpacity: number;
  coreScale: number;
  emissiveIntensity: number;
  scale: number;
  dimmed: boolean;
  selected: boolean;
  active: boolean;
};

export type GoalMeshLinkVisualStyle = {
  color: string;
  width: number;
  particles: number;
  particleWidth: number;
  particleSpeed: number;
  dimmed: boolean;
  active: boolean;
};

const relationLabels: Record<GoalMeshEdgeType, string> = {
  center: "地图中心",
  parent: "父子层级"
};

const relationSolidColors: Record<GoalMeshEdgeType, string> = {
  center: "#d7f7ef",
  parent: "#9fb8b3"
};

const goalMeshLevelVolumeRatio = 0.6;
const goalMeshLevelRadiusRatio = Math.cbrt(goalMeshLevelVolumeRatio);
const goalMeshNodeRadiusScale = 1.32;

/** 入场：层级之间的错峰（ms）。外层更晚从中心弹出。 */
const goalMeshEntranceDepthStaggerMs = 130;
/** 入场：同层节点之间的错峰（ms），让星体一颗颗绕中心绽开。 */
const goalMeshEntranceSiblingStaggerMs = 46;
/** 入场：单颗节点从中心飞到种子位的时长（ms）。 */
const goalMeshEntranceFlightMs = 760;
/** 入场：中心地图节点单独先亮起后再放外围。 */
const goalMeshEntranceCenterLeadMs = 160;
/** 入场：飞到位后短暂保留固定坐标，再交给力模拟微调。 */
const goalMeshEntranceSettleHoldMs = 40;

const statusLightColors: Record<GoalStatus, string> = {
  active: "#5eead4",
  paused: "#fbbf24",
  done: "#86efac",
  archived: "#94a3b8"
};

function colorWithAlpha(hexColor: string, alpha: number) {
  const normalized = hexColor.replace("#", "");
  const value = Number.parseInt(normalized.length === 3 ? normalized.replace(/(.)/g, "$1$1") : normalized, 16);
  if (!Number.isFinite(value)) return `rgba(148, 163, 184, ${alpha})`;
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function endpointId(endpoint: string | number | GoalMeshNode | undefined) {
  if (endpoint && typeof endpoint === "object") return String(endpoint.id);
  return String(endpoint ?? "");
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasFiniteCoordinates(node: Pick<GoalMeshNode, "x" | "y" | "z">) {
  return finiteCoordinate(node.x) && finiteCoordinate(node.y) && finiteCoordinate(node.z);
}

function vectorFromCoordinates(value: Partial<GoalMeshVector> | undefined | null): GoalMeshVector | null {
  if (!value || !finiteCoordinate(value.x) || !finiteCoordinate(value.y) || !finiteCoordinate(value.z)) return null;
  return { x: value.x, y: value.y, z: value.z };
}

function normalizedVector(value: GoalMeshVector): GoalMeshVector | null {
  const length = Math.hypot(value.x, value.y, value.z);
  if (!Number.isFinite(length) || length < 0.001) return null;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

export function goalMeshCameraPoseForNode(
  node: Pick<GoalMeshNode, "x" | "y" | "z" | "depth" | "val">,
  currentCamera?: Partial<GoalMeshVector> | null,
  reducedMotion = false
): GoalMeshCameraPose | null {
  const lookAt = vectorFromCoordinates(node);
  if (!lookAt) return null;

  const current = vectorFromCoordinates(currentCamera);
  const fallbackDirection =
    normalizedVector({
      x: lookAt.x * 0.8 + 18,
      y: lookAt.y * 0.8 - 24,
      z: lookAt.z + 160
    }) ?? { x: 0.34, y: -0.24, z: 0.91 };
  const currentDirection = current
    ? normalizedVector({
        x: current.x - lookAt.x,
        y: current.y - lookAt.y,
        z: current.z - lookAt.z
      })
    : null;
  const direction = currentDirection ?? fallbackDirection;
  const focusDepth = Math.max(1, node.depth);
  // 与更紧凑的尺寸感知布局(goalMeshLinkRestLength)配套:聚焦距离同步收近,让被选星体占据视野。
  const distance = clamp(212 - focusDepth * 6 + clamp(node.val, 8, 32) * 1.05, 176, 244);
  const lift = clamp(18 - focusDepth * 1.4, 8, 16);

  return {
    position: {
      x: lookAt.x + direction.x * distance,
      y: lookAt.y + direction.y * distance,
      z: lookAt.z + direction.z * distance + lift
    },
    lookAt,
    durationMs: reducedMotion ? 0 : clamp(740 - focusDepth * 34, 540, 720),
    distance
  };
}

/** 按种子坐标包围球计算总览镜头，保证整张目标地图落在画面内。 */
export function goalMeshOverviewCameraPose(seeds: Iterable<Pick<GoalMeshVector, "x" | "y" | "z">>): GoalMeshCameraPose {
  let radius = 72;
  for (const seed of seeds) {
    if (!finiteCoordinate(seed.x) || !finiteCoordinate(seed.y) || !finiteCoordinate(seed.z)) continue;
    radius = Math.max(radius, Math.hypot(seed.x, seed.y, seed.z));
  }
  // 预留星体半径与边距；约按 50° 视场把包围球装进画面。
  const span = radius + 56;
  const distance = clamp(span * 2.65, 360, 980);
  const direction = normalizedVector({ x: 0.32, y: -0.2, z: 0.93 }) ?? { x: 0, y: 0, z: 1 };
  return {
    position: {
      x: direction.x * distance,
      y: direction.y * distance,
      z: direction.z * distance
    },
    lookAt: { x: 0, y: 0, z: 0 },
    durationMs: 0,
    distance
  };
}

function graphNodeDepths(goals: GoalNode[], depth = 1, result = new Map<string, number>()) {
  for (const goal of goals) {
    result.set(goal.id, depth);
    graphNodeDepths(goal.children || [], depth + 1, result);
  }
  return result;
}

function graphNodeBranches(goals: GoalNode[]) {
  const branches = new Map<string, { branchId: string; branchTitle: string; branchIndex: number; branchCount: number }>();
  const branchCount = Math.max(1, goals.length);
  const visit = (goal: GoalNode, branch: { branchId: string; branchTitle: string; branchIndex: number; branchCount: number }) => {
    branches.set(goal.id, branch);
    for (const child of goal.children || []) visit(child, branch);
  };

  goals.forEach((goal, index) => {
    visit(goal, { branchId: goal.id, branchTitle: goal.title, branchIndex: index, branchCount });
  });
  return branches;
}

const goalMeshTopLevelSeedRadius = 112;
const goalMeshChildOrbitBaseRadius = 58;
const goalMeshChildOrbitRadiusPerSibling = 4.5;

function goalIdHash(goalId: string) {
  return Array.from(goalId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function outwardUnitFromParent(parent: GoalMeshVector): GoalMeshVector {
  return (
    normalizedVector(parent) ?? {
      x: 1,
      y: 0,
      z: 0
    }
  );
}

function orthonormalFrame(outward: GoalMeshVector): { tangent: GoalMeshVector; binormal: GoalMeshVector } {
  const tangent =
    normalizedVector(
      Math.abs(outward.z) < 0.9 ? { x: -outward.y, y: outward.x, z: 0 } : { x: 0, y: -outward.z, z: outward.y }
    ) ?? { x: 0, y: 1, z: 0 };
  const binormal =
    normalizedVector({
      x: outward.y * tangent.z - outward.z * tangent.y,
      y: outward.z * tangent.x - outward.x * tangent.z,
      z: outward.x * tangent.y - outward.y * tangent.x
    }) ?? { x: 0, y: 0, z: 1 };
  return { tangent, binormal };
}

/** 斐波那契球面采样：在单位球上近似均匀取点。 */
export function goalMeshFibonacciSpherePoint(index: number, count: number, jitter = 0): GoalMeshVector {
  const n = Math.max(1, count);
  const i = clamp(index, 0, n - 1);
  const y = n === 1 ? 0 : 1 - ((i + 0.5) / n) * 2;
  const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
  const golden = Math.PI * (3 - Math.sqrt(5));
  const theta = i * golden + jitter;
  return {
    x: Math.cos(theta) * radiusAtY,
    y,
    z: Math.sin(theta) * radiusAtY
  };
}

/**
 * 球体感成簇种子：
 * - 一级目标铺满以地图中心为球心的球面（斐波那契球）
 * - 子目标绕父节点形成局部球面壳（外半球偏置，保持树向外生长）
 */
export function seedGoalMeshTreePositions(goals: GoalNode[]): Map<string, GoalMeshVector> {
  const positions = new Map<string, GoalMeshVector>();
  const topCount = Math.max(1, goals.length);

  const placeChildren = (parent: GoalNode, parentPos: GoalMeshVector, depth: number) => {
    const children = parent.children || [];
    if (children.length === 0) return;

    const outward = outwardUnitFromParent(parentPos);
    const { tangent, binormal } = orthonormalFrame(outward);
    const siblingCount = children.length;
    const orbitRadius = goalMeshChildOrbitBaseRadius + siblingCount * goalMeshChildOrbitRadiusPerSibling + (depth - 1) * 6;

    children.forEach((child, siblingIndex) => {
      const hash = goalIdHash(child.id);
      const jitter = ((hash % 29) - 14) * 0.04;
      // 在父节点局部球面上采样；外半球偏置（|y|→outward）保持径向向外的球体层次。
      const sample = goalMeshFibonacciSpherePoint(siblingIndex, siblingCount, jitter);
      const local: GoalMeshVector = {
        x: tangent.x * sample.x + outward.x * Math.abs(sample.y) + binormal.x * sample.z,
        y: tangent.y * sample.x + outward.y * Math.abs(sample.y) + binormal.y * sample.z,
        z: tangent.z * sample.x + outward.z * Math.abs(sample.y) + binormal.z * sample.z
      };
      const unit = normalizedVector(local) ?? outward;
      // 轻微径向起伏，让球壳有厚度而不像薄皮。
      const shell = orbitRadius * (0.88 + ((hash % 9) / 9) * 0.28);
      const pos: GoalMeshVector = {
        x: parentPos.x + unit.x * shell,
        y: parentPos.y + unit.y * shell,
        z: parentPos.z + unit.z * shell
      };
      positions.set(child.id, pos);
      placeChildren(child, pos, depth + 1);
    });
  };

  goals.forEach((goal, index) => {
    const hash = goalIdHash(goal.id);
    const sample = goalMeshFibonacciSpherePoint(index, topCount, ((hash % 41) - 20) * 0.012);
    const radius = goalMeshTopLevelSeedRadius * (0.92 + ((hash % 7) / 7) * 0.16);
    const pos: GoalMeshVector = {
      x: sample.x * radius,
      y: sample.y * radius,
      z: sample.z * radius
    };
    positions.set(goal.id, pos);
    placeChildren(goal, pos, 1);
  });

  return positions;
}

function addParentLinks(goals: GoalNode[], links: Map<string, GoalMeshLink>) {
  for (const goal of goals) {
    for (const child of goal.children || []) {
      const id = `${child.id}->${goal.id}:parent`;
      if (!links.has(id)) links.set(id, { id, source: child.id, target: goal.id, type: "parent" });
    }
    addParentLinks(goal.children || [], links);
  }
}

function addCenterLinks(goals: GoalNode[], center: GoalMeshCenterInput | undefined, links: Map<string, GoalMeshLink>) {
  if (!center) return;
  for (const goal of goals) {
    const id = `${goal.id}->${center.id}:center`;
    if (!links.has(id)) links.set(id, { id, source: goal.id, target: center.id, type: "center" });
  }
}

function buildGoalMeshCenterNode(
  center: GoalMeshCenterInput | undefined,
  goals: GoalNode[],
  importanceOverrides: ImportanceOverrides,
  progressOverrides: ProgressOverrides
): GoalMeshNode | null {
  if (!center?.id) return null;
  return {
    id: center.id,
    title: center.title.trim() || "目标地图",
    domain: "目标地图",
    status: "active",
    priority: 3,
    progress: averageProgress(goals, importanceOverrides, progressOverrides),
    depth: 0,
    childCount: goals.length,
    branchId: center.id,
    branchTitle: center.title.trim() || "目标地图",
    color: "#d4a017",
    val: 42,
    kind: "map",
    x: 0,
    y: 0,
    z: 0
  };
}

export function buildGoalMeshGraph(
  goals: GoalNode[],
  importanceOverrides: ImportanceOverrides = {},
  progressOverrides: ProgressOverrides = {},
  colorOverrides: ColorOverrides = {},
  center?: GoalMeshCenterInput
): GoalMeshGraph {
  const flatGoals = flattenGoals(goals);
  const depths = graphNodeDepths(goals);
  const branches = graphNodeBranches(goals);
  const topImportance = normalizedImportance(goals, importanceOverrides);
  const seedPositions = seedGoalMeshTreePositions(goals);

  const nodes = flatGoals.map((goal, index) => {
    const branch = branches.get(goal.id) ?? {
      branchId: goal.id,
      branchTitle: goal.title,
      branchIndex: index,
      branchCount: Math.max(1, flatGoals.length)
    };
    const fallbackColor = goal.id === branch.branchId ? goalThemeColorForIndex(branch.branchIndex) : "";
    const color = colorOverrides[goal.id] || resolveGoalThemeColor(goal, fallbackColor);
    const progress = weightedGoalProgress(goal, importanceOverrides, progressOverrides);
    const priorityShare = goal.id in topImportance ? topImportance[goal.id] : clamp(Math.round(goal.priority * 10), 1, 100);
    const depth = depths.get(goal.id) ?? 1;
    const seed = seedPositions.get(goal.id) ?? { x: 0, y: 0, z: 0 };
    return {
      id: goal.id,
      title: goal.title,
      domain: titleFromLink(goal.domain),
      status: goal.status,
      priority: goal.priority,
      progress,
      depth,
      childCount: goal.children?.length ?? 0,
      branchId: branch.branchId,
      branchTitle: branch.branchTitle,
      color,
      val: clamp(7.4 + priorityShare / 10.5 + progress / 16 + (goal.children?.length ?? 0) * 1.65, 8.4, 28),
      kind: "goal" as const,
      x: seed.x,
      y: seed.y,
      z: seed.z
    } satisfies GoalMeshNode;
  });

  const centerNode = buildGoalMeshCenterNode(center, goals, importanceOverrides, progressOverrides);
  const links = new Map<string, GoalMeshLink>();
  addCenterLinks(goals, center, links);
  addParentLinks(goals, links);

  return { nodes: centerNode ? [centerNode, ...nodes] : nodes, links: Array.from(links.values()) };
}

export function normalizeEngineLinks(graph: GoalMeshGraph, nodeIds: Set<string>): GoalMeshLink[] {
  return graph.links.flatMap((link) => {
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    if (!source || !target || source === target || !nodeIds.has(source) || !nodeIds.has(target)) return [];
    return [{ ...link, source, target }];
  });
}

export function graphDataForEngine(graph: GoalMeshGraph): GoalMeshEngineGraph {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  return {
    nodes: graph.nodes.map((node) => ({ ...node })),
    links: normalizeEngineLinks(graph, nodeIds)
  };
}

export type GoalMeshTopologyDiff = {
  changed: boolean;
  nodeIdsChanged: boolean;
  linkIdsChanged: boolean;
  addedNodeIds: string[];
  removedNodeIds: string[];
};

// 拓扑(节点/连线 id 集合)变化才需要 instance.graphData() 重排;仅属性变化走就地更新,力模拟不重置。
export function diffGoalMeshTopology(prev: GoalMeshGraph | null, next: GoalMeshGraph): GoalMeshTopologyDiff {
  const nextNodeIds = new Set(next.nodes.map((node) => node.id));
  if (!prev) {
    return {
      changed: true,
      nodeIdsChanged: true,
      linkIdsChanged: true,
      addedNodeIds: Array.from(nextNodeIds),
      removedNodeIds: []
    };
  }

  const prevNodeIds = new Set(prev.nodes.map((node) => node.id));
  const addedNodeIds = Array.from(nextNodeIds).filter((id) => !prevNodeIds.has(id));
  const removedNodeIds = Array.from(prevNodeIds).filter((id) => !nextNodeIds.has(id));
  const nodeIdsChanged = addedNodeIds.length > 0 || removedNodeIds.length > 0;

  const prevLinkIds = new Set(prev.links.map((link) => link.id));
  const nextLinkIds = new Set(next.links.map((link) => link.id));
  const linkIdsChanged =
    prevLinkIds.size !== nextLinkIds.size || Array.from(nextLinkIds).some((id) => !prevLinkIds.has(id));

  return {
    changed: nodeIdsChanged || linkIdsChanged,
    nodeIdsChanged,
    linkIdsChanged,
    addedNodeIds,
    removedNodeIds
  };
}

// 只同步数据字段;绝不触碰 x/y/z/vx/vy/vz/fx/fy/fz 与引擎缓存(__threeObj),否则会丢失演化后的布局。
export function mergeGoalMeshNodeData(target: GoalMeshNode, source: GoalMeshNode): void {
  target.title = source.title;
  target.domain = source.domain;
  target.status = source.status;
  target.progress = source.progress;
  target.priority = source.priority;
  target.depth = source.depth;
  target.childCount = source.childCount;
  target.branchId = source.branchId;
  target.branchTitle = source.branchTitle;
  target.color = source.color;
  target.val = source.val;
  target.kind = source.kind;
}

// 增量重排:已存在的节点复用同一对象引用(d3-force-3d 只在坐标为 NaN 时才重新初始化,
// three-forcegraph 的 digest 按对象身份缓存 Object3D),因此复用引用 = 保留位置与三维对象。
export function reconcileEngineGraph(
  prevNodeById: Map<string, GoalMeshNode>,
  next: GoalMeshGraph
): { engineGraph: GoalMeshEngineGraph; nodeById: Map<string, GoalMeshNode> } {
  const nodeById = new Map<string, GoalMeshNode>();
  const nodes = next.nodes.map((node) => {
    const existing = prevNodeById.get(node.id);
    if (existing) {
      mergeGoalMeshNodeData(existing, node);
      nodeById.set(existing.id, existing);
      return existing;
    }
    const created = { ...node };
    nodeById.set(created.id, created);
    return created;
  });

  return {
    engineGraph: { nodes, links: normalizeEngineLinks(next, new Set(nodeById.keys())) },
    nodeById
  };
}

export type GoalMeshEntrancePlanItem = {
  id: string;
  depth: number;
  delayMs: number;
  from: GoalMeshVector;
  to: GoalMeshVector;
};

export type GoalMeshEntrancePlan = {
  items: GoalMeshEntrancePlanItem[];
  totalMs: number;
};

/** 天体绽放缓动：前段快冲出中心，尾段柔和落位。 */
export function goalMeshEntranceEase(t: number): number {
  const clamped = clamp(t, 0, 1);
  return 1 - Math.pow(1 - clamped, 4);
}

export function lerpGoalMeshVector(from: GoalMeshVector, to: GoalMeshVector, t: number): GoalMeshVector {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t
  };
}

function goalMeshEntranceSeed(node: Pick<GoalMeshNode, "x" | "y" | "z" | "kind">): GoalMeshVector {
  if (node.kind === "map") return { x: 0, y: 0, z: 0 };
  return {
    x: finiteCoordinate(node.x) ? node.x : 0,
    y: finiteCoordinate(node.y) ? node.y : 0,
    z: finiteCoordinate(node.z) ? node.z : 0
  };
}

/**
 * 按深度由内向外、同层按绕中心角排序，生成错峰绽放时间表。
 * 中心地图节点 delay=0；目标节点从 lead 之后开始一颗颗弹出。
 * `seeds` 为折叠前的目标坐标；缺省时从节点当前 x/y/z 读取。
 */
export function planGoalMeshEntrance(nodes: GoalMeshNode[], seeds?: Map<string, GoalMeshVector>): GoalMeshEntrancePlan {
  const center = nodes.find((node) => node.kind === "map");
  const goals = nodes
    .filter((node) => node.kind !== "map")
    .slice()
    .sort((a, b) => {
      const seedA = seeds?.get(a.id) ?? goalMeshEntranceSeed(a);
      const seedB = seeds?.get(b.id) ?? goalMeshEntranceSeed(b);
      if (a.depth !== b.depth) return a.depth - b.depth;
      const angleA = Math.atan2(seedA.y, seedA.x);
      const angleB = Math.atan2(seedB.y, seedB.x);
      if (angleA !== angleB) return angleA - angleB;
      return a.id.localeCompare(b.id);
    });

  const items: GoalMeshEntrancePlanItem[] = [];
  if (center) {
    items.push({
      id: center.id,
      depth: 0,
      delayMs: 0,
      from: { x: 0, y: 0, z: 0 },
      to: { x: 0, y: 0, z: 0 }
    });
  }

  let siblingIndexInDepth = 0;
  let lastDepth = -1;
  for (const node of goals) {
    if (node.depth !== lastDepth) {
      siblingIndexInDepth = 0;
      lastDepth = node.depth;
    }
    const to = seeds?.get(node.id) ?? goalMeshEntranceSeed(node);
    items.push({
      id: node.id,
      depth: node.depth,
      delayMs: goalMeshEntranceCenterLeadMs + Math.max(0, node.depth - 1) * goalMeshEntranceDepthStaggerMs + siblingIndexInDepth * goalMeshEntranceSiblingStaggerMs,
      from: { x: 0, y: 0, z: 0 },
      to
    });
    siblingIndexInDepth += 1;
  }

  const totalMs =
    items.reduce((max, item) => Math.max(max, item.delayMs + goalMeshEntranceFlightMs), 0) + goalMeshEntranceSettleHoldMs;
  return { items, totalMs };
}

/** 把节点钉在中心，供入场动画从原点展开；返回各节点目标种子坐标。 */
export function prepareGoalMeshEntrance(nodes: GoalMeshNode[]): Map<string, GoalMeshVector> {
  const seeds = new Map<string, GoalMeshVector>();
  for (const node of nodes) {
    const seed = goalMeshEntranceSeed(node);
    seeds.set(node.id, seed);
    node.x = 0;
    node.y = 0;
    node.z = 0;
    node.vx = 0;
    node.vy = 0;
    node.vz = 0;
    node.fx = 0;
    node.fy = 0;
    node.fz = 0;
  }
  return seeds;
}

/** 将节点放到种子位：中心地图钉死，其余交给力模拟排层级。 */
export function placeGoalMeshNodesAtSeeds(nodes: GoalMeshNode[], seeds: Map<string, GoalMeshVector>) {
  for (const node of nodes) {
    const seed = seeds.get(node.id) ?? { x: 0, y: 0, z: 0 };
    node.x = seed.x;
    node.y = seed.y;
    node.z = seed.z;
    node.vx = 0;
    node.vy = 0;
    node.vz = 0;
    if (node.kind === "map") {
      node.fx = 0;
      node.fy = 0;
      node.fz = 0;
    } else {
      node.fx = undefined;
      node.fy = undefined;
      node.fz = undefined;
    }
  }
}

export function releaseGoalMeshEntrancePins(nodes: Iterable<GoalMeshNode>, options?: { pinMapCenter?: boolean }) {
  for (const node of nodes) {
    if (options?.pinMapCenter && node.kind === "map") {
      node.fx = finiteCoordinate(node.x) ? node.x : 0;
      node.fy = finiteCoordinate(node.y) ? node.y : 0;
      node.fz = finiteCoordinate(node.z) ? node.z : 0;
      node.vx = 0;
      node.vy = 0;
      node.vz = 0;
      continue;
    }
    node.fx = undefined;
    node.fy = undefined;
    node.fz = undefined;
    node.vx = 0;
    node.vy = 0;
    node.vz = 0;
  }
}

export function applyGoalMeshEntranceFrame(
  nodesById: Map<string, GoalMeshNode>,
  plan: GoalMeshEntrancePlan,
  elapsedMs: number
): { progressById: Map<string, number>; done: boolean } {
  const progressById = new Map<string, number>();
  let done = true;
  for (const item of plan.items) {
    const node = nodesById.get(item.id);
    if (!node) continue;
    const local = elapsedMs - item.delayMs;
    if (local < 0) {
      progressById.set(item.id, 0);
      node.x = item.from.x;
      node.y = item.from.y;
      node.z = item.from.z;
      node.fx = item.from.x;
      node.fy = item.from.y;
      node.fz = item.from.z;
      done = false;
      continue;
    }
    const raw = local / goalMeshEntranceFlightMs;
    const eased = goalMeshEntranceEase(raw);
    progressById.set(item.id, clamp(eased, 0, 1));
    if (raw < 1) done = false;
    const point = lerpGoalMeshVector(item.from, item.to, clamp(eased, 0, 1));
    node.x = point.x;
    node.y = point.y;
    node.z = point.z;
    node.fx = point.x;
    node.fy = point.y;
    node.fz = point.z;
    node.vx = 0;
    node.vy = 0;
    node.vz = 0;
  }
  return { progressById, done: done && elapsedMs >= plan.totalMs };
}

export function goalMeshEntranceRevealScale(progress: number): number {
  const t = goalMeshEntranceEase(progress);
  return 0.08 + t * 0.92;
}

function nodeLabel(node: GoalMeshNode) {
  if (node.kind === "map") {
    return `<div class="mesh-node-label mesh-map-label"><strong>${escapeHtml(node.title)}</strong><span>当前目标地图</span><small>${node.childCount} 个一级目标</small></div>`;
  }
  const domain = node.domain ? `<span>${escapeHtml(node.domain)}</span>` : "";
  return `<div class="mesh-node-label"><strong>${escapeHtml(node.title)}</strong>${domain}<small>${node.progress}% / ${node.childCount} 个子目标</small></div>`;
}

function linkLabel(link: GoalMeshLink) {
  return `<div class="mesh-node-label mesh-link-label"><strong>${relationLabels[link.type]}</strong></div>`;
}

function linkInvolves(link: GoalMeshLink, nodeId: string) {
  return endpointId(link.source) === nodeId || endpointId(link.target) === nodeId;
}

function nodeIsHighlighted(node: GoalMeshNode, links: GoalMeshLink[], selectedId: string, hoveredId: string | null) {
  const focusId = hoveredId || selectedId;
  if (!focusId || focusId === "root") return true;
  const focusExistsInGraph = node.id === focusId || links.some((link) => linkInvolves(link, focusId));
  if (!focusExistsInGraph) return true;
  if (node.id === focusId) return true;
  return links.some((link) => linkInvolves(link, focusId) && linkInvolves(link, node.id));
}

function linkIsHighlighted(link: GoalMeshLink, links: GoalMeshLink[], selectedId: string, hoveredId: string | null) {
  const focusId = hoveredId || selectedId;
  if (!focusId || focusId === "root") return true;
  if (!links.some((item) => linkInvolves(item, focusId))) return true;
  return linkInvolves(link, focusId);
}

function focusIdFromState(focus: GoalMeshFocus) {
  const focusId = focus.hoveredId || focus.selectedId;
  return focusId && focusId !== "root" ? focusId : "";
}

function focusTouchesGraph(links: GoalMeshLink[], focusId: string) {
  return Boolean(focusId && links.some((link) => linkInvolves(link, focusId)));
}

export function goalMeshNodeVisualStyle(
  node: GoalMeshNode,
  links: GoalMeshLink[],
  focus: GoalMeshFocus,
  theme: ResolvedTheme = "light"
): GoalMeshNodeVisualStyle {
  const dark = theme === "dark";
  const focusId = focusIdFromState(focus);
  const graphFocused = focusId === node.id || focusTouchesGraph(links, focusId);
  const active = nodeIsHighlighted(node, links, focus.selectedId, focus.hoveredId);
  const dimmed = graphFocused && !active;
  const selected = focusId === node.id;
  const depthIndex = Math.max(0, Math.max(1, node.depth) - 1);
  const progressRatio = clamp(node.progress, 0, 100) / 100;
  const depthScale = node.kind === "map" ? 1.22 : 1.18 * Math.pow(goalMeshLevelRadiusRatio, depthIndex);
  const mapScaleBoost = node.kind === "map" ? 0.24 : 0;
  const valueRatio = clamp((node.val - 8.4) / (28 - 8.4), 0, 1);
  const childRatio = clamp(node.childCount / 5, 0, 1);
  const levelDetailScale = node.kind === "map" ? 1 : clamp(0.95 + valueRatio * 0.06 + progressRatio * 0.025 + childRatio * 0.025, 0.95, 1.06);
  const baseScale =
    node.kind === "map"
      ? clamp((0.72 + node.val / 36 + node.progress / 560 + mapScaleBoost) * depthScale, 0.76, 1.68)
      : clamp(depthScale * levelDetailScale, 0.12, 1.42);
  const scale = clamp(baseScale + (selected ? 0.06 : graphFocused && active ? 0.025 : 0) - (dimmed ? 0.025 : 0), node.kind === "map" ? 0.7 : 0.12, 1.72);
  // 深色 = 深夜天文台:近黑底上材质被"洗暗",各档不透明度与自发光整体上调,让星体靠发光可辨。
  const coreOpacity = selected ? 1 : dimmed ? (dark ? 0.68 : 0.58) : graphFocused && active ? (dark ? 0.97 : 0.94) : dark ? 0.9 : 0.86;
  const shellOpacity = selected ? (dark ? 0.64 : 0.56) : dimmed ? (dark ? 0.3 : 0.22) : graphFocused && active ? (dark ? 0.42 : 0.34) : dark ? 0.34 : 0.26;
  const coreScale = clamp(0.58 + progressRatio * 0.42 + (selected ? 0.16 : 0), 0.58, 1.16);
  const emissiveIntensity = dimmed ? (dark ? 0.3 : 0.18) : selected ? (dark ? 1.12 : 0.96) : graphFocused && active ? (dark ? 0.7 : 0.46) : dark ? 0.55 : 0.32;

  return {
    color: node.color,
    coreColor: node.color,
    shellColor: node.color,
    statusColor: statusLightColors[node.status],
    coreOpacity,
    shellOpacity,
    coreScale,
    emissiveIntensity,
    scale,
    dimmed,
    selected,
    active
  };
}

export function goalMeshLinkVisualStyle(
  link: GoalMeshLink,
  links: GoalMeshLink[],
  focus: GoalMeshFocus,
  theme: ResolvedTheme = "light"
): GoalMeshLinkVisualStyle {
  const dark = theme === "dark";
  const focusId = focusIdFromState(focus);
  const graphFocused = focusTouchesGraph(links, focusId);
  const active = linkIsHighlighted(link, links, focus.selectedId, focus.hoveredId);
  const dimmed = graphFocused && !active;
  const isCenter = link.type === "center";
  // 深色底上连线 alpha 还要再乘全局 linkOpacity(0.72),各档上调保持能量流可见。
  const alpha = dimmed
    ? isCenter
      ? dark
        ? 0.24
        : 0.16
      : dark
        ? 0.2
        : 0.13
    : graphFocused
      ? isCenter
        ? dark
          ? 0.92
          : 0.82
        : dark
          ? 0.86
          : 0.74
      : isCenter
        ? dark
          ? 0.72
          : 0.52
        : dark
          ? 0.6
          : 0.4;
  const width = dimmed
    ? isCenter
      ? 0.5
      : 0.36
    : graphFocused && active
      ? isCenter
        ? 1.54
        : 1.28
      : isCenter
        ? 0.9
        : 0.68;

  return {
    color: colorWithAlpha(relationSolidColors[link.type], alpha),
    width,
    particles: graphFocused && active ? 1 : 0,
    particleWidth: graphFocused && active ? (isCenter ? 1.22 : 1.12) : 0.54,
    particleSpeed: isCenter ? 0.0018 : 0.002,
    dimmed,
    active
  };
}

export function goalMeshNodeRadius(node: GoalMeshNode, style: Pick<GoalMeshNodeVisualStyle, "scale">) {
  return clamp(
    node.val * 0.288 * style.scale * goalMeshNodeRadiusScale,
    (node.kind === "map" ? 6.96 : 0.9) * goalMeshNodeRadiusScale,
    (node.kind === "map" ? 13.68 : 7.5) * goalMeshNodeRadiusScale
  );
}

const goalMeshNeutralFocus: GoalMeshFocus = { selectedId: "", hoveredId: null };
const goalMeshFallbackEndpointRadius = 4.4;

// 节点在无聚焦状态下的"星体"半径(几何尺寸与主题无关),供连线静息长度等布局计算使用。
export function goalMeshNodeNeutralRadius(node: GoalMeshNode) {
  return goalMeshNodeRadius(node, goalMeshNodeVisualStyle(node, [], goalMeshNeutralFocus));
}

// 连线静息长度随两端星体半径缩放:大节点之间连线更长、叶子节点之间更短,
// 表面呼吸间距始终 ≥ 12,保证节点醒目(整图更紧凑)但不相互拥挤。
export function goalMeshLinkRestLength(link: GoalMeshLink) {
  const sourceRadius = typeof link.source === "object" ? goalMeshNodeNeutralRadius(link.source) : goalMeshFallbackEndpointRadius;
  const targetRadius = typeof link.target === "object" ? goalMeshNodeNeutralRadius(link.target) : goalMeshFallbackEndpointRadius;
  const span = sourceRadius + targetRadius;
  const jitter = link.id.length % 9;
  return link.type === "center" ? clamp(span * 1.3 + 24, 52, 104) + jitter : clamp(span * 1.4 + 20, 34, 84) + jitter;
}

export type GoalMeshNodeLayerSpec = {
  scale: number;
  color: string;
  opacity: number;
  emissiveIntensity?: number;
};

export type GoalMeshNodeObjectSpec = {
  radius: number;
  shell: GoalMeshNodeLayerSpec;
  core: GoalMeshNodeLayerSpec;
  status: GoalMeshNodeLayerSpec & { position: GoalMeshVector };
};

// 节点各层(shell/core/状态灯)的材质与缩放规格。创建与就地更新共用同一份数学,
// 保证 hover/select 时直接改材质与 nodeThreeObject 工厂重建的结果一致。
export function goalMeshNodeObjectSpec(
  node: GoalMeshNode,
  links: GoalMeshLink[],
  focus: GoalMeshFocus,
  theme: ResolvedTheme = "light"
): GoalMeshNodeObjectSpec {
  const dark = theme === "dark";
  const style = goalMeshNodeVisualStyle(node, links, focus, theme);
  const radius = goalMeshNodeRadius(node, style);
  const statusScale = clamp(radius * 0.16, 0.34, 0.78);
  // 深色底上中低亮度主题色会沉进背景,向白轻混提亮（中心金球也会更醒目）。
  const coreColor = dark ? blend(style.coreColor, "#ffffff", 0.14) : style.coreColor;
  const shellColor = dark ? blend(style.shellColor, "#ffffff", 0.14) : style.shellColor;

  return {
    radius,
    shell: {
      scale: radius * 1.16,
      color: shellColor,
      opacity: style.shellOpacity,
      emissiveIntensity: style.dimmed ? (dark ? 0.16 : 0.08) : style.selected ? (dark ? 0.34 : 0.22) : dark ? 0.22 : 0.12
    },
    core: {
      scale: radius * style.coreScale,
      color: coreColor,
      opacity: style.coreOpacity,
      emissiveIntensity: style.emissiveIntensity
    },
    status: {
      scale: statusScale,
      color: style.statusColor,
      opacity: style.dimmed ? 0.72 : 0.96,
      position: { x: radius * 1.08, y: radius * 0.7, z: radius * 0.14 }
    }
  };
}

type GoalMeshLayerHandle = {
  mesh: Mesh;
  material: MeshStandardMaterial | MeshBasicMaterial;
};

type GoalMeshNodeHandle = {
  group: Object3D;
  shell: GoalMeshLayerHandle;
  core: GoalMeshLayerHandle;
  status: GoalMeshLayerHandle;
};

function applyGoalMeshLayer(handle: GoalMeshLayerHandle, layer: GoalMeshNodeLayerSpec) {
  handle.mesh.scale.setScalar(layer.scale);
  handle.material.color.set(layer.color);
  handle.material.opacity = layer.opacity;
  if (layer.emissiveIntensity !== undefined && "emissive" in handle.material) {
    handle.material.emissive.set(layer.color);
    handle.material.emissiveIntensity = layer.emissiveIntensity;
  }
}

// 就地更新一个已渲染节点的材质/缩放。渲染循环每帧运行,改完下一帧生效——
// 不经过 nodeThreeObject 工厂,也就不会触发全量 Object3D 重建与材质 dispose。
function applyGoalMeshNodeObject(handle: GoalMeshNodeHandle, spec: GoalMeshNodeObjectSpec) {
  applyGoalMeshLayer(handle.shell, spec.shell);
  applyGoalMeshLayer(handle.core, spec.core);
  applyGoalMeshLayer(handle.status, spec.status);
  handle.status.mesh.position.set(spec.status.position.x, spec.status.position.y, spec.status.position.z);
}

function createGoalMeshNodeObject(
  three: ThreeModule,
  geometries: { core: BufferGeometry; shell: BufferGeometry; status: BufferGeometry },
  node: GoalMeshNode,
  links: GoalMeshLink[],
  focus: GoalMeshFocus,
  theme: ResolvedTheme = "light"
): GoalMeshNodeHandle {
  const spec = goalMeshNodeObjectSpec(node, links, focus, theme);
  const group = new three.Group();
  group.userData.goalId = node.id;

  const buildLayer = (
    geometry: BufferGeometry,
    layer: GoalMeshNodeLayerSpec,
    materialOptions: { standard?: boolean; roughness?: number; metalness?: number; depthWrite?: boolean }
  ): GoalMeshLayerHandle => {
    const material = materialOptions.standard
      ? new three.MeshStandardMaterial({
          color: new three.Color(layer.color),
          transparent: true,
          opacity: layer.opacity,
          roughness: materialOptions.roughness,
          metalness: materialOptions.metalness,
          emissive: new three.Color(layer.color),
          emissiveIntensity: layer.emissiveIntensity
        })
      : new three.MeshBasicMaterial({
          color: new three.Color(layer.color),
          transparent: true,
          opacity: layer.opacity,
          depthWrite: materialOptions.depthWrite
        });
    const mesh = new three.Mesh(geometry, material);
    mesh.scale.setScalar(layer.scale);
    group.add(mesh);
    return { mesh, material };
  };

  const shell = buildLayer(geometries.shell, spec.shell, { standard: true, roughness: 0.18, metalness: 0.22 });
  const core = buildLayer(geometries.core, spec.core, { standard: true, roughness: 0.34, metalness: 0.1 });

  const status = buildLayer(geometries.status, spec.status, { depthWrite: false });
  status.mesh.position.set(spec.status.position.x, spec.status.position.y, spec.status.position.z);

  return { group, shell, core, status };
}

function safeZoomToFit(instance: ForceGraph3DInstance<GoalMeshNode, GoalMeshLink>, graph: GoalMeshGraph, durationMs: number, padding = 58) {
  if (!graph.nodes.some(hasFiniteCoordinates)) return;
  try {
    instance.zoomToFit(durationMs, padding, hasFiniteCoordinates);
  } catch {
    // The force graph can briefly have unresolved endpoints while data is swapping.
  }
}

function safeFocusNode(
  instance: ForceGraph3DInstance<GoalMeshNode, GoalMeshLink>,
  node: GoalMeshNode | undefined,
  graph: GoalMeshGraph,
  reducedMotion: boolean
) {
  if (!node) {
    safeZoomToFit(instance, graph, reducedMotion ? 0 : 540, 68);
    return false;
  }

  let currentCamera: GoalMeshVector | null = null;
  try {
    currentCamera = instance.cameraPosition();
  } catch {
    currentCamera = null;
  }

  const pose = goalMeshCameraPoseForNode(node, currentCamera, reducedMotion);
  if (!pose) {
    safeZoomToFit(instance, graph, reducedMotion ? 0 : 540, 68);
    return false;
  }

  try {
    instance.cameraPosition(pose.position, pose.lookAt, pose.durationMs);
    return true;
  } catch {
    safeZoomToFit(instance, graph, reducedMotion ? 0 : 540, 68);
    return false;
  }
}

export function GoalMeshMap({
  goals,
  selectedId,
  centerId,
  centerTitle,
  theme,
  importanceOverrides,
  progressOverrides,
  colorOverrides,
  onSelect
}: GoalMeshMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraph3DInstance<GoalMeshNode, GoalMeshLink> | null>(null);
  const selectedIdRef = useRef(selectedId);
  const centerIdRef = useRef(centerId);
  const onSelectRef = useRef(onSelect);
  const hoveredIdRef = useRef<string | null>(null);
  const themeRef = useRef<ResolvedTheme>(theme);
  const graphData = useMemo(
    () => buildGoalMeshGraph(goals, importanceOverrides, progressOverrides, colorOverrides, { id: centerId, title: centerTitle }),
    [centerId, centerTitle, colorOverrides, goals, importanceOverrides, progressOverrides]
  );
  const graphDataRef = useRef<GoalMeshGraph>(graphData);
  const engineGraphRef = useRef<GoalMeshGraph | null>(null);
  const engineNodeByIdRef = useRef<Map<string, GoalMeshNode>>(new Map());
  const nodeHandleByIdRef = useRef<Map<string, GoalMeshNodeHandle>>(new Map());
  const entranceActiveRef = useRef(false);
  const entranceFrameRef = useRef<number | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const reducedMotion = Boolean(useReducedMotion());
  const reducedMotionRef = useRef(reducedMotion);
  const selectedMeshNode = useMemo(() => graphData.nodes.find((node) => node.id === selectedId), [graphData.nodes, selectedId]);

  // 就地更新所有已渲染节点的材质/缩放(下一帧生效),不触发引擎的 Object3D 全量重建。
  const applyAllNodeVisuals = useCallback((instance = graphRef.current) => {
    if (!instance) return;
    const focus = { selectedId: selectedIdRef.current, hoveredId: hoveredIdRef.current };
    const links = graphDataRef.current.links;
    for (const [id, node] of engineNodeByIdRef.current) {
      const handle = nodeHandleByIdRef.current.get(id);
      if (!handle) continue;
      applyGoalMeshNodeObject(handle, goalMeshNodeObjectSpec(node, links, focus, themeRef.current));
    }
  }, []);

  // hover 路径的连线刷新:刻意不设 linkWidth——重设 linkWidth 会让引擎重建全部连线管体。
  const applyLinkColorsOnly = useCallback((instance = graphRef.current) => {
    if (!instance) return;
    instance
      .linkColor((link) =>
        goalMeshLinkVisualStyle(
          link,
          graphDataRef.current.links,
          { selectedId: selectedIdRef.current, hoveredId: hoveredIdRef.current },
          themeRef.current
        ).color
      )
      .linkDirectionalParticles((link) =>
        goalMeshLinkVisualStyle(
          link,
          graphDataRef.current.links,
          { selectedId: selectedIdRef.current, hoveredId: hoveredIdRef.current },
          themeRef.current
        ).particles
      )
      .linkDirectionalParticleWidth((link) =>
        goalMeshLinkVisualStyle(
          link,
          graphDataRef.current.links,
          { selectedId: selectedIdRef.current, hoveredId: hoveredIdRef.current },
          themeRef.current
        ).particleWidth
      )
      .linkDirectionalParticleColor((link) =>
        goalMeshLinkVisualStyle(
          link,
          graphDataRef.current.links,
          { selectedId: selectedIdRef.current, hoveredId: hoveredIdRef.current },
          themeRef.current
        ).color
      );
  }, []);

  // 完整连线样式(含宽度),只在选中变化等低频时刻调用。
  const applyLinkStyles = useCallback((instance = graphRef.current) => {
    if (!instance) return;
    applyLinkColorsOnly(instance);
    instance.linkWidth((link) =>
      goalMeshLinkVisualStyle(
        link,
        graphDataRef.current.links,
        { selectedId: selectedIdRef.current, hoveredId: hoveredIdRef.current },
        themeRef.current
      ).width
    );
  }, [applyLinkColorsOnly]);

  const cancelEntranceAnimation = useCallback(() => {
    if (entranceFrameRef.current !== null) {
      window.cancelAnimationFrame(entranceFrameRef.current);
      entranceFrameRef.current = null;
    }
    entranceActiveRef.current = false;
    for (const handle of nodeHandleByIdRef.current.values()) {
      handle.group.scale.setScalar(1);
    }
  }, []);

  const applyEntranceRevealScales = useCallback((progressById: Map<string, number>) => {
    for (const [id, handle] of nodeHandleByIdRef.current) {
      const progress = progressById.get(id);
      handle.group.scale.setScalar(progress === undefined ? 1 : goalMeshEntranceRevealScale(progress));
    }
  }, []);

  const playEntranceAnimation = useCallback(
    (instance: ForceGraph3DInstance<GoalMeshNode, GoalMeshLink>, engineNodes: GoalMeshNode[], seeds?: Map<string, GoalMeshVector>) => {
      cancelEntranceAnimation();
      const radialSeeds =
        seeds ??
        new Map(engineNodes.map((node) => [node.id, goalMeshEntranceSeed(node)] as const));

      // 先藏住节点，用短 warmup 避碰微调（树形成簇种子已表达层级），再作为绽放终点。
      applyEntranceRevealScales(new Map(engineNodes.map((node) => [node.id, 0])));
      placeGoalMeshNodesAtSeeds(engineNodes, radialSeeds);
      try {
        instance.warmupTicks(56).cooldownTicks(0);
        instance.graphData({
          nodes: engineNodes,
          links: normalizeEngineLinks(graphDataRef.current, new Set(engineNodes.map((node) => node.id)))
        });
      } catch {
        // settle is best-effort; fall back to radial seeds
      }
      const flightTargets = prepareGoalMeshEntrance(engineNodes);

      if (reducedMotionRef.current || engineNodes.length === 0) {
        placeGoalMeshNodesAtSeeds(engineNodes, flightTargets);
        // 减少动效：落到平衡位后同样钉住，保持与入场结束态一致。
        for (const node of engineNodes) {
          node.fx = finiteCoordinate(node.x) ? node.x : 0;
          node.fy = finiteCoordinate(node.y) ? node.y : 0;
          node.fz = finiteCoordinate(node.z) ? node.z : 0;
          node.vx = 0;
          node.vy = 0;
          node.vz = 0;
        }
        for (const handle of nodeHandleByIdRef.current.values()) handle.group.scale.setScalar(1);
        instance.warmupTicks(0).cooldownTicks(0);
        window.setTimeout(() => safeZoomToFit(instance, graphDataRef.current, 0, 68), 40);
        return;
      }

      const plan = planGoalMeshEntrance(engineNodes, flightTargets);
      entranceActiveRef.current = true;
      instance.warmupTicks(0).cooldownTicks(Number.POSITIVE_INFINITY);
      applyEntranceRevealScales(new Map(plan.items.map((item) => [item.id, 0])));
      // 入场一开始就按最终布局包围取总览，避免镜头贴太近只看见中心一团。
      try {
        const overview = goalMeshOverviewCameraPose(flightTargets.values());
        instance.cameraPosition(overview.position, overview.lookAt, 0);
      } catch {
        // camera may not be ready yet
      }

      const startedAt = performance.now();
      const tick = (now: number) => {
        if (!entranceActiveRef.current || graphRef.current !== instance) return;
        const elapsed = now - startedAt;
        const { progressById, done } = applyGoalMeshEntranceFrame(engineNodeByIdRef.current, plan, elapsed);
        applyEntranceRevealScales(progressById);
        if (!done) {
          entranceFrameRef.current = window.requestAnimationFrame(tick);
          return;
        }

        entranceFrameRef.current = null;
        entranceActiveRef.current = false;
        // 落点已是力平衡结果：保持 fx 钉住，避免 cooldown 把层级冲散。
        for (const handle of nodeHandleByIdRef.current.values()) handle.group.scale.setScalar(1);
        instance.warmupTicks(0).cooldownTicks(0);
        safeZoomToFit(instance, graphDataRef.current, 720, 72);
      };
      entranceFrameRef.current = window.requestAnimationFrame(tick);
    },
    [applyEntranceRevealScales, cancelEntranceAnimation]
  );

  const focusSelectedMeshNode = useCallback(() => {
    if (entranceActiveRef.current) return;
    const instance = graphRef.current;
    if (!instance) return;
    const node =
      engineNodeByIdRef.current.get(selectedIdRef.current) ?? graphDataRef.current.nodes.find((item) => item.id === selectedIdRef.current);
    safeFocusNode(instance, node, graphDataRef.current, reducedMotionRef.current);
  }, []);

  const resetMeshOverview = useCallback(() => {
    if (entranceActiveRef.current) return;
    const instance = graphRef.current;
    const nextCenterId = centerIdRef.current;
    selectedIdRef.current = nextCenterId;
    hoveredIdRef.current = null;
    setHoveredId(null);
    onSelectRef.current(nextCenterId);
    applyAllNodeVisuals(instance);
    applyLinkStyles(instance);
    if (instance) safeZoomToFit(instance, graphDataRef.current, reducedMotionRef.current ? 0 : 560, 72);
  }, [applyAllNodeVisuals, applyLinkStyles]);

  useEffect(() => {
    graphDataRef.current = graphData;
  }, [graphData]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    centerIdRef.current = centerId;
  }, [centerId]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    hoveredIdRef.current = hoveredId;
  }, [hoveredId]);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  // 主题切换:就地刷新全部节点材质与连线样式(低频),不重建引擎、不重排布局。
  useEffect(() => {
    if (themeRef.current === theme) return;
    themeRef.current = theme;
    applyAllNodeVisuals();
    applyLinkStyles();
  }, [theme, applyAllNodeVisuals, applyLinkStyles]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    let mounted = true;
    let resizeObserver: ResizeObserver | null = null;
    let disposeNodeGeometries: (() => void) | null = null;

    void Promise.all([import("3d-force-graph"), import("three")]).then(([forceGraphModule, three]) => {
      if (!mounted || !host.isConnected) return;

      const ForceGraph3D = forceGraphModule.default as unknown as new (
        element: HTMLElement,
        configOptions?: ConfigOptions
      ) => ForceGraph3DInstance<GoalMeshNode, GoalMeshLink>;
      const nodeGeometries = {
        core: new three.SphereGeometry(1, 24, 16),
        shell: new three.SphereGeometry(1, 32, 20),
        status: new three.SphereGeometry(1, 12, 8)
      };
      disposeNodeGeometries = () => {
        nodeGeometries.core.dispose();
        nodeGeometries.shell.dispose();
        nodeGeometries.status.dispose();
      };
      // 工厂只在节点首次进入引擎时被调用(digest 按对象身份缓存);把各层 mesh/material 句柄
      // 登记到注册表,后续 hover/select/属性变化直接就地改材质。
      const nodeObjectFactory = (node: GoalMeshNode): Object3D => {
        const handle = createGoalMeshNodeObject(
          three,
          nodeGeometries,
          node,
          graphDataRef.current.links,
          { selectedId: selectedIdRef.current, hoveredId: hoveredIdRef.current },
          themeRef.current
        );
        nodeHandleByIdRef.current.set(node.id, handle);
        return handle.group;
      };
      const { engineGraph: initialEngineGraph, nodeById } = reconcileEngineGraph(new Map(), graphDataRef.current);
      // 首次进入：先钉在中心，再由入场动画一颗颗展开到种子位。
      const entranceSeeds = prepareGoalMeshEntrance(initialEngineGraph.nodes);
      engineNodeByIdRef.current = nodeById;
      engineGraphRef.current = graphDataRef.current;
      const instance = new ForceGraph3D(host, {
        controlType: "orbit",
        rendererConfig: { antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: true }
      })
        .graphData(initialEngineGraph)
        .backgroundColor("rgba(0,0,0,0)")
        .showNavInfo(false)
        .enableNodeDrag(false)
        .nodeLabel(nodeLabel)
        .nodeThreeObject(nodeObjectFactory)
        .nodeThreeObjectExtend(false)
        .linkLabel(linkLabel)
        .linkColor((link) =>
          goalMeshLinkVisualStyle(
            link,
            graphDataRef.current.links,
            { selectedId: selectedIdRef.current, hoveredId: hoveredIdRef.current },
            themeRef.current
          ).color
        )
        .linkWidth((link) =>
          goalMeshLinkVisualStyle(
            link,
            graphDataRef.current.links,
            { selectedId: selectedIdRef.current, hoveredId: hoveredIdRef.current },
            themeRef.current
          ).width
        )
        .linkOpacity(0.72)
        .linkResolution(4)
        .linkHoverPrecision(5)
        .linkDirectionalParticles((link) =>
          goalMeshLinkVisualStyle(
            link,
            graphDataRef.current.links,
            { selectedId: selectedIdRef.current, hoveredId: hoveredIdRef.current },
            themeRef.current
          ).particles
        )
        .linkDirectionalParticleWidth((link) =>
          goalMeshLinkVisualStyle(
            link,
            graphDataRef.current.links,
            { selectedId: selectedIdRef.current, hoveredId: hoveredIdRef.current },
            themeRef.current
          ).particleWidth
        )
        .linkDirectionalParticleSpeed((link) =>
          goalMeshLinkVisualStyle(
            link,
            graphDataRef.current.links,
            { selectedId: selectedIdRef.current, hoveredId: hoveredIdRef.current },
            themeRef.current
          ).particleSpeed
        )
        .linkDirectionalParticleColor((link) =>
          goalMeshLinkVisualStyle(
            link,
            graphDataRef.current.links,
            { selectedId: selectedIdRef.current, hoveredId: hoveredIdRef.current },
            themeRef.current
          ).color
        )
        .onNodeHover((node) => {
          hoveredIdRef.current = node?.id ?? null;
          setHoveredId(node?.id ?? null);
        })
        .onNodeClick((node) => {
          // 相机聚焦由 selectedId effect 统一驱动;仅当点击已选中节点(prop 不会变化、effect 不触发)时补一次显式聚焦。
          const alreadySelected = selectedIdRef.current === node.id;
          selectedIdRef.current = node.id;
          engineNodeByIdRef.current.set(node.id, node);
          onSelectRef.current(node.id);
          applyAllNodeVisuals(instance);
          applyLinkStyles(instance);
          if (alreadySelected) safeFocusNode(instance, node, graphDataRef.current, reducedMotionRef.current);
        })
        .onBackgroundClick(() => {
          const nextCenterId = centerIdRef.current;
          selectedIdRef.current = nextCenterId;
          hoveredIdRef.current = null;
          setHoveredId(null);
          onSelectRef.current(nextCenterId);
          applyAllNodeVisuals(instance);
          applyLinkStyles(instance);
          safeZoomToFit(instance, graphDataRef.current, reducedMotionRef.current ? 0 : 560, 72);
        });

      instance.lights([
        new three.AmbientLight(0xffffff, 1.26),
        new three.DirectionalLight(0xffffff, 0.92),
        new three.PointLight(0x86fff1, 0.62, 760),
        new three.PointLight(0xf8f7ff, 0.22, 520)
      ]);

      const linkForce = instance.d3Force("link") as Partial<LinkForce> | undefined;
      // 静息长度由两端星体半径推导(goalMeshLinkRestLength),连线长短与节点大小保持协调。
      linkForce?.distance?.(goalMeshLinkRestLength);
      linkForce?.strength?.((link) => (link.type === "center" ? 0.7 : 0.88));
      const chargeForce = instance.d3Force("charge") as Partial<ChargeForce> | undefined;
      chargeForce?.strength?.(-76);
      instance.d3VelocityDecay(0.34).warmupTicks(0).cooldownTicks(Number.POSITIVE_INFINITY);

      const sizeGraph = () => {
        const rect = host.getBoundingClientRect();
        instance.width(Math.max(320, Math.floor(rect.width)));
        instance.height(Math.max(320, Math.floor(rect.height)));
      };
      sizeGraph();
      resizeObserver = new ResizeObserver(sizeGraph);
      resizeObserver.observe(host);

      graphRef.current = instance;
      setReady(true);
      // 等一帧让 nodeThreeObject 工厂建好句柄，再播绽放动画。
      window.setTimeout(() => {
        if (!mounted || graphRef.current !== instance) return;
        playEntranceAnimation(instance, initialEngineGraph.nodes, entranceSeeds);
      }, 32);
    });

    return () => {
      mounted = false;
      cancelEntranceAnimation();
      resizeObserver?.disconnect();
      graphRef.current?._destructor();
      graphRef.current = null;
      engineGraphRef.current = null;
      engineNodeByIdRef.current = new Map();
      nodeHandleByIdRef.current = new Map();
      disposeNodeGeometries?.();
      setReady(false);
    };
  }, [applyAllNodeVisuals, applyLinkStyles, cancelEntranceAnimation, playEntranceAnimation]);

  useEffect(() => {
    const instance = graphRef.current;
    if (!instance) return;
    const diff = diffGoalMeshTopology(engineGraphRef.current, graphData);

    if (diff.changed) {
      // 拓扑变化:复用既有节点对象(保留演化坐标与 Object3D),只有新节点从种子位置进入。
      // 增量变化用 warmupTicks(0) 让既有节点从当前位置平滑演化;整图替换(如切换目标地图)
      // 没有可保留的位置,重新播放从中心向外绽放的入场。
      const fullReplacement = diff.addedNodeIds.length === graphData.nodes.length;
      cancelEntranceAnimation();
      const { engineGraph, nodeById } = reconcileEngineGraph(engineNodeByIdRef.current, graphData);
      const entranceSeeds = fullReplacement ? prepareGoalMeshEntrance(engineGraph.nodes) : null;
      if (!fullReplacement) {
        // 入场结束会钉住坐标；增量增删时先松钉，让力模拟微调层级。
        releaseGoalMeshEntrancePins(engineGraph.nodes);
        instance.warmupTicks(0).cooldownTicks(120);
      }
      engineNodeByIdRef.current = nodeById;
      instance.graphData(engineGraph);
      for (const id of Array.from(nodeHandleByIdRef.current.keys())) {
        if (!nodeById.has(id)) nodeHandleByIdRef.current.delete(id);
      }
      applyLinkStyles(instance);
      applyAllNodeVisuals(instance);
      if (fullReplacement && entranceSeeds) {
        window.setTimeout(() => {
          if (graphRef.current !== instance) return;
          playEntranceAnimation(instance, engineGraph.nodes, entranceSeeds);
        }, 32);
      } else if (diff.nodeIdsChanged) {
        window.setTimeout(() => {
          if (entranceActiveRef.current) return;
          const selectedNode =
            engineNodeByIdRef.current.get(selectedIdRef.current) ??
            graphDataRef.current.nodes.find((node) => node.id === selectedIdRef.current);
          if (selectedNode) safeFocusNode(instance, selectedNode, graphDataRef.current, reducedMotionRef.current);
          else safeZoomToFit(instance, graphDataRef.current, reducedMotionRef.current ? 0 : 520, 68);
        }, 80);
      }
    } else {
      // 仅属性变化(编辑、预览滑块、reload 回流):就地同步数据字段并刷新视觉,不重置力模拟、不移动相机。
      for (const node of graphData.nodes) {
        const engineNode = engineNodeByIdRef.current.get(node.id);
        if (engineNode) mergeGoalMeshNodeData(engineNode, node);
      }
      applyAllNodeVisuals(instance);
      applyLinkColorsOnly(instance);
    }

    engineGraphRef.current = graphData;
  }, [graphData, applyAllNodeVisuals, applyLinkColorsOnly, applyLinkStyles, cancelEntranceAnimation, playEntranceAnimation]);

  useEffect(() => {
    applyAllNodeVisuals();
    applyLinkColorsOnly();
  }, [hoveredId, selectedId, applyAllNodeVisuals, applyLinkColorsOnly]);

  useEffect(() => {
    const instance = graphRef.current;
    if (!instance || entranceActiveRef.current) return;
    const selectedNode = engineNodeByIdRef.current.get(selectedId) ?? graphDataRef.current.nodes.find((node) => node.id === selectedId);
    if (!selectedNode) {
      safeZoomToFit(instance, graphDataRef.current, reducedMotionRef.current ? 0 : 540, 68);
      return;
    }

    safeFocusNode(instance, selectedNode, graphDataRef.current, reducedMotionRef.current);
  }, [selectedId]);

  return (
    <section
      className="goal-mesh-map"
      aria-label={`3D 目标网络，${graphData.nodes.length} 个目标，${graphData.links.length} 条关系`}
    >
      <div ref={containerRef} className="goal-mesh-viewport" />
      {!ready && (
        <div className="goal-mesh-loading" role="status" aria-label="正在展开三维目标网络">
          <span className="goal-mesh-loading-orb" aria-hidden="true" />
          <span className="goal-mesh-loading-text">正在展开星网…</span>
        </div>
      )}
      <div className="goal-mesh-controls" aria-label="3D 网图视角控制">
        <button
          type="button"
          className="goal-mesh-control"
          title="聚焦当前节点"
          aria-label="聚焦当前节点"
          disabled={!selectedMeshNode}
          onClick={focusSelectedMeshNode}
        >
          <Focus aria-hidden="true" />
        </button>
        <button type="button" className="goal-mesh-control" title="回到总览" aria-label="回到总览" onClick={resetMeshOverview}>
          <Maximize2 aria-hidden="true" />
        </button>
      </div>
      {graphData.nodes.length === 0 && <p className="empty-map-text mesh-empty-text">这个目标地图还没有目标</p>}
    </section>
  );
}
