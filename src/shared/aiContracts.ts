import { z } from "zod";

const goalStatusSchema = z.enum(["active", "paused", "done", "archived"]);

export const aiActionCandidateSchema = z.object({
  text: z.string().min(1),
  done: z.boolean().default(false)
}).strict();

export const aiActionCandidateInputSchema = z.union([z.string(), aiActionCandidateSchema]);

export const aiTurnIntentSchema = z.enum([
  "generate",
  "message",
  "quick-adjust",
  "clarification-answer"
]);

export const aiQuickAdjustmentSchema = z.enum([
  "too-hard",
  "not-enough-time",
  "lower-frequency",
  "fewer-actions"
]);

export const aiAssistantTargetSchema = z.enum(["improve", "subgoals", "diagnose", "weekly"]);

export const aiConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1)
}).strict();

export const aiClarificationAnswerSchema = z.object({
  questionId: z.string().min(1),
  optionId: z.string().min(1),
  label: z.string().min(1)
}).strict();

export const aiTurnSchema = z.object({
  intent: aiTurnIntentSchema,
  allowClarification: z.boolean().optional(),
  message: z.string().optional(),
  quickAdjustment: aiQuickAdjustmentSchema.optional(),
  clarificationAnswer: aiClarificationAnswerSchema.optional(),
  conversation: z.array(aiConversationMessageSchema).optional(),
  currentResponse: z.unknown().optional()
}).strict();

export const aiClarifyingQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1)
  }).strict()).min(2).max(4)
}).strict();

export const aiGoalContextSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: goalStatusSchema,
  horizon: z.string(),
  domain: z.string(),
  parent: z.string(),
  priority: z.number().min(0).max(100),
  clarity: z.number().min(1).max(5),
  progress: z.number().min(0).max(100).optional(),
  color: z.string(),
  summary: z.string(),
  directions: z.array(z.string()),
  successSignals: z.array(z.string()),
  actionCandidates: z.array(aiActionCandidateInputSchema),
  reviewQuestions: z.array(z.string())
}).strict();

export const aiBranchContextSummarySchema = z.object({
  summaryVersion: z.number().int().positive(),
  sourceHash: z.string().min(1),
  scope: z.literal("branch"),
  rootGoalId: z.string().min(1),
  rootGoalTitle: z.string().min(1),
  goalCount: z.number().int().nonnegative(),
  omittedGoalCount: z.number().int().nonnegative(),
  statusCounts: z.record(goalStatusSchema, z.number().int().nonnegative()),
  horizonCounts: z.record(z.string(), z.number().int().nonnegative()),
  averageClarity: z.number().nullable(),
  averageProgress: z.number().nullable(),
  openActionCount: z.number().int().nonnegative(),
  completedActionCount: z.number().int().nonnegative(),
  relationCounts: z.object({
    supports: z.number().int().nonnegative(),
    depends_on: z.number().int().nonnegative(),
    conflicts_with: z.number().int().nonnegative()
  }).strict(),
  riskSignals: z.array(z.string()),
  recentSignals: z.array(z.string()),
  goals: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: goalStatusSchema,
    horizon: z.string(),
    priority: z.number().min(0).max(100),
    clarity: z.number().min(1).max(5),
    progress: z.number().min(0).max(100).optional(),
    summary: z.string(),
    successSignals: z.array(z.string()),
    openActionCount: z.number().int().nonnegative(),
    completedActionCount: z.number().int().nonnegative(),
    childrenCount: z.number().int().nonnegative(),
    lastReviewed: z.string(),
    lastProgress: z.string()
  }).strict())
}).strict();

const baseGoalRequestSchema = z.object({
  goalId: z.string().min(1),
  goal: aiGoalContextSchema,
  parentChain: z.array(aiGoalContextSchema),
  children: z.array(aiGoalContextSchema),
  siblings: z.array(aiGoalContextSchema),
  turn: aiTurnSchema.optional()
}).strict();

const aiGoalMapContextSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1)
}).strict();

const aiGoalDraftSchema = z.object({
  title: z.string(),
  domain: z.string(),
  horizon: z.string(),
  priority: z.number().min(0).max(100),
  progress: z.number().min(0).max(100),
  summary: z.string(),
  successSignals: z.array(z.string()),
  actionCandidates: z.array(aiActionCandidateInputSchema),
  reviewQuestions: z.array(z.string())
}).strict();

export const improveGoalRequestSchema = baseGoalRequestSchema;
export const suggestSubgoalsRequestSchema = baseGoalRequestSchema;
export const diagnoseBranchRequestSchema = baseGoalRequestSchema.extend({
  branchGoals: z.array(aiGoalContextSchema).optional(),
  branchSummary: aiBranchContextSummarySchema.optional()
}).strict();
export const suggestWeeklyActionsRequestSchema = baseGoalRequestSchema.extend({
  branchGoals: z.array(aiGoalContextSchema).optional(),
  branchSummary: aiBranchContextSummarySchema.optional()
}).strict();
export const draftGoalRequestSchema = z.object({
  mode: z.enum(["top", "subgoal", "sibling"]),
  goalMap: aiGoalMapContextSchema,
  parentGoal: aiGoalContextSchema.optional(),
  sourceGoal: aiGoalContextSchema.optional(),
  siblings: z.array(aiGoalContextSchema),
  existingTitles: z.array(z.string()),
  domainCandidates: z.array(z.string()),
  draft: aiGoalDraftSchema,
  turn: aiTurnSchema.optional()
}).strict();

