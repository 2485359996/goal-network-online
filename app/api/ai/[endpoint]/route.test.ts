import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiContext: vi.fn(),
  buildServerAiRequest: vi.fn(),
  runAiProvider: vi.fn()
}));

vi.mock("../../../../src/lib/api/context", () => {
  class ApiError extends Error {
    constructor(message: string, public readonly status = 400) {
      super(message);
    }
  }
  return {
    ApiError,
    getApiContext: mocks.getApiContext
  };
});

vi.mock("../../../../src/server/aiContext", () => ({
  buildServerAiRequest: mocks.buildServerAiRequest
}));

vi.mock("../../../../src/server/ai", () => ({
  AI_PROVIDER_NOT_CONFIGURED: "AI provider not configured",
  runAiProvider: mocks.runAiProvider
}));

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

const validRequest = {
  goalId: "goal-delivery",
  goal: validGoalContext,
  parentChain: [],
  children: [],
  siblings: [],
  branchGoals: [validGoalContext]
};

async function postAi(endpoint: string, payload: unknown) {
  const { POST } = await import("./route");
  return POST(new Request(`http://local.test/api/ai/${endpoint}`, {
    method: "POST",
    body: JSON.stringify(payload)
  }), { params: Promise.resolve({ endpoint }) });
}

describe("AI route", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getApiContext.mockReset();
    mocks.buildServerAiRequest.mockReset();
    mocks.runAiProvider.mockReset();
    mocks.getApiContext.mockResolvedValue({
      admin: {},
      workspaceId: "workspace-1",
      user: { id: "user-1" },
      role: "owner"
    });
    mocks.buildServerAiRequest.mockImplementation(async (_endpoint, request) => request);
    mocks.runAiProvider.mockResolvedValue({ findings: [] });
  });

  it("returns a request validation error before loading workspace context", async () => {
    const response = await postAi("diagnose-branch", {
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: []
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "AI 请求格式无效" });
    expect(mocks.getApiContext).not.toHaveBeenCalled();
    expect(mocks.runAiProvider).not.toHaveBeenCalled();
  });

  it("requires an authenticated workspace before calling the provider", async () => {
    const { ApiError } = await import("../../../../src/lib/api/context");
    mocks.getApiContext.mockRejectedValue(new ApiError("Unauthorized", 401));

    const response = await postAi("diagnose-branch", validRequest);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.runAiProvider).not.toHaveBeenCalled();
  });

  it("returns a not-found error when server context cannot find the goal", async () => {
    const { ApiError } = await import("../../../../src/lib/api/context");
    mocks.buildServerAiRequest.mockRejectedValue(new ApiError("Goal not found", 404));

    const response = await postAi("diagnose-branch", validRequest);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Goal not found" });
    expect(mocks.runAiProvider).not.toHaveBeenCalled();
  });

  it("passes the hydrated compact request to the provider", async () => {
    const compactRequest = {
      goalId: validRequest.goalId,
      goal: validRequest.goal,
      parentChain: validRequest.parentChain,
      children: validRequest.children,
      siblings: validRequest.siblings,
      branchSummary: {
        summaryVersion: 1,
        sourceHash: "hash-1",
        scope: "branch",
        rootGoalId: "goal-delivery",
        rootGoalTitle: "Delivery",
        goalCount: 12,
        omittedGoalCount: 0,
        statusCounts: { active: 12, paused: 0, done: 0, archived: 0 },
        horizonCounts: { medium: 12 },
        averageClarity: 3,
        averageProgress: 20,
        openActionCount: 3,
        completedActionCount: 1,
        relationCounts: { supports: 0, depends_on: 0, conflicts_with: 0 },
        riskSignals: [],
        recentSignals: [],
        goals: []
      }
    };
    mocks.buildServerAiRequest.mockResolvedValue(compactRequest);

    const response = await postAi("diagnose-branch", validRequest);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ findings: [] });
    expect(mocks.runAiProvider).toHaveBeenCalledWith("diagnose-branch", compactRequest, { readLocalEnv: expect.any(Function) });
  });

  it("normalizes common diagnose finding aliases from the provider", async () => {
    mocks.runAiProvider.mockResolvedValue({
      issues: [{
        level: "high",
        issue: "进展卡住",
        description: "高优先级目标没有最近进展。",
        suggestions: ["缩小本周范围", "补一条开放行动"]
      }]
    });

    const response = await postAi("diagnose-branch", validRequest);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      findings: [{
        severity: "critical",
        title: "进展卡住",
        detail: "高优先级目标没有最近进展。",
        recommendation: "缩小本周范围\n补一条开放行动"
      }]
    });
  });

  it("returns a response validation error separately from request validation", async () => {
    mocks.runAiProvider.mockResolvedValue({ findings: [{ severity: "unknown" }] });

    const response = await postAi("diagnose-branch", validRequest);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "AI 返回格式不符合预期" });
  });
});
