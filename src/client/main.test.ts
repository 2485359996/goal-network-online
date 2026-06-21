import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GoalNode, GoalStatus, GoalsResponse } from "../shared/types";
import { applyGoalPatchLocally, buildGoalMapOverview, deleteGoalLocally, deleteGoalWarningText } from "./main";

function clientMainSource() {
  return readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
}

function goal(input: {
  id: string;
  title?: string;
  status?: GoalStatus;
  priority?: number;
  progress?: number;
  children?: GoalNode[];
  actions?: { text: string; done: boolean }[];
}): GoalNode {
  return {
    id: input.id,
    goalMapId: "map-1",
    title: input.title ?? input.id,
    filePath: "",
    status: input.status ?? "active",
    horizon: "short",
    domain: "[[职业发展]]",
    parent: "",
    priority: input.priority ?? 1,
    clarity: 0,
    progress: input.progress ?? 0,
    color: "",
    supports: [],
    depends_on: [],
    conflicts_with: [],
    last_reviewed: "",
    last_progress: "",
    tags: [],
    sections: {
      summary: "",
      directions: [],
      directionHeading: "子方向",
      successSignals: [],
      actionCandidates: input.actions ?? [],
      reviewQuestions: []
    },
    children: input.children ?? []
  };
}

describe("deleteGoalWarningText", () => {
  it("describes deleting goal data without mentioning Markdown", () => {
    const warning = deleteGoalWarningText(0);

    expect(warning).toBe("这会直接删除目标数据。此操作无法在应用内撤销。");
    expect(warning).not.toMatch(/markdown/i);
  });

  it("includes the child goal count without mentioning Markdown", () => {
    const warning = deleteGoalWarningText(3);

    expect(warning).toBe("这会直接删除目标数据，并一并删除 3 个子目标。此操作无法在应用内撤销。");
    expect(warning).not.toMatch(/markdown/i);
  });
});

describe("buildGoalMapOverview", () => {
  it("summarizes current-map status, depth, leaves, and pending action candidates", () => {
    const tree = [
      goal({
        id: "career",
        children: [
          goal({ id: "career-action", actions: [{ text: "Ship proposal", done: false }, { text: "Archive notes", done: true }] }),
          goal({ id: "career-done", status: "done", progress: 100 })
        ]
      }),
      goal({
        id: "life",
        status: "paused",
        children: [
          goal({
            id: "life-done",
            status: "done",
            children: [goal({ id: "life-leaf", actions: [{ text: "Book review", done: false }] })]
          })
        ]
      })
    ];

    const overview = buildGoalMapOverview(tree);

    expect(overview.totalGoals).toBe(6);
    expect(overview.activeCount).toBe(3);
    expect(overview.pausedCount).toBe(1);
    expect(overview.doneCount).toBe(2);
    expect(overview.leafGoalCount).toBe(3);
    expect(overview.maxDepth).toBe(3);
    expect(overview.depthCounts).toEqual([
      { depth: 1, count: 2 },
      { depth: 2, count: 3 },
      { depth: 3, count: 1 }
    ]);
    expect(overview.openActionCount).toBe(2);
    expect(overview.branchSummaries.find((branch) => branch.id === "career")?.goalCount).toBe(3);
  });

  it("applies live importance and progress previews to branch summaries", () => {
    const tree = [
      goal({ id: "alpha", priority: 1, children: [goal({ id: "alpha-leaf", progress: 10 })] }),
      goal({ id: "beta", priority: 1, progress: 40 })
    ];

    const overview = buildGoalMapOverview(tree, { alpha: 75, beta: 25 }, { "alpha-leaf": 90 });
    const alpha = overview.branchSummaries.find((branch) => branch.id === "alpha");
    const beta = overview.branchSummaries.find((branch) => branch.id === "beta");

    expect(alpha?.importance).toBe(75);
    expect(beta?.importance).toBe(25);
    expect(alpha?.progress).toBe(90);
  });
});

describe("optimistic goal updates", () => {
  function goalsResponse(goals: GoalNode[]): GoalsResponse {
    const flatGoals = goals.flatMap((topGoal) => [topGoal, ...topGoal.children]);
    return {
      workspaceId: "workspace-1",
      goalMaps: [{ id: "map-1", name: "目标网络", sortOrder: 0 }],
      goals,
      flatGoals,
      graph: {
        nodes: flatGoals.map((item) => ({
          id: item.id,
          title: item.title,
          domain: item.domain,
          status: item.status,
          priority: item.priority,
          clarity: item.clarity
        })),
        edges: [{ id: "child->parent:parent", source: "child", target: "parent", type: "parent" }]
      }
    };
  }

  it("renames a goal locally and updates references that point to it", () => {
    const parent = goal({
      id: "parent",
      title: "旧目标",
      children: [goal({ id: "child", title: "子目标" })]
    });
    parent.children[0].parent = "[[旧目标]]";
    const sibling = goal({ id: "sibling", title: "旁支" });
    sibling.supports = ["[[旧目标]]"];

    const next = applyGoalPatchLocally(goalsResponse([parent, sibling]), "parent", { title: "新目标" });

    expect(next.flatGoals.find((item) => item.id === "parent")?.title).toBe("新目标");
    expect(next.flatGoals.find((item) => item.id === "child")?.parent).toBe("[[新目标]]");
    expect(next.flatGoals.find((item) => item.id === "sibling")?.supports).toEqual(["[[新目标]]"]);
    expect(next.graph.nodes.find((item) => item.id === "parent")?.title).toBe("新目标");
  });

  it("deletes a goal subtree locally and prunes graph edges", () => {
    const parent = goal({
      id: "parent",
      children: [goal({ id: "child" })]
    });
    const next = deleteGoalLocally(goalsResponse([parent]), "parent");

    expect(next.goals).toEqual([]);
    expect(next.flatGoals).toEqual([]);
    expect(next.graph.edges).toEqual([]);
  });
});

describe("root detail panel overview", () => {
  it("uses presentation mode specific empty-state copy without embedding another map", () => {
    const source = clientMainSource();
    const goalDetailPanelSource = source.slice(source.indexOf("const GoalDetailPanel"), source.indexOf("const editDraftKeys"));

    expect(goalDetailPanelSource).toContain("presentationMode: GoalPresentationMode");
    expect(goalDetailPanelSource).toContain("顶层轨道");
    expect(goalDetailPanelSource).toContain("层级刻度");
    expect(goalDetailPanelSource).toContain("星系总览");
    expect(goalDetailPanelSource).toContain("层级总览");
    expect(goalDetailPanelSource).not.toContain("<GoalMap");
    expect(goalDetailPanelSource).not.toContain("<SunburstGoalMap");
  });
});
