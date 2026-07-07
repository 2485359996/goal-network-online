"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfigOptions, ForceGraph3DInstance, LinkObject, NodeObject } from "3d-force-graph";
import { useReducedMotion } from "framer-motion";
import { Focus, Maximize2 } from "lucide-react";
import type { BufferGeometry, Object3D } from "three";
import type { GoalNode, GoalStatus } from "../shared/types";
import {
  averageProgress,
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
type GoalMeshNodeObjectFactory = (node: GoalMeshNode) => Object3D;

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
  ringColor: string;
  statusColor: string;
  coreOpacity: number;
  shellOpacity: number;
  ringOpacity: number;
  rimOpacity: number;
  haloOpacity: number;
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
const goalMeshNodeRadiusScale = 1.2;

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
  const distance = clamp(292 - focusDepth * 7 + clamp(node.val, 8, 32) * 1.2, 248, 330);
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

function goalSeedPosition(goalId: string, depth: number, branchIndex: number, branchCount: number, siblingIndex: number) {
  const branchAngle = (Math.PI * 2 * branchIndex) / Math.max(1, branchCount) - Math.PI / 2;
  const hash = Array.from(goalId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const microAngle = ((hash % 41) - 20) * 0.008;
  const depthRadius = 58 + depth * 58 + siblingIndex * 4;
  const x = Math.cos(branchAngle + microAngle) * depthRadius;
  const y = Math.sin(branchAngle + microAngle) * depthRadius;
  const z = (depth - 2) * 36 + Math.sin(branchAngle * 1.7 + siblingIndex) * 44 + (hash % 29) - 14;
  return { x, y, z };
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
    color: "#0f766e",
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
  const siblingIndexById = new Map<string, number>();
  const collectSiblingIndexes = (items: GoalNode[]) => {
    items.forEach((goal, index) => {
      siblingIndexById.set(goal.id, index);
      collectSiblingIndexes(goal.children || []);
    });
  };
  collectSiblingIndexes(goals);

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
      kind: "goal",
      ...goalSeedPosition(goal.id, depth, branch.branchIndex, branch.branchCount, siblingIndexById.get(goal.id) ?? index)
    } satisfies GoalMeshNode;
  });

  const centerNode = buildGoalMeshCenterNode(center, goals, importanceOverrides, progressOverrides);
  const links = new Map<string, GoalMeshLink>();
  addCenterLinks(goals, center, links);
  addParentLinks(goals, links);

  return { nodes: centerNode ? [centerNode, ...nodes] : nodes, links: Array.from(links.values()) };
}

