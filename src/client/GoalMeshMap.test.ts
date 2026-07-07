import { describe, expect, it } from "vitest";
import type { GoalNode } from "../shared/types";
import {
  buildGoalMeshGraph,
  goalMeshCameraPoseForNode,
  goalMeshLinkVisualStyle,
  goalMeshNodeRadius,
  goalMeshNodeVisualStyle,
  graphDataForEngine
} from "./GoalMeshMap";

function goal(input: { id: string; title?: string; goalMapId?: string; progress?: number; children?: GoalNode[] }): GoalNode {
  return {
    id: input.id,
    goalMapId: input.goalMapId ?? "map-1",
    title: input.title ?? input.id,
    filePath: "",
    status: "active",
    horizon: "",
    domain: "[[职业发展]]",
    parent: "",
    priority: 1,
    clarity: 0,
    progress: input.progress ?? 0,
    color: "",
    last_reviewed: "",
    last_progress: "",
    tags: [],
    sections: {
      summary: "",
      directions: [],
      directionHeading: "子方向",
      successSignals: [],
      actionCandidates: [],
      reviewQuestions: []
    },
    children: input.children ?? []
  };
}

describe("buildGoalMeshGraph", () => {
  it("builds a 3D graph from hierarchy", () => {
    const child = goal({ id: "career-child", progress: 70 });
    const career = goal({ id: "career", children: [child] });
    const life = goal({ id: "life" });

    const graph = buildGoalMeshGraph([career, life], {}, { "career-child": 90 }, { life: "#e11d48" });

    expect(graph.nodes.map((node) => node.id)).toEqual(["career", "career-child", "life"]);
    expect(graph.links.map((link) => link.id)).toEqual(["career-child->career:parent"]);
    expect(graph.links.map((link) => link.type)).toEqual(["parent"]);
    expect(graph.nodes.find((node) => node.id === "career-child")).toMatchObject({
      depth: 2,
      branchId: "career",
      branchTitle: "career",
      progress: 90
    });
    expect(graph.nodes.find((node) => node.id === "career")?.progress).toBe(90);
    expect(graph.nodes.find((node) => node.id === "life")?.color).toBe("#e11d48");
  });

  it("passes cloned string-endpoint snapshots to the graph engine", () => {
    const child = goal({ id: "child" });
    const parent = goal({ id: "parent", children: [child] });
    const graph = buildGoalMeshGraph([parent]);
    const engineGraph = graphDataForEngine(graph);

    engineGraph.links[0].source = engineGraph.nodes[0];
    engineGraph.nodes[0].x = 999;

    expect(graph.links[0].source).toBe("child");
    expect(graph.nodes[0].x).not.toBe(999);
    expect(graphDataForEngine(graph).links[0]).toMatchObject({ source: "child", target: "parent" });
  });

  it("adds a large current-map center node connected to top-level goals", () => {
    const career = goal({ id: "career", progress: 40 });
    const life = goal({ id: "life", progress: 80 });
    const graph = buildGoalMeshGraph([career, life], {}, {}, {}, { id: "map-1", title: "目标网络" });
    const center = graph.nodes.find((node) => node.id === "map-1");

    expect(center).toMatchObject({
      title: "目标网络",
      domain: "目标地图",
      kind: "map",
      depth: 0,
      childCount: 2
    });
    expect(center?.val ?? 0).toBeGreaterThan(graph.nodes.find((node) => node.id === "career")?.val ?? 0);
    expect(graph.links.filter((link) => link.type === "center").map((link) => link.id).sort()).toEqual([
      "career->map-1:center",
      "life->map-1:center"
    ]);
  });

  it("styles focused nodes and parent links above unrelated objects", () => {
    const child = goal({ id: "career-child", progress: 80 });
    const career = goal({ id: "career", children: [child] });
    const life = goal({ id: "life" });
    const unrelated = goal({ id: "unrelated" });
    const graph = buildGoalMeshGraph([career, life, unrelated]);
    const focus = { selectedId: "career", hoveredId: null };
    const selectedNode = graph.nodes.find((node) => node.id === "career");
    const childNode = graph.nodes.find((node) => node.id === "career-child");
    const siblingNode = graph.nodes.find((node) => node.id === "life");
    const unrelatedNode = graph.nodes.find((node) => node.id === "unrelated");
    const childLink = graph.links.find((link) => link.id === "career-child->career:parent");
    const unrelatedStyle =
      unrelatedNode && goalMeshNodeVisualStyle(unrelatedNode, graph.links, focus);

    expect(selectedNode && goalMeshNodeVisualStyle(selectedNode, graph.links, focus)).toMatchObject({
      selected: true,
      dimmed: false,
      active: true
    });
    expect(childNode && goalMeshNodeVisualStyle(childNode, graph.links, focus).dimmed).toBe(false);
    expect(siblingNode && goalMeshNodeVisualStyle(siblingNode, graph.links, focus).dimmed).toBe(true);
    expect(unrelatedStyle?.dimmed).toBe(true);
    expect(unrelatedStyle?.coreColor).toBe(unrelatedNode?.color);
    expect(unrelatedStyle?.coreOpacity).toBeGreaterThanOrEqual(0.58);
    expect(unrelatedStyle?.shellOpacity).toBeGreaterThanOrEqual(0.22);
    expect(unrelatedStyle?.ringOpacity).toBeGreaterThanOrEqual(0.36);
    expect(unrelatedStyle?.haloOpacity).toBeGreaterThanOrEqual(0.14);
    expect(unrelatedStyle?.emissiveIntensity).toBeGreaterThanOrEqual(0.18);

    const childStyle = childLink && goalMeshLinkVisualStyle(childLink, graph.links, focus);
    expect(childStyle?.active).toBe(true);
    expect(childStyle?.particles).toBe(1);
  });

  it("uses progress and focus to shape the node shell, core, and halo", () => {
    const graph = buildGoalMeshGraph([goal({ id: "node" })]);
    const baseNode = graph.nodes[0];
    const lowStyle = goalMeshNodeVisualStyle({ ...baseNode, progress: 5 }, [], { selectedId: "root", hoveredId: null });
    const highStyle = goalMeshNodeVisualStyle({ ...baseNode, progress: 90 }, [], { selectedId: "root", hoveredId: null });
    const selectedStyle = goalMeshNodeVisualStyle({ ...baseNode, progress: 90 }, [], { selectedId: "node", hoveredId: null });

    expect(highStyle.coreScale).toBeGreaterThan(lowStyle.coreScale);
    expect(selectedStyle.shellOpacity).toBeGreaterThan(highStyle.shellOpacity);
    expect(selectedStyle.rimOpacity).toBeGreaterThan(highStyle.rimOpacity);
    expect(selectedStyle.haloOpacity).toBeGreaterThan(highStyle.haloOpacity);
    expect(selectedStyle.ringColor).toBe("#fbbf24");
    expect(selectedStyle.scale).toBeGreaterThan(highStyle.scale);
  });

  it("keeps parent-level goal volume larger than child-level goals even when child metadata is stronger", () => {
    const child = goal({ id: "child", progress: 100 });
    const parent = goal({ id: "parent", progress: 0, children: [child] });
    const graph = buildGoalMeshGraph([parent]);
    const parentNode = graph.nodes.find((node) => node.id === "parent");
    const childNode = graph.nodes.find((node) => node.id === "child");
    expect(parentNode).toBeDefined();
    expect(childNode).toBeDefined();
    if (!parentNode || !childNode) return;

    const weakParentStyle = goalMeshNodeVisualStyle({ ...parentNode, val: 8.4, progress: 0, childCount: 0 }, graph.links, {
      selectedId: "root",
      hoveredId: null
    });
    const strongChildStyle = goalMeshNodeVisualStyle({ ...childNode, val: 28, progress: 100, childCount: 5 }, graph.links, {
      selectedId: "root",
      hoveredId: null
    });

    expect(weakParentStyle.scale).toBeGreaterThan(strongChildStyle.scale);
    expect(Math.pow(strongChildStyle.scale / weakParentStyle.scale, 3)).toBeLessThan(1);
  });

  it("does not let selected child node sphere size overtake its active parent level", () => {
    const child = goal({ id: "child", progress: 100 });
    const parent = goal({ id: "parent", progress: 0, children: [child] });
    const graph = buildGoalMeshGraph([parent]);
    const parentNode = graph.nodes.find((node) => node.id === "parent");
    const childNode = graph.nodes.find((node) => node.id === "child");
    expect(parentNode).toBeDefined();
    expect(childNode).toBeDefined();
    if (!parentNode || !childNode) return;

    const focus = { selectedId: "child", hoveredId: null };
    const parentStyle = goalMeshNodeVisualStyle({ ...parentNode, val: 8.4, progress: 0, childCount: 0 }, graph.links, focus);
    const childStyle = goalMeshNodeVisualStyle({ ...childNode, val: 28, progress: 100, childCount: 5 }, graph.links, focus);

    expect(parentStyle.scale).toBeGreaterThan(childStyle.scale);
    expect(childStyle.selected).toBe(true);
    expect(childStyle.haloOpacity).toBeGreaterThan(parentStyle.haloOpacity);
  });

  it("renders mesh node radii twenty percent larger", () => {
    const graph = buildGoalMeshGraph([goal({ id: "node", progress: 50 })], {}, {}, {}, { id: "map-1", title: "目标网络" });
    const goalNode = graph.nodes.find((node) => node.id === "node");
    const centerNode = graph.nodes.find((node) => node.id === "map-1");
    expect(goalNode).toBeDefined();
    expect(centerNode).toBeDefined();
    if (!goalNode || !centerNode) return;

    const goalStyle = goalMeshNodeVisualStyle({ ...goalNode, val: 12 }, [], { selectedId: "root", hoveredId: null });
    const centerStyle = goalMeshNodeVisualStyle(centerNode, [], { selectedId: "root", hoveredId: null });

    expect(goalMeshNodeRadius({ ...goalNode, val: 12 }, goalStyle)).toBeCloseTo(12 * 0.288 * goalStyle.scale * 1.2, 5);
    expect(goalMeshNodeRadius(centerNode, centerStyle)).toBeCloseTo(
      Math.min(13.68 * 1.2, Math.max(6.96 * 1.2, centerNode.val * 0.288 * centerStyle.scale * 1.2)),
      5
    );
  });

  it("does not connect same-level goals directly", () => {
    const child = goal({ id: "child" });
    const parent = goal({ id: "parent", children: [child] });
    const sibling = goal({ id: "sibling" });
    const graph = buildGoalMeshGraph([parent, sibling]);

    expect(graph.links.map((link) => link.id)).toEqual(["child->parent:parent"]);
    expect(graph.links.some((link) => link.source === "parent" && link.target === "sibling")).toBe(false);
  });

  it("renders center links stronger than ordinary structural links", () => {
    const child = goal({ id: "child" });
    const parent = goal({ id: "parent", children: [child] });
    const graph = buildGoalMeshGraph([parent], {}, {}, {}, { id: "map-1", title: "目标网络" });
    const centerLink = graph.links.find((link) => link.type === "center");
    const parentLink = graph.links.find((link) => link.type === "parent");
    expect(centerLink).toBeDefined();
    expect(parentLink).toBeDefined();
    if (!centerLink || !parentLink) return;

    const focus = { selectedId: "map-1", hoveredId: null };
    const centerStyle = goalMeshLinkVisualStyle(centerLink, graph.links, focus);
    const parentStyle = goalMeshLinkVisualStyle(parentLink, graph.links, focus);

    expect(centerStyle.width).toBeGreaterThan(parentStyle.width);
    expect(centerStyle.particleWidth).toBeGreaterThan(parentStyle.particleWidth);
  });

  it("keeps higher-level goals visually larger when priority and progress are equal", () => {
    const child = goal({ id: "child", progress: 50 });
    const parent = goal({ id: "parent", progress: 50, children: [child] });
    const graph = buildGoalMeshGraph([parent]);
    const baseNode = graph.nodes.find((node) => node.id === "child");
    expect(baseNode).toBeDefined();
    if (!baseNode) return;

    const shallowStyle = goalMeshNodeVisualStyle({ ...baseNode, id: "shallow", depth: 1, val: 12 }, [], {
      selectedId: "root",
      hoveredId: null
    });
    const deepStyle = goalMeshNodeVisualStyle({ ...baseNode, id: "deep", depth: 4, val: 12 }, [], {
      selectedId: "root",
      hoveredId: null
    });

    expect(shallowStyle.scale).toBeGreaterThan(deepStyle.scale);
    expect(shallowStyle.scale - deepStyle.scale).toBeGreaterThan(0.16);
  });

  it("keeps arbitrary adjacent goal levels about forty percent apart in visual volume", () => {
    const graph = buildGoalMeshGraph([goal({ id: "base" })]);
    const baseNode = graph.nodes[0];
    const styleAtDepth = (depth: number) =>
      goalMeshNodeVisualStyle({ ...baseNode, depth, val: 12, progress: 50 }, [], {
        selectedId: "root",
        hoveredId: null
      });

    const depthOne = styleAtDepth(1);
    const depthTwo = styleAtDepth(2);
    const depthEight = styleAtDepth(8);
    const depthNine = styleAtDepth(9);

    expect(Math.pow(depthTwo.scale / depthOne.scale, 3)).toBeCloseTo(0.6, 5);
    expect(Math.pow(depthNine.scale / depthEight.scale, 3)).toBeCloseTo(0.6, 5);
  });

  it("does not clamp practical deep levels into the same node size", () => {
    const graph = buildGoalMeshGraph([goal({ id: "base" })]);
    const baseNode = graph.nodes[0];
    const depthEight = goalMeshNodeVisualStyle({ ...baseNode, depth: 8, val: 12, progress: 50 }, [], {
      selectedId: "root",
      hoveredId: null
    });
    const depthNine = goalMeshNodeVisualStyle({ ...baseNode, depth: 9, val: 12, progress: 50 }, [], {
      selectedId: "root",
      hoveredId: null
    });

    expect(depthEight.scale).toBeGreaterThan(depthNine.scale);
    expect(depthNine.scale).toBeGreaterThan(0.12);
  });

  it("does not connect adjacent goals on the same level", () => {
    const first = goal({ id: "first" });
    const second = goal({ id: "second" });
    const third = goal({ id: "third" });
    const graph = buildGoalMeshGraph([first, second, third]);

    expect(graph.links).toEqual([]);
  });

  it("calculates a focus camera pose from live node and camera coordinates", () => {
    const pose = goalMeshCameraPoseForNode(
      { x: 12, y: -24, z: 36, depth: 1, val: 20 },
      { x: 12, y: -24, z: 520 },
      false
    );

    expect(pose).toBeTruthy();
    expect(pose?.lookAt).toEqual({ x: 12, y: -24, z: 36 });
    expect(pose?.position.x).toBeCloseTo(12, 5);
    expect(pose?.position.y).toBeCloseTo(-24, 5);
    expect(pose?.distance ?? 0).toBeGreaterThan(300);
    expect(pose?.position.z ?? 0).toBeGreaterThan(340);
    expect(pose?.position.z ?? 0).toBeLessThan(390);
    expect(pose?.durationMs).toBeGreaterThan(0);
  });

  it("moves deeper nodes closer and respects reduced motion", () => {
    const shallow = goalMeshCameraPoseForNode({ x: 80, y: 0, z: 20, depth: 1, val: 12 }, null, false);
    const deep = goalMeshCameraPoseForNode({ x: 80, y: 0, z: 20, depth: 4, val: 12 }, null, true);

    expect(shallow).toBeTruthy();
    expect(deep).toBeTruthy();
    expect(shallow?.distance ?? 0).toBeGreaterThan(deep?.distance ?? 0);
    expect((shallow?.distance ?? 0) - (deep?.distance ?? 0)).toBeLessThan(28);
    expect(deep?.durationMs).toBe(0);
  });

  it("returns null camera pose for invalid node coordinates so callers can use overview fallback", () => {
    expect(goalMeshCameraPoseForNode({ x: Number.NaN, y: 0, z: 0, depth: 1, val: 12 })).toBeNull();
  });
});
