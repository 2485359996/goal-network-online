import { describe, expect, it } from "vitest";
import type { GoalNode } from "../shared/types";
import {
  allocateGoalMeshAngularPlots,
  applyGoalMeshEntranceFrame,
  applyGoalMeshShellProjection,
  buildGoalMeshGraph,
  diffGoalMeshTopology,
  goalMeshCameraPoseForNode,
  goalMeshEntranceEase,
  goalMeshEntranceRevealScale,
  goalMeshLinkRestLength,
  goalMeshLinkVisualStyle,
  goalMeshNodeNeutralRadius,
  goalMeshNodeObjectSpec,
  goalMeshNodeRadius,
  goalMeshNodeVisualStyle,
  goalMeshOverviewCameraPose,
  goalMeshShellGap,
  goalMeshShellRadiusForDepth,
  graphDataForEngine,
  lerpGoalMeshVector,
  mergeGoalMeshNodeData,
  normalizeEngineLinks,
  placeGoalMeshNodesAtSeeds,
  planGoalMeshEntrance,
  prepareGoalMeshEntrance,
  projectGoalMeshNodeToShell,
  reconcileEngineGraph,
  releaseGoalMeshEntrancePins,
  seedGoalMeshTreePositions
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
    expect(unrelatedStyle?.emissiveIntensity).toBeGreaterThanOrEqual(0.18);

    const childStyle = childLink && goalMeshLinkVisualStyle(childLink, graph.links, focus);
    expect(childStyle?.active).toBe(true);
    expect(childStyle?.particles).toBe(1);
  });

  it("uses progress and focus to shape the node shell and core", () => {
    const graph = buildGoalMeshGraph([goal({ id: "node" })]);
    const baseNode = graph.nodes[0];
    const lowStyle = goalMeshNodeVisualStyle({ ...baseNode, progress: 5 }, [], { selectedId: "root", hoveredId: null });
    const highStyle = goalMeshNodeVisualStyle({ ...baseNode, progress: 90 }, [], { selectedId: "root", hoveredId: null });
    const selectedStyle = goalMeshNodeVisualStyle({ ...baseNode, progress: 90 }, [], { selectedId: "node", hoveredId: null });

    expect(highStyle.coreScale).toBeGreaterThan(lowStyle.coreScale);
    expect(selectedStyle.shellOpacity).toBeGreaterThan(highStyle.shellOpacity);
    expect(selectedStyle.emissiveIntensity).toBeGreaterThan(highStyle.emissiveIntensity);
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
    expect(childStyle.emissiveIntensity).toBeGreaterThan(parentStyle.emissiveIntensity);
  });

  it("renders mesh node radii thirty-two percent larger", () => {
    const graph = buildGoalMeshGraph([goal({ id: "node", progress: 50 })], {}, {}, {}, { id: "map-1", title: "目标网络" });
    const goalNode = graph.nodes.find((node) => node.id === "node");
    const centerNode = graph.nodes.find((node) => node.id === "map-1");
    expect(goalNode).toBeDefined();
    expect(centerNode).toBeDefined();
    if (!goalNode || !centerNode) return;

    const goalStyle = goalMeshNodeVisualStyle({ ...goalNode, val: 12 }, [], { selectedId: "root", hoveredId: null });
    const centerStyle = goalMeshNodeVisualStyle(centerNode, [], { selectedId: "root", hoveredId: null });

    expect(goalMeshNodeRadius({ ...goalNode, val: 12 }, goalStyle)).toBeCloseTo(12 * 0.288 * goalStyle.scale * 1.32, 5);
    expect(goalMeshNodeRadius(centerNode, centerStyle)).toBeCloseTo(
      Math.min(13.68 * 1.32, Math.max(6.96 * 1.32, centerNode.val * 0.288 * centerStyle.scale * 1.32)),
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
    expect(pose?.distance ?? 0).toBeGreaterThan(215);
    expect(pose?.position.z ?? 0).toBeGreaterThan(260);
    expect(pose?.position.z ?? 0).toBeLessThan(300);
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

  it("frames the overview camera far enough to keep the whole seed map in view", () => {
    const near = goalMeshOverviewCameraPose([{ x: 40, y: 0, z: 0 }]);
    const wide = goalMeshOverviewCameraPose([
      { x: 180, y: 0, z: 0 },
      { x: -120, y: 90, z: 40 },
      { x: 0, y: -150, z: -60 }
    ]);

    expect(near.lookAt).toEqual({ x: 0, y: 0, z: 0 });
    expect(near.distance).toBeGreaterThanOrEqual(360);
    expect(wide.distance).toBeGreaterThan(near.distance);
    expect(Math.hypot(wide.position.x, wide.position.y, wide.position.z)).toBeCloseTo(wide.distance, 5);
    expect(wide.distance).toBeGreaterThan(180 * 2);
  });
});

describe("goalMeshLinkRestLength", () => {
  function meshNodes() {
    const child = goal({ id: "career-child", progress: 60 });
    const career = goal({ id: "career", children: [child] });
    const graph = buildGoalMeshGraph([career], {}, {}, {}, { id: "map-1", title: "网" });
    const center = graph.nodes.find((node) => node.kind === "map")!;
    const parent = graph.nodes.find((node) => node.id === "career")!;
    const leaf = graph.nodes.find((node) => node.id === "career-child")!;
    return { center, parent, leaf };
  }

  it("keeps a breathing gap beyond both endpoint surfaces", () => {
    const { center, parent, leaf } = meshNodes();
    const centerLink = { id: "career->map-1:center", source: parent, target: center, type: "center" as const };
    const parentLink = { id: "career-child->career:parent", source: leaf, target: parent, type: "parent" as const };

    for (const link of [centerLink, parentLink]) {
      const span = goalMeshNodeNeutralRadius(link.source) + goalMeshNodeNeutralRadius(link.target);
      expect(goalMeshLinkRestLength(link)).toBeGreaterThanOrEqual(span + 12);
    }
  });

  it("gives larger endpoints longer rest lengths so size and length stay coordinated", () => {
    const { parent, leaf } = meshNodes();
    const small = { id: "same-id", source: leaf, target: parent, type: "parent" as const };
    const big = { id: "same-id", source: { ...leaf, val: 28 }, target: parent, type: "parent" as const };

    expect(goalMeshNodeNeutralRadius(big.source)).toBeGreaterThan(goalMeshNodeNeutralRadius(leaf));
    expect(goalMeshLinkRestLength(big)).toBeGreaterThan(goalMeshLinkRestLength(small));
  });

  it("keeps center spokes longer than inter-shell parent links", () => {
    const { center, parent, leaf } = meshNodes();
    const centerLink = { id: "career->map-1:center", source: parent, target: center, type: "center" as const };
    const parentLink = { id: "career-child->career:parent", source: leaf, target: parent, type: "parent" as const };

    expect(goalMeshLinkRestLength(centerLink)).toBeGreaterThan(goalMeshLinkRestLength(parentLink));
    expect(goalMeshLinkRestLength(centerLink)).toBeGreaterThan(goalMeshShellRadiusForDepth(1) - 1);
    expect(goalMeshLinkRestLength(centerLink)).toBeLessThan(goalMeshShellRadiusForDepth(1) + 24);
    expect(goalMeshLinkRestLength(parentLink)).toBeGreaterThan(goalMeshShellGap - 1);
    expect(goalMeshLinkRestLength(parentLink)).toBeLessThan(goalMeshShellGap + 24);
  });

  it("falls back to a finite rest length for unresolved string endpoints", () => {
    const link = { id: "a->b:parent", source: "a", target: "b", type: "parent" as const };
    const length = goalMeshLinkRestLength(link);

    expect(Number.isFinite(length)).toBe(true);
    expect(length).toBeGreaterThanOrEqual(28);
  });
});

describe("diffGoalMeshTopology", () => {
  const baseGraph = () => buildGoalMeshGraph([goal({ id: "parent", children: [goal({ id: "child" })] })], {}, {}, {}, { id: "map-1", title: "网" });

  it("treats a null previous graph as changed", () => {
    const diff = diffGoalMeshTopology(null, baseGraph());
    expect(diff.changed).toBe(true);
    expect(diff.nodeIdsChanged).toBe(true);
    expect(diff.addedNodeIds.sort()).toEqual(["child", "map-1", "parent"]);
    expect(diff.removedNodeIds).toEqual([]);
  });

  it("detects node additions and removals", () => {
    const prev = baseGraph();
    const withSibling = buildGoalMeshGraph(
      [goal({ id: "parent", children: [goal({ id: "child" })] }), goal({ id: "sibling" })],
      {},
      {},
      {},
      { id: "map-1", title: "网" }
    );

    const added = diffGoalMeshTopology(prev, withSibling);
    expect(added.changed).toBe(true);
    expect(added.nodeIdsChanged).toBe(true);
    expect(added.addedNodeIds).toEqual(["sibling"]);

    const removed = diffGoalMeshTopology(withSibling, prev);
    expect(removed.changed).toBe(true);
    expect(removed.removedNodeIds).toEqual(["sibling"]);
  });

  it("detects link-only changes (same nodes, different structure)", () => {
    const flat = buildGoalMeshGraph([goal({ id: "a" }), goal({ id: "b" })]);
    const nested = buildGoalMeshGraph([goal({ id: "a", children: [goal({ id: "b" })] })]);

    const diff = diffGoalMeshTopology(flat, nested);
    expect(diff.nodeIdsChanged).toBe(false);
    expect(diff.linkIdsChanged).toBe(true);
    expect(diff.changed).toBe(true);
  });

  it("classifies progress/color/importance preview changes as property-only", () => {
    const prev = baseGraph();
    const next = buildGoalMeshGraph(
      [goal({ id: "parent", title: "改名了", children: [goal({ id: "child", progress: 90 })] })],
      { child: 80 },
      { child: 90 },
      { parent: "#e11d48" },
      { id: "map-1", title: "网" }
    );

    const diff = diffGoalMeshTopology(prev, next);
    expect(diff.changed).toBe(false);
    expect(diff.nodeIdsChanged).toBe(false);
    expect(diff.linkIdsChanged).toBe(false);
  });
});

describe("mergeGoalMeshNodeData", () => {
  it("copies data fields but never engine coordinates", () => {
    const graph = buildGoalMeshGraph([goal({ id: "node", progress: 10 })]);
    const target = { ...graph.nodes[0], x: 11, y: 22, z: 33, vx: 1, vy: 2, vz: 3, fx: 5 };
    const source = { ...graph.nodes[0], title: "新标题", progress: 90, color: "#e11d48", val: 20, x: 999, y: 999, z: 999 };

    mergeGoalMeshNodeData(target, source);

    expect(target.title).toBe("新标题");
    expect(target.progress).toBe(90);
    expect(target.color).toBe("#e11d48");
    expect(target.val).toBe(20);
    expect(target.x).toBe(11);
    expect(target.y).toBe(22);
    expect(target.z).toBe(33);
    expect(target.vx).toBe(1);
    expect(target.vy).toBe(2);
    expect(target.vz).toBe(3);
    expect(target.fx).toBe(5);
  });
});

describe("normalizeEngineLinks", () => {
  it("clones links to string endpoints and drops self or dangling references", () => {
    const graph = buildGoalMeshGraph([goal({ id: "parent", children: [goal({ id: "child" })] })]);
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const withBadLinks = {
      nodes: graph.nodes,
      links: [
        ...graph.links,
        { id: "self", source: "parent", target: "parent", type: "parent" as const },
        { id: "dangling", source: "child", target: "ghost", type: "parent" as const }
      ]
    };

    const links = normalizeEngineLinks(withBadLinks, nodeIds);

    expect(links.map((link) => link.id)).toEqual(["child->parent:parent"]);
    expect(links[0]).not.toBe(graph.links[0]);
    expect(links[0]).toMatchObject({ source: "child", target: "parent" });
  });
});

describe("reconcileEngineGraph", () => {
  it("keeps identity and evolved coordinates for existing nodes while updating data fields", () => {
    const first = buildGoalMeshGraph([goal({ id: "parent", children: [goal({ id: "child" })] })]);
    const { nodeById } = reconcileEngineGraph(new Map(), first);

    // 模拟力布局演化后的坐标。
    const evolved = nodeById.get("child");
    expect(evolved).toBeDefined();
    if (!evolved) return;
    evolved.x = 123;
    evolved.y = -45;
    evolved.z = 67;
    evolved.vx = 0.4;

    const second = buildGoalMeshGraph([goal({ id: "parent", children: [goal({ id: "child", progress: 90 })] })], {}, { child: 90 });
    const { engineGraph, nodeById: nextById } = reconcileEngineGraph(nodeById, second);

    const child = nextById.get("child");
    expect(child).toBe(evolved);
    expect(child).toMatchObject({ x: 123, y: -45, z: 67, vx: 0.4, progress: 90 });
    expect(engineGraph.nodes).toContain(evolved);
  });

  it("seeds new nodes with finite coordinates and drops removed nodes", () => {
    const first = buildGoalMeshGraph([goal({ id: "a" }), goal({ id: "b" })]);
    const { nodeById } = reconcileEngineGraph(new Map(), first);

    const second = buildGoalMeshGraph([goal({ id: "a" }), goal({ id: "c" })]);
    const { engineGraph, nodeById: nextById } = reconcileEngineGraph(nodeById, second);

    expect(nextById.has("b")).toBe(false);
    expect(engineGraph.nodes.map((node) => node.id).sort()).toEqual(["a", "c"]);
    const added = nextById.get("c");
    expect(added).toBeDefined();
    expect(Number.isFinite(added?.x)).toBe(true);
    expect(Number.isFinite(added?.y)).toBe(true);
    expect(Number.isFinite(added?.z)).toBe(true);
    // 新节点是克隆(不共享 buildGoalMeshGraph 的对象),避免外部突变引擎状态。
    expect(added).not.toBe(second.nodes.find((node) => node.id === "c"));
  });

  it("normalizes links against the surviving node set", () => {
    const first = buildGoalMeshGraph([goal({ id: "parent", children: [goal({ id: "child" })] })], {}, {}, {}, { id: "map-1", title: "网" });
    const { nodeById } = reconcileEngineGraph(new Map(), first);
    const { engineGraph } = reconcileEngineGraph(nodeById, first);

    expect(engineGraph.links.map((link) => link.id).sort()).toEqual(["child->parent:parent", "parent->map-1:center"]);
    expect(engineGraph.links.every((link) => typeof link.source === "string" && typeof link.target === "string")).toBe(true);
  });
});

describe("goalMeshNodeObjectSpec", () => {
  it("matches goalMeshNodeRadius and the layer multipliers used by the node factory", () => {
    const graph = buildGoalMeshGraph([goal({ id: "node", progress: 60 })]);
    const node = graph.nodes[0];
    const focus = { selectedId: "root", hoveredId: null };
    const style = goalMeshNodeVisualStyle(node, graph.links, focus);
    const radius = goalMeshNodeRadius(node, style);

    const spec = goalMeshNodeObjectSpec(node, graph.links, focus);

    expect(spec.radius).toBeCloseTo(radius, 8);
    expect(spec.shell.scale).toBeCloseTo(radius * 1.16, 8);
    expect(spec.core.scale).toBeCloseTo(radius * style.coreScale, 8);
    expect(spec.shell.opacity).toBe(style.shellOpacity);
    expect(spec.core.opacity).toBe(style.coreOpacity);
    expect(spec.core.emissiveIntensity).toBe(style.emissiveIntensity);
    expect(spec.shell.emissiveIntensity).toBe(0.12);
    expect(spec.status.position.x).toBeCloseTo(radius * 1.08, 8);
    expect(spec.status.position.y).toBeCloseTo(radius * 0.7, 8);
    expect(spec.status.position.z).toBeCloseTo(radius * 0.14, 8);
  });

  it("boosts shell emissive when selected, dims when unrelated", () => {
    const graph = buildGoalMeshGraph([goal({ id: "node" }), goal({ id: "other" })]);
    const node = graph.nodes.find((item) => item.id === "node");
    const other = graph.nodes.find((item) => item.id === "other");
    expect(node).toBeDefined();
    expect(other).toBeDefined();
    if (!node || !other) return;
    const links = buildGoalMeshGraph([goal({ id: "node", children: [goal({ id: "leaf" })] }), goal({ id: "other" })]).links;

    const selectedSpec = goalMeshNodeObjectSpec(node, links, { selectedId: "node", hoveredId: null });
    expect(selectedSpec.shell.emissiveIntensity).toBe(0.22);

    const dimmedSpec = goalMeshNodeObjectSpec(other, links, { selectedId: "node", hoveredId: null });
    expect(dimmedSpec.shell.emissiveIntensity).toBe(0.08);
    expect(dimmedSpec.status.opacity).toBe(0.72);
  });
});

describe("dark theme visibility", () => {
  const rgbaAlpha = (color: string) => {
    const match = color.match(/rgba?\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
    return match ? Number(match[1]) : 1;
  };
  const focusStates: Array<{ name: string; focus: { selectedId: string; hoveredId: string | null } }> = [
    { name: "default", focus: { selectedId: "root", hoveredId: null } },
    { name: "selected", focus: { selectedId: "node", hoveredId: null } },
    { name: "dimmed", focus: { selectedId: "other", hoveredId: null } }
  ];

  it("raises node emissive and layer opacities in dark mode across all focus states", () => {
    const graph = buildGoalMeshGraph([goal({ id: "node", children: [goal({ id: "leaf" })] }), goal({ id: "other" })]);
    const node = graph.nodes.find((item) => item.id === "node");
    expect(node).toBeDefined();
    if (!node) return;

    for (const { name, focus } of focusStates) {
      const light = goalMeshNodeVisualStyle(node, graph.links, focus);
      const dark = goalMeshNodeVisualStyle(node, graph.links, focus, "dark");

      expect(dark.emissiveIntensity, `${name} emissive`).toBeGreaterThan(light.emissiveIntensity);
      expect(dark.coreOpacity, `${name} core`).toBeGreaterThanOrEqual(light.coreOpacity);
      expect(dark.shellOpacity, `${name} shell`).toBeGreaterThan(light.shellOpacity);
      for (const value of [dark.coreOpacity, dark.shellOpacity]) {
        expect(value).toBeLessThanOrEqual(1);
      }
      // 布局相关字段不受主题影响。
      expect(dark.scale, `${name} scale`).toBe(light.scale);
      expect(dark.coreScale, `${name} coreScale`).toBe(light.coreScale);
    }
  });

  it("raises link alpha in dark mode while keeping width and particles unchanged", () => {
    const graph = buildGoalMeshGraph([goal({ id: "parent", children: [goal({ id: "child" })] })], {}, {}, {}, { id: "map-1", title: "网" });
    const centerLink = graph.links.find((link) => link.type === "center");
    const parentLink = graph.links.find((link) => link.type === "parent");
    expect(centerLink).toBeDefined();
    expect(parentLink).toBeDefined();
    if (!centerLink || !parentLink) return;

    for (const { name, focus } of [
      { name: "default", focus: { selectedId: "root", hoveredId: null } },
      { name: "focused", focus: { selectedId: "parent", hoveredId: null } }
    ]) {
      for (const link of [centerLink, parentLink]) {
        const light = goalMeshLinkVisualStyle(link, graph.links, focus);
        const dark = goalMeshLinkVisualStyle(link, graph.links, focus, "dark");
        expect(rgbaAlpha(dark.color), `${name} ${link.type} alpha`).toBeGreaterThan(rgbaAlpha(light.color));
        expect(rgbaAlpha(dark.color)).toBeLessThanOrEqual(1);
        expect(dark.width).toBe(light.width);
        expect(dark.particles).toBe(light.particles);
        expect(dark.particleWidth).toBe(light.particleWidth);
      }
    }
  });

  it("brightens node core/shell colors in dark mode but keeps original hex in light mode", () => {
    const graph = buildGoalMeshGraph([goal({ id: "node" })], {}, {}, {}, { id: "map-1", title: "网" });
    const node = graph.nodes.find((item) => item.id === "node");
    const center = graph.nodes.find((item) => item.id === "map-1");
    expect(node).toBeDefined();
    expect(center).toBeDefined();
    if (!node || !center) return;
    const focus = { selectedId: "root", hoveredId: null };

    const lightSpec = goalMeshNodeObjectSpec(node, graph.links, focus);
    expect(lightSpec.core.color).toBe(node.color);
    expect(lightSpec.shell.color).toBe(node.color);

    const darkSpec = goalMeshNodeObjectSpec(node, graph.links, focus, "dark");
    expect(darkSpec.core.color).not.toBe(node.color);
    expect(darkSpec.core.color).toMatch(/^rgb\(/);
    expect(darkSpec.shell.emissiveIntensity ?? 0).toBeGreaterThan(lightSpec.shell.emissiveIntensity ?? 0);

    // 深色下中心金球被提亮(各通道不低于原金色，且保持暖色：红 > 蓝)。
    const darkCenter = goalMeshNodeObjectSpec(center, graph.links, focus, "dark");
    const channels = darkCenter.core.color.match(/\d+/g)?.map(Number) ?? [];
    expect(channels.length).toBe(3);
    expect(channels[0]).toBeGreaterThanOrEqual(0xd4);
    expect(channels[1]).toBeGreaterThanOrEqual(0xa0);
    expect(channels[2]).toBeGreaterThanOrEqual(0x17);
    expect(channels[0]).toBeGreaterThan(channels[2]);
  });

  it("keeps light theme as the default when theme argument is omitted", () => {
    const graph = buildGoalMeshGraph([goal({ id: "node" })]);
    const node = graph.nodes[0];
    const focus = { selectedId: "root", hoveredId: null };

    const implicit = goalMeshNodeVisualStyle(node, graph.links, focus);
    const explicit = goalMeshNodeVisualStyle(node, graph.links, focus, "light");
    expect(implicit).toEqual(explicit);
    expect(implicit.emissiveIntensity).toBe(0.32);

    const implicitSpec = goalMeshNodeObjectSpec(node, graph.links, focus);
    const explicitSpec = goalMeshNodeObjectSpec(node, graph.links, focus, "light");
    expect(implicitSpec).toEqual(explicitSpec);
  });
});

describe("goal mesh entrance bloom", () => {
  it("orders nodes from center outward and staggers deeper siblings later", () => {
    const grandchild = goal({ id: "grandchild" });
    const child = goal({ id: "child", children: [grandchild] });
    const parent = goal({ id: "parent", children: [child] });
    const sibling = goal({ id: "sibling" });
    const graph = buildGoalMeshGraph([parent, sibling], {}, {}, {}, { id: "map-1", title: "网" });
    const seeds = new Map(graph.nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 }]));
    const plan = planGoalMeshEntrance(graph.nodes, seeds);

    expect(plan.items[0]).toMatchObject({ id: "map-1", delayMs: 0 });
    const parentItem = plan.items.find((item) => item.id === "parent");
    const siblingItem = plan.items.find((item) => item.id === "sibling");
    const childItem = plan.items.find((item) => item.id === "child");
    const grandchildItem = plan.items.find((item) => item.id === "grandchild");

    expect(parentItem?.delayMs).toBeGreaterThan(0);
    expect(siblingItem?.delayMs).toBeGreaterThan(0);
    expect(childItem?.delayMs ?? 0).toBeGreaterThan(parentItem?.delayMs ?? 0);
    expect(grandchildItem?.delayMs ?? 0).toBeGreaterThan(childItem?.delayMs ?? 0);
    expect(parentItem?.to).toEqual(seeds.get("parent"));
    expect(plan.totalMs).toBeGreaterThan(grandchildItem?.delayMs ?? 0);
  });

  it("collapses nodes to the origin while preserving seed targets for the flight", () => {
    const graph = buildGoalMeshGraph([goal({ id: "career" }), goal({ id: "life" })], {}, {}, {}, { id: "map-1", title: "网" });
    const careerBefore = graph.nodes.find((node) => node.id === "career");
    expect(careerBefore).toBeDefined();
    if (!careerBefore) return;
    const expected = { x: careerBefore.x ?? 0, y: careerBefore.y ?? 0, z: careerBefore.z ?? 0 };
    expect(Math.hypot(expected.x, expected.y, expected.z)).toBeGreaterThan(1);

    const seeds = prepareGoalMeshEntrance(graph.nodes);
    expect(seeds.get("career")).toEqual(expected);
    for (const node of graph.nodes) {
      expect(node.x).toBe(0);
      expect(node.y).toBe(0);
      expect(node.z).toBe(0);
      expect(node.fx).toBe(0);
    }
  });

  it("places goal nodes free and pins the map center when restoring seeds", () => {
    const graph = buildGoalMeshGraph([goal({ id: "career" })], {}, {}, {}, { id: "map-1", title: "网" });
    const seeds = prepareGoalMeshEntrance(graph.nodes);
    placeGoalMeshNodesAtSeeds(graph.nodes, seeds);

    const center = graph.nodes.find((node) => node.id === "map-1");
    const career = graph.nodes.find((node) => node.id === "career");
    expect(center).toMatchObject({ x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 0 });
    expect(career).toMatchObject(seeds.get("career") ?? {});
    expect(career?.fx).toBeUndefined();
  });

  it("interpolates pinned positions during the flight and releases pins afterwards", () => {
    const graph = buildGoalMeshGraph([goal({ id: "career" })], {}, {}, {}, { id: "map-1", title: "网" });
    const seeds = prepareGoalMeshEntrance(graph.nodes);
    const plan = planGoalMeshEntrance(graph.nodes, seeds);
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

    const mid = applyGoalMeshEntranceFrame(nodeById, plan, 160 + 380);
    const career = nodeById.get("career");
    expect(career).toBeDefined();
    if (!career) return;
    expect(mid.done).toBe(false);
    expect(mid.progressById.get("career") ?? 0).toBeGreaterThan(0);
    expect(mid.progressById.get("career") ?? 0).toBeLessThan(1);
    expect(career.fx).toBe(career.x);
    expect(Math.hypot(career.x ?? 0, career.y ?? 0, career.z ?? 0)).toBeGreaterThan(1);

    const end = applyGoalMeshEntranceFrame(nodeById, plan, plan.totalMs);
    expect(end.done).toBe(true);
    expect(end.progressById.get("career")).toBe(1);
    expect(career).toMatchObject(seeds.get("career") ?? {});

    releaseGoalMeshEntrancePins(graph.nodes);
    expect(career.fx).toBeUndefined();
    expect(career.fy).toBeUndefined();
    expect(career.fz).toBeUndefined();
  });

  it("can keep the map center pinned when releasing entrance pins", () => {
    const graph = buildGoalMeshGraph([goal({ id: "career" })], {}, {}, {}, { id: "map-1", title: "网" });
    placeGoalMeshNodesAtSeeds(graph.nodes, prepareGoalMeshEntrance(graph.nodes));
    const center = graph.nodes.find((node) => node.id === "map-1")!;
    center.x = 2;
    center.y = -3;
    center.z = 4;
    releaseGoalMeshEntrancePins(graph.nodes, { pinMapCenter: true });
    expect(center).toMatchObject({ fx: 2, fy: -3, fz: 4 });
    expect(graph.nodes.find((node) => node.id === "career")?.fx).toBeUndefined();
  });

  it("eases reveal scale from a near-zero bloom to full size", () => {
    expect(goalMeshEntranceEase(0)).toBe(0);
    expect(goalMeshEntranceEase(1)).toBe(1);
    expect(goalMeshEntranceEase(0.5)).toBeGreaterThan(0.5);
    expect(goalMeshEntranceRevealScale(0)).toBeCloseTo(0.08, 5);
    expect(goalMeshEntranceRevealScale(1)).toBeCloseTo(1, 5);
    expect(lerpGoalMeshVector({ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 30 }, 0.5)).toEqual({ x: 5, y: 10, z: 15 });
  });
});

