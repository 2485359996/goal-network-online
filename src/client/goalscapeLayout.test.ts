import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GoalNode } from "../shared/types";
import {
  ApiClientError,
  buildSunburstLayout,
  GOAL_PRESENTATION_STORAGE_KEY,
  GoalApp,
  buildGoalscapeLayout,
  clampGoalscapePosition,
  constrainGoalscapePositionToOrbit,
  filterGoalsByGoalMap,
  goalMapCenterTitle,
  goalscapeCenter,
  goalscapeCenterPearlSize,
  goalscapeCenterVisualMode,
  goalscapeBranchMapPositionPatches,
  goalHasMapPosition,
  isUnauthorizedApiError,
  mapAddActionAvailability,
  mapPositionPreviewForContext,
  goalscapeNodeDensity,
  goalscapeOrbitForDepth,
  goalscapeProgressFillGeometry,
  goalscapeStarlightCoreRadius,
  pruneSavedMapPositionPreviews,
  readGoalPresentationMode,
  shouldApplyGoalsResponse,
  shouldShowFirstGoalMapCta,
  SUNBURST_DEPTH_CONTROL_GEOMETRY,
  SUNBURST_VIEW_BOX,
  nextSunburstVisibleDepth,
  sunburstArcPath,
  sunburstDepthControlState,
  sunburstProgressArcPath,
  sunburstProgressEdgePath,
  withMapPositionPreview,
  withoutMapPositionPreview,
  writeGoalPresentationMode,
  weightedGoalProgress
} from "./main";
import { GOAL_THEME_COLORS } from "./goalUtils";

function goal(id: string, title = id): GoalNode {
  return { id, goalMapId: "map-1", title, domain: "", color: "", priority: 1, clarity: 1, children: [] } as unknown as GoalNode;
}

function clientStyles() {
  return readFileSync(new URL("./styles.css", import.meta.url), "utf8");
}

function clientMainSource() {
  return readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
}

function storageWith(value?: string) {
  const values = new Map<string, string>();
  if (value !== undefined) values.set(GOAL_PRESENTATION_STORAGE_KEY, value);
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, nextValue: string) => values.set(key, nextValue))
  };
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

function triangleCenter(points: readonly { x: number; y: number }[]) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
}

function triangleArea(points: readonly { x: number; y: number }[]) {
  const [a, b, c] = points;
  return Math.abs((a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) / 2);
}

function triangleTip(points: readonly { x: number; y: number }[]) {
  let tip = points[0];
  let longestOppositeSide = -Infinity;

  points.forEach((point, index) => {
    const a = points[(index + 1) % points.length];
    const b = points[(index + 2) % points.length];
    const oppositeSide = distance(a, b);
    if (oppositeSide > longestOppositeSide) {
      tip = point;
      longestOppositeSide = oppositeSide;
    }
  });

  return tip;
}

