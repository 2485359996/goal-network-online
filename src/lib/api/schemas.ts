import { z } from "zod";

export const goalMapPositionSchema = z.object({
  x: z.number(),
  y: z.number()
});

export const goalActionCandidateInputSchema = z.union([
  z.string(),
  z.object({
    text: z.string(),
    done: z.boolean()
  })
]);

export const goalPatchSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.enum(["active", "paused", "done", "archived"]).optional(),
  horizon: z.string().optional(),
  domain: z.string().optional(),
  parent: z.string().optional(),
  priority: z.number().min(0).max(100).optional(),
  clarity: z.number().min(1).max(5).optional(),
  progress: z.number().min(0).max(100).optional(),
  color: z.string().optional(),
  map_x: z.number().nullable().optional(),
  map_y: z.number().nullable().optional(),
  map_positions: z.record(z.string(), goalMapPositionSchema.nullable()).optional(),
  last_reviewed: z.string().optional(),
  last_progress: z.string().optional(),
  summary: z.string().optional(),
  directions: z.array(z.string()).optional(),
  successSignals: z.array(z.string()).optional(),
  actionCandidates: z.array(goalActionCandidateInputSchema).optional(),
  reviewQuestions: z.array(z.string()).optional()
});

export const goalMapPositionsClearSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  mapContextId: z.string().min(1)
});

export const goalMapPositionsSetSchema = z.object({
  positions: z.array(z.object({
    id: z.string().min(1),
    position: goalMapPositionSchema
  })).min(1),
  mapContextId: z.string().min(1)
});

export const goalCreateSchema = z.object({
  title: z.string().min(1),
  goalMapId: z.string().min(1),
  domain: z.string().min(1),
  parent: z.string().optional(),
  horizon: z.string().optional(),
  priority: z.number().min(0).max(100).optional(),
  clarity: z.number().min(1).max(5).optional(),
  progress: z.number().min(0).max(100).optional(),
  color: z.string().optional(),
  summary: z.string().optional(),
  directions: z.array(z.string()).optional(),
  successSignals: z.array(z.string()).optional(),
  actionCandidates: z.array(goalActionCandidateInputSchema).optional(),
  reviewQuestions: z.array(z.string()).optional()
});

export const goalsBatchCreateSchema = z.object({
  goals: z.array(goalCreateSchema).min(1).max(25)
});

export const goalMapCreateSchema = z.object({
  name: z.string().min(1)
});

export const goalMapPatchSchema = z.object({
  name: z.string().min(1).optional()
});

export const actionCreateSchema = z.object({
  description: z.string().min(1),
  goal: z.string().min(1),
  due: z.string().optional()
});

export const actionPatchSchema = z.object({
  description: z.string().optional(),
  goal: z.string().optional(),
  due: z.string().optional(),
  done: z.boolean().optional()
});

export const recordCreateSchema = z.object({
  type: z.enum(["plan", "review", "weekly-review", "progress-log"]),
  goals: z.array(z.string()).default([]),
  title: z.string().optional(),
  date: z.string().optional(),
  week: z.string().optional(),
  review_scope: z.string().optional(),
  progress_state: z.enum(["moving", "blocked", "paused", "done", "unclear"]).optional(),
  horizon: z.string().optional(),
  summary: z.string().optional(),
  facts: z.string().optional(),
  progress: z.string().optional(),
  blockers: z.string().optional(),
  learnings: z.string().optional(),
  nextActions: z.array(z.string()).optional()
});