describe("goalMeshShellRadiusForDepth", () => {
  it("maps depth to concentric shell radii with a stable gap", () => {
    expect(goalMeshShellRadiusForDepth(0)).toBe(0);
    expect(goalMeshShellRadiusForDepth(1)).toBeGreaterThan(100);
    expect(goalMeshShellRadiusForDepth(2) - goalMeshShellRadiusForDepth(1)).toBe(goalMeshShellGap);
    expect(goalMeshShellRadiusForDepth(3) - goalMeshShellRadiusForDepth(2)).toBe(goalMeshShellGap);
    expect(goalMeshShellGap).toBeGreaterThan(40);
  });
});

describe("projectGoalMeshNodeToShell", () => {
  it("pins map/center nodes at the origin and goals onto their depth shell", () => {
    const mapProjected = projectGoalMeshNodeToShell({
      id: "map",
      kind: "map",
      depth: 0,
      x: 12,
      y: -4,
      z: 9
    });
    expect(mapProjected).toEqual({ x: 0, y: 0, z: 0 });

    const goalProjected = projectGoalMeshNodeToShell({
      id: "g",
      kind: "goal",
      depth: 2,
      x: 3,
      y: 0,
      z: 4
    });
    expect(Math.hypot(goalProjected.x, goalProjected.y, goalProjected.z)).toBeCloseTo(goalMeshShellRadiusForDepth(2), 8);
  });

  it("strips radial velocity when projecting a live node set", () => {
    const node = {
      id: "drift",
      title: "drift",
      domain: "",
      status: "active" as const,
      progress: 0,
      priority: 1,
      depth: 1,
      childCount: 0,
      branchId: "drift",
      branchTitle: "drift",
      color: "#fff",
      val: 10,
      kind: "goal" as const,
      x: 50,
      y: 0,
      z: 0,
      vx: 10,
      vy: 2,
      vz: 0
    };
    applyGoalMeshShellProjection([node]);
    expect(Math.hypot(node.x!, node.y!, node.z!)).toBeCloseTo(goalMeshShellRadiusForDepth(1), 8);
    expect(node.vx).toBeCloseTo(0, 8);
    expect(node.vy).toBeCloseTo(2, 8);
  });
});

