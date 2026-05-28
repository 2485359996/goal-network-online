import Fastify from "fastify";
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

async function buildApp() {
  const app = Fastify();
  registerAiRoutes(app, { readLocalEnv: () => ({}) });
  await app.ready();
  return app;
}

describe("AI routes", () => {
  it("returns 501 for valid improve-goal requests until a provider is configured", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/ai/improve-goal",
      payload: {
        goalId: "goal-delivery",
        goal: validGoalContext,
        parentChain: [],
        children: [],
        siblings: []
      }
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "AI provider not configured" });
    await app.close();
  });

  it("returns 400 for malformed requests", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/ai/improve-goal",
      payload: {
        goal: validGoalContext,
        parentChain: [],
        children: [],
        siblings: []
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Invalid AI request");
    await app.close();
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
});
