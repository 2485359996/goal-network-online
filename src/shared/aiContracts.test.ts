import { describe, expect, it } from "vitest";
import {
  aiFindingSchema,
  aiWeeklyActionSchema,
  draftGoalRequestSchema,
  draftGoalResponseSchema,
  improveGoalRequestSchema,
  improveGoalResponseSchema,
  normalizeAiActionCandidates
} from "./aiContracts";

const validGoalContext = {
  id: "goal-delivery",
  title: "Delivery",
  status: "active",
  horizon: "medium",
  domain: "[[Career]]",
  parent: "[[Career]]",
  priority: 50,
  clarity: 2,
  progress: 20,
  color: "#2563eb",
  summary: "Ship the current project.",
  directions: ["Clarify scope"],
  successSignals: ["Demo is accepted"],
  actionCandidates: [{ text: "Write demo notes", done: false }],
  reviewQuestions: ["What blocked delivery?"]
};

describe("AI contracts", () => {
  it("accepts valid improve-goal requests and rejects malformed requests", () => {
    const request = {
      goalId: "goal-delivery",
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: []
    };

    expect(improveGoalRequestSchema.safeParse(request).success).toBe(true);
    expect(improveGoalRequestSchema.safeParse({ ...request, goalId: undefined }).success).toBe(false);
    expect(improveGoalRequestSchema.safeParse({ ...request, children: "wrong" }).success).toBe(false);
  });

  it("rejects arbitrary markdown response fields", () => {
    expect(
      improveGoalResponseSchema.safeParse({
        summary: "Sharper goal definition",
        markdown: "# Delivery\n\nFree-form content"
      }).success
    ).toBe(false);
  });

  it("normalizes action candidate suggestions", () => {
    expect(normalizeAiActionCandidates(["Write plan", { text: "Review plan", done: true }, "  "])).toEqual([
      { text: "Write plan", done: false },
      { text: "Review plan", done: true }
    ]);
  });

  it("accepts draft-goal requests and rejects free-form draft-goal responses", () => {
    const request = {
      mode: "subgoal",
      goalMap: { id: "map-1", name: "目标网络" },
      parentGoal: validGoalContext,
      sourceGoal: validGoalContext,
      siblings: [],
      existingTitles: ["Delivery"],
      domainCandidates: ["Career"],
      draft: {
        title: "Improve release confidence",
        domain: "Career",
        horizon: "medium",
        priority: 50,
        progress: 0,
        summary: "",
        successSignals: [],
        actionCandidates: [],
        reviewQuestions: []
      }
    };

    expect(draftGoalRequestSchema.safeParse(request).success).toBe(true);
    expect(draftGoalRequestSchema.safeParse({ ...request, mode: "wrong" }).success).toBe(false);
    expect(
      draftGoalResponseSchema.safeParse({
        title: "Improve release confidence",
        summary: "Make the release path measurable.",
        markdown: "# Free-form content"
      }).success
    ).toBe(false);
  });

  it("finding severity defaults to info when omitted", () => {
    const result = aiFindingSchema.safeParse({
      title: "Stale goal",
      detail: "No progress in 30 days"
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.severity).toBe("info");
  });

  it("weekly action schema requires description and accepts optional fields", () => {
    expect(aiWeeklyActionSchema.safeParse({ description: "Review PRs" }).success).toBe(true);
    expect(aiWeeklyActionSchema.safeParse({ description: "Review PRs", goal: "Delivery", due: "2025-01-13" }).success).toBe(true);
    expect(aiWeeklyActionSchema.safeParse({ goal: "Delivery" }).success).toBe(false);
  });
});