function triangleBounds(points: readonly { x: number; y: number }[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
}

function vector(from: { x: number; y: number }, to: { x: number; y: number }) {
  return {
    x: to.x - from.x,
    y: to.y - from.y
  };
}

function directionAlignment(a: { x: number; y: number }, b: { x: number; y: number }) {
  return (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
}

function cubicPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number
) {
  const u = 1 - t;
  return {
    x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y
  };
}

function xOnDepthControlArcAtY(y: number) {
  const values = SUNBURST_DEPTH_CONTROL_GEOMETRY.arcPath.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const [x0, y0, x1, y1, x2, y2, x3, y3] = values;
  let best = cubicPoint({ x: x0, y: y0 }, { x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }, 0);
  let bestDistance = Math.abs(best.y - y);

  for (let step = 1; step <= 1000; step += 1) {
    const point = cubicPoint({ x: x0, y: y0 }, { x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }, step / 1000);
    const pointDistance = Math.abs(point.y - y);
    if (pointDistance < bestDistance) {
      best = point;
      bestDistance = pointDistance;
    }
  }

  return best.x;
}

function angularDistanceDegrees(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function relativeAngleDegrees(angle: number, center: number) {
  return ((angle - center + 540) % 360) - 180;
}

function expectAngleClose(actual: number, expected: number) {
  expect(angularDistanceDegrees(actual, expected)).toBeLessThan(0.25);
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

function layoutSnapshot(layouts: ReturnType<typeof buildGoalscapeLayout>) {
  return layouts.map((layout) => ({
    id: layout.node.id,
    x: Math.round(layout.x),
    y: Math.round(layout.y),
    width: layout.width,
    height: layout.height,
    opacity: layout.opacity
  }));
}

describe("goalscape layout", () => {
  it("renders the goal app during server prerender without browser globals", () => {
    expect(() => renderToString(createElement(GoalApp))).not.toThrow();
  });

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

  it("renders a login recovery state instead of the empty-goal creation flow for auth failures", () => {
    const source = clientMainSource();
    const css = clientStyles();

    expect(source).toContain("authRequired ? (");
    expect(source).toContain("<AuthRequiredState />");
    expect(source).toContain('href="/login"');
    expect(source).toContain("{!authRequired && (");
    expect(css).toContain(".map-workspace.auth-required-workspace");
    expect(css).toContain(".auth-required-state");
  });

  it("routes unauthorized writes into the login recovery state", () => {
    const source = clientMainSource();
    const runWriteBlock = source.match(/const runWrite = useCallback\([\s\S]*?\n  }, \[clearNoticeTimer, enterAuthRequiredState, showNotice\]\);/)?.[0] ?? "";

    expect(runWriteBlock).toContain("isUnauthorizedApiError(nextError)");
    expect(runWriteBlock).toContain("enterAuthRequiredState();");
  });

  it("centers the goalscape composition in the svg viewbox", () => {
    const layouts = buildGoalscapeLayout([goal("life"), goal("growth"), goal("career")], {}, {});
    const compositionCenter = {
      x: (goalscapeCenter.x + layouts.reduce((sum, layout) => sum + layout.x, 0)) / (layouts.length + 1),
      y: (goalscapeCenter.y + layouts.reduce((sum, layout) => sum + layout.y, 0)) / (layouts.length + 1)
    };

    expect(goalscapeCenter).toMatchObject({ x: 600, y: 380 });
    expect(compositionCenter.x).toBeCloseTo(600, -1);
    expect(Math.abs(compositionCenter.y - 380)).toBeLessThan(12);
  });

  it("uses goal center visuals after drilling into a goal", () => {
    const centerGoal = goal("focus", "个人成长");

    expect(goalscapeCenterVisualMode("map-1", null)).toBe("map");
    expect(goalscapeCenterVisualMode(centerGoal.id, centerGoal)).toBe("goal");
  });

  it("keeps both add-target actions visible at the map center", () => {
    expect(
      mapAddActionAvailability({
        mapCenterSelected: true,
        hasActiveGoalMap: true,
        hasSelectedGoal: false,
        canAddSibling: false,
        saving: false
      })
    ).toEqual({
      subgoalDisabled: false,
      siblingDisabled: true,
      subgoalUsesTopGoal: true
    });
  });

  it("enables sibling add action when a selected goal can create a sibling", () => {
    expect(
      mapAddActionAvailability({
        mapCenterSelected: false,
        hasActiveGoalMap: true,
        hasSelectedGoal: true,
        canAddSibling: true,
        saving: false
      })
    ).toMatchObject({
      subgoalDisabled: false,
      siblingDisabled: false,
      subgoalUsesTopGoal: false
    });
  });

  it("keeps the main add action pointed at the selected goal when sibling creation is unavailable", () => {
    expect(
      mapAddActionAvailability({
        mapCenterSelected: false,
        hasActiveGoalMap: true,
        hasSelectedGoal: true,
        canAddSibling: false,
        saving: false
      })
    ).toEqual({
      subgoalDisabled: false,
      siblingDisabled: true,
      subgoalUsesTopGoal: false
    });
  });

  it("reads presentation mode per goal map and falls back to sphere for unknown or damaged storage", () => {
    expect(readGoalPresentationMode("map-1", storageWith())).toBe("sphere");
    expect(readGoalPresentationMode("map-1", storageWith("{broken json"))).toBe("sphere");
    expect(readGoalPresentationMode("map-3", storageWith(JSON.stringify({ "map-1": "sunburst", "map-2": "sphere" })))).toBe("sphere");
    expect(readGoalPresentationMode("map-1", storageWith(JSON.stringify({ "map-1": "sunburst", "map-2": "sphere" })))).toBe("sunburst");
  });

  it("writes presentation mode without mixing goal map preferences", () => {
    const storage = storageWith(JSON.stringify({ "map-1": "sunburst" }));

    writeGoalPresentationMode("map-2", "sphere", storage);
    writeGoalPresentationMode("map-3", "sunburst", storage);

    expect(storage.setItem).toHaveBeenLastCalledWith(
      GOAL_PRESENTATION_STORAGE_KEY,
      JSON.stringify({ "map-1": "sunburst", "map-2": "sphere", "map-3": "sunburst" })
    );
    expect(readGoalPresentationMode("map-1", storage)).toBe("sunburst");
    expect(readGoalPresentationMode("map-2", storage)).toBe("sphere");
    expect(readGoalPresentationMode("map-3", storage)).toBe("sunburst");
  });

  it("lays out top-level goals evenly around the full orbit from twelve o'clock", () => {
    const alpha = goal("alpha");
    const beta = { ...goal("beta"), children: [goal("beta-a"), goal("beta-b")] };
    const gamma = goal("gamma");
    const layouts = buildGoalscapeLayout([alpha, beta, gamma], {}, {});
    const topLayouts = [alpha, beta, gamma].map((item) => {
      const layout = layouts.find((itemLayout) => itemLayout.node.id === item.id);
      expect(layout).toBeDefined();
      return layout!;
    });
    const orbit = goalscapeOrbitForDepth(1, topLayouts[0].visibleDepth);

    expectAngleClose(angleDegreesFromCenter(topLayouts[0]), -90);
    expectAngleClose(angleDegreesFromCenter(topLayouts[1]), 30);
    expectAngleClose(angleDegreesFromCenter(topLayouts[2]), 150);
    for (const layout of topLayouts) {
      expect(ellipseValue(layout, orbit)).toBeCloseTo(1, 2);
    }
  });

  it("keeps fallback top-level positions stable when a goal is appended", () => {
    const initial = buildGoalscapeLayout([goal("alpha"), goal("beta"), goal("gamma")], {}, {});
    const appended = buildGoalscapeLayout([goal("alpha"), goal("beta"), goal("gamma"), goal("delta")], {}, {});

    for (const id of ["alpha", "beta", "gamma"]) {
      const before = initial.find((layout) => layout.node.id === id);
      const after = appended.find((layout) => layout.node.id === id);
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expectAngleClose(angleDegreesFromCenter(after!), angleDegreesFromCenter(before!));
    }
  });

  it("assigns the seven theme colors to top-level goals and ignores child colors in the sphere map", () => {
    const alphaChild = { ...goal("alpha-child"), color: "#10b981", domain: "personal" };
    const roots = [
      { ...goal("alpha"), children: [alphaChild] },
      goal("beta"),
      goal("gamma"),
      goal("delta"),
      goal("epsilon")
    ];
    const layouts = buildGoalscapeLayout(roots, {}, {});
    const topLevelColors = roots.map((root) => layouts.find((layout) => layout.node.id === root.id)?.color);
    const childLayout = layouts.find((layout) => layout.node.id === "alpha-child");

    expect(topLevelColors).toEqual(GOAL_THEME_COLORS.slice(0, roots.length).map((item) => item.value));
    expect(childLayout?.color).toBe(GOAL_THEME_COLORS[0].value);
  });

  it("maps live theme color previews to first-level goals and descendants in the sphere map", () => {
    const previewColor = GOAL_THEME_COLORS[4].value;
    const roots = [
      {
        ...goal("alpha"),
        color: GOAL_THEME_COLORS[0].value,
        children: [{ ...goal("alpha-child"), color: GOAL_THEME_COLORS[0].value }]
      }
    ];
    const layouts = buildGoalscapeLayout(roots, {}, {}, {}, "root", undefined, {
      alpha: previewColor,
      "alpha-child": previewColor
    });

    expect(layouts.find((layout) => layout.node.id === "alpha")?.color).toBe(previewColor);
    expect(layouts.find((layout) => layout.node.id === "alpha-child")?.color).toBe(previewColor);
  });

  it("exposes the seven theme colors in the goal detail panel for first-level goals", () => {
    const source = clientMainSource();

    expect(source).toContain("themeColorEditable");
    expect(source).toContain("GOAL_THEME_COLORS.map((color)");
    expect(source).toContain('name="goal-editor-theme-color"');
    expect(source).toContain("detail-goal-color-option");
    expect(source).toContain("colorPreview");
    expect(source).toContain("onPreviewThemeColor");
  });

  it("saves first-level goal theme color changes to all descendants", () => {
    const source = clientMainSource();

    expect(source).toContain("collectDescendants(goal)");
    expect(source).toContain("themeColorChanged");
    expect(source).toContain("body: JSON.stringify({ color: nextThemeColor })");
  });

  it("uses the real root theme color for a focused sphere branch", () => {
    const realRootColor = "#e11d48";
    const leaf = { ...goal("leaf"), color: "#0284c7" };
    const focusedChild = { ...goal("focused-child"), color: "#10b981", children: [leaf] };
    const focusedLayoutBuilder = buildGoalscapeLayout as (
      goals: GoalNode[],
      importanceOverrides: Record<string, number>,
      progressOverrides: Record<string, number>,
      positionOverrides: Record<string, { x: number; y: number }>,
      mapContextId: string,
      selectedId: string | undefined,
      treeRootThemeColor: string
    ) => ReturnType<typeof buildGoalscapeLayout>;

    const layouts = focusedLayoutBuilder([focusedChild], {}, {}, {}, "focused-parent", undefined, realRootColor);

    expect(layouts.find((layout) => layout.node.id === "focused-child")?.color).toBe(realRootColor);
    expect(layouts.find((layout) => layout.node.id === "leaf")?.color).toBe(realRootColor);
  });

  it("fans child goals around the parent angle without sector fields", () => {
    const parent = { ...goal("parent"), children: [goal("child-a"), goal("child-b"), goal("child-c")] };
    const layouts = buildGoalscapeLayout([parent], {}, {});
    const parentLayout = layouts.find((layout) => layout.node.id === "parent");
    const childAngles = ["child-a", "child-b", "child-c"].map((id) => {
      const layout = layouts.find((item) => item.node.id === id);
      expect(layout).toBeDefined();
      expect("sectorStartAngle" in layout!).toBe(false);
      expect("sectorEndAngle" in layout!).toBe(false);
      expect("sectorRole" in layout!).toBe(false);
      return angleDegreesFromCenter(layout!);
    });

    expect(parentLayout).toBeDefined();
    expectAngleClose(angleDegreesFromCenter(parentLayout!), -90);
    expectAngleClose(childAngles[0], -90);
    expectAngleClose(childAngles[1], -120);
    expectAngleClose(childAngles[2], -60);
  });

  it("keeps fallback child positions stable when a sibling is appended", () => {
    const initialParent = { ...goal("parent"), children: [goal("child-a"), goal("child-b")] };
    const appendedParent = { ...goal("parent"), children: [goal("child-a"), goal("child-b"), goal("child-c")] };
    const initial = buildGoalscapeLayout([initialParent], {}, {});
    const appended = buildGoalscapeLayout([appendedParent], {}, {});

    for (const id of ["child-a", "child-b"]) {
      const before = initial.find((layout) => layout.node.id === id);
      const after = appended.find((layout) => layout.node.id === id);
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expectAngleClose(angleDegreesFromCenter(after!), angleDegreesFromCenter(before!));
    }
  });

  it("keeps child fans inside each top-level parent's angular lane", () => {
    const roots = Array.from({ length: 8 }, (_, rootIndex) => ({
      ...goal(`root-${rootIndex}`),
      children: Array.from({ length: 4 }, (_, childIndex) => goal(`root-${rootIndex}-child-${childIndex}`))
    }));
    const layouts = buildGoalscapeLayout(roots, {}, {});
    const parentLane = (360 / roots.length) * 0.78;

    for (const root of roots) {
      const parentLayout = layouts.find((layout) => layout.node.id === root.id);
      expect(parentLayout).toBeDefined();
      const parentAngle = angleDegreesFromCenter(parentLayout!);
      for (const child of root.children) {
        const childLayout = layouts.find((layout) => layout.node.id === child.id);
        expect(childLayout).toBeDefined();
        expect(angularDistanceDegrees(angleDegreesFromCenter(childLayout!), parentAngle)).toBeLessThanOrEqual(parentLane / 2 + 0.25);
      }
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

  it("matches saved map positions before clearing drag previews", () => {
    const pending = { ...goal("pending"), map_positions: { root: { x: 260, y: 220 } } };
    const saved = { ...goal("saved"), map_positions: { root: { x: 860, y: 520 } } };

    expect(goalHasMapPosition(pending, "root", { x: 860, y: 520 })).toBe(false);
    expect(goalHasMapPosition(saved, "root", { x: 860, y: 520 })).toBe(true);
  });

  it("ignores stale goal reload responses and state updates that finish after a newer request starts", () => {
    expect(shouldApplyGoalsResponse(1, 2)).toBe(false);
    expect(shouldApplyGoalsResponse(2, 2)).toBe(true);
  });

  it("classifies 401 API errors without treating generic errors as auth failures", () => {
    expect(isUnauthorizedApiError(new ApiClientError("Unauthorized", 401))).toBe(true);
    expect(isUnauthorizedApiError(new ApiClientError("Forbidden", 403))).toBe(false);
    expect(isUnauthorizedApiError(new Error("Unauthorized"))).toBe(false);
  });

  it("keeps map position drag previews scoped to the active map context", () => {
    const rootPreview = withMapPositionPreview({}, "root", "child", { x: 900, y: 510 });
    const scopedPreview = withMapPositionPreview(rootPreview, "focus", "child", { x: 260, y: 220 });
    const withoutScoped = withoutMapPositionPreview(scopedPreview, "focus", "child");

    expect(mapPositionPreviewForContext(scopedPreview, "root").child).toEqual({ x: 900, y: 510 });
    expect(mapPositionPreviewForContext(scopedPreview, "focus").child).toEqual({ x: 260, y: 220 });
    expect(mapPositionPreviewForContext(withoutScoped, "focus").child).toBeUndefined();
    expect(mapPositionPreviewForContext(withoutScoped, "root").child).toEqual({ x: 900, y: 510 });
  });

  it("clears only persisted drag previews from their matching map context", () => {
    const saved = {
      ...goal("child"),
      map_positions: {
        root: { x: 900, y: 510 },
        focus: { x: 260, y: 220 }
      }
    };
    const previews = withMapPositionPreview(
      withMapPositionPreview(
        withMapPositionPreview({}, "root", saved.id, { x: 900, y: 510 }),
        "focus",
        saved.id,
        { x: 260, y: 220 }
      ),
      "other",
      saved.id,
      { x: 600, y: 690 }
    );
    const pruned = pruneSavedMapPositionPreviews(previews, [saved]);

    expect(mapPositionPreviewForContext(pruned, "root")[saved.id]).toBeUndefined();
    expect(mapPositionPreviewForContext(pruned, "focus")[saved.id]).toBeUndefined();
    expect(mapPositionPreviewForContext(pruned, "other")[saved.id]).toEqual({ x: 600, y: 690 });
  });

  it("moves descendants along their orbits after dragging the parent", () => {
    const parent = { ...goal("parent"), children: [goal("child-a"), goal("child-b"), goal("child-c")] };
    const baselineLayouts = buildGoalscapeLayout([parent], {}, {});
    const draggedPosition = constrainGoalscapePositionToOrbit({ x: 900, y: 510 }, goalscapeOrbitForDepth(1));
    const draggedLayouts = buildGoalscapeLayout([parent], {}, {}, { parent: draggedPosition });
    const baselineParent = baselineLayouts.find((layout) => layout.node.id === "parent");
    const draggedParent = draggedLayouts.find((layout) => layout.node.id === "parent");

    expect(baselineParent).toBeDefined();
    expect(draggedParent).toBeDefined();
    expect(angularDistanceDegrees(angleDegreesFromCenter(draggedParent!), angleDegreesFromCenter(baselineParent!))).toBeGreaterThan(20);
    expect(ellipseValue(draggedParent!, goalscapeOrbitForDepth(draggedParent!.depth, draggedParent!.visibleDepth))).toBeCloseTo(1, 2);

    const angleDelta = relativeAngleDegrees(angleDegreesFromCenter(draggedParent!), angleDegreesFromCenter(baselineParent!));
    for (const id of ["child-a", "child-b", "child-c"]) {
      const baselineChild = baselineLayouts.find((layout) => layout.node.id === id);
      const draggedChild = draggedLayouts.find((layout) => layout.node.id === id);
      expect(baselineChild).toBeDefined();
      expect(draggedChild).toBeDefined();

      expect(ellipseValue(draggedChild!, goalscapeOrbitForDepth(draggedChild!.depth, draggedChild!.visibleDepth))).toBeCloseTo(1, 2);
      expect(relativeAngleDegrees(angleDegreesFromCenter(draggedChild!), angleDegreesFromCenter(baselineChild!))).toBeCloseTo(angleDelta, 1);
    }
  });

  it("moves saved child positions along their orbits with the dragged parent preview", () => {
    const parent = {
      ...goal("parent"),
      children: [
        { ...goal("child-a"), map_positions: { root: { x: 1090, y: 380 } } },
        { ...goal("child-b"), map_positions: { root: { x: 600, y: 690 } } },
        { ...goal("child-c"), map_positions: { root: { x: 110, y: 380 } } }
      ]
    };
    const baselineLayouts = buildGoalscapeLayout([parent], {}, {});
    const draggedPosition = constrainGoalscapePositionToOrbit({ x: 900, y: 510 }, goalscapeOrbitForDepth(1));
    const draggedLayouts = buildGoalscapeLayout([parent], {}, {}, { parent: draggedPosition });
    const baselineParent = baselineLayouts.find((layout) => layout.node.id === "parent");
    const parentLayout = draggedLayouts.find((layout) => layout.node.id === "parent");

    expect(baselineParent).toBeDefined();
    expect(parentLayout).toBeDefined();
    const angleDelta = relativeAngleDegrees(angleDegreesFromCenter(parentLayout!), angleDegreesFromCenter(baselineParent!));
    for (const id of ["child-a", "child-b", "child-c"]) {
      const baselineChild = baselineLayouts.find((layout) => layout.node.id === id);
      const draggedChild = draggedLayouts.find((layout) => layout.node.id === id);
      expect(baselineChild).toBeDefined();
      expect(draggedChild).toBeDefined();

      expect(ellipseValue(draggedChild!, goalscapeOrbitForDepth(draggedChild!.depth, draggedChild!.visibleDepth))).toBeCloseTo(1, 2);
      expect(relativeAngleDegrees(angleDegreesFromCenter(draggedChild!), angleDegreesFromCenter(baselineChild!))).toBeCloseTo(angleDelta, 1);
    }
  });

  it("computes orbital map position patches for the entire dragged branch", () => {
    const grandchild = goal("grandchild");
    const child = { ...goal("child"), children: [grandchild] };
    const parent = { ...goal("parent"), children: [child] };
    const draggedPosition = constrainGoalscapePositionToOrbit({ x: 900, y: 510 }, goalscapeOrbitForDepth(1));
    const baselinePatches = goalscapeBranchMapPositionPatches([parent], "parent", {}, "root");
    const draggedPatches = goalscapeBranchMapPositionPatches([parent], "parent", { parent: draggedPosition }, "root");
    const baselineById = new Map(baselinePatches.map((patch) => [patch.id, patch.position]));
    const draggedById = new Map(draggedPatches.map((patch) => [patch.id, patch.position]));
    const angleDelta = relativeAngleDegrees(angleDegreesFromCenter(draggedById.get("parent")!), angleDegreesFromCenter(baselineById.get("parent")!));

    expect(draggedPatches.map((patch) => patch.id)).toEqual(["parent", "child", "grandchild"]);
    for (const [id, depth] of [
      ["child", 2],
      ["grandchild", 3]
    ] as const) {
      const baselinePosition = baselineById.get(id);
      const draggedPatch = draggedById.get(id);
      expect(baselinePosition).toBeDefined();
      expect(draggedPatch).toBeDefined();

      expect(ellipseValue(draggedPatch!, goalscapeOrbitForDepth(depth))).toBeCloseTo(1, 2);
      expect(relativeAngleDegrees(angleDegreesFromCenter(draggedPatch!), angleDegreesFromCenter(baselinePosition!))).toBeCloseTo(angleDelta, 0);
    }
  });

  it("scopes saved map positions to the current focus context", () => {
    const scoped = { ...goal("scoped"), map_positions: { root: { x: 420, y: 260 }, parent: { x: 880, y: 500 } } };
    const fallbackLayout = buildGoalscapeLayout([scoped], {}, {}, {}, "other")[0];

    expect(angleFromCenter(buildGoalscapeLayout([scoped], {}, {}, {}, "root")[0])).toBeCloseTo(angleFromCenter({ x: 420, y: 260 }), 2);
    expect(angleFromCenter(buildGoalscapeLayout([scoped], {}, {}, {}, "parent")[0])).toBeCloseTo(angleFromCenter({ x: 880, y: 500 }), 2);
    expect(angleDegreesFromCenter(fallbackLayout)).toBeCloseTo(-90, 3);
  });

  it("keeps custom positions inside the goalscape viewbox", () => {
    expect(clampGoalscapePosition({ x: -100, y: 999 })).toEqual({ x: 80, y: 690 });
  });

  it("constrains arbitrary positions to a circular orbit", () => {
    const orbit = goalscapeOrbitForDepth(1);
    const constrained = constrainGoalscapePositionToOrbit({ x: 420, y: 260 }, orbit);
    const centered = constrainGoalscapePositionToOrbit(goalscapeCenter, orbit);

    expect(orbit.rx).toBe(orbit.ry);
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

  it("renders only two outer goal levels from the current center", () => {
    const branch = { ...goal("branch"), children: [goal("branch-leaf-a"), goal("branch-leaf-b")] };
    const other = { ...goal("other"), children: [goal("other-leaf")] };
    const layouts = buildGoalscapeLayout([branch, other], {}, {});
    const branchLayout = layouts.find((layout) => layout.node.id === "branch") as
      | (ReturnType<typeof buildGoalscapeLayout>[number] & { childCount?: number })
      | undefined;
    const otherLayout = layouts.find((layout) => layout.node.id === "other") as
      | (ReturnType<typeof buildGoalscapeLayout>[number] & { childCount?: number })
      | undefined;

    expect(layoutIds(layouts)).toEqual(["branch", "branch-leaf-a", "branch-leaf-b", "other", "other-leaf"]);
    expect(branchLayout?.childCount).toBeUndefined();
    expect(otherLayout?.childCount).toBeUndefined();
  });

  it("hides goals deeper than two outer levels and badges their parent", () => {
    const greatGrandchild = goal("great-grandchild");
    const grandchild = { ...goal("grandchild"), children: [greatGrandchild] };
    const child = { ...goal("child"), children: [grandchild] };
    const parent = { ...goal("parent"), children: [child] };
    const layouts = buildGoalscapeLayout([parent], {}, {});
    const childLayout = layouts.find((layout) => layout.node.id === "child") as
      | (ReturnType<typeof buildGoalscapeLayout>[number] & { childCount?: number })
      | undefined;

    expect(layouts.map((layout) => layout.node.id)).toEqual(["parent", "child"]);
    expect(childLayout?.childCount).toBe(2);
    for (const layout of layouts) {
      expect(ellipseValue(layout, goalscapeOrbitForDepth(layout.depth, layout.visibleDepth))).toBeCloseTo(1, 2);
    }
  });

  it("shows hidden descendants after drilling into their parent goal", () => {
    const greatGrandchild = goal("great-grandchild");
    const grandchild = { ...goal("grandchild"), children: [greatGrandchild] };
    const child = { ...goal("child"), children: [grandchild] };
    const drilledLayouts = buildGoalscapeLayout(child.children, {}, {});

    expect(layoutIds(drilledLayouts)).toEqual(["grandchild", "great-grandchild"]);
    expect((drilledLayouts.find((layout) => layout.node.id === "great-grandchild") as { childCount?: number } | undefined)?.childCount).toBeUndefined();
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

  it("does not change layout geometry when a goal is selected", () => {
    const focus = { ...goal("focus"), children: [goal("focus-child")] };
    const other = { ...goal("other"), children: [goal("other-child")] };
    const neutralLayouts = buildGoalscapeLayout([focus, other], {}, {});
    const selectedLayouts = buildGoalscapeLayoutWithSelection([focus, other], "focus");

    expect(layoutSnapshot(selectedLayouts)).toEqual(layoutSnapshot(neutralLayouts));
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

    expect(innerOrbit).toMatchObject({ rx: 174, ry: 174 });
    expect(outerOrbit).toMatchObject({ rx: 300, ry: 300 });
    expect(innerOrbit.rx).toBe(innerOrbit.ry);
    expect(outerOrbit.rx).toBe(outerOrbit.ry);
    expect(outerOrbit.rx - innerOrbit.rx).toBeGreaterThanOrEqual(120);
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

  it("omits internal icon chrome from goalscape target spheres only", () => {
    const source = clientMainSource();
    const css = clientStyles();

    expect(source).not.toContain("goalscape-icon-object");
    expect(source).not.toContain("goalscape-icon-wrap");
    expect(source).not.toContain("goalscape-node-icon");
    expect(css).not.toContain(".goalscape-icon-object");
    expect(css).not.toContain(".goalscape-icon-wrap");
    expect(css).not.toContain(".goalscape-node-icon");
    expect(source).toContain("sunburst-center-icon");
    expect(css).toContain(".sunburst-center-icon");
  });
});

describe("sunburst layout", () => {
  it("allocates sibling angles by importance and keeps children inside the parent sector", () => {
    const child = goal("heavy-child");
    const light = { ...goal("light"), priority: 1 };
    const heavy = { ...goal("heavy"), priority: 3, children: [child] };
    const root = { ...goal("root"), children: [light, heavy] };
    const layout = buildSunburstLayout([root], {}, {}, 4);
    const lightSegment = layout.segments.find((segment) => segment.node.id === "light");
    const heavySegment = layout.segments.find((segment) => segment.node.id === "heavy");
    const childSegment = layout.segments.find((segment) => segment.node.id === "heavy-child");

    expect(layout.center.node?.id).toBe("root");
    expect(lightSegment).toBeDefined();
    expect(heavySegment).toBeDefined();
    expect(childSegment).toBeDefined();
    expect(lightSegment!.depth).toBe(2);
    expect(heavySegment!.depth).toBe(2);
    expect(lightSegment!.startAngle).toBeCloseTo(-90);
    expect(lightSegment!.endAngle).toBeCloseTo(0);
    expect(heavySegment!.startAngle).toBeCloseTo(0);
    expect(heavySegment!.endAngle).toBeCloseTo(270);
    expect(childSegment!.startAngle).toBeGreaterThanOrEqual(heavySegment!.startAngle);
    expect(childSegment!.endAngle).toBeLessThanOrEqual(heavySegment!.endAngle);
  });

  it("falls back to a synthetic map center when multiple top-level goals exist", () => {
    const layout = buildSunburstLayout([goal("alpha"), goal("beta")], {}, {}, 4);

    expect(layout.center.node).toBeUndefined();
    expect(layout.hasSyntheticRoot).toBe(true);
    expect(layout.segments.map((segment) => [segment.node.id, segment.depth])).toEqual([
      ["alpha", 1],
      ["beta", 1]
    ]);
  });

  it("centers a focused goal and renders its children as the first sunburst ring", () => {
    const child = goal("focused-child");
    const focusGoal = { ...goal("focused"), children: [child] };
    const layout = buildSunburstLayout([focusGoal], {}, {}, 4);

    expect(layout.center.node?.id).toBe("focused");
    expect(layout.hasSyntheticRoot).toBe(false);
    expect(layout.segments.map((segment) => [segment.node.id, segment.depth])).toEqual([["focused-child", 2]]);
  });

  it("wires the sunburst map to the shared drill focus state", () => {
    const source = clientMainSource();

    expect(source).toContain("const sunburstGoals = focusGoal ? [focusGoal] : visibleTree;");
    expect(source).toContain('focusRootId && (presentationMode === "sphere" || presentationMode === "sunburst")');
    expect(source).toMatch(/<SunburstGoalMap[\s\S]*?goals=\{sunburstGoals\}[\s\S]*?onDrill=\{drillGoal\}[\s\S]*?onAscend=\{ascendGoal\}/);
    expect(source).toMatch(/const lastSegmentClickRef = useRef/);
    expect(source).toContain("onDrill(segment.node.id)");
    expect(source).toContain('if (event.key === "Enter" && event.shiftKey)');
    expect(source).not.toMatch(/if \(mode === "sunburst"\) \{[\s\S]{0,160}?setFocusRootId\(null\)/);
  });

  it("defaults to four visible layers and emits a thin collapsed outer ring for deeper goals", () => {
    const level5 = goal("level-5");
    const level4 = { ...goal("level-4"), children: [level5] };
    const level3 = { ...goal("level-3"), children: [level4] };
    const level2 = { ...goal("level-2"), children: [level3] };
    const level1 = { ...goal("level-1"), children: [level2] };
    const layout = buildSunburstLayout([level1], {}, {}, 4);
    const visibleSegments = layout.segments.filter((segment) => !segment.collapsed);
    const collapsedRing = layout.segments.find((segment) => segment.collapsed);

    expect(layout.maxDepth).toBe(5);
    expect(layout.visibleDepth).toBe(4);
    expect(visibleSegments.map((segment) => segment.node.id)).toEqual(["level-2", "level-3", "level-4"]);
    expect(collapsedRing).toBeDefined();
    expect(collapsedRing!.node.id).toBe("level-4");
    expect(collapsedRing!.depth).toBe(5);
    expect(collapsedRing!.hiddenDescendantCount).toBe(1);
    expect(collapsedRing!.outerRadius - collapsedRing!.innerRadius).toBeLessThanOrEqual(12);
    expect(nextSunburstVisibleDepth(layout.visibleDepth, layout.maxDepth, 1)).toBe(5);
    expect(nextSunburstVisibleDepth(layout.visibleDepth, layout.maxDepth, -1)).toBe(3);
  });

  it("uses a larger sunburst footprint for the visible rings", () => {
    const level4 = goal("level-4");
    const level3 = { ...goal("level-3"), children: [level4] };
    const level2 = { ...goal("level-2"), children: [level3] };
    const level1 = { ...goal("level-1"), children: [level2] };
    const layout = buildSunburstLayout([level1], {}, {}, 4);
    const outerMostSegment = layout.segments.find((segment) => segment.node.id === "level-4");

    expect(layout.center.radius).toBeGreaterThanOrEqual(80);
    expect(outerMostSegment?.outerRadius).toBeGreaterThanOrEqual(380);
  });

  it("uses a tighter sunburst viewport so the chart fills more of the pane", () => {
    expect(SUNBURST_VIEW_BOX).toMatchObject({
      x: 100,
      width: 1000
    });
    expect(SUNBURST_VIEW_BOX.width / SUNBURST_VIEW_BOX.height).toBeLessThan(1.35);
  });

  it("keeps the sunburst depth triangles close enough to read as one control", () => {
    const increaseCenter = triangleCenter(SUNBURST_DEPTH_CONTROL_GEOMETRY.increaseTriangle);
    const decreaseCenter = triangleCenter(SUNBURST_DEPTH_CONTROL_GEOMETRY.decreaseTriangle);
    const areaRatio =
      triangleArea(SUNBURST_DEPTH_CONTROL_GEOMETRY.increaseTriangle) / triangleArea(SUNBURST_DEPTH_CONTROL_GEOMETRY.decreaseTriangle);

    expect(distance(increaseCenter, decreaseCenter)).toBeLessThanOrEqual(42);
    expect(distance(increaseCenter, decreaseCenter)).toBeGreaterThanOrEqual(30);
    expect(decreaseCenter.x).toBeLessThan(increaseCenter.x - 20);
    expect(decreaseCenter.y).toBeGreaterThan(increaseCenter.y);
    expect(areaRatio).toBeGreaterThanOrEqual(2);
    expect(areaRatio).toBeLessThanOrEqual(3.2);

    expect(Math.abs(increaseCenter.x - decreaseCenter.x - (decreaseCenter.y - increaseCenter.y))).toBeLessThanOrEqual(1);

    const decreaseTip = triangleTip(SUNBURST_DEPTH_CONTROL_GEOMETRY.decreaseTriangle);
    const decreaseBaseCenter = triangleCenter(SUNBURST_DEPTH_CONTROL_GEOMETRY.decreaseTriangle.filter((point) => point !== decreaseTip));
    expect(directionAlignment(vector(decreaseCenter, decreaseTip), vector(decreaseCenter, goalscapeCenter))).toBeGreaterThan(0.9);
    expect(directionAlignment(vector(decreaseCenter, decreaseBaseCenter), vector(decreaseCenter, increaseCenter))).toBeGreaterThan(0.9);

    const scale = Math.sqrt(
      triangleArea(SUNBURST_DEPTH_CONTROL_GEOMETRY.decreaseTriangle) /
        triangleArea(SUNBURST_DEPTH_CONTROL_GEOMETRY.increaseTriangle)
    );
    SUNBURST_DEPTH_CONTROL_GEOMETRY.increaseTriangle.forEach((point, index) => {
      const decreasePoint = SUNBURST_DEPTH_CONTROL_GEOMETRY.decreaseTriangle[index];
      expect(decreasePoint.x - decreaseCenter.x).toBeCloseTo((increaseCenter.x - point.x) * scale, 0);
      expect(decreasePoint.y - decreaseCenter.y).toBeCloseTo((increaseCenter.y - point.y) * scale, 0);
    });
  });

  it("keeps the sunburst depth arc visually between the two triangles", () => {
    const increaseCenter = triangleCenter(SUNBURST_DEPTH_CONTROL_GEOMETRY.increaseTriangle);
    const decreaseCenter = triangleCenter(SUNBURST_DEPTH_CONTROL_GEOMETRY.decreaseTriangle);
    const increaseBounds = triangleBounds(SUNBURST_DEPTH_CONTROL_GEOMETRY.increaseTriangle);
    const decreaseBounds = triangleBounds(SUNBURST_DEPTH_CONTROL_GEOMETRY.decreaseTriangle);

    const upperGap = increaseBounds.minX - xOnDepthControlArcAtY(increaseCenter.y);
    const lowerGap = xOnDepthControlArcAtY(decreaseCenter.y) - decreaseBounds.maxX;

    expect(upperGap).toBeGreaterThanOrEqual(6);
    expect(upperGap).toBeLessThanOrEqual(16);
    expect(lowerGap).toBeGreaterThanOrEqual(6);
    expect(lowerGap).toBeLessThanOrEqual(16);
  });

  it("keeps the sunburst depth control visually simple", () => {
    expect("tickPaths" in SUNBURST_DEPTH_CONTROL_GEOMETRY).toBe(false);
    expect("hitRadius" in SUNBURST_DEPTH_CONTROL_GEOMETRY).toBe(false);

    const css = clientStyles();
    expect(css).not.toContain(".sunburst-depth-tick");
    expect(css).not.toContain(".sunburst-depth-hit-area");
    expect(css).not.toContain("drop-shadow(0 6px 14px");
  });

  it("measures sunburst sizing against the visual canvas instead of the full toolbar pane", () => {
    const css = clientStyles();

    expect(css).toMatch(/\.map-canvas\s*\{[\s\S]*?container-type:\s*size;/);
    expect(css).toMatch(/\.goal-map\.sunburst-map\s*\{[\s\S]*?aspect-ratio:\s*1000 \/ 788;/);
    expect(css).toMatch(/\.goal-map\.sunburst-map\s*\{[\s\S]*?width:\s*min\(100cqw, calc\(100cqh \* 1\.269\), 1120px\);/);
  });

  it("floats the expanded goal map list without spending canvas height", () => {
    const css = clientStyles();

    expect(css).toMatch(/\.map-pane-toolbar\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*var\(--map-pane-padding\) var\(--map-pane-padding\) auto var\(--map-pane-padding\);/);
    expect(css).toMatch(/\.map-pane-toolbar\s*\{[\s\S]*?pointer-events:\s*none;/);
    expect(css).toMatch(/\.map-pane-toolbar\s*>\s*\*\s*\{[\s\S]*?pointer-events:\s*auto;/);
    expect(css).toMatch(/\.map-canvas\s*\{[\s\S]*?grid-row:\s*1 \/ -1;/);
  });

  it("keeps the expanded goal map list width compact across breakpoints", () => {
    const css = clientStyles();

    expect(css).toMatch(/\.map-scope-list\s*\{[\s\S]*?--scope-list-open-width:\s*clamp\(280px, 42cqw, 340px\);/);
    expect(css).toMatch(/\.map-scope-list\s*\{[\s\S]*?width:\s*min\(var\(--scope-list-open-width\), calc\(100cqw - 20px\)\);/);
    expect(css).toMatch(/\.map-scope-list\s*\{[\s\S]*?flex:\s*0 1 var\(--scope-list-open-width\);/);
    expect(css).toMatch(/@media \(max-width: 680px\)\s*\{[\s\S]*?\.map-scope-list:not\(\.collapsed\)\s*\{[\s\S]*?width:\s*var\(--scope-list-open-width\);[\s\S]*?flex-basis:\s*var\(--scope-list-open-width\);/);
    expect(css).not.toMatch(/\.map-scope-list:not\(\.collapsed\)\s*\{[\s\S]*?width:\s*100%;[\s\S]*?flex-basis:\s*100%;/);
  });

  it("maximizes the sunburst map inside the visual canvas without transform overflow", () => {
    const css = clientStyles();

    expect(css).toMatch(/\.goal-map\.sunburst-map\s*\{[\s\S]*?width:\s*min\(100%, 1120px\);/);
    expect(css).toMatch(/\.goal-map\.sunburst-map\s*\{[\s\S]*?aspect-ratio:\s*1000 \/ 788;/);
    expect(css).toMatch(/\.goal-map\.sunburst-map\s*\{[\s\S]*?max-height:\s*100%;/);
    expect(css).toMatch(/\.goal-map\.sunburst-map\s*\{[\s\S]*?width:\s*min\(100cqw, calc\(100cqh \* 1\.269\), 1120px\);/);
    expect(css).not.toMatch(/\.goal-map\.goalscape-map,\s*\.goal-map\.sunburst-map\s*\{[\s\S]*?transform:\s*scale/);
    expect(css).not.toMatch(/@media \(max-width: 1120px\)\s*\{[\s\S]*?\.goal-map\.goalscape-map,\s*\.goal-map\.sunburst-map\s*\{/);
  });

  it("does not render visible progress percentages in the sunburst map", () => {
    const source = clientMainSource();
    const css = clientStyles();

    expect(source).not.toContain("sunburst-center-progress-text");
    expect(source).not.toContain("sunburst-segment-percent");
    expect(css).not.toContain(".sunburst-center-progress-text");
    expect(css).not.toContain(".sunburst-segment-percent");
  });

  it("uses a custom card tooltip for sunburst goals instead of native svg titles", () => {
    const source = clientMainSource();
    const css = clientStyles();

    expect(source).toContain("sunburstTooltipForSegment");
    expect(source).toContain("sunburst-tooltip-card");
    expect(source).toContain("setSunburstTooltip");
    expect(source).toMatch(/const top = clamp\(preferredTop >= minTop \? preferredTop : fallbackTop, minTop, maxTop\);/);
    expect(source).toMatch(/const selectSegment = useCallback\([\s\S]*?setSunburstTooltip\(null\);[\s\S]*?segment\.collapsed/);
    expect(source).toMatch(/event\.key === "Enter" && event\.shiftKey[\s\S]*?setSunburstTooltip\(null\);/);
    expect(source).not.toContain("<title>{centerDisplayTitle}</title>");
    expect(source).not.toContain("<title>{segment.collapsed");
    expect(css).toMatch(/\.sunburst-tooltip-card\s*\{[\s\S]*?border-radius:\s*8px;/);
    expect(css).toMatch(/\.sunburst-tooltip-card\s*\{[\s\S]*?box-shadow:/);
    expect(css).toMatch(/\.sunburst-tooltip\s*\{[\s\S]*?pointer-events:\s*none;/);
  });

  it("omits decorative sunburst stripe overlays that compete with segment boundaries", () => {
    const source = clientMainSource();
    const css = clientStyles();

    expect(source).not.toContain("sunburst-corona");
    expect(source).not.toContain("sunburst-ray-overlay");
    expect(source).not.toContain("sunburst-ray-sheen");
    expect(css).not.toContain(".sunburst-corona");
    expect(css).not.toContain(".sunburst-ray");
    expect(css).not.toContain("sunburst-ray-overlay");
    expect(css).not.toContain("--sun-ray");
    expect(css).not.toContain("--sun-sheen");
  });

  it("uses the same seven theme colors and ignores child colors in the sunburst map", () => {
    const alphaGrandchild = { ...goal("alpha-grandchild"), color: "#f59e0b" };
    const alphaChild = { ...goal("alpha-child"), color: "#10b981", children: [alphaGrandchild] };
    const roots = [
      { ...goal("alpha"), children: [alphaChild] },
      goal("beta"),
      goal("gamma"),
      goal("delta"),
      goal("epsilon")
    ];
    const layout = buildSunburstLayout(roots, {}, {}, 4);
    const topLevelColors = roots.map((root) => layout.segments.find((segment) => segment.node.id === root.id)?.color);
    const childSegment = layout.segments.find((segment) => segment.node.id === "alpha-child");
    const grandchildSegment = layout.segments.find((segment) => segment.node.id === "alpha-grandchild");

    expect(topLevelColors).toEqual(GOAL_THEME_COLORS.slice(0, roots.length).map((item) => item.value));
    expect(childSegment?.color).toBe(GOAL_THEME_COLORS[0].value);
    expect(grandchildSegment?.color).toBe(GOAL_THEME_COLORS[0].value);
  });

  it("maps live theme color previews to first-level goals and descendants in the sunburst map", () => {
    const previewColor = GOAL_THEME_COLORS[5].value;
    const roots = [
      {
        ...goal("alpha"),
        color: GOAL_THEME_COLORS[0].value,
        children: [{ ...goal("alpha-child"), color: GOAL_THEME_COLORS[0].value }]
      }
    ];
    const layout = buildSunburstLayout(roots, {}, {}, 4, {
      alpha: previewColor,
      "alpha-child": previewColor
    });

    expect(layout.center.color).toBe(previewColor);
    expect(layout.segments.find((segment) => segment.node.id === "alpha-child")?.color).toBe(previewColor);
  });

  it("maps live progress previews to sunburst segments without changing importance angles", () => {
    const light = { ...goal("light"), priority: 1, progress: 20 };
    const heavy = { ...goal("heavy"), priority: 3, progress: 80 };
    const root = { ...goal("root"), children: [light, heavy] };
    const baseline = buildSunburstLayout([root], {}, {}, 4);
    const previewed = buildSunburstLayout([root], {}, { heavy: 45 }, 4);
    const baselineHeavy = baseline.segments.find((segment) => segment.node.id === "heavy");
    const previewedHeavy = previewed.segments.find((segment) => segment.node.id === "heavy");

    expect(previewedHeavy?.progress).toBe(45);
    expect(previewedHeavy?.startAngle).toBeCloseTo(baselineHeavy!.startAngle);
    expect(previewedHeavy?.endAngle).toBeCloseTo(baselineHeavy!.endAngle);
  });

  it("builds radial sunburst progress geometry for empty, partial, and complete segments", () => {
    const segment = buildSunburstLayout([{ ...goal("root"), children: [goal("leaf")] }], {}, {}, 4).segments[0];
    const fullPath = sunburstArcPath(segment);
    const midRadius = segment.innerRadius + (segment.outerRadius - segment.innerRadius) * 0.5;
    const midRadiusArc = `A ${midRadius.toFixed(2)} ${midRadius.toFixed(2)}`;

    expect(sunburstProgressArcPath({ ...segment, progress: 0 })).toBe("");
    expect(sunburstProgressArcPath({ ...segment, progress: 50 })).toContain(midRadiusArc);
    expect(sunburstProgressArcPath({ ...segment, progress: 50 })).not.toBe(fullPath);
    expect(sunburstProgressArcPath({ ...segment, progress: 100 })).toBe(fullPath);
    expect(sunburstProgressEdgePath({ ...segment, progress: 50 })).toContain(midRadiusArc);
    expect(sunburstProgressEdgePath({ ...segment, progress: 0 })).toBe("");
    expect(sunburstProgressEdgePath({ ...segment, progress: 100 })).toBe("");
  });

  it("derives two step controls for shrinking and expanding the sunburst depth", () => {
    expect(sunburstDepthControlState(4, 6)).toEqual({
      canDecrease: true,
      canIncrease: true,
      decreaseDepth: 3,
      increaseDepth: 5
    });
    expect(sunburstDepthControlState(1, 6)).toMatchObject({ canDecrease: false, decreaseDepth: 1 });
    expect(sunburstDepthControlState(6, 6)).toMatchObject({ canIncrease: false, increaseDepth: 6 });
  });
});
