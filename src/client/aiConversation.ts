import type {
  AiAgentResponse,
  AiClarificationAnswer,
  AiClarifyingQuestion,
  AiConversationMessage,
  AiEndpoint,
  AiQuickAdjustment,
  AiTurn,
  AiTurnIntent
} from "../shared/aiContracts";

export type AiConversationTarget = "improve" | "subgoals" | "diagnose" | "weekly" | "draft-goal";
export type AiAssistantTarget = Exclude<AiConversationTarget, "draft-goal">;
export type AiAssistantCommand = {
  target: AiAssistantTarget;
  label: string;
  endpoint: AiEndpoint;
};
export type AiAssistantMessageRoute =
  | { kind: "task"; target: AiAssistantTarget; inferred: boolean }
  | { kind: "needs-command"; reply: string };
export type AiDraftCommand = {
  id: "draft-goal";
  label: string;
};

type BuildAiTurnInput = {
  intent: AiTurnIntent;
  allowClarification?: boolean;
  message?: string;
  quickAdjustment?: AiQuickAdjustment;
  conversation?: AiConversationMessage[];
  currentResponse?: unknown;
  clarificationAnswer?: AiClarificationAnswer;
};

type GoalClarificationInput = {
  target: AiConversationTarget;
  goal: {
    clarity?: number;
    horizon?: string;
    summary?: string;
    successSignals?: unknown[];
    actionCandidates?: unknown[];
    reviewQuestions?: unknown[];
    sections?: {
      summary?: string;
      successSignals?: unknown[];
      actionCandidates?: unknown[];
      reviewQuestions?: unknown[];
    };
  };
  parentChain: unknown[];
  children: unknown[];
  siblings: unknown[];
  hasClarificationAnswer: boolean;
};

type DraftClarificationInput = {
  draft: {
    title?: string;
    horizon?: string;
    summary?: string;
    successSignals?: unknown[];
    actionCandidates?: unknown[];
    reviewQuestions?: unknown[];
  };
  parentGoal?: unknown;
  sourceGoal?: unknown;
  hasClarificationAnswer: boolean;
};

const assistantCommands: AiAssistantCommand[] = [
  { target: "improve", label: "优化目标", endpoint: "improve-goal" },
  { target: "subgoals", label: "拆解子目标", endpoint: "suggest-subgoals" },
  { target: "diagnose", label: "分支体检", endpoint: "diagnose-branch" },
  { target: "weekly", label: "本周行动", endpoint: "suggest-weekly-actions" }
];

const draftCommands: AiDraftCommand[] = [
  { id: "draft-goal", label: "AI 辅助填写" }
];

export function availableAssistantCommands(): AiAssistantCommand[] {
  return assistantCommands.map((command) => ({ ...command }));
}

export function availableDraftCommands(): AiDraftCommand[] {
  return draftCommands.map((command) => ({ ...command }));
}

export function endpointForAssistantTarget(target: AiAssistantTarget): AiEndpoint {
  return assistantCommands.find((command) => command.target === target)?.endpoint ?? "improve-goal";
}

export function labelForAssistantTarget(target: AiAssistantTarget) {
  return assistantCommands.find((command) => command.target === target)?.label ?? "优化目标";
}

export function buildAssistantCommandTurn(allowClarification: boolean): AiTurn {
  return buildAiTurn({
    intent: "generate",
    allowClarification
  });
}

export function inferAssistantTargetFromMessage(message: string): AiAssistantTarget | null {
  return explicitAssistantTargetFromMessage(message);
}

function explicitAssistantTargetFromMessage(message: string): AiAssistantTarget | null {
  const normalized = message.trim().toLowerCase();
  if (/(拆|拆解|分解|子目标|subgoal|break\s*down)/i.test(normalized)) return "subgoals";
  if (/(体检|诊断|风险|问题|卡点|瓶颈|diagnos|health|risk)/i.test(normalized)) return "diagnose";
  if (/(本周|周行动|这周|行动|待办|安排|weekly|week|todo|action)/i.test(normalized)) return "weekly";
  if (/(优化|改|改写|更清楚|清晰|目标|improve|rewrite|sharpen)/i.test(normalized)) return "improve";
  return null;
}

export function resolveAssistantMessageRoute(
  target: AiAssistantTarget | null | undefined,
  message: string
): AiAssistantMessageRoute {
  const explicitTarget = explicitAssistantTargetFromMessage(message);
  if (explicitTarget) {
    return { kind: "task", target: explicitTarget, inferred: true };
  }

  if (target) {
    return { kind: "task", target, inferred: false };
  }

  return {
    kind: "needs-command",
    reply: "我还不确定你想让我执行哪类任务。请选择一个快捷指令，或直接说“优化目标 / 拆解子目标 / 分支体检 / 本周行动”。"
  };
}

