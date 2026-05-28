import { describe, expect, it } from "vitest";
import { PRIMARY_GOAL_TITLES } from "../shared/goalRules";
import type { GoalNode } from "../shared/types";
import { buildImproveGoalPatch } from "./AiAssistantDialog";

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
