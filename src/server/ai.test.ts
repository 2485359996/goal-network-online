import { describe, expect, it } from "vitest";
import { registerAiRoutes, runAiProvider, systemPromptFor } from "./ai";

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

type AiHandler = (
  request: { body: unknown },
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } }
) => Promise<unknown>;

function buildRoutes(options: Parameters<typeof registerAiRoutes>[1] = { readLocalEnv: () => ({}) }) {
  const routes = new Map<string, AiHandler>();
  registerAiRoutes({
    post: (path, handler) => {
      routes.set(path, handler);
    }
  }, options);
  return routes;
}

async function inject(routes: Map<string, AiHandler>, url: string, payload: unknown) {
  const handler = routes.get(url);
  if (!handler) throw new Error(`Missing route: ${url}`);

  let statusCode = 200;
  let body: unknown;
  const result = await handler(
    { body: payload },
    {
      code: (status) => {
        statusCode = status;
        return {
          send: (payload) => {
            body = payload;
            return payload;
          }
        };
      }
    }
  );
  if (body === undefined) body = result;
  return {
    statusCode,
    json: () => body
  };
}

describe("AI routes", () => {
  it("returns 501 for valid improve-goal requests until a provider is configured", async () => {
    const routes = buildRoutes();
    const response = await inject(routes, "/api/ai/improve-goal", {
      goalId: "goal-delivery",
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: []
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "AI provider not configured" });
  });

  it("returns 501 for valid draft-goal requests until a provider is configured", async () => {
    const routes = buildRoutes();
    const response = await inject(routes, "/api/ai/draft-goal", {
      mode: "top",
      goalMap: { id: "map-1", name: "目标网络" },
      siblings: [],
      existingTitles: ["Delivery"],
      domainCandidates: ["Career"],
      draft: {
        title: "New goal",
        domain: "Career",
        horizon: "medium",
        priority: 50,
        progress: 0,
        summary: "",
        successSignals: [],
        actionCandidates: [],
        reviewQuestions: []
      }
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "AI provider not configured" });
  });

  it("returns 501 for valid agent router requests until a provider is configured", async () => {
    const routes = buildRoutes();
    const response = await inject(routes, "/api/ai/agent", {
      goalId: "goal-delivery",
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: [],
      branchGoals: [validGoalContext],
      message: "帮我看看这个目标应该怎么处理",
      conversation: [{ role: "user", content: "帮我看看这个目标应该怎么处理" }],
      lastTarget: null,
      activeTarget: null
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "AI provider not configured" });
  });

  it("calls a configured provider for draft-goal and parses a goal draft", async () => {
    const request = {
      mode: "top",
      goalMap: { id: "map-1", name: "目标网络" },
      siblings: [],
      existingTitles: ["Delivery"],
      domainCandidates: ["Career"],
      draft: {
        title: "New goal",
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

    const result = await runAiProvider("draft-goal", request, {
      env: {
        AI_PROVIDER_URL: "https://provider.example/v1",
        AI_PROVIDER_KEY: "test-key",
        AI_PROVIDER_MODEL: "test-model"
      },
      readLocalEnv: () => ({}),
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "Improve release confidence",
                    domain: "Career",
                    priority: 60,
                    summary: "Make release readiness measurable."
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    expect(result).toEqual({
      title: "Improve release confidence",
      domain: "Career",
      priority: 60,
      summary: "Make release readiness measurable."
    });
  });

  it("calls a configured provider for the agent router and parses a tool decision", async () => {
    const request = {
      goalId: "goal-delivery",
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: [],
      branchGoals: [validGoalContext],
      message: "这个目标太大了，帮我拆成几个子目标",
      conversation: [{ role: "user", content: "这个目标太大了，帮我拆成几个子目标" }],
      lastTarget: null,
      activeTarget: null
    };

    const result = await runAiProvider("agent", request, {
      env: {
        AI_PROVIDER_URL: "https://provider.example/v1",
        AI_PROVIDER_KEY: "test-key",
        AI_PROVIDER_MODEL: "test-model"
      },
      readLocalEnv: () => ({}),
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    kind: "tool",
                    target: "subgoals",
                    message: "我会先把它拆成几个候选子目标。"
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    expect(result).toEqual({
      kind: "tool",
      target: "subgoals",
      message: "我会先把它拆成几个候选子目标。"
    });
  });

  it("returns 400 for malformed requests", async () => {
    const routes = buildRoutes();
    const response = await inject(routes, "/api/ai/improve-goal", {
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: []
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: string }).error).toBe("Invalid AI request");
  });

  it("calls a configured OpenAI-compatible provider and parses JSON content", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const request = {
      goalId: "goal-delivery",
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: []
    };

    const result = await runAiProvider("improve-goal", request, {
      env: {
        AI_PROVIDER_URL: "https://provider.example/v1",
        AI_PROVIDER_KEY: "test-key",
        AI_PROVIDER_MODEL: "test-model"
      },
      readLocalEnv: () => ({}),
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "Sharper delivery goal",
                    actionCandidates: ["Draft acceptance checklist"]
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    expect(result).toEqual({
      summary: "Sharper delivery goal",
      actionCandidates: ["Draft acceptance checklist"]
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://provider.example/v1/chat/completions");
    expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      model: "test-model",
      response_format: { type: "json_object" }
    });
  });

  it("parses the first JSON object when a provider appends non-JSON text", async () => {
    const request = {
      goalId: "goal-delivery",
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: []
    };

    const result = await runAiProvider("improve-goal", request, {
      env: {
        AI_PROVIDER_URL: "https://provider.example/v1",
        AI_PROVIDER_KEY: "test-key",
        AI_PROVIDER_MODEL: "test-model"
      },
      readLocalEnv: () => ({}),
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"summary":"Sharper delivery goal"}\n\n说明：已按 JSON 返回。'
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    expect(result).toEqual({
      summary: "Sharper delivery goal"
    });
  });

  it("includes turn metadata inside the provider user message JSON", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const request = {
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
    };

    await runAiProvider("improve-goal", request, {
      env: {
        AI_PROVIDER_URL: "https://provider.example/v1",
        AI_PROVIDER_KEY: "test-key",
        AI_PROVIDER_MODEL: "test-model"
      },
      readLocalEnv: () => ({}),
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ summary: "Adjusted summary" }) } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    const body = JSON.parse(String(calls[0].init.body)) as { messages: Array<{ role: string; content: string }> };
    const userMessage = body.messages.find((message) => message.role === "user");
    expect(JSON.parse(userMessage?.content ?? "{}")).toMatchObject({
      endpoint: "improve-goal",
      request: {
        turn: {
          intent: "quick-adjust",
          quickAdjustment: "too-hard",
          currentResponse: { summary: "Current summary" }
        }
      }
    });
  });

  it("sends compact branch summaries to the provider without full branchGoals", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const request = {
      goalId: "goal-delivery",
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: [],
      branchSummary: {
        summaryVersion: 1,
        sourceHash: "hash-1",
        scope: "branch",
        rootGoalId: "goal-delivery",
        rootGoalTitle: "Delivery",
        goalCount: 40,
        omittedGoalCount: 20,
        statusCounts: { active: 30, paused: 5, done: 5, archived: 0 },
        horizonCounts: { medium: 40 },
        averageClarity: 2.8,
        averageProgress: 35,
        openActionCount: 12,
        completedActionCount: 4,
        riskSignals: ["10 个活跃目标清晰度偏低"],
        recentSignals: [],
        goals: []
      }
    };

    await runAiProvider("diagnose-branch", request, {
      env: {
        AI_PROVIDER_URL: "https://provider.example/v1",
        AI_PROVIDER_KEY: "test-key",
        AI_PROVIDER_MODEL: "test-model"
      },
      readLocalEnv: () => ({}),
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ findings: [] }) } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
    });

    const body = JSON.parse(String(calls[0].init.body)) as { messages: Array<{ role: string; content: string }> };
    const userPayload = JSON.parse(body.messages.find((message) => message.role === "user")?.content ?? "{}");
    expect(userPayload.request.branchSummary).toMatchObject({ sourceHash: "hash-1", goalCount: 40 });
    expect(userPayload.request).not.toHaveProperty("branchGoals");
    expect(body.messages.find((message) => message.role === "system")?.content).toContain("request.branchSummary");
  });

  it("only allows clarifyingQuestion in the system prompt when turn explicitly allows it", () => {
    const request = {
      goalId: "goal-delivery",
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: []
    };

    expect(systemPromptFor("improve-goal", request)).not.toContain("clarifyingQuestion");
    expect(systemPromptFor("improve-goal", {
      ...request,
      turn: { intent: "generate", allowClarification: true }
    })).toContain("clarifyingQuestion");
    expect(systemPromptFor("improve-goal", {
      ...request,
      turn: { intent: "generate", allowClarification: false }
    })).not.toContain("clarifyingQuestion");
  });

  it("uses a controlled tool-routing prompt for the agent endpoint", () => {
    const prompt = systemPromptFor("agent", {
      goalId: "goal-delivery",
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: [],
      branchGoals: [validGoalContext],
      message: "帮我看看",
      conversation: [{ role: "user", content: "帮我看看" }],
      lastTarget: null,
      activeTarget: null
    });

    expect(prompt).toContain("controlled goal-coach agent router");
    expect(prompt).toContain("Do not write data");
    expect(prompt).toContain("improve");
    expect(prompt).toContain("subgoals");
    expect(prompt).toContain("diagnose");
    expect(prompt).toContain("weekly");
  });

  it("parses provider clarification responses through route contracts", async () => {
    const routes = buildRoutes({
      env: {
        AI_PROVIDER_URL: "https://provider.example/v1",
        AI_PROVIDER_KEY: "test-key",
        AI_PROVIDER_MODEL: "test-model"
      },
      readLocalEnv: () => ({}),
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    clarifyingQuestion: {
                      id: "scope",
                      question: "你更想先调整哪一部分？",
                      options: [
                        { id: "scope", label: "缩小范围" },
                        { id: "cadence", label: "降低频率" }
                      ]
                    }
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    const response = await inject(routes, "/api/ai/improve-goal", {
      goalId: "goal-delivery",
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: [],
      turn: { intent: "generate", allowClarification: true }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      clarifyingQuestion: {
        id: "scope",
        options: [
          { id: "scope", label: "缩小范围" },
          { id: "cadence", label: "降低频率" }
        ]
      }
    });
  });
});
