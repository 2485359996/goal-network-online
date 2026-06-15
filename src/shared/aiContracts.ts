import { z } from "zod";

const goalStatusSchema = z.enum(["active", "paused", "done", "archived"]);

export const aiActionCandidateSchema = z.object({
  text: z.string().min(1),
  done: z.boolean().default(false)
}).strict();

export const aiActionCandidateInputSchema = z.union([z.string(), aiActionCandidateSchema]);

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

const baseGoalRequestSchema = z.object({
  goalId: z.string().min(1),
  goal: aiGoalContextSchema,
  parentChain: z.array(aiGoalContextSchema),
  children: z.array(aiGoalContextSchema),
  siblings: z.array(aiGoalContextSchema)
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
  branchGoals: z.array(aiGoalContextSchema)
}).strict();
export const suggestWeeklyActionsRequestSchema = baseGoalRequestSchema.extend({
  branchGoals: z.array(aiGoalContextSchema)
}).strict();
export const draftGoalRequestSchema = z.object({
  mode: z.enum(["top", "subgoal", "sibling"]),
  goalMap: aiGoalMapContextSchema,
  parentGoal: aiGoalContextSchema.optional(),
  sourceGoal: aiGoalContextSchema.optional(),
  siblings: z.array(aiGoalContextSchema),
  existingTitles: z.array(z.string()),
  domainCandidates: z.array(z.string()),
  draft: aiGoalDraftSchema
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

export const aiFindingSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]).default("info"),
  title: z.string().min(1),
  detail: z.string().min(1),
  recommendation: z.string().optional()
}).strict();

export const aiWeeklyActionSchema = z.preprocess((value) => {
  if (typeof value === "string") return { description: value.trim() };
  return value;
}, z.object({
  description: z.string().min(1),
  goal: z.string().optional(),
  due: z.string().optional()
}).strip());

const warningsSchema = z.array(z.string()).optional();

export const improveGoalResponseSchema = z.object({
  summary: z.string().optional(),
  successSignals: z.array(z.string()).optional(),
  actionCandidates: z.array(aiActionCandidateInputSchema).optional(),
  reviewQuestions: z.array(z.string()).optional(),
  warnings: warningsSchema
}).strict();

export const suggestSubgoalsResponseSchema = z.object({
  subgoals: z.array(aiSubgoalSuggestionSchema).optional(),
  warnings: warningsSchema
}).strict();

export const diagnoseBranchResponseSchema = z.object({
  findings: z.array(aiFindingSchema).optional(),
  warnings: warningsSchema
}).strict();

export const suggestWeeklyActionsResponseSchema = z.object({
  weeklyActions: z.array(aiWeeklyActionSchema).optional(),
  warnings: warningsSchema
}).strict();

export const draftGoalResponseSchema = z.object({
  title: z.string().min(1),
  domain: z.string().optional(),
  horizon: z.string().optional(),
  priority: z.number().min(0).max(100).optional(),
  progress: z.number().min(0).max(100).optional(),
  summary: z.string().optional(),
  successSignals: z.array(z.string()).optional(),
  actionCandidates: z.array(aiActionCandidateInputSchema).optional(),
  reviewQuestions: z.array(z.string()).optional(),
  warnings: warningsSchema
}).strict();

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
  }
} as const;

export type AiEndpoint = keyof typeof aiRouteContracts;
export type AiGoalContext = z.infer<typeof aiGoalContextSchema>;
export type AiActionCandidateInput = z.infer<typeof aiActionCandidateInputSchema>;
export type AiActionCandidate = z.infer<typeof aiActionCandidateSchema>;
export type AiImproveGoalRequest = z.infer<typeof improveGoalRequestSchema>;
export type AiSuggestSubgoalsRequest = z.infer<typeof suggestSubgoalsRequestSchema>;
export type AiDiagnoseBranchRequest = z.infer<typeof diagnoseBranchRequestSchema>;
export type AiSuggestWeeklyActionsRequest = z.infer<typeof suggestWeeklyActionsRequestSchema>;
export type AiDraftGoalRequest = z.infer<typeof draftGoalRequestSchema>;
export type AiImproveGoalResponse = z.infer<typeof improveGoalResponseSchema>;
export type AiSuggestSubgoalsResponse = z.infer<typeof suggestSubgoalsResponseSchema>;
export type AiDiagnoseBranchResponse = z.infer<typeof diagnoseBranchResponseSchema>;
export type AiSuggestWeeklyActionsResponse = z.infer<typeof suggestWeeklyActionsResponseSchema>;
export type AiDraftGoalResponse = z.infer<typeof draftGoalResponseSchema>;
export type AiSubgoalSuggestion = z.infer<typeof aiSubgoalSuggestionSchema>;
export type AiFinding = z.infer<typeof aiFindingSchema>;
export type AiWeeklyActionSuggestion = z.infer<typeof aiWeeklyActionSchema>;

export function normalizeAiActionCandidates(input: AiActionCandidateInput[] = []): AiActionCandidate[] {
  return input
    .map((action) => (typeof action === "string" ? { text: action, done: false } : action))
    .map((action) => ({ text: action.text.trim(), done: Boolean(action.done) }))
    .filter((action) => action.text.length > 0);
}
