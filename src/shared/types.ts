export type GoalStatus = "active" | "paused" | "done" | "archived";

export interface GoalActionCandidate {
  text: string;
  done: boolean;
}

export interface GoalMapPosition {
  x: number;
  y: number;
}

export interface GoalMap {
  id: string;
  name: string;
  sortOrder: number;
}

export type GoalActionCandidateInput = GoalActionCandidate | string;

export interface GoalSections {
  summary: string;
  directions: string[];
  directionHeading: "子方向" | "中期目标" | "瀛愭柟鍚?" | "涓湡鐩爣";
  successSignals: string[];
  actionCandidates: GoalActionCandidate[];
  reviewQuestions: string[];
}

export interface GoalNode {
  id: string;
  goalMapId: string;
  title: string;
  filePath: string;
  status: GoalStatus;
  horizon: string;
  domain: string;
  parent: string;
  priority: number;
  clarity: number;
  progress?: number;
  color: string;
  map_x?: number;
  map_y?: number;
  map_positions?: Record<string, GoalMapPosition>;
  last_reviewed: string;
  last_progress: string;
  tags: string[];
  sections: GoalSections;
  children: GoalNode[];
}

export interface GoalGraphNode {
  id: string;
  title: string;
  domain: string;
  status: GoalStatus;
  priority: number;
  clarity: number;
}

export interface GoalGraphEdge {
  id: string;
  source: string;
  target: string;
  type: "parent";
}

export interface GoalsResponse {
  workspaceId?: string;
  goalMaps: GoalMap[];
  goals: GoalNode[];
  flatGoals: GoalNode[];
  graph: {
    nodes: GoalGraphNode[];
    edges: GoalGraphEdge[];
  };
}

export interface GoalPatchInput {
  title?: string;
  status?: GoalStatus;
  horizon?: string;
  domain?: string;
  parent?: string;
  priority?: number;
  clarity?: number;
  progress?: number;
  color?: string;
  map_x?: number | null;
  map_y?: number | null;
  map_positions?: Record<string, GoalMapPosition | null>;
  last_reviewed?: string;
  last_progress?: string;
  summary?: string;
  directions?: string[];
  successSignals?: string[];
  actionCandidates?: GoalActionCandidateInput[];
  reviewQuestions?: string[];
}

export interface GoalCreateInput {
  title: string;
  goalMapId: string;
  domain: string;
  parent?: string;
  horizon?: string;
  priority?: number;
  clarity?: number;
  progress?: number;
  color?: string;
  summary?: string;
  directions?: string[];
  successSignals?: string[];
  actionCandidates?: GoalActionCandidateInput[];
  reviewQuestions?: string[];
}

export interface GoalsBatchCreateInput {
  goals: GoalCreateInput[];
}

export interface GoalMapCreateInput {
  name: string;
}

export interface GoalMapPatchInput {
  name?: string;
}

export interface WeeklyAction {
  id: string;
  description: string;
  goal: string;
  due: string;
  done: boolean;
  line: number;
  hasStableId: boolean;
}

export interface WeeklyActionsResponse {
  week: string;
  filePath: string;
  focus: string[];
  actions: WeeklyAction[];
}

export interface ActionCreateInput {
  description: string;
  goal: string;
  due?: string;
}

export interface ActionPatchInput {
  description?: string;
  goal?: string;
  due?: string;
  done?: boolean;
}

export type RecordType = "plan" | "review" | "weekly-review" | "progress-log";

export interface RecordSummary {
  id: string;
  type: RecordType;
  title: string;
  filePath: string;
  date: string;
  created: string;
  week: string;
  status: string;
  goals: string[];
  source: string;
  review_scope: string;
  progress_state: string;
  horizon: string;
}

export interface RecordCreateInput {
  type: RecordType;
  goals: string[];
  title?: string;
  date?: string;
  week?: string;
  review_scope?: string;
  progress_state?: "moving" | "blocked" | "paused" | "done" | "unclear";
  horizon?: string;
  summary?: string;
  facts?: string;
  progress?: string;
  blockers?: string;
  learnings?: string;
  nextActions?: string[];
}

export interface MarkdownWriteResult {
  ok: true;
  filePath: string;
  message: string;
}