export const aiAgentRequestSchema = baseGoalRequestSchema.extend({
  branchGoals: z.array(aiGoalContextSchema).optional(),
  branchSummary: aiBranchContextSummarySchema.optional(),
  message: z.string().trim().min(1),
  conversation: z.array(aiConversationMessageSchema).optional(),
  lastTarget: aiAssistantTargetSchema.nullable().optional(),
  activeTarget: aiAssistantTargetSchema.nullable().optional(),
  currentResponse: z.unknown().optional()
}).strict();

export const aiSubgoalSuggestionSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
  horizon: z.string().optional(),
  priority: z.number().min(0).max(100).optional(),
  clarity: z.number().min(1).max(5).optional(),
  successSignals: z.array(z.string()).optional(),
  actionCandidates: z.array(aiActionCandidateInputSchema).optional(),
  reviewQuestions: z.array(z.string()).optional()
}).strip();

const aiFindingSeveritySchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["critical", "severe", "high", "blocker", "error", "danger"].includes(normalized) || /严重|高|关键/.test(normalized)) {
    return "critical";
  }
  if (["warning", "warn", "medium", "moderate", "risk"].includes(normalized) || /警告|中|风险/.test(normalized)) {
    return "warning";
  }
  if (["info", "low", "note", "observation"].includes(normalized) || /信息|低|提示/.test(normalized)) {
    return "info";
  }
  return value;
}, z.enum(["info", "warning", "critical"]).default("info"));

function textFromUnknown(value: unknown): string {
  if (Array.isArray(value)) return value.map(textFromUnknown).filter(Boolean).join("\n");
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export const aiFindingSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    return { title: "分支体检发现", detail: value };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const record = value as Record<string, unknown>;
  const title =
    textFromUnknown(record.title) ||
    textFromUnknown(record.issue) ||
    textFromUnknown(record.risk) ||
    textFromUnknown(record.summary) ||
    "分支体检发现";
  const detail =
    textFromUnknown(record.detail) ||
    textFromUnknown(record.description) ||
    textFromUnknown(record.reason) ||
    textFromUnknown(record.analysis) ||
    textFromUnknown(record.issue) ||
    title;
  const recommendation =
    textFromUnknown(record.recommendation) ||
    textFromUnknown(record.recommendations) ||
    textFromUnknown(record.suggestion) ||
    textFromUnknown(record.suggestions) ||
    textFromUnknown(record.action) ||
    textFromUnknown(record.nextStep);

  return {
    severity: record.severity ?? record.level ?? record.riskLevel ?? record.priority,
    title,
    detail,
    ...(recommendation ? { recommendation } : {})
  };
}, z.object({
  severity: aiFindingSeveritySchema,
  title: z.string().min(1),
  detail: z.string().min(1),
  recommendation: z.string().optional()
}).strip());

export const aiWeeklyActionSchema = z.preprocess((value) => {
  if (typeof value === "string") return { description: value.trim() };
  return value;
}, z.object({
  description: z.string().min(1),
  goal: z.string().optional(),
  due: z.string().optional()
}).strip());

const warningsSchema = z.array(z.string()).optional();

export const aiAgentResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("chat"),
    message: z.string().min(1),
    warnings: warningsSchema
  }).strict(),
  z.object({
    kind: z.literal("clarify"),
    message: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(4).optional(),
    warnings: warningsSchema
  }).strict(),
  z.object({
    kind: z.literal("tool"),
    target: aiAssistantTargetSchema,
    message: z.string().min(1).optional(),
    warnings: warningsSchema
  }).strict()
]);

function withClarification<T extends z.ZodRawShape>(
  shape: T,
  resultFields: Array<keyof T>
) {
  return z.object({
    ...shape,
    clarifyingQuestion: aiClarifyingQuestionSchema.optional(),
    warnings: warningsSchema
  }).strict().superRefine((value, ctx) => {
    const output = value as Record<string, unknown> & { clarifyingQuestion?: unknown };
    if (!output.clarifyingQuestion) return;
    if (resultFields.some((field) => output[String(field)] !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "clarifyingQuestion cannot be returned with result fields"
      });
    }
  });
}

export const improveGoalResponseSchema = withClarification({
  summary: z.string().optional(),
  successSignals: z.array(z.string()).optional(),
  actionCandidates: z.array(aiActionCandidateInputSchema).optional(),
  reviewQuestions: z.array(z.string()).optional()
}, ["summary", "successSignals", "actionCandidates", "reviewQuestions"]);

export const suggestSubgoalsResponseSchema = withClarification({
  subgoals: z.array(aiSubgoalSuggestionSchema).optional()
}, ["subgoals"]);

