import { describe, expect, it } from "vitest";
import { PRIMARY_GOAL_TITLES } from "../shared/goalRules";
import type { GoalNode } from "../shared/types";
import { buildAgentRequest, buildImproveGoalPatch, requestAgent, resolveAiAssistantResponse } from "./AiAssistantDialog";
import {
  agentClarifyingQuestionFromDecision,
  availableAssistantCommands,
  availableQuickAdjustmentsForTab,
  buildAiTurn,
  buildAssistantCommandTurn,
  inferAssistantTargetFromMessage,
  resolveAssistantMessageRoute,
  resolveAssistantMessageTarget,
  shouldUseAgentRouterForRoute,
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

  it("builds controlled agent router requests with current goal context", () => {
    const goal = goalFixture({
      id: "goal-delivery",
      title: "Delivery",
      children: [goalFixture({ id: "child-1", title: "Release checklist", parent: "[[Delivery]]" })]
    });
    const parent = goalFixture({ id: "parent-1", title: "Career", parent: "" });
    const sibling = goalFixture({ id: "sibling-1", title: "Quality", parent: "" });

    expect(
      buildAgentRequest(goal, [parent, goal, sibling], "帮我看看这个目标", {
        conversation: [{ role: "user", content: "帮我看看这个目标" }],
        lastTarget: "weekly",
        activeTarget: "weekly",
        currentResponse: { weeklyActions: [{ description: "Draft checklist" }] }
      })
    ).toMatchObject({
      goalId: "goal-delivery",
      goal: { title: "Delivery" },
      message: "帮我看看这个目标",
      conversation: [{ role: "user", content: "帮我看看这个目标" }],
      lastTarget: "weekly",
      activeTarget: "weekly",
      currentResponse: { weeklyActions: [{ description: "Draft checklist" }] },
      children: [expect.objectContaining({ title: "Release checklist" })]
    });
  });

  it("prepares pending edits before requesting the agent router", async () => {
    const goal = goalFixture();
    const request = buildAgentRequest(goal, [goal], "help me decide");
    const calls: string[] = [];

    const result = await requestAgent(request, {
      beforeGenerate: async () => {
        calls.push("before-generate");
      },
      fetch: async (url, init) => {
        calls.push(String(url));
        expect(JSON.parse(String(init?.body))).toMatchObject({
          goalId: "goal-career",
          message: "help me decide"
        });
        return new Response(
          JSON.stringify({
            kind: "chat",
            message: "Ready."
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    expect(calls).toEqual(["before-generate", "/api/ai/agent"]);
    expect(result).toEqual({
      kind: "chat",
      message: "Ready."
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

  it("sends explicit task messages directly to task endpoints instead of the agent router", () => {
    expect(shouldUseAgentRouterForRoute(resolveAssistantMessageRoute(null, "帮我拆解成几个子目标"))).toBe(false);
    expect(shouldUseAgentRouterForRoute(resolveAssistantMessageRoute("weekly", "少一点"))).toBe(false);
    expect(shouldUseAgentRouterForRoute(resolveAssistantMessageRoute(null, "你好"))).toBe(true);
  });

  it("leaves greetings undecided so the agent router can answer them", () => {
    expect(inferAssistantTargetFromMessage("你好")).toBeNull();
    expect(resolveAssistantMessageRoute(null, "你好")).toEqual({
      kind: "needs-command",
      reply: "我还不确定你想让我执行哪类任务。请选择一个快捷指令，或直接说“优化目标 / 拆解子目标 / 分支体检 / 本周行动”。"
    });
  });

  it("turns agent clarify decisions into clickable clarification questions", () => {
    expect(
      agentClarifyingQuestionFromDecision({
        kind: "clarify",
        message: "你更想先优化定义，还是拆解行动？",
        options: ["优化目标", "拆解子目标"]
      })
    ).toEqual({
      id: "agent-clarify",
      question: "你更想先优化定义，还是拆解行动？",
      options: [
        { id: "option-0", label: "优化目标" },
        { id: "option-1", label: "拆解子目标" }
      ]
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
