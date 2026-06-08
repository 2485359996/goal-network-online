import { describe, expect, it } from "vitest";
import type { GoalNode } from "../shared/types";
import {
  buildGoalscapeLayout,
  clampGoalscapePosition,
  constrainGoalscapePositionToOrbit,
  filterGoalsByGoalMap,
  goalMapCenterTitle,
  goalscapeCenter,
  goalscapeCenterPearlSize,
  goalscapeNodeDensity,
  goalscapeOrbitForDepth,
  goalscapeProgressFillGeometry,
  goalscapeStarlightCoreRadius,
  shouldShowFirstGoalMapCta,
  weightedGoalProgress
} from "./main";

function goal(id: string, title = id): GoalNode {
  return { id, goalMapId: "map-1", title, domain: "", color: "", priority: 1, clarity: 1, children: [] } as unknown as GoalNode;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ellipseValue(point: { x: number; y: number }, orbit: { cx: number; cy: number; rx: number; ry: number }) {
  return ((point.x - orbit.cx) ** 2) / orbit.rx ** 2 + ((point.y - orbit.cy) ** 2) / orbit.ry ** 2;
}

function angleFromCenter(point: { x: number; y: number }) {
  return Math.atan2(point.y - goalscapeCenter.y, point.x - goalscapeCenter.x);
}

function angleDegreesFromCenter(point: { x: number; y: number }) {
  return (Math.atan2(point.y - goalscapeCenter.y, point.x - goalscapeCenter.x) * 180) / Math.PI;
}

function angularDistanceDegrees(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

type SectorLayout = ReturnType<typeof buildGoalscapeLayout>[number] & {
  sectorStartAngle?: number;
  sectorEndAngle?: number;
  sectorMidAngle?: number;
  sectorRole?: "primary" | "descendant" | "ancestor" | "context";
};

function expectSectorLayout(layout: ReturnType<typeof buildGoalscapeLayout>[number] | undefined) {
  expect(layout).toBeDefined();
  const sectorLayout = layout as SectorLayout;
  expect(sectorLayout.sectorStartAngle).toBeTypeOf("number");
  expect(sectorLayout.sectorEndAngle).toBeTypeOf("number");
  expect(sectorLayout.sectorMidAngle).toBeTypeOf("number");
  expect(sectorLayout.sectorRole).toBeTypeOf("string");
  return sectorLayout as Required<Pick<SectorLayout, "sectorStartAngle" | "sectorEndAngle" | "sectorMidAngle" | "sectorRole">> &
    ReturnType<typeof buildGoalscapeLayout>[number];
}

function sectorSpan(layout: SectorLayout) {
  return (layout.sectorEndAngle ?? 0) - (layout.sectorStartAngle ?? 0);
}

function expectSectorInside(child: SectorLayout, parent: SectorLayout) {
  expect(child.sectorStartAngle).toBeGreaterThanOrEqual((parent.sectorStartAngle ?? 0) - 0.001);
  expect(child.sectorEndAngle).toBeLessThanOrEqual((parent.sectorEndAngle ?? 0) + 0.001);
  expect(child.sectorMidAngle).toBeGreaterThanOrEqual((parent.sectorStartAngle ?? 0) - 0.001);
  expect(child.sectorMidAngle).toBeLessThanOrEqual((parent.sectorEndAngle ?? 0) + 0.001);
}

function buildGoalscapeLayoutWithSelection(goals: GoalNode[], selectedId: string) {
  return (
    buildGoalscapeLayout as (
      goals: GoalNode[],
      importanceOverrides: Record<string, number>,
      progressOverrides: Record<string, number>,
      positionOverrides: Record<string, { x: number; y: number }>,
      mapContextId: string,
      selectedId: string
    ) => ReturnType<typeof buildGoalscapeLayout>
  )(goals, {}, {}, {}, "root", selectedId);
}

function layoutIds(layouts: ReturnType<typeof buildGoalscapeLayout>) {
  return layouts.map((layout) => layout.node.id);
}

describe("goalscape layout", () => {
  it("filters the visible goal tree by the active goal map", () => {
    const mapOneChild = goal("map-1-child");
    const mapOne = { ...goal("map-1-root"), children: [mapOneChild] };
    const mapTwo = { ...goal("map-2-root"), goalMapId: "map-2", children: [{ ...goal("map-2-child"), goalMapId: "map-2" }] };

    const filtered = filterGoalsByGoalMap([mapOne, mapTwo], "map-1");

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("map-1-root");
    expect(filtered[0].children.map((child) => child.id)).toEqual(["map-1-child"]);
  });

  it("derives goal map empty state and center title", () => {
    expect(shouldShowFirstGoalMapCta([], false)).toBe(true);
    expect(shouldShowFirstGoalMapCta([], true)).toBe(false);
    expect(shouldShowFirstGoalMapCta([{ id: "map-1", name: "目标网络", sortOrder: 0 }], false)).toBe(false);
    expect(goalMapCenterTitle({ name: "年度目标" })).toBe("年度目标");
    expect(goalMapCenterTitle(undefined)).toBe("目标地图");
  });

  it("centers the goalscape composition in the svg viewbox", () => {
    const layouts = buildGoalscapeLayout([goal("life"), goal("growth"), goal("career")], {}, {});
    const compositionCenter = {
      x: (goalscapeCenter.x + layouts.reduce((sum, layout) => sum + layout.x, 0)) / (layouts.length + 1),
      y: (goalscapeCenter.y + layouts.reduce((sum, layout) => sum + layout.y, 0)) / (layouts.length + 1)
    };

    expect(goalscapeCenter).toMatchObject({ x: 600, y: 380 });
    expect(compositionCenter.x).toBeCloseTo(600, -1);
    expect(Math.abs(compositionCenter.y - 380)).toBeLessThan(10);
  });

  it("lays out the first ring as contiguous weighted sunburst sectors from twelve o'clock", () => {
    const alpha = goal("alpha");
    const beta = { ...goal("beta"), children: [goal("beta-a"), goal("beta-b")] };
    const gamma = goal("gamma");
    const layouts = buildGoalscapeLayout([alpha, beta, gamma], {}, {});
    const topLayouts = [alpha, beta, gamma].map((item) => expectSectorLayout(layouts.find((layout) => layout.node.id === item.id)));
    const orbit = goalscapeOrbitForDepth(1, topLayouts[0].visibleDepth);

    expect(topLayouts.map((layout) => layout.sectorStartAngle)).toEqual([
      expect.closeTo(-90, 3),
      expect.closeTo(0, 3),
      expect.closeTo(180, 3)
    ]);
    expect(topLayouts.map((layout) => layout.sectorEndAngle)).toEqual([
      expect.closeTo(0, 3),
      expect.closeTo(180, 3),
      expect.closeTo(270, 3)
    ]);
    expect(topLayouts.reduce((sum, layout) => sum + sectorSpan(layout), 0)).toBeCloseTo(360, 3);
    for (const layout of topLayouts) {
      expect(angularDistanceDegrees(angleDegreesFromCenter(layout), layout.sectorMidAngle)).toBeLessThan(0.001);
      expect(ellipseValue(layout, orbit)).toBeCloseTo(1, 2);
    }
  });

  it("projects saved or previewed map positions onto the matching orbit while preserving direction", () => {
    const saved = { ...goal("saved"), map_positions: { root: { x: 900, y: 260 } } };
    const previewed = goal("previewed");
    const previewPosition = { x: 300, y: 500 };
    const layouts = buildGoalscapeLayout([saved, previewed], {}, {}, { previewed: previewPosition });
    const orbit = goalscapeOrbitForDepth(1, layouts[0].visibleDepth);
    const savedLayout = layouts.find((layout) => layout.node.id === "saved");
    const previewedLayout = layouts.find((layout) => layout.node.id === "previewed");

    expect(savedLayout).toBeDefined();
    expect(previewedLayout).toBeDefined();
    expect(ellipseValue(savedLayout!, orbit)).toBeCloseTo(1, 2);
    expect(ellipseValue(previewedLayout!, orbit)).toBeCloseTo(1, 2);
    expect(angleFromCenter(savedLayout!)).toBeCloseTo(angleFromCenter(saved.map_positions.root), 2);
    expect(angleFromCenter(previewedLayout!)).toBeCloseTo(angleFromCenter(previewPosition), 2);
  });

  it("keeps child goal positions stable while previewing a parent drag", () => {
    const child = { ...goal("child"), children: [goal("child-leaf")] };
    const parent = { ...goal("parent"), children: [child] };
    const baselineChild = buildGoalscapeLayout([parent], {}, {}).find((layout) => layout.node.id === "child");
    const draggedChild = buildGoalscapeLayout([parent], {}, {}, { parent: { x: 900, y: 510 } }).find((layout) => layout.node.id === "child");

    expect(baselineChild).toBeDefined();
    expect(draggedChild).toBeDefined();
    expect(draggedChild!.x).toBeCloseTo(baselineChild!.x, 5);
    expect(draggedChild!.y).toBeCloseTo(baselineChild!.y, 5);
  });

  it("scopes saved map positions to the current focus context", () => {
    const scoped = { ...goal("scoped"), map_positions: { root: { x: 420, y: 260 }, parent: { x: 880, y: 500 } } };
    const fallbackLayout = expectSectorLayout(buildGoalscapeLayout([scoped], {}, {}, {}, "other")[0]);

    expect(angleFromCenter(buildGoalscapeLayout([scoped], {}, {}, {}, "root")[0])).toBeCloseTo(angleFromCenter({ x: 420, y: 260 }), 2);
    expect(angleFromCenter(buildGoalscapeLayout([scoped], {}, {}, {}, "parent")[0])).toBeCloseTo(angleFromCenter({ x: 880, y: 500 }), 2);
    expect(angularDistanceDegrees(angleDegreesFromCenter(fallbackLayout), fallbackLayout.sectorMidAngle)).toBeLessThan(0.001);
  });

  it("keeps custom positions inside the goalscape viewbox", () => {
    expect(clampGoalscapePosition({ x: -100, y: 999 })).toEqual({ x: 80, y: 690 });
  });

  it("constrains arbitrary positions to an ellipse orbit", () => {
    const orbit = goalscapeOrbitForDepth(1);
    const constrained = constrainGoalscapePositionToOrbit({ x: 420, y: 260 }, orbit);
    const centered = constrainGoalscapePositionToOrbit(goalscapeCenter, orbit);

    expect(ellipseValue(constrained, orbit)).toBeCloseTo(1, 2);
    expect(angleFromCenter(constrained)).toBeCloseTo(angleFromCenter({ x: 420, y: 260 }), 2);
    expect(centered).toEqual({ x: orbit.cx, y: orbit.cy - orbit.ry });
  });

  it("places each visible depth on its own orbit", () => {
    const child = { ...goal("child"), children: [goal("child-leaf")] };
    const parent = { ...goal("parent"), children: [child] };
    const layouts = buildGoalscapeLayout([parent], {}, {});
    const parentLayout = layouts.find((layout) => layout.node.id === "parent");
    const childLayout = layouts.find((layout) => layout.node.id === "child");

    expect(parentLayout).toBeDefined();
    expect(childLayout).toBeDefined();
    expect(ellipseValue(parentLayout!, goalscapeOrbitForDepth(1))).toBeCloseTo(1, 2);
    expect(ellipseValue(childLayout!, goalscapeOrbitForDepth(2, childLayout!.visibleDepth))).toBeCloseTo(1, 2);
  });

  it("hides the outermost leaf ring by default and badges the parent", () => {
    const branch = { ...goal("branch"), children: [goal("branch-leaf-a"), goal("branch-leaf-b")] };
    const other = { ...goal("other"), children: [goal("other-leaf")] };
    const layouts = buildGoalscapeLayout([branch, other], {}, {});
    const branchLayout = layouts.find((layout) => layout.node.id === "branch") as
      | (ReturnType<typeof buildGoalscapeLayout>[number] & { childCount?: number })
      | undefined;
    const otherLayout = layouts.find((layout) => layout.node.id === "other") as
      | (ReturnType<typeof buildGoalscapeLayout>[number] & { childCount?: number })
      | undefined;

    expect(layoutIds(layouts)).toEqual(["branch", "other"]);
    expect(branchLayout?.childCount).toBe(2);
    expect(otherLayout?.childCount).toBe(1);
  });

  it("shows only the selected subtree's outermost leaves", () => {
    const branch = { ...goal("branch"), children: [goal("branch-leaf-a"), goal("branch-leaf-b")] };
    const other = { ...goal("other"), children: [goal("other-leaf")] };
    const layouts = buildGoalscapeLayoutWithSelection([branch, other], "branch");

    expect(layoutIds(layouts)).toEqual(["branch", "branch-leaf-a", "branch-leaf-b", "other"]);
    expect((layouts.find((layout) => layout.node.id === "branch") as { childCount?: number } | undefined)?.childCount).toBeUndefined();
    expect((layouts.find((layout) => layout.node.id === "other") as { childCount?: number } | undefined)?.childCount).toBe(1);
  });

  it("recursively lays out visible depth three nodes on matching orbits while hiding the outer leaf ring", () => {
    const greatGrandchild = goal("great-grandchild");
    const grandchild = { ...goal("grandchild"), children: [greatGrandchild] };
    const child = { ...goal("child"), children: [grandchild] };
    const parent = { ...goal("parent"), children: [child] };
    const layouts = buildGoalscapeLayout([parent], {}, {});

    expect(layouts.map((layout) => layout.node.id)).toEqual(["parent", "child", "grandchild"]);
    expect((layouts.find((layout) => layout.node.id === "grandchild") as { childCount?: number } | undefined)?.childCount).toBe(1);
    for (const layout of layouts) {
      expect(ellipseValue(layout, goalscapeOrbitForDepth(layout.depth, layout.visibleDepth))).toBeCloseTo(1, 2);
    }
  });

  it("collapses crowded descendants into a readable child-count badge", () => {
    const crowdedBranch = {
      ...goal("crowded-branch"),
      children: Array.from({ length: 32 }, (_, index) => goal(`hidden-${index}`))
    };
    const parent = { ...goal("parent"), children: [crowdedBranch] };
    const layouts = buildGoalscapeLayout([parent], {}, {});
    const branchLayout = layouts.find((layout) => layout.node.id === "crowded-branch") as
      | (ReturnType<typeof buildGoalscapeLayout>[number] & { childCount?: number })
      | undefined;

    expect(branchLayout).toBeDefined();
    expect(branchLayout!.childCount).toBe(32);
    expect(layouts.some((layout) => layout.node.id.startsWith("hidden-"))).toBe(false);
  });

  it("expands the selected path sector and compresses unrelated sibling sectors", () => {
    const focus = { ...goal("focus"), children: [goal("focus-leaf")] };
    const sibling = { ...goal("sibling"), children: [goal("sibling-leaf")] };
    const selectedTop = { ...goal("selected-top"), children: [focus, sibling] };
    const otherTop = { ...goal("other-top"), children: [goal("other-leaf")] };
    const neutralLayouts = buildGoalscapeLayout([selectedTop, otherTop], {}, {});
    const selectedLayouts = buildGoalscapeLayoutWithSelection([selectedTop, otherTop], "focus");
    const neutralTop = expectSectorLayout(neutralLayouts.find((layout) => layout.node.id === "selected-top"));
    const focusedTop = expectSectorLayout(selectedLayouts.find((layout) => layout.node.id === "selected-top"));
    const neutralOther = expectSectorLayout(neutralLayouts.find((layout) => layout.node.id === "other-top"));
    const focusedOther = expectSectorLayout(selectedLayouts.find((layout) => layout.node.id === "other-top"));
    const neutralFocus = expectSectorLayout(neutralLayouts.find((layout) => layout.node.id === "focus"));
    const focusedFocus = expectSectorLayout(selectedLayouts.find((layout) => layout.node.id === "focus"));
    const neutralSibling = expectSectorLayout(neutralLayouts.find((layout) => layout.node.id === "sibling"));
    const focusedSibling = expectSectorLayout(selectedLayouts.find((layout) => layout.node.id === "sibling"));

    expect(sectorSpan(focusedTop)).toBeGreaterThan(sectorSpan(neutralTop));
    expect(sectorSpan(focusedOther)).toBeLessThan(sectorSpan(neutralOther));
    expect(sectorSpan(focusedFocus)).toBeGreaterThan(sectorSpan(neutralFocus));
    expect(sectorSpan(focusedSibling)).toBeLessThan(sectorSpan(neutralSibling));
    expect(sectorSpan(focusedTop) + sectorSpan(focusedOther)).toBeCloseTo(360, 3);
    expect(sectorSpan(focusedFocus) + sectorSpan(focusedSibling)).toBeCloseTo(sectorSpan(focusedTop), 3);
  });

  it("moves the selected subtree closer to the visual center while keeping ancestors and unrelated branches visible", () => {
    const focusChild = goal("focus-child");
    const focus = { ...goal("focus"), children: [focusChild] };
    const parent = { ...goal("parent"), children: [focus, goal("parent-sibling")] };
    const other = { ...goal("other"), children: [goal("other-child")] };
    const neutralLayouts = buildGoalscapeLayout([parent, other], {}, {});
    const selectedLayouts = buildGoalscapeLayoutWithSelection([parent, other], "focus");
    const neutralFocus = neutralLayouts.find((layout) => layout.node.id === "focus");
    const selectedFocus = selectedLayouts.find((layout) => layout.node.id === "focus");
    const ancestor = selectedLayouts.find((layout) => layout.node.id === "parent");
    const unrelated = selectedLayouts.find((layout) => layout.node.id === "other");

    expect(neutralFocus).toBeDefined();
    expect(selectedFocus).toBeDefined();
    expect(distance(selectedFocus!, goalscapeCenter)).toBeLessThan(distance(neutralFocus!, goalscapeCenter));
    expect(ancestor).toBeDefined();
    expect(unrelated).toBeDefined();
    expect(ancestor!.opacity).toBeGreaterThanOrEqual(0.75);
    expect(unrelated!.opacity).toBeGreaterThanOrEqual(0.75);
  });

  it("enlarges the selected node and descendants while shrinking unrelated nodes", () => {
    const focusChild = goal("focus-child");
    const focus = { ...goal("focus"), children: [focusChild] };
    const other = { ...goal("other"), children: [goal("other-child")] };
    const layouts = buildGoalscapeLayoutWithSelection([focus, other], "focus");
    const focusLayout = layouts.find((layout) => layout.node.id === "focus");
    const focusChildLayout = layouts.find((layout) => layout.node.id === "focus-child");
    const otherLayout = layouts.find((layout) => layout.node.id === "other");

    expect(focusLayout).toBeDefined();
    expect(focusChildLayout).toBeDefined();
    expect(otherLayout).toBeDefined();
    expect(layouts.find((layout) => layout.node.id === "other-child")).toBeUndefined();
    expect(focusLayout!.width).toBeGreaterThan(otherLayout!.width);
    expect(focusLayout!.height).toBeGreaterThan(otherLayout!.height);
    expect(focusChildLayout!.width).toBeGreaterThan(otherLayout!.width);
    expect(focusChildLayout!.height).toBeGreaterThan(otherLayout!.height);
    expect(focusLayout!.opacity).toBe(1);
    expect(otherLayout!.opacity).toBeGreaterThanOrEqual(0.75);
    expect(otherLayout!.opacity).toBeLessThan(1);
  });

  it("keeps selected layouts in primary and descendant sectors instead of ancestor or context sectors", () => {
    const firstGrandchild = goal("first-grandchild");
    const secondGrandchild = goal("second-grandchild");
    const first = { ...goal("first"), children: [firstGrandchild, secondGrandchild] };
    const second = { ...goal("second"), children: [goal("third-grandchild")] };
    const focus = { ...goal("focus"), children: [first, second] };
    const root = { ...goal("root"), children: [focus] };
    const layouts = buildGoalscapeLayoutWithSelection([root], "focus");
    const firstLayout = expectSectorLayout(layouts.find((layout) => layout.node.id === "first"));
    const secondLayout = expectSectorLayout(layouts.find((layout) => layout.node.id === "second"));
    const firstGrandchildLayout = expectSectorLayout(layouts.find((layout) => layout.node.id === "first-grandchild"));
    const secondGrandchildLayout = expectSectorLayout(layouts.find((layout) => layout.node.id === "third-grandchild"));

    expect(layouts.map((layout) => layout.sectorRole)).not.toContain("ancestor");
    expect(layouts.map((layout) => layout.sectorRole)).not.toContain("context");
    expect(firstLayout.sectorEndAngle).toBeLessThanOrEqual(secondLayout.sectorStartAngle + 0.001);
    expectSectorInside(firstLayout, expectSectorLayout(layouts.find((layout) => layout.node.id === "focus")));
    expectSectorInside(secondLayout, expectSectorLayout(layouts.find((layout) => layout.node.id === "focus")));
    expectSectorInside(firstGrandchildLayout, firstLayout);
    expectSectorInside(secondGrandchildLayout, secondLayout);
  });

  it("returns to neutral depth semantics when the center is selected", () => {
    const grandchild = goal("grandchild");
    const child = { ...goal("child"), children: [grandchild] };
    const parent = { ...goal("parent"), children: [child] };
    const neutralLayouts = buildGoalscapeLayout([parent], {}, {});
    const centeredLayouts = buildGoalscapeLayoutWithSelection([parent], "root");

    expect(centeredLayouts.map((layout) => [layout.node.id, layout.depth])).toEqual(neutralLayouts.map((layout) => [layout.node.id, layout.depth]));
  });

  it("keeps higher-level goals closer to the center than child goals", () => {
    const child = { ...goal("child"), children: [goal("child-leaf")] };
    const parent = { ...goal("parent"), children: [child] };
    const layouts = buildGoalscapeLayout([parent], {}, {});
    const parentLayout = layouts.find((layout) => layout.node.id === "parent");
    const childLayout = layouts.find((layout) => layout.node.id === "child");

    expect(parentLayout).toBeDefined();
    expect(childLayout).toBeDefined();
    expect(distance(parentLayout!, goalscapeCenter)).toBeLessThan(distance(childLayout!, goalscapeCenter));
  });

  it("scales goal spheres down harmoniously from the center outward", () => {
    const firstChild = goal("first-child");
    const secondChild = goal("second-child");
    const parent = { ...goal("parent"), children: [firstChild, secondChild] };
    const siblingLayouts = buildGoalscapeLayout([goal("life"), goal("growth"), goal("career")], {}, {});
    const layouts = buildGoalscapeLayout([parent], {}, {});
    const parentLayout = layouts.find((layout) => layout.node.id === "parent");
    const childLayouts = layouts.filter((layout) => layout.parentId === "parent");
    const siblingWidths = siblingLayouts.map((layout) => layout.width);
    const siblingHeights = siblingLayouts.map((layout) => layout.height);

    expect(parentLayout).toBeDefined();
    expect(parentLayout!.width).toBeLessThan(goalscapeCenterPearlSize.width);
    expect(parentLayout!.height).toBeLessThan(goalscapeCenterPearlSize.height);
    expect(Math.max(...siblingWidths) - Math.min(...siblingWidths)).toBeLessThanOrEqual(12);
    expect(Math.max(...siblingHeights) - Math.min(...siblingHeights)).toBeLessThanOrEqual(12);
    childLayouts.forEach((layout) => {
      expect(layout.width).toBeLessThan(parentLayout!.width);
      expect(layout.height).toBeLessThan(parentLayout!.height);
    });
  });

  it("keeps adjacent level orbits visibly separated", () => {
    const innerOrbit = goalscapeOrbitForDepth(1);
    const outerOrbit = goalscapeOrbitForDepth(2);

    expect(outerOrbit.rx - innerOrbit.rx).toBeGreaterThanOrEqual(180);
    expect(outerOrbit.ry - innerOrbit.ry).toBeGreaterThanOrEqual(110);
  });

  it("interpolates crystal node density and starlight core radius correctly", () => {
    // Check node density scale from 0 to 100
    expect(goalscapeNodeDensity(0)).toBe(0.12);
    expect(goalscapeNodeDensity(50)).toBeCloseTo(0.46);
    expect(goalscapeNodeDensity(100)).toBe(0.8);

    // Out of bounds safety clamp
    expect(goalscapeNodeDensity(-20)).toBe(0.12);
    expect(goalscapeNodeDensity(150)).toBe(0.8);

    // Check core radius scale from 0 to 100
    expect(goalscapeStarlightCoreRadius(10, 0)).toBeCloseTo(2);
    expect(goalscapeStarlightCoreRadius(10, 50)).toBeCloseTo(6);
    expect(goalscapeStarlightCoreRadius(10, 100)).toBeCloseTo(10);
  });

  it("maps live progress previews to layout and fill geometry", () => {
    const previewed = { ...goal("previewed"), progress: 20 };
    const layout = buildGoalscapeLayout([previewed], {}, { previewed: 75 })[0];
    const fill = goalscapeProgressFillGeometry(layout.y, layout.height, layout.progress);

    expect(layout.progress).toBe(75);
    expect(fill.height).toBeCloseTo(layout.height * 0.75);
    expect(fill.y).toBeCloseTo(layout.y + layout.height / 2 - layout.height * 0.75);
  });

  it("derives parent progress from immediate child progress weighted by importance", () => {
    const light = { ...goal("light"), priority: 1, progress: 20 };
    const heavy = { ...goal("heavy"), priority: 3, progress: 80 };
    const parent = { ...goal("parent"), progress: 0, children: [light, heavy] };

    expect(weightedGoalProgress(parent)).toBe(65);
    expect(weightedGoalProgress(parent, { light: 75, heavy: 25 }, { heavy: 100 })).toBe(40);
    expect(buildGoalscapeLayout([parent], {}, {})[0].progress).toBe(65);
  });
});
