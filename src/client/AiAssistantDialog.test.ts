import { describe, expect, it } from "vitest";
import { PRIMARY_GOAL_TITLES } from "../shared/goalRules";
import type { GoalNode } from "../shared/types";
import { buildImproveGoalPatch, resolveAiAssistantResponse } from "./AiAssistantDialog";
import {
  availableAssistantCommands,
  availableQuickAdjustmentsForTab,
  buildAiTurn,
  buildAssistantCommandTurn,
  inferAssistantTargetFromMessage,
  resolveAssistantMessageRoute,
  resolveAssistantMessageTarget,
  shouldAllowGoalClarification
} from "./aiConversation";

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

  it("returns quick adjustments by AI target", () => {
    expect(availableQuickAdjustmentsForTab("diagnose")).toEqual([]);
    expect(availableQuickAdjustmentsForTab("weekly")).toEqual(
      expect.arrayContaining(["not-enough-time", "fewer-actions"])
    );
  });

  it("maps assistant quick commands to the existing AI endpoints", () => {
    expect(availableAssistantCommands()).toEqual([
      { target: "improve", label: "优化目标", endpoint: "improve-goal" },
      { target: "subgoals", label: "拆解子目标", endpoint: "suggest-subgoals" },
      { target: "diagnose", label: "分支体检", endpoint: "diagnose-branch" },
      { target: "weekly", label: "本周行动", endpoint: "suggest-weekly-actions" }
    ]);
  });

  it("builds generate turns for assistant quick commands", () => {
    expect(buildAssistantCommandTurn(true)).toEqual({
      intent: "generate",
      allowClarification: true
    });
  });

  it("infers assistant targets from natural language messages", () => {
    expect(inferAssistantTargetFromMessage("帮我拆解成几个子目标")).toBe("subgoals");
    expect(inferAssistantTargetFromMessage("体检一下这个分支有什么风险")).toBe("diagnose");
    expect(inferAssistantTargetFromMessage("安排一下本周行动")).toBe("weekly");
    expect(inferAssistantTargetFromMessage("帮我改得更清楚")).toBe("improve");
  });

  it("uses the recent target for follow-up chat and asks for a command on unclear first messages", () => {
    expect(resolveAssistantMessageTarget("weekly", "少一点")).toEqual({
      target: "weekly",
      inferred: false
    });
    expect(resolveAssistantMessageTarget(null, "帮我看看")).toBeNull();
    expect(resolveAssistantMessageRoute(null, "帮我看看")).toEqual({
      kind: "needs-command",
      reply: "我还不确定你想让我执行哪类任务。请选择一个快捷指令，或直接说“优化目标 / 拆解子目标 / 分支体检 / 本周行动”。"
    });
    expect(resolveAssistantMessageTarget("weekly", "帮我拆解成几个子目标")).toEqual({
      target: "subgoals",
      inferred: true
    });
  });

  it("treats greetings as chat instead of defaulting to goal suggestions", () => {
    expect(inferAssistantTargetFromMessage("你好")).toBeNull();
    expect(resolveAssistantMessageRoute(null, "你好")).toEqual({
      kind: "chat",
      reply: "你好，我可以帮你优化目标、拆解子目标、体检分支，或安排本周行动。你可以直接说想做哪一件。"
    });
  });

  it("builds AI turns without translating quick adjustment enums", () => {
    const turn = buildAiTurn({
      intent: "quick-adjust",
      quickAdjustment: "too-hard",
      currentResponse: { summary: "Current summary" },
      allowClarification: false
    });

    expect(turn).toMatchObject({
      intent: "quick-adjust",
      quickAdjustment: "too-hard",
      currentResponse: { summary: "Current summary" },
      allowClarification: false
    });
    expect(turn.message).toBeUndefined();
  });

  it("does not allow goal clarification after an answer was already supplied", () => {
    const goal = goalFixture({ clarity: 1, horizon: "long" });

    expect(
      shouldAllowGoalClarification({
        target: "improve",
        goal,
        parentChain: [goalFixture({ id: "parent-1" })],
        children: [goalFixture({ id: "child-1" })],
        siblings: [goalFixture({ id: "sibling-1" })],
        hasClarificationAnswer: true
      })
    ).toBe(false);
  });

  it("does not allow goal clarification for diagnosis", () => {
    const goal = goalFixture({ clarity: 1, horizon: "long" });

    expect(
      shouldAllowGoalClarification({
        target: "diagnose",
        goal,
        parentChain: [goalFixture({ id: "parent-1" })],
        children: [goalFixture({ id: "child-1" })],
        siblings: [goalFixture({ id: "sibling-1" })],
        hasClarificationAnswer: false
      })
    ).toBe(false);
  });

  it("rejects clarification questions when the current turn did not allow clarification", () => {
    const transition = resolveAiAssistantResponse({
      tab: "improve",
      response: {
        clarifyingQuestion: {
          id: "scope",
          question: "你更想先调整哪一部分？",
          options: [
            { id: "scope", label: "缩小范围" },
            { id: "cadence", label: "降低频率" }
          ]
        }
      },
      goal: goalFixture(),
      allowClarification: false
    });

    expect(transition.kind).toBe("protocol-error");
  });

  it("does not compute default selections for clarification-only responses", () => {
    const transition = resolveAiAssistantResponse({
      tab: "improve",
      response: {
        clarifyingQuestion: {
          id: "scope",
          question: "你更想先调整哪一部分？",
          options: [
            { id: "scope", label: "缩小范围" },
            { id: "cadence", label: "降低频率" }
          ]
        }
      },
      goal: goalFixture(),
      allowClarification: true,
      selectDefaults: () => {
        throw new Error("default selections should not be called");
      }
    });

    expect(transition.kind).toBe("clarification");
  });
});
