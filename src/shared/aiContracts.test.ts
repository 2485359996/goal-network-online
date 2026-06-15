import { describe, expect, it } from "vitest";
import {
  aiFindingSchema,
  aiWeeklyActionSchema,
  draftGoalRequestSchema,
  draftGoalResponseSchema,
  improveGoalRequestSchema,
  improveGoalResponseSchema,
  normalizeAiActionCandidates,
  suggestSubgoalsResponseSchema,
  suggestWeeklyActionsResponseSchema
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

  it("accepts turn metadata on improve-goal requests", () => {
    expect(
      improveGoalRequestSchema.safeParse({
        goalId: "goal-delivery",
        goal: validGoalContext,
        parentChain: [],
        children: [],
        siblings: [],
        turn: {
          intent: "quick-adjust",
          allowClarification: false,
          quickAdjustment: "too-hard",
          currentResponse: { summary: "Current summary" }
        }
      }).success
    ).toBe(true);
  });

  it("accepts clarification-only responses and rejects mixed result responses", () => {
    const clarifyingQuestion = {
      id: "scope",
      question: "你更想先调整哪一部分？",
      options: [
        { id: "scope", label: "缩小范围" },
        { id: "cadence", label: "降低频率" }
      ]
    };

    expect(
      improveGoalResponseSchema.safeParse({
        clarifyingQuestion
      }).success
    ).toBe(true);

    expect(
      improveGoalResponseSchema.safeParse({
        summary: "Sharper goal",
        clarifyingQuestion
      }).success
    ).toBe(false);
  });

  it("normalizes action candidate suggestions", () => {
    expect(normalizeAiActionCandidates(["Write plan", { text: "Review plan", done: true }, "  "])).toEqual([
      { text: "Write plan", done: false },
      { text: "Review plan", done: true }
    ]);
  });

  it("strips harmless goal-context fields from subgoal suggestions", () => {
    expect(
      suggestSubgoalsResponseSchema.parse({
        subgoals: [
          {
            id: "draft-subgoal",
            title: "Improve release confidence",
            status: "active",
            horizon: "medium",
            priority: 60,
            progress: 0,
            directions: ["Clarify release gates"],
            summary: "Make release readiness measurable."
          }
        ]
      })
    ).toEqual({
      subgoals: [
        {
          title: "Improve release confidence",
          horizon: "medium",
          priority: 60,
          summary: "Make release readiness measurable."
        }
      ]
    });
  });

  it("normalizes string weekly-action suggestions into action objects", () => {
    expect(
      suggestWeeklyActionsResponseSchema.parse({
        weeklyActions: ["Draft acceptance checklist", { description: "Review release risks", goal: "Delivery" }]
      })
    ).toEqual({
      weeklyActions: [
        { description: "Draft acceptance checklist" },
        { description: "Review release risks", goal: "Delivery" }
      ]
    });
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
