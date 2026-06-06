import { describe, expect, it } from "vitest";
import type { GoalNode } from "../shared/types";
import {
  assignGoalscapeSlots,
  buildGoalscapeLayout,
  canOpenGoalSubmap,
  clampGoalscapePosition,
  constrainGoalscapePositionToOrbit,
  goalscapeCenter,
  goalscapeCenterPearlSize,
  goalscapeChildOffset,
  goalscapeNodeDensity,
  goalscapeOrbitForDepth,
  goalscapeProgressFillGeometry,
  goalscapeStarlightCoreRadius,
  parentMapFocusId,
  weightedGoalProgress
} from "./main";

function goal(id: string, title = id): GoalNode {
  return { id, title, domain: "", color: "", priority: 1, clarity: 1, children: [] } as unknown as GoalNode;
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

describe("goalscape layout", () => {
  it("centers the goalscape composition in the svg viewbox", () => {
    const layouts = buildGoalscapeLayout([goal("life"), goal("growth"), goal("career")], {}, {});
    const compositionCenter = {
      x: (goalscapeCenter.x + layouts.reduce((sum, layout) => sum + layout.x, 0)) / (layouts.length + 1),
      y: (goalscapeCenter.y + layouts.reduce((sum, layout) => sum + layout.y, 0)) / (layouts.length + 1)
    };

    expect(goalscapeCenter).toMatchObject({ x: 600, y: 380 });
    expect(compositionCenter.x).toBeCloseTo(600, -1);
    expect(compositionCenter.y).toBeCloseTo(380, -1);
  });

  it("keeps the three primary goal slots stable", () => {
    const slots = assignGoalscapeSlots([goal("a"), goal("b"), goal("c")]);

    expect(slots.get("a")).toMatchObject({ key: "life", x: 382, y: 354 });
    expect(slots.get("b")).toMatchObject({ key: "growth", x: 777, y: 229 });
    expect(slots.get("c")).toMatchObject({ key: "career", x: 694, y: 559 });
  });

  it("places four primary goals in four quadrants", () => {
    const slots = Array.from(assignGoalscapeSlots([goal("a"), goal("b"), goal("c"), goal("d")]).values());
    const quadrants = new Set(
      slots.map((slot) => `${slot.x < goalscapeCenter.x ? "left" : "right"}-${slot.y < goalscapeCenter.y ? "top" : "bottom"}`)
    );

    expect(quadrants).toEqual(new Set(["left-top", "right-top", "right-bottom", "left-bottom"]));
  });

  it("spreads six primary goals around the center with usable spacing", () => {
    const slots = Array.from(assignGoalscapeSlots(Array.from({ length: 6 }, (_, index) => goal(`goal-${index}`))).values());

    expect(slots).toHaveLength(6);
    slots.forEach((slot) => {
      expect(slot.x).toBeGreaterThan(90);
      expect(slot.x).toBeLessThan(1110);
      expect(slot.y).toBeGreaterThan(90);
      expect(slot.y).toBeLessThan(670);
    });

    for (let outer = 0; outer < slots.length; outer += 1) {
      for (let inner = outer + 1; inner < slots.length; inner += 1) {
        expect(distance(slots[outer], slots[inner])).toBeGreaterThan(220);
      }
    }
  });

  it("fans child goals outward from the parent side", () => {
    const rightOffsets = Array.from({ length: 4 }, (_, index) => goalscapeChildOffset({ x: 925, y: goalscapeCenter.y }, index, 4));
    const leftOffsets = Array.from({ length: 4 }, (_, index) => goalscapeChildOffset({ x: 195, y: goalscapeCenter.y }, index, 4));
    const topOffsets = Array.from({ length: 4 }, (_, index) => goalscapeChildOffset({ x: goalscapeCenter.x, y: 175 }, index, 4));
    const bottomOffsets = Array.from({ length: 4 }, (_, index) => goalscapeChildOffset({ x: goalscapeCenter.x, y: 645 }, index, 4));

    expect(rightOffsets.every((offset) => offset.x > 0)).toBe(true);
    expect(leftOffsets.every((offset) => offset.x < 0)).toBe(true);
    expect(topOffsets.every((offset) => offset.y < 0)).toBe(true);
    expect(bottomOffsets.every((offset) => offset.y > 0)).toBe(true);
  });

  it("projects saved or previewed map positions onto the matching orbit while preserving direction", () => {
    const saved = { ...goal("saved"), map_positions: { root: { x: 420, y: 260 } } };
    const previewed = goal("previewed");
    const layouts = buildGoalscapeLayout([saved, previewed], {}, {}, { previewed: { x: 900, y: 510 } });
    const orbit = goalscapeOrbitForDepth(1);
    const savedLayout = layouts.find((layout) => layout.node.id === "saved");
    const previewedLayout = layouts.find((layout) => layout.node.id === "previewed");

    expect(savedLayout).toBeDefined();
    expect(previewedLayout).toBeDefined();
    expect(ellipseValue(savedLayout!, orbit)).toBeCloseTo(1, 2);
    expect(ellipseValue(previewedLayout!, orbit)).toBeCloseTo(1, 2);
    expect(angleFromCenter(savedLayout!)).toBeCloseTo(angleFromCenter({ x: 420, y: 260 }), 2);
    expect(angleFromCenter(previewedLayout!)).toBeCloseTo(angleFromCenter({ x: 900, y: 510 }), 2);
  });

  it("keeps child goal positions stable while previewing a parent drag", () => {
    const child = goal("child");
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

    expect(angleFromCenter(buildGoalscapeLayout([scoped], {}, {}, {}, "root")[0])).toBeCloseTo(angleFromCenter({ x: 420, y: 260 }), 2);
    expect(angleFromCenter(buildGoalscapeLayout([scoped], {}, {}, {}, "parent")[0])).toBeCloseTo(angleFromCenter({ x: 880, y: 500 }), 2);
    expect(angleFromCenter(buildGoalscapeLayout([scoped], {}, {}, {}, "other")[0])).toBeCloseTo(angleFromCenter({ x: 382, y: 354 }), 2);
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
    const child = goal("child");
    const parent = { ...goal("parent"), children: [child] };
    const layouts = buildGoalscapeLayout([parent], {}, {});
    const parentLayout = layouts.find((layout) => layout.node.id === "parent");
    const childLayout = layouts.find((layout) => layout.node.id === "child");

    expect(parentLayout).toBeDefined();
    expect(childLayout).toBeDefined();
    expect(ellipseValue(parentLayout!, goalscapeOrbitForDepth(1))).toBeCloseTo(1, 2);
    expect(ellipseValue(childLayout!, goalscapeOrbitForDepth(2))).toBeCloseTo(1, 2);
  });

  it("keeps higher-level goals closer to the center than child goals", () => {
    const child = goal("child");
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

  it("resolves the previous map focus for center-node double click", () => {
    const child = goal("child");
    const parent = { ...goal("parent"), children: [child] };

    expect(parentMapFocusId([parent], "child")).toBe("parent");
    expect(parentMapFocusId([parent], "parent")).toBe("root");
    expect(parentMapFocusId([parent], "root")).toBe("root");
  });

  it("allows descendant goals with children to open their own map focus", () => {
    const leaf = goal("leaf");
    const branch = { ...goal("branch"), children: [leaf] };

    expect(canOpenGoalSubmap({ node: goal("top"), depth: 1 })).toBe(true);
    expect(canOpenGoalSubmap({ node: branch, depth: 2 })).toBe(true);
    expect(canOpenGoalSubmap({ node: leaf, depth: 2 })).toBe(false);
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