export function graphDataForEngine(graph: GoalMeshGraph): GoalMeshEngineGraph {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  return {
    nodes: graph.nodes.map((node) => ({ ...node })),
    links: graph.links.flatMap((link) => {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      if (!source || !target || source === target || !nodeIds.has(source) || !nodeIds.has(target)) return [];
      return [{ ...link, source, target }];
    })
  };
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
  focus: GoalMeshFocus
): GoalMeshNodeVisualStyle {
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
  const coreOpacity = selected ? 1 : dimmed ? 0.58 : graphFocused && active ? 0.94 : 0.86;
  const shellOpacity = selected ? 0.56 : dimmed ? 0.22 : graphFocused && active ? 0.34 : 0.26;
  const ringOpacity = selected ? 1 : dimmed ? 0.36 : graphFocused && active ? 0.68 : 0.46;
  const rimOpacity = selected ? 1 : dimmed ? 0.4 : graphFocused && active ? 0.7 : 0.5;
  const haloOpacity = selected ? 0.76 : dimmed ? 0.14 : graphFocused && active ? 0.3 : 0.18;
  const coreScale = clamp(0.58 + progressRatio * 0.42 + (selected ? 0.16 : 0), 0.58, 1.16);
  const emissiveIntensity = dimmed ? 0.18 : selected ? 0.96 : graphFocused && active ? 0.46 : 0.32;

  return {
    color: node.color,
    coreColor: node.color,
    shellColor: node.color,
    ringColor: selected ? "#fbbf24" : node.kind === "map" ? "#e5fdf8" : dimmed ? "#7dd3fc" : "#a7f3d0",
    statusColor: statusLightColors[node.status],
    coreOpacity,
    shellOpacity,
    ringOpacity,
    rimOpacity,
    haloOpacity,
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
  focus: GoalMeshFocus
): GoalMeshLinkVisualStyle {
  const focusId = focusIdFromState(focus);
  const graphFocused = focusTouchesGraph(links, focusId);
  const active = linkIsHighlighted(link, links, focus.selectedId, focus.hoveredId);
  const dimmed = graphFocused && !active;
  const isCenter = link.type === "center";
  const alpha = dimmed
    ? isCenter
      ? 0.16
      : 0.13
    : graphFocused
      ? isCenter
        ? 0.82
        : 0.74
      : isCenter
        ? 0.52
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

function createGoalMeshNodeObject(
  three: ThreeModule,
  geometries: { core: BufferGeometry; shell: BufferGeometry; ring: BufferGeometry; status: BufferGeometry },
  node: GoalMeshNode,
  links: GoalMeshLink[],
  focus: GoalMeshFocus
) {
  const style = goalMeshNodeVisualStyle(node, links, focus);
  const radius = goalMeshNodeRadius(node, style);
  const group = new three.Group();
  group.userData.goalId = node.id;

  const shellMaterial = new three.MeshStandardMaterial({
    color: new three.Color(style.shellColor),
    transparent: true,
    opacity: style.shellOpacity,
    roughness: 0.18,
    metalness: 0.22,
    emissive: new three.Color(style.shellColor),
    emissiveIntensity: style.dimmed ? 0.08 : style.selected ? 0.22 : 0.12
  });
  const shell = new three.Mesh(geometries.shell, shellMaterial);
  shell.scale.setScalar(radius * 1.16);
  group.add(shell);

  const coreMaterial = new three.MeshStandardMaterial({
    color: new three.Color(style.coreColor),
    transparent: true,
    opacity: style.coreOpacity,
    roughness: 0.34,
    metalness: 0.1,
    emissive: new three.Color(style.coreColor),
    emissiveIntensity: style.emissiveIntensity
  });
  const core = new three.Mesh(geometries.core, coreMaterial);
  core.scale.setScalar(radius * style.coreScale);
  group.add(core);

  const ringMaterial = new three.MeshBasicMaterial({
    color: new three.Color(style.ringColor),
    transparent: true,
    opacity: style.ringOpacity,
    depthWrite: false
  });
  const equator = new three.Mesh(geometries.ring, ringMaterial);
  equator.scale.setScalar(radius * 1.66);
  equator.rotation.x = Math.PI / 2;
  group.add(equator);

  const rimMaterial = new three.MeshBasicMaterial({
    color: new three.Color(style.selected ? "#ffffff" : style.ringColor),
    transparent: true,
    opacity: style.rimOpacity,
    depthWrite: false
  });
  const tiltedRim = new three.Mesh(geometries.ring, rimMaterial);
  tiltedRim.scale.setScalar(radius * 1.32);
  tiltedRim.rotation.x = Math.PI / 2.55;
  tiltedRim.rotation.y = Math.PI / 5.6;
  group.add(tiltedRim);

  const haloMaterial = new three.MeshBasicMaterial({
    color: new three.Color(style.ringColor),
    transparent: true,
    opacity: style.haloOpacity,
    depthWrite: false
  });
  const halo = new three.Mesh(geometries.ring, haloMaterial);
  halo.scale.setScalar(radius * 2.18);
  halo.rotation.x = Math.PI / 2.8;
  halo.rotation.y = Math.PI / 3.6;
  group.add(halo);

  const statusMaterial = new three.MeshBasicMaterial({
    color: new three.Color(style.statusColor),
    transparent: true,
    opacity: style.dimmed ? 0.72 : 0.96,
    depthWrite: false
  });
  const status = new three.Mesh(geometries.status, statusMaterial);
  status.scale.setScalar(clamp(radius * 0.16, 0.34, 0.78));
  status.position.set(radius * 1.08, radius * 0.7, radius * 0.14);
  group.add(status);

  return group;
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
  importanceOverrides,
  progressOverrides,
  colorOverrides,
  onSelect
}: GoalMeshMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraph3DInstance<GoalMeshNode, GoalMeshLink> | null>(null);
  const nodeObjectFactoryRef = useRef<GoalMeshNodeObjectFactory | null>(null);
  const selectedIdRef = useRef(selectedId);
  const centerIdRef = useRef(centerId);
  const onSelectRef = useRef(onSelect);
  const hoveredIdRef = useRef<string | null>(null);
  const graphData = useMemo(
    () => buildGoalMeshGraph(goals, importanceOverrides, progressOverrides, colorOverrides, { id: centerId, title: centerTitle }),
    [centerId, centerTitle, colorOverrides, goals, importanceOverrides, progressOverrides]
  );
  const graphDataRef = useRef<GoalMeshGraph>(graphData);
  const engineNodeByIdRef = useRef<Map<string, GoalMeshNode>>(new Map());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const reducedMotion = Boolean(useReducedMotion());
  const reducedMotionRef = useRef(reducedMotion);
  const selectedMeshNode = useMemo(() => graphData.nodes.find((node) => node.id === selectedId), [graphData.nodes, selectedId]);

  const refreshMeshVisuals = useCallback((instance = graphRef.current) => {
    if (!instance) return;
    if (nodeObjectFactoryRef.current) instance.nodeThreeObject(nodeObjectFactoryRef.current);
    instance
      .linkColor((link) =>
        goalMeshLinkVisualStyle(link, graphDataRef.current.links, {
          selectedId: selectedIdRef.current,
          hoveredId: hoveredIdRef.current
        }).color
      )
      .linkWidth((link) =>
        goalMeshLinkVisualStyle(link, graphDataRef.current.links, {
          selectedId: selectedIdRef.current,
          hoveredId: hoveredIdRef.current
        }).width
      )
      .linkDirectionalParticles((link) =>
        goalMeshLinkVisualStyle(link, graphDataRef.current.links, {
          selectedId: selectedIdRef.current,
          hoveredId: hoveredIdRef.current
        }).particles
      )
      .linkDirectionalParticleWidth((link) =>
        goalMeshLinkVisualStyle(link, graphDataRef.current.links, {
          selectedId: selectedIdRef.current,
          hoveredId: hoveredIdRef.current
        }).particleWidth
      )
      .linkDirectionalParticleSpeed((link) =>
        goalMeshLinkVisualStyle(link, graphDataRef.current.links, {
          selectedId: selectedIdRef.current,
          hoveredId: hoveredIdRef.current
        }).particleSpeed
      )
      .linkDirectionalParticleColor((link) =>
        goalMeshLinkVisualStyle(link, graphDataRef.current.links, {
          selectedId: selectedIdRef.current,
          hoveredId: hoveredIdRef.current
        }).color
      );
  }, []);

  const focusSelectedMeshNode = useCallback(() => {
    const instance = graphRef.current;
    if (!instance) return;
    const node =
      engineNodeByIdRef.current.get(selectedIdRef.current) ?? graphDataRef.current.nodes.find((item) => item.id === selectedIdRef.current);
    safeFocusNode(instance, node, graphDataRef.current, reducedMotionRef.current);
  }, []);

  const resetMeshOverview = useCallback(() => {
    const instance = graphRef.current;
    const nextCenterId = centerIdRef.current;
    selectedIdRef.current = nextCenterId;
    hoveredIdRef.current = null;
    setHoveredId(null);
    onSelectRef.current(nextCenterId);
    refreshMeshVisuals(instance);
    if (instance) safeZoomToFit(instance, graphDataRef.current, reducedMotionRef.current ? 0 : 560, 72);
  }, [refreshMeshVisuals]);

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
        ring: new three.TorusGeometry(1, 0.018, 8, 72),
        status: new three.SphereGeometry(1, 12, 8)
      };
      disposeNodeGeometries = () => {
        nodeGeometries.core.dispose();
        nodeGeometries.shell.dispose();
        nodeGeometries.ring.dispose();
        nodeGeometries.status.dispose();
      };
      const nodeObjectFactory: GoalMeshNodeObjectFactory = (node) =>
        createGoalMeshNodeObject(three, nodeGeometries, node, graphDataRef.current.links, {
          selectedId: selectedIdRef.current,
          hoveredId: hoveredIdRef.current
        });
      nodeObjectFactoryRef.current = nodeObjectFactory;
      const initialEngineGraph = graphDataForEngine(graphDataRef.current);
      engineNodeByIdRef.current = new Map(initialEngineGraph.nodes.map((node) => [node.id, node]));
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
          goalMeshLinkVisualStyle(link, graphDataRef.current.links, {
            selectedId: selectedIdRef.current,
            hoveredId: hoveredIdRef.current
          }).color
        )
        .linkWidth((link) =>
          goalMeshLinkVisualStyle(link, graphDataRef.current.links, {
            selectedId: selectedIdRef.current,
            hoveredId: hoveredIdRef.current
          }).width
        )
        .linkOpacity(0.72)
        .linkResolution(4)
        .linkHoverPrecision(5)
        .linkDirectionalParticles((link) =>
          goalMeshLinkVisualStyle(link, graphDataRef.current.links, {
            selectedId: selectedIdRef.current,
            hoveredId: hoveredIdRef.current
          }).particles
        )
        .linkDirectionalParticleWidth((link) =>
          goalMeshLinkVisualStyle(link, graphDataRef.current.links, {
            selectedId: selectedIdRef.current,
            hoveredId: hoveredIdRef.current
          }).particleWidth
        )
        .linkDirectionalParticleSpeed((link) =>
          goalMeshLinkVisualStyle(link, graphDataRef.current.links, {
            selectedId: selectedIdRef.current,
            hoveredId: hoveredIdRef.current
          }).particleSpeed
        )
        .linkDirectionalParticleColor((link) =>
          goalMeshLinkVisualStyle(link, graphDataRef.current.links, {
            selectedId: selectedIdRef.current,
            hoveredId: hoveredIdRef.current
          }).color
        )
        .onNodeHover((node) => {
          hoveredIdRef.current = node?.id ?? null;
          setHoveredId(node?.id ?? null);
        })
        .onNodeClick((node) => {
          selectedIdRef.current = node.id;
          engineNodeByIdRef.current.set(node.id, node);
          onSelectRef.current(node.id);
          refreshMeshVisuals(instance);
          safeFocusNode(instance, node, graphDataRef.current, reducedMotionRef.current);
        })
        .onBackgroundClick(() => {
          const nextCenterId = centerIdRef.current;
          selectedIdRef.current = nextCenterId;
          hoveredIdRef.current = null;
          setHoveredId(null);
          onSelectRef.current(nextCenterId);
          refreshMeshVisuals(instance);
          safeZoomToFit(instance, graphDataRef.current, reducedMotionRef.current ? 0 : 560, 72);
        });

      instance.lights([
        new three.AmbientLight(0xffffff, 1.26),
        new three.DirectionalLight(0xffffff, 0.92),
        new three.PointLight(0x86fff1, 0.62, 760),
        new three.PointLight(0xf8f7ff, 0.22, 520)
      ]);

      const linkForce = instance.d3Force("link") as Partial<LinkForce> | undefined;
      linkForce?.distance?.((link) => (link.type === "center" ? 112 : link.type === "parent" ? 74 + Math.min(38, link.id.length % 28) : 122));
      linkForce?.strength?.((link) => (link.type === "center" ? 0.58 : link.type === "parent" ? 0.76 : 0.1));
      const chargeForce = instance.d3Force("charge") as Partial<ChargeForce> | undefined;
      chargeForce?.strength?.(-118);
      instance.d3VelocityDecay(0.34).warmupTicks(88).cooldownTicks(142);

      const sizeGraph = () => {
        const rect = host.getBoundingClientRect();
        instance.width(Math.max(320, Math.floor(rect.width)));
        instance.height(Math.max(320, Math.floor(rect.height)));
      };
      sizeGraph();
      resizeObserver = new ResizeObserver(sizeGraph);
      resizeObserver.observe(host);
      window.setTimeout(() => safeZoomToFit(instance, graphDataRef.current, reducedMotionRef.current ? 0 : 620), 120);

      graphRef.current = instance;
    });

    return () => {
      mounted = false;
      resizeObserver?.disconnect();
      graphRef.current?._destructor();
      graphRef.current = null;
      nodeObjectFactoryRef.current = null;
      disposeNodeGeometries?.();
    };
  }, [refreshMeshVisuals]);

  useEffect(() => {
    const instance = graphRef.current;
    if (!instance) return;
    const engineGraph = graphDataForEngine(graphData);
    engineNodeByIdRef.current = new Map(engineGraph.nodes.map((node) => [node.id, node]));
    instance.graphData(engineGraph);
    refreshMeshVisuals(instance);
    window.setTimeout(() => {
      const selectedNode =
        engineNodeByIdRef.current.get(selectedIdRef.current) ?? graphDataRef.current.nodes.find((node) => node.id === selectedIdRef.current);
      if (selectedNode) safeFocusNode(instance, selectedNode, graphDataRef.current, reducedMotionRef.current);
      else safeZoomToFit(instance, graphDataRef.current, reducedMotionRef.current ? 0 : 520, 68);
    }, 80);
  }, [graphData, refreshMeshVisuals]);

  useEffect(() => {
    refreshMeshVisuals();
  }, [hoveredId, refreshMeshVisuals, selectedId]);

  useEffect(() => {
    const instance = graphRef.current;
    if (!instance) return;
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