export const diagnoseBranchResponseSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const findings = record.findings ?? record.issues ?? record.risks ?? record.diagnosis ?? record.finding;
  if (findings === undefined) return value;
  return {
    findings: Array.isArray(findings) ? findings : [findings],
    ...(record.clarifyingQuestion !== undefined ? { clarifyingQuestion: record.clarifyingQuestion } : {}),
    ...(record.warnings !== undefined ? { warnings: record.warnings } : {})
  };
}, withClarification({
  findings: z.array(aiFindingSchema).optional()
}, ["findings"]));

export const suggestWeeklyActionsResponseSchema = withClarification({
  weeklyActions: z.array(aiWeeklyActionSchema).optional()
}, ["weeklyActions"]);

export const draftGoalResponseSchema = withClarification({
  title: z.string().min(1).optional(),
  domain: z.string().optional(),
  horizon: z.string().optional(),
  priority: z.number().min(0).max(100).optional(),
  progress: z.number().min(0).max(100).optional(),
  summary: z.string().optional(),
  successSignals: z.array(z.string()).optional(),
  actionCandidates: z.array(aiActionCandidateInputSchema).optional(),
  reviewQuestions: z.array(z.string()).optional()
}, ["title", "domain", "horizon", "priority", "progress", "summary", "successSignals", "actionCandidates", "reviewQuestions"]);

export const aiRouteContracts = {
  "improve-goal": {
    path: "/api/ai/improve-goal",
    request: improveGoalRequestSchema,
    response: improveGoalResponseSchema
  },
  "suggest-subgoals": {
    path: "/api/ai/suggest-subgoals",
    request: suggestSubgoalsRequestSchema,
    response: suggestSubgoalsResponseSchema
  },
  "diagnose-branch": {
    path: "/api/ai/diagnose-branch",
    request: diagnoseBranchRequestSchema,
    response: diagnoseBranchResponseSchema
  },
  "suggest-weekly-actions": {
    path: "/api/ai/suggest-weekly-actions",
    request: suggestWeeklyActionsRequestSchema,
    response: suggestWeeklyActionsResponseSchema
  },
  "draft-goal": {
    path: "/api/ai/draft-goal",
    request: draftGoalRequestSchema,
    response: draftGoalResponseSchema
  },
  agent: {
    path: "/api/ai/agent",
    request: aiAgentRequestSchema,
    response: aiAgentResponseSchema
  }
} as const;

export type AiEndpoint = keyof typeof aiRouteContracts;
export type AiAssistantTarget = z.infer<typeof aiAssistantTargetSchema>;
export type AiTurn = z.infer<typeof aiTurnSchema>;
export type AiTurnIntent = z.infer<typeof aiTurnIntentSchema>;
export type AiQuickAdjustment = z.infer<typeof aiQuickAdjustmentSchema>;
export type AiConversationMessage = z.infer<typeof aiConversationMessageSchema>;
export type AiClarifyingQuestion = z.infer<typeof aiClarifyingQuestionSchema>;
export type AiClarificationAnswer = z.infer<typeof aiClarificationAnswerSchema>;
export type AiGoalContext = z.infer<typeof aiGoalContextSchema>;
export type AiBranchContextSummary = z.infer<typeof aiBranchContextSummarySchema>;
export type AiActionCandidateInput = z.infer<typeof aiActionCandidateInputSchema>;
export type AiActionCandidate = z.infer<typeof aiActionCandidateSchema>;
export type AiImproveGoalRequest = z.infer<typeof improveGoalRequestSchema>;
export type AiSuggestSubgoalsRequest = z.infer<typeof suggestSubgoalsRequestSchema>;
export type AiDiagnoseBranchRequest = z.infer<typeof diagnoseBranchRequestSchema>;
export type AiSuggestWeeklyActionsRequest = z.infer<typeof suggestWeeklyActionsRequestSchema>;
export type AiDraftGoalRequest = z.infer<typeof draftGoalRequestSchema>;
export type AiAgentRequest = z.infer<typeof aiAgentRequestSchema>;
export type AiImproveGoalResponse = z.infer<typeof improveGoalResponseSchema>;
export type AiSuggestSubgoalsResponse = z.infer<typeof suggestSubgoalsResponseSchema>;
export type AiDiagnoseBranchResponse = z.infer<typeof diagnoseBranchResponseSchema>;
export type AiSuggestWeeklyActionsResponse = z.infer<typeof suggestWeeklyActionsResponseSchema>;
export type AiDraftGoalResponse = z.infer<typeof draftGoalResponseSchema>;
export type AiAgentResponse = z.infer<typeof aiAgentResponseSchema>;
export type AiSubgoalSuggestion = z.infer<typeof aiSubgoalSuggestionSchema>;
export type AiFinding = z.infer<typeof aiFindingSchema>;
export type AiWeeklyActionSuggestion = z.infer<typeof aiWeeklyActionSchema>;

export function normalizeAiActionCandidates(input: AiActionCandidateInput[] = []): AiActionCandidate[] {
  return input
    .map((action) => (typeof action === "string" ? { text: action, done: false } : action))
    .map((action) => ({ text: action.text.trim(), done: Boolean(action.done) }))
    .filter((action) => action.text.length > 0);
}
