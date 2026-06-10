import { describe, expect, it } from "vitest";
import { registerAiRoutes, runAiProvider } from "./ai";

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

function buildRoutes() {
  const routes = new Map<string, AiHandler>();
  registerAiRoutes({
    post: (path, handler) => {
      routes.set(path, handler);
    }
  }, { readLocalEnv: () => ({}) });
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

  it("parses JSON wrapped in code fences", async () => {
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
            choices: [{ message: { content: "```json\n{\"summary\": \"Better goal\"}\n```" } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    expect((result as { summary: string }).summary).toBe("Better goal");
  });

  it("extracts JSON object from content with surrounding text", async () => {
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
            choices: [{ message: { content: "Here is the result:\n{\"summary\": \"Better goal\"}\n\nDone." } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    expect((result as { summary: string }).summary).toBe("Better goal");
  });

  it("throws for completely invalid JSON content", async () => {
    const request = {
      goalId: "goal-delivery",
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: []
    };

    await expect(
      runAiProvider("improve-goal", request, {
        env: {
          AI_PROVIDER_URL: "https://provider.example/v1",
          AI_PROVIDER_KEY: "test-key",
          AI_PROVIDER_MODEL: "test-model"
        },
        readLocalEnv: () => ({}),
        fetch: async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "not any json at all" } }]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
      })
    ).rejects.toThrow("AI provider returned invalid JSON");
  });

  it("throws a timeout error when the request exceeds AI_REQUEST_TIMEOUT_MS", async () => {
    const request = {
      goalId: "goal-delivery",
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: []
    };

    await expect(
      runAiProvider("improve-goal", request, {
        env: {
          AI_PROVIDER_URL: "https://provider.example/v1",
          AI_PROVIDER_KEY: "test-key",
          AI_PROVIDER_MODEL: "test-model",
          AI_REQUEST_TIMEOUT_MS: "10"
        },
        readLocalEnv: () => ({}),
        fetch: async (_url, init) => {
          await new Promise<void>((_resolve, reject) => {
            const signal = (init as RequestInit).signal;
            if (!signal) return;
            signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              (err as NodeJS.ErrnoException).name = "AbortError";
              reject(err);
            });
          });
          throw new Error("should not reach here");
        }
      })
    ).rejects.toThrow("AI provider request timed out");
  });

  it("throws with status code for provider 5xx errors", async () => {
    const request = {
      goalId: "goal-delivery",
      goal: validGoalContext,
      parentChain: [],
      children: [],
      siblings: []
    };

    await expect(
      runAiProvider("improve-goal", request, {
        env: {
          AI_PROVIDER_URL: "https://provider.example/v1",
          AI_PROVIDER_KEY: "test-key",
          AI_PROVIDER_MODEL: "test-model"
        },
        readLocalEnv: () => ({}),
        fetch: async () =>
          new Response(JSON.stringify({}), { status: 503, headers: { "content-type": "application/json" } })
      })
    ).rejects.toThrow("AI provider error: 503");
  });

});
