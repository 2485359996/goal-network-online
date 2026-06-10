import { describe, expect, it } from "vitest";
import { PRIMARY_GOAL_TITLES } from "../shared/goalRules";
import type { GoalNode } from "../shared/types";
import {
  buildAiRequest,
  buildImproveGoalPatch,
  improveDraftFromResponse,
  improveResponseFromDraft,
  selectedSubgoalSuggestionsForCreate,
  selectedWeeklyActionInputsForCreate
} from "./AiAssistantDialog";

function goalFixture(patch: Partial<GoalNode> = {}): GoalNode {
  return {
    id: "goal-career",
    title: "Career",
    filePath: "goals/career.md",
    status: "active",
    horizon: "long",
    domain: "[[Career]]",
    parent: "",
    priority: 50,
    clarity: 2,
    progress: 20,
    color: "#2563eb",
    supports: [],
    depends_on: [],
    conflicts_with: [],
    last_reviewed: "",
    last_progress: "",
    tags: ["goal-network"],
    sections: {
      summary: "",
      directions: [],
      directionHeading: "子方向",
      successSignals: [],
      actionCandidates: [],
      reviewQuestions: []
    },
    children: [],
    goalMapId: "map-1",
    ...patch
  } as GoalNode;
}

describe("AI assistant apply helpers", () => {
  it("filters action candidates when applying suggestions to primary goals", () => {
    const primaryGoal = goalFixture({
      title: PRIMARY_GOAL_TITLES[0],
      parent: ""
    });

    expect(
      buildImproveGoalPatch(
        primaryGoal,
        {
          summary: "Clearer definition",
          actionCandidates: ["Should not be applied"]
        },
        {
          summary: true,
          actionCandidates: true
        }
      )
    ).toEqual({
      summary: "Clearer definition"
    });
  });
});

describe("buildAiRequest", () => {
  it("improve tab omits branchGoals", () => {
    const goal = goalFixture({ id: "g1", title: "Goal A" });
    const req = buildAiRequest("improve", goal, [goal]);
    expect(req).not.toHaveProperty("branchGoals");
  });

  it("subgoals tab omits branchGoals", () => {
    const goal = goalFixture({ id: "g1", title: "Goal A" });
    const req = buildAiRequest("subgoals", goal, [goal]);
    expect(req).not.toHaveProperty("branchGoals");
  });

  it("diagnose tab includes branchGoals with full subtree", () => {
    const child = goalFixture({ id: "g2", title: "Child A", parent: "[[Goal A]]" });
    const goal = goalFixture({ id: "g1", title: "Goal A", children: [child] });
    const req = buildAiRequest("diagnose", goal, [goal, child]);
    expect(req).toHaveProperty("branchGoals");
    const titles = (req as { branchGoals: Array<{ title: string }> }).branchGoals.map((g) => g.title);
    expect(titles).toContain("Goal A");
    expect(titles).toContain("Child A");
  });

  it("weekly tab includes branchGoals", () => {
    const goal = goalFixture({ id: "g1", title: "Goal A" });
    const req = buildAiRequest("weekly", goal, [goal]);
    expect(req).toHaveProperty("branchGoals");
  });

  it("builds parentChain from root to immediate parent", () => {
    const root = goalFixture({ id: "g0", title: "Root", parent: "" });
    const parent = goalFixture({ id: "g1", title: "Parent", parent: "" });
    const child = goalFixture({ id: "g2", title: "Child", parent: "[[Parent]]" });
    parent.parent = "[[Root]]";
    const req = buildAiRequest("improve", child, [root, parent, child]) as {
      parentChain: Array<{ title: string }>;
    };
    expect(req.parentChain.map((g) => g.title)).toEqual(["Root", "Parent"]);
  });

  it("siblings share same parent and domain", () => {
    const goal = goalFixture({ id: "g1", title: "Goal A", parent: "[[Root]]", domain: "[[Career]]" });
    const sibling = goalFixture({ id: "g2", title: "Goal B", parent: "[[Root]]", domain: "[[Career]]" });
    const unrelated = goalFixture({ id: "g3", title: "Goal C", parent: "[[Root]]", domain: "[[Health]]" });
    const req = buildAiRequest("improve", goal, [goal, sibling, unrelated]) as {
      siblings: Array<{ title: string }>;
    };
    expect(req.siblings.map((g) => g.title)).toEqual(["Goal B"]);
  });
});

describe("improveDraftFromResponse / improveResponseFromDraft", () => {
  it("round-trips a full response", () => {
    const original = {
      summary: "Better goal",
      successSignals: ["Signal A", "Signal B"],
      actionCandidates: [{ text: "Do thing", done: false }],
      reviewQuestions: ["What worked?"],
      warnings: undefined
    };
    const draft = improveDraftFromResponse(original);
    expect(draft.summary).toBe("Better goal");
    expect(draft.successSignals).toBe("Signal A\nSignal B");
    expect(draft.actionCandidates).toBe("Do thing");
    expect(draft.reviewQuestions).toBe("What worked?");

    const back = improveResponseFromDraft(draft, original);
    expect(back.summary).toBe("Better goal");
    expect(back.successSignals).toEqual(["Signal A", "Signal B"]);
    expect(back.actionCandidates).toEqual(["Do thing"]);
    expect(back.reviewQuestions).toEqual(["What worked?"]);
  });

  it("preserves undefined for fields not returned by AI", () => {
    const original = { summary: "Only summary", warnings: undefined };
    const draft = improveDraftFromResponse(original);
    const back = improveResponseFromDraft(draft, original);
    expect(back.summary).toBe("Only summary");
    expect(back.successSignals).toBeUndefined();
    expect(back.actionCandidates).toBeUndefined();
    expect(back.reviewQuestions).toBeUndefined();
  });

  it("filters empty lines when splitting textarea value", () => {
    const original = { successSignals: ["A", "B"], warnings: undefined };
    const draft = improveDraftFromResponse(original);
    draft.successSignals = "A\n\n  B  \n";
    const back = improveResponseFromDraft(draft, original);
    expect(back.successSignals).toEqual(["A", "B"]);
  });
});

describe("selected AI draft helpers", () => {
  it("keeps subgoal drafts aligned to original suggestion indexes", () => {
    const suggestions = selectedSubgoalSuggestionsForCreate(
      {
        subgoals: [
          { title: "Subgoal A", summary: "Original A" },
          { title: "Subgoal B", summary: "Original B", successSignals: ["Signal B"] }
        ]
      },
      { "subgoal-1": true },
      [
        { title: "Edited A", summary: "Edited summary A" },
        { title: "Edited B", summary: "Edited summary B" }
      ]
    );

    expect(suggestions).toEqual([
      { title: "Edited B", summary: "Edited summary B", successSignals: ["Signal B"] }
    ]);
  });

  it("keeps weekly action drafts aligned to original suggestion indexes", () => {
    const actions = selectedWeeklyActionInputsForCreate(
      {
        weeklyActions: [
          { description: "Action A", goal: "Goal A", due: "2026-01-01" },
          { description: "Action B", goal: "Goal B", due: "2026-01-02" }
        ]
      },
      { "weekly-1": true },
      [
        { description: "Edited A", due: "2026-02-01" },
        { description: "Edited B", due: "2026-02-02" }
      ],
      "Fallback Goal"
    );

    expect(actions).toEqual([
      { description: "Edited B", goal: "Goal B", due: "2026-02-02" }
    ]);
  });
});
