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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(`${config.url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: systemPromptFor(endpoint, request)
          },
          {
            role: "user",
            content: JSON.stringify({ endpoint, request }, null, 2)
          }
        ]
      })
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("AI provider request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

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
  const timeoutRaw = Number(env.AI_REQUEST_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 45_000;

  return { url, key, model, timeoutMs };
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

export function systemPromptFor(endpoint: AiEndpoint, request: unknown) {
  if (endpoint === "agent") return agentSystemPromptFor(request);

  const resultFields = {
    "improve-goal": ["summary", "successSignals", "actionCandidates", "reviewQuestions"],
    "suggest-subgoals": ["subgoals"],
    "diagnose-branch": ["findings"],
    "suggest-weekly-actions": ["weeklyActions"],
    "draft-goal": ["title", "domain", "horizon", "priority", "progress", "summary", "successSignals", "actionCandidates", "reviewQuestions"],
    agent: ["kind", "target", "message", "options"]
  } satisfies Record<AiEndpoint, string[]>;
  const allowClarification = Boolean(
    request &&
      typeof request === "object" &&
      "turn" in request &&
      (request as { turn?: { allowClarification?: boolean } }).turn?.allowClarification === true
  );
  const allowedFields = [
    ...resultFields[endpoint],
    "warnings",
    ...(allowClarification ? ["clarifyingQuestion"] : [])
  ];
  const clarificationRules = allowClarification
    ? [
        "You may return clarifyingQuestion only when one multiple-choice question would materially improve the result.",
        "When returning clarifyingQuestion, include only clarifyingQuestion and optional warnings; do not include any result fields."
      ]
    : ["Use the available request context to produce the best structured result now."];

  return [
    "You are the AI assistant for a personal goal network.",
    "Return exactly one JSON object and no markdown, prose, or custom sections.",
    `Current endpoint: ${endpoint}.`,
    `Allowed top-level fields: ${allowedFields.join(", ")}.`,
    ...clarificationRules,
    "For turn.intent message, quick-adjust, or clarification-answer, revise turn.currentResponse when present and preserve unaffected fields.",
    "When request.branchSummary is present, treat it as the authoritative compact branch context; do not require branchGoals.",
    "For diagnose-branch, findings must be an array of objects with severity, title, detail, and optional recommendation. Severity must be info, warning, or critical; map high/severe to critical and medium/risk to warning.",
    "Quick adjustment meanings:",
    "- too-hard: reduce difficulty, scope, prerequisites, or action intensity.",
    "- not-enough-time: shrink the current cycle scope and prefer the next smallest useful step.",
    "- lower-frequency: lower cadence or review/action frequency where the endpoint has cadence semantics.",
    "- fewer-actions: keep only the highest-leverage items.",
    "actionCandidates may be strings or { text, done } objects; subgoals must be independent goal suggestions; weeklyActions must be actionable weekly items."
  ].join("\n");
}

function agentSystemPromptFor(request: unknown) {
  return [
    "You are a controlled goal-coach agent router for a personal goal network.",
    "Return exactly one JSON object and no markdown, prose, or custom sections.",
    "Do not write data, create records, delete records, or claim that data has been saved.",
    "Your job is to decide the next safe assistant step: chat, clarify, or select one controlled tool.",
    "Allowed top-level fields by kind:",
    "- chat: kind, message, warnings",
    "- clarify: kind, message, options, warnings",
    "- tool: kind, target, message, warnings",
    "Allowed tool targets:",
    "- improve: improve or rewrite the current goal definition, success signals, action candidates, or review questions.",
    "- subgoals: split the current goal into independent child-goal candidates.",
    "- diagnose: inspect the current branch for risks, conflicts, stale work, vague goals, or bottlenecks.",
    "- weekly: propose actionable next-week or current-week actions.",
    "Use chat for greetings, thanks, small talk, and capability questions.",
    "Use clarify when the user wants help but the requested action is ambiguous and no recent target clearly applies.",
    "Use tool when the user asks for a concrete goal operation, or when their follow-up should continue lastTarget/activeTarget.",
    "If lastTarget or activeTarget exists and the user gives a short follow-up such as 'less', 'more concrete', or 'reduce scope', keep that target unless the user explicitly switches.",
    "The final write still requires user confirmation outside this router.",
    "Request JSON is supplied in the user message; use it only to route safely."
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
  try {
    return JSON.parse(firstJsonObject(withoutFence));
  } catch {
    throw new Error("AI provider returned invalid JSON");
  }
}

function firstJsonObject(content: string) {
  const start = content.indexOf("{");
  if (start < 0) return content;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") inString = false;
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }

  return content;
}