export function resolveAssistantMessageTarget(
  target: AiAssistantTarget | null | undefined,
  message: string
): { target: AiAssistantTarget; inferred: boolean } | null {
  const route = resolveAssistantMessageRoute(target, message);
  if (route.kind !== "task") return null;
  return {
    target: route.target,
    inferred: route.inferred
  };
}

export function agentClarifyingQuestionFromDecision(
  decision: Extract<AiAgentResponse, { kind: "clarify" }>
): AiClarifyingQuestion | null {
  const options = (decision.options ?? [])
    .map((label) => label.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((label, index) => ({
      id: `option-${index}`,
      label
    }));

  if (options.length < 2) return null;

  return {
    id: "agent-clarify",
    question: decision.message,
    options
  };
}

export function availableQuickAdjustmentsForTarget(target: AiConversationTarget): AiQuickAdjustment[] {
  if (target === "diagnose") return [];
  if (target === "subgoals") return ["too-hard", "not-enough-time"];
  if (target === "weekly") return ["too-hard", "not-enough-time", "fewer-actions", "lower-frequency"];
  return ["too-hard", "not-enough-time", "fewer-actions"];
}

export const availableQuickAdjustmentsForTab = availableQuickAdjustmentsForTarget;

export function quickAdjustmentLabel(adjustment: AiQuickAdjustment) {
  const labels: Record<AiQuickAdjustment, string> = {
    "too-hard": "太难",
    "not-enough-time": "时间不够",
    "lower-frequency": "降低频率",
    "fewer-actions": "减少行动"
  };
  return labels[adjustment];
}

export function buildAiTurn(input: BuildAiTurnInput): AiTurn {
  const turn: AiTurn = { intent: input.intent };
  const message = input.message?.trim();

  if (input.allowClarification !== undefined) turn.allowClarification = input.allowClarification;
  if (message) turn.message = message;
  if (input.quickAdjustment !== undefined) turn.quickAdjustment = input.quickAdjustment;
  if (input.clarificationAnswer !== undefined) turn.clarificationAnswer = input.clarificationAnswer;
  if (input.conversation && input.conversation.length > 0) turn.conversation = input.conversation;
  if (input.currentResponse !== undefined) turn.currentResponse = input.currentResponse;

  return turn;
}

export function shouldAllowGoalClarification({
  target,
  goal,
  parentChain,
  children,
  siblings,
  hasClarificationAnswer
}: GoalClarificationInput) {
  if (hasClarificationAnswer || target === "diagnose" || target === "draft-goal") return false;

  const summary = goal.sections?.summary ?? goal.summary ?? "";
  const successSignals = goal.sections?.successSignals ?? goal.successSignals ?? [];
  const actionCandidates = goal.sections?.actionCandidates ?? goal.actionCandidates ?? [];
  const reviewQuestions = goal.sections?.reviewQuestions ?? goal.reviewQuestions ?? [];
  const sparse =
    Number(goal.clarity ?? 5) <= 2 ||
    (summary.trim().length === 0 && successSignals.length + actionCandidates.length + reviewQuestions.length < 2);
  const relationshipCount = parentChain.length + children.length + siblings.length;
  const horizon = goal.horizon ?? "medium";
  const complex =
    target === "subgoals" || target === "weekly"
      ? horizon !== "short" || relationshipCount >= 2
      : horizon !== "short" && relationshipCount >= 3;

  return sparse && complex;
}

export function shouldAllowDraftClarification({
  draft,
  parentGoal,
  sourceGoal,
  hasClarificationAnswer
}: DraftClarificationInput) {
  if (hasClarificationAnswer) return false;

  const title = draft.title?.trim() ?? "";
  const normalizedTitle = title.toLowerCase();
  const defaultTitle =
    title.length === 0 ||
    normalizedTitle === "new goal" ||
    normalizedTitle === "untitled" ||
    title.startsWith("新目标") ||
    title.startsWith("鏂扮洰鏍");
  const summary = draft.summary?.trim() ?? "";
  const sparse =
    defaultTitle ||
    (summary.length === 0 &&
      (draft.successSignals ?? []).length === 0 &&
      (draft.actionCandidates ?? []).length === 0 &&
      (draft.reviewQuestions ?? []).length === 0);
  const complex = (draft.horizon ?? "medium") !== "short" || Boolean(parentGoal) || Boolean(sourceGoal);

  return sparse && complex;
}

export function isClarificationOnlyResponse(response: unknown): response is {
  clarifyingQuestion: AiClarifyingQuestion;
  warnings?: string[];
} {
  return Boolean(
    response &&
      typeof response === "object" &&
      "clarifyingQuestion" in response &&
      (response as { clarifyingQuestion?: AiClarifyingQuestion }).clarifyingQuestion
  );
}
