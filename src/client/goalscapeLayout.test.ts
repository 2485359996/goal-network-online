import { describe, expect, it } from "vitest";
import type { GoalNode } from "../shared/types";
import {
  assignGoalscapeSlots,
  buildGoalscapeLayout,
  clampGoalscapePosition,
  goalscapeCenter,
  goalscapeChildOffset,
  goalscapeLiquidGeometry,
  parentMapFocusId
} from "./main";

function goal(id: string, title = id): GoalNode {
  return { id, title, domain: "", color: "", priority: 1, clarity: 1, children: [] } as unknown as GoalNode;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("goalscape layout", () => {
  it("keeps the three primary goal slots stable", () => {
    const slots = assignGoalscapeSlots([goal("a"), goal("b"), goal("c")]);

    expect(slots.get("a")).toMatchObject({ key: "life", x: 310, y: 380 });
    expect(slots.get("b")).toMatchObject({ key: "growth", x: 705, y: 255 });
    expect(slots.get("c")).toMatchObject({ key: "career", x: 622, y: 585 });
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

  it("uses saved or previewed map positions before generated slots", () => {
    const saved = { ...goal("saved"), map_positions: { root: { x: 420, y: 260 } } };
    const previewed = goal("previewed");
    const layouts = buildGoalscapeLayout([saved, previewed], {}, {}, { previewed: { x: 900, y: 510 } });

    expect(layouts.find((layout) => layout.node.id === "saved")).toMatchObject({ x: 420, y: 260 });
    expect(layouts.find((layout) => layout.node.id === "previewed")).toMatchObject({ x: 900, y: 510 });
  });

  it("scopes saved map positions to the current focus context", () => {
    const scoped = { ...goal("scoped"), map_positions: { root: { x: 420, y: 260 }, parent: { x: 880, y: 500 } } };

    expect(buildGoalscapeLayout([scoped], {}, {}, {}, "root")[0]).toMatchObject({ x: 420, y: 260 });
    expect(buildGoalscapeLayout([scoped], {}, {}, {}, "parent")[0]).toMatchObject({ x: 880, y: 500 });
    expect(buildGoalscapeLayout([scoped], {}, {}, {}, "other")[0]).toMatchObject({ x: 310, y: 380 });
  });

  it("keeps custom positions inside the goalscape viewbox", () => {
    expect(clampGoalscapePosition({ x: -100, y: 999 })).toEqual({ x: 80, y: 690 });
  });

  it("resolves the previous map focus for center-node double click", () => {
    const child = goal("child");
    const parent = { ...goal("parent"), children: [child] };

    expect(parentMapFocusId([parent], "child")).toBe("parent");
    expect(parentMapFocusId([parent], "parent")).toBe("root");
    expect(parentMapFocusId([parent], "root")).toBe("root");
  });

  it("maps progress to liquid amount instead of color depth", () => {
    const empty = goalscapeLiquidGeometry(100, 100, 120, 80, 0);
    const half = goalscapeLiquidGeometry(100, 100, 120, 80, 50);
    const full = goalscapeLiquidGeometry(100, 100, 120, 80, 100);

    expect(empty.fillRatio).toBe(0);
    expect(full.fillRatio).toBe(1);
    expect(empty.surfaceY).toBeCloseTo(empty.bottomY);
    expect(half.surfaceY).toBeLessThan(empty.surfaceY);
    expect(full.surfaceY).toBeLessThan(half.surfaceY);
    expect(Math.abs(half.surfaceY - 100)).toBeLessThan(3);
  });
});
