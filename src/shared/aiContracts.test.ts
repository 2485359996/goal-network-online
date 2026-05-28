import { describe, expect, it } from "vitest";
import {
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
});
