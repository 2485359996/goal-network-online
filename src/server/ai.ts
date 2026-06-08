import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { aiRouteContracts, type AiEndpoint } from "../shared/aiContracts";

export const AI_PROVIDER_NOT_CONFIGURED = "AI provider not configured";

type AiProviderEnv = Record<string, string | undefined>;
type AiProviderOptions = {
  env?: AiProviderEnv;
  readLocalEnv?: () => AiProviderEnv;
  fetch?: typeof fetch;
};

class AiProviderNotConfiguredError extends Error {
  constructor() {
    super(AI_PROVIDER_NOT_CONFIGURED);
  }
}

export async function runAiProvider(endpoint: AiEndpoint, request: unknown, options: AiProviderOptions = {}): Promise<unknown> {
  const config = loadAiProviderConfig(options);
  if (!config) throw new AiProviderNotConfiguredError();

  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(`${config.url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.key}`
    },
    body: JSON.stringify({
      model: config.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: systemPromptFor(endpoint)
        },
        {
          role: "user",
          content: JSON.stringify({ endpoint, request }, null, 2)
        }
      ]
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const providerMessage = providerErrorMessage(body);
    throw new Error(providerMessage ? `AI provider error: ${providerMessage}` : `AI provider error: ${response.status}`);
  }

  const content = extractMessageContent(body);
  if (!content) throw new Error("AI provider returned empty content");

  return parseJsonObject(content);
}

type AiRouteReply = { code: (status: number) => { send: (payload: unknown) => unknown } };
type AiRouteApp = {
  post: (path: string, handler: (request: { body: unknown }, reply: AiRouteReply) => Promise<unknown>) => unknown;
};

export function registerAiRoutes(app: AiRouteApp, options: AiProviderOptions = {}) {
  const entries = Object.entries(aiRouteContracts) as Array<[AiEndpoint, (typeof aiRouteContracts)[AiEndpoint]]>;

  for (const [endpoint, contract] of entries) {
    app.post(contract.path, async (request, reply) => {
      try {
        const parsedRequest = contract.request.parse(request.body);
        const result = await runAiProvider(endpoint, parsedRequest, options);
        return contract.response.parse(result);
      } catch (error) {
        return handleAiError(error, reply);
      }
    });
  }
}

function handleAiError(error: unknown, reply: AiRouteReply) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      error: "Invalid AI request",
      issues: error.issues
    });
  }

  if (error instanceof AiProviderNotConfiguredError) {
    return reply.code(501).send({ error: AI_PROVIDER_NOT_CONFIGURED });
  }

  const message = error instanceof Error ? error.message : "AI request failed";
  return reply.code(500).send({ error: message });
}

function loadAiProviderConfig(options: AiProviderOptions) {
  const localEnv = options.readLocalEnv ? options.readLocalEnv() : readLocalEnvFile();
  const env = {
    ...localEnv,
    ...(options.env ?? process.env)
  };
  const url = env.AI_PROVIDER_URL?.trim().replace(/\/+$/, "");
  const key = env.AI_PROVIDER_KEY?.trim();
  const model = env.AI_PROVIDER_MODEL?.trim();

  if (!url || !key || !model) return null;
  return { url, key, model };
}

function readLocalEnvFile(): AiProviderEnv {
  const filePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env.local");
  if (!fs.existsSync(filePath)) return {};

  const result: AiProviderEnv = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    result[key] = value;
  }
  return result;
}

function systemPromptFor(endpoint: AiEndpoint) {
  const responseFields = {
    "improve-goal": "summary, successSignals, actionCandidates, reviewQuestions, warnings",
    "suggest-subgoals": "subgoals, warnings",
    "diagnose-branch": "findings, warnings",
    "suggest-weekly-actions": "weeklyActions, warnings",
    "draft-goal": "title, domain, horizon, priority, progress, summary, successSignals, actionCandidates, reviewQuestions, warnings"
  } satisfies Record<AiEndpoint, string>;

  return [
    "你是 Obsidian 目标网络的 AI 助手，只返回一个 JSON object。",
    `当前任务：${endpoint}。`,
    `允许的顶层字段仅限：${responseFields[endpoint]}。`,
    "不要返回 Markdown 文件内容，不要新增自定义 section，不要解释 JSON 之外的内容。",
    "actionCandidates 可以是字符串数组或 { text, done } 数组；subgoals 必须是独立目标建议；weeklyActions 必须可转成周行动。"
  ].join("\n");
}

function providerErrorMessage(body: unknown) {
  const parsed = z.object({
    error: z.union([
      z.string(),
      z.object({
        message: z.string().optional()
      }).passthrough()
    ]).optional()
  }).passthrough().safeParse(body);

  if (!parsed.success || !parsed.data.error) return "";
  return typeof parsed.data.error === "string" ? parsed.data.error : parsed.data.error.message ?? "";
}

function extractMessageContent(body: unknown) {
  const parsed = z.object({
    choices: z.array(z.object({
      message: z.object({
        content: z.union([
          z.string(),
          z.array(z.object({
            text: z.string().optional()
          }).passthrough())
        ]).optional()
      }).passthrough()
    }).passthrough())
  }).passthrough().safeParse(body);

  if (!parsed.success) return "";
  const content = parsed.data.choices[0]?.message.content;
  if (typeof content === "string") return content;
  return content?.map((item) => item.text ?? "").join("").trim() ?? "";
}

function parseJsonObject(content: string) {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(withoutFence);
}