describe("allocateGoalMeshAngularPlots", () => {
  function clampCos(value: number) {
    return Math.min(1, Math.max(-1, value));
  }

  function angularDistance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    const cos = a.x * b.x + a.y * b.y + a.z * b.z;
    return Math.acos(clampCos(cos));
  }

  it("splits the full sphere into non-overlapping top-level plots", () => {
    const plots = allocateGoalMeshAngularPlots(8, null, [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(plots).toHaveLength(8);
    for (let i = 0; i < plots.length; i += 1) {
      for (let j = i + 1; j < plots.length; j += 1) {
        const gap = angularDistance(plots[i].direction, plots[j].direction);
        expect(plots[i].halfAngle + plots[j].halfAngle).toBeLessThanOrEqual(gap + 1e-6);
      }
    }
  });

  it("subdivides a parent plot into child plots that stay inside the parent land", () => {
    const parent = { direction: { x: 0, y: 1, z: 0 }, halfAngle: 0.9 };
    const plots = allocateGoalMeshAngularPlots(5, parent, [10, 11, 12, 13, 14]);
    expect(plots).toHaveLength(5);
    for (const plot of plots) {
      expect(angularDistance(plot.direction, parent.direction)).toBeLessThanOrEqual(parent.halfAngle + 1e-6);
      expect(angularDistance(plot.direction, parent.direction) + plot.halfAngle).toBeLessThanOrEqual(parent.halfAngle + 1e-5);
    }
    for (let i = 0; i < plots.length; i += 1) {
      for (let j = i + 1; j < plots.length; j += 1) {
        const gap = angularDistance(plots[i].direction, plots[j].direction);
        expect(plots[i].halfAngle + plots[j].halfAngle).toBeLessThanOrEqual(gap + 1e-6);
      }
    }
  });
});

describe("seedGoalMeshTreePositions", () => {
  function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  function radial(a: { x: number; y: number; z: number }) {
    return Math.hypot(a.x, a.y, a.z);
  }

  function clampCos(value: number) {
    return Math.min(1, Math.max(-1, value));
  }

  function angularDistance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    const aLen = radial(a);
    const bLen = radial(b);
    const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / (aLen * bLen);
    return Math.acos(clampCos(cos));
  }

  it("keeps children angularly closer to their parent than to an unrelated top-level goal", () => {
    const childA = goal({ id: "child-a" });
    const childB = goal({ id: "child-b" });
    const parent = goal({ id: "parent", children: [childA, childB] });
    const other = goal({ id: "other" });
    const positions = seedGoalMeshTreePositions([parent, other]);
    const parentPos = positions.get("parent")!;
    const childPos = positions.get("child-a")!;
    const otherPos = positions.get("other")!;

    expect(angularDistance(childPos, parentPos)).toBeLessThan(angularDistance(childPos, otherPos));
  });

  it("spreads siblings around the parent with a meaningful fan angle", () => {
    const left = goal({ id: "left-child" });
    const right = goal({ id: "right-child" });
    const parent = goal({ id: "fan-parent", children: [left, right] });
    const positions = seedGoalMeshTreePositions([parent]);
    const parentPos = positions.get("fan-parent")!;
    const leftPos = positions.get("left-child")!;
    const rightPos = positions.get("right-child")!;

    const toLeft = { x: leftPos.x - parentPos.x, y: leftPos.y - parentPos.y, z: leftPos.z - parentPos.z };
    const toRight = { x: rightPos.x - parentPos.x, y: rightPos.y - parentPos.y, z: rightPos.z - parentPos.z };
    const leftLen = Math.hypot(toLeft.x, toLeft.y, toLeft.z);
    const rightLen = Math.hypot(toRight.x, toRight.y, toRight.z);
    const cos = (toLeft.x * toRight.x + toLeft.y * toRight.y + toLeft.z * toRight.z) / (leftLen * rightLen);
    const angle = Math.acos(clampCos(cos));

    expect(angle).toBeGreaterThan(0.35);
    expect(dist(leftPos, rightPos)).toBeGreaterThan(20);
  });

  it("places deeper nodes farther from the map center than their parent", () => {
    const grandchild = goal({ id: "gc" });
    const child = goal({ id: "c", children: [grandchild] });
    const parent = goal({ id: "p", children: [child] });
    const positions = seedGoalMeshTreePositions([parent]);

    expect(radial(positions.get("c")!)).toBeCloseTo(goalMeshShellRadiusForDepth(2), 8);
    expect(radial(positions.get("p")!)).toBeCloseTo(goalMeshShellRadiusForDepth(1), 8);
    expect(radial(positions.get("gc")!)).toBeCloseTo(goalMeshShellRadiusForDepth(3), 8);
    expect(radial(positions.get("c")!)).toBeGreaterThan(radial(positions.get("p")!));
    expect(radial(positions.get("gc")!)).toBeGreaterThan(radial(positions.get("c")!));
  });

  it("keeps same-depth goals on one concentric shell", () => {
    const tops = Array.from({ length: 12 }, (_, i) =>
      goal({
        id: `top-${i}`,
        children: Array.from({ length: 5 }, (_, j) => goal({ id: `top-${i}-child-${j}` }))
      })
    );
    const positions = seedGoalMeshTreePositions(tops);
    const depth1 = tops.map((item) => radial(positions.get(item.id)!));
    const depth2 = tops.flatMap((item) => (item.children || []).map((child) => radial(positions.get(child.id)!)));
    const mean1 = depth1.reduce((sum, value) => sum + value, 0) / depth1.length;
    const mean2 = depth2.reduce((sum, value) => sum + value, 0) / depth2.length;

    for (const value of depth1) {
      expect(Math.abs(value - mean1) / mean1).toBeLessThan(0.08);
    }
    for (const value of depth2) {
      expect(Math.abs(value - mean2) / mean2).toBeLessThan(0.08);
    }
    expect(mean2 - mean1).toBeGreaterThan(goalMeshShellGap * 0.9);
  });

  it("keeps sibling branches on their own land after plot allocation", () => {
    const aKids = [goal({ id: "a1" }), goal({ id: "a2" }), goal({ id: "a3" })];
    const bKids = [goal({ id: "b1" }), goal({ id: "b2" }), goal({ id: "b3" })];
    const branchA = goal({ id: "branch-a", children: aKids });
    const branchB = goal({ id: "branch-b", children: bKids });
    const positions = seedGoalMeshTreePositions([branchA, branchB]);
    const aPos = positions.get("branch-a")!;
    const bPos = positions.get("branch-b")!;

    for (const kid of aKids) {
      const pos = positions.get(kid.id)!;
      expect(angularDistance(pos, aPos)).toBeLessThan(angularDistance(pos, bPos));
    }
    for (const kid of bKids) {
      const pos = positions.get(kid.id)!;
      expect(angularDistance(pos, bPos)).toBeLessThan(angularDistance(pos, aPos));
    }
  });

  it("wires tree seeds into buildGoalMeshGraph node coordinates", () => {
    const child = goal({ id: "wired-child" });
    const parent = goal({ id: "wired-parent", children: [child] });
    const seeds = seedGoalMeshTreePositions([parent]);
    const graph = buildGoalMeshGraph([parent]);
    const parentNode = graph.nodes.find((node) => node.id === "wired-parent");
    const childNode = graph.nodes.find((node) => node.id === "wired-child");

    expect(parentNode).toMatchObject(seeds.get("wired-parent") ?? {});
    expect(childNode).toMatchObject(seeds.get("wired-child") ?? {});
  });

  it("gives the layout real volumetric depth instead of a flat plane", () => {
    const children = [goal({ id: "v0" }), goal({ id: "v1" }), goal({ id: "v2" }), goal({ id: "v3" })];
    const parent = goal({ id: "volume-parent", children });
    const other = goal({ id: "volume-other", children: [goal({ id: "v4" }), goal({ id: "v5" })] });
    const third = goal({ id: "volume-third" });
    const fourth = goal({ id: "volume-fourth" });
    const fifth = goal({ id: "volume-fifth" });
    const positions = seedGoalMeshTreePositions([parent, other, third, fourth, fifth]);
    const points = Array.from(positions.values());
    const zs = points.map((p) => p.z);
    const zSpan = Math.max(...zs) - Math.min(...zs);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xySpan = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));

    expect(zSpan).toBeGreaterThan(80);
    // 球体感：z 跨度应接近 xy 跨度，而不是薄片。
    expect(zSpan / xySpan).toBeGreaterThan(0.55);

    const parentPos = positions.get("volume-parent")!;
    const childOffsets = children.map((child) => {
      const pos = positions.get(child.id)!;
      return { x: pos.x - parentPos.x, y: pos.y - parentPos.y, z: pos.z - parentPos.z };
    });
    const cross = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    });
    const n1 = cross(childOffsets[0], childOffsets[1]);
    const n2 = cross(childOffsets[0], childOffsets[2]);
    const n3 = cross(childOffsets[1], childOffsets[2]);
    const nonPlanar =
      Math.hypot(n1.x - n2.x, n1.y - n2.y, n1.z - n2.z) +
      Math.hypot(n1.x - n3.x, n1.y - n3.y, n1.z - n3.z);
    expect(nonPlanar).toBeGreaterThan(0.15);
  });

  it("places top-level goals on a sphere around the map center", () => {
    const tops = Array.from({ length: 8 }, (_, i) => goal({ id: `sphere-${i}` }));
    const positions = seedGoalMeshTreePositions(tops);
    const radii = tops.map((item) => radial(positions.get(item.id)!));
    const mean = radii.reduce((sum, value) => sum + value, 0) / radii.length;
    for (const value of radii) {
      expect(Math.abs(value - mean) / mean).toBeLessThan(0.08);
    }
    expect(mean).toBeCloseTo(goalMeshShellRadiusForDepth(1), 8);
    const zs = tops.map((item) => positions.get(item.id)!.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(mean * 0.9);
  });

  it("supports multi-level trees without collapsing shells or producing NaN", () => {
    const deep = goal({
      id: "d1",
      children: [
        goal({
          id: "d2",
          children: [
            goal({
              id: "d3",
              children: [goal({ id: "d4a" }), goal({ id: "d4b" }), goal({ id: "d4c" })]
            })
          ]
        })
      ]
    });
    const positions = seedGoalMeshTreePositions([deep]);
    for (const pos of positions.values()) {
      expect(Number.isFinite(pos.x)).toBe(true);
      expect(Number.isFinite(pos.y)).toBe(true);
      expect(Number.isFinite(pos.z)).toBe(true);
    }
    expect(radial(positions.get("d4a")!) - radial(positions.get("d3")!)).toBeGreaterThan(goalMeshShellGap * 0.9);
    expect(radial(positions.get("d3")!) - radial(positions.get("d2")!)).toBeGreaterThan(goalMeshShellGap * 0.9);
  });
});
