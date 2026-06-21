import { AlertCircle, CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import { motion } from "framer-motion";
import React, { useEffect, useState } from "react";
import { isPrimaryGoalNode } from "../shared/goalRules";
import type { ActionCreateInput, GoalCreateInput, GoalNode, GoalPatchInput } from "../shared/types";
import { AiConversationControls } from "./AiConversationControls";
import {
  agentClarifyingQuestionFromDecision,
  availableAssistantCommands,
  availableQuickAdjustmentsForTarget,
  buildAssistantCommandTurn,
  buildAiTurn,
  endpointForAssistantTarget,
  isClarificationOnlyResponse,
  quickAdjustmentLabel,
  resolveAssistantMessageRoute,
  shouldUseAgentRouterForRoute,
  type AiAssistantMessageRoute,
  type AiAssistantTarget,
  shouldAllowGoalClarification
} from "./aiConversation";
import { resolveGoalThemeColor } from "./goalUtils";
import { useDialogMotion } from "./motion";
import { useModalDialog } from "./useModalDialog";
import {
  aiAgentResponseSchema,
  aiRouteContracts,
  diagnoseBranchResponseSchema,
  improveGoalResponseSchema,
  normalizeAiActionCandidates,
  suggestSubgoalsResponseSchema,
  suggestWeeklyActionsResponseSchema,
  type AiDiagnoseBranchResponse,
  type AiFinding,
  type AiGoalContext,
  type AiImproveGoalResponse,
  type AiAgentRequest,
  type AiAgentResponse,
  type AiClarificationAnswer,
  type AiClarifyingQuestion,
  type AiConversationMessage,
  type AiSubgoalSuggestion,
  type AiSuggestSubgoalsResponse,
  type AiSuggestWeeklyActionsResponse,
  type AiTurn,
  type AiQuickAdjustment,
  type AiWeeklyActionSuggestion
} from "../shared/aiContracts";

export type AiTab = AiAssistantTarget;
type AiResponse =
  | AiImproveGoalResponse
  | AiSuggestSubgoalsResponse
  | AiDiagnoseBranchResponse
  | AiSuggestWeeklyActionsResponse;
type SelectionMap = Record<string, boolean>;
type ImproveField = "summary" | "successSignals" | "actionCandidates" | "reviewQuestions";
type ClarificationSource = "agent" | "tool";
type RequestAgentOptions = {
  beforeGenerate?: () => Promise<void>;
  fetch?: typeof fetch;
};

const AI_CLIENT_TIMEOUT_MS = 60_000;
const assistantCommands = availableAssistantCommands();

class AiAgentPreparationError extends Error {
  constructor(readonly originalError: unknown) {
    super(originalError instanceof Error ? originalError.message : "AI request preparation failed");
  }
}

export type ImproveDraft = {
  summary: string;
  successSignals: string;
  actionCandidates: string;
  reviewQuestions: string;
};

export type SubgoalDraft = {
  title: string;
  summary: string;
};

export type WeeklyDraft = {
  description: string;
  due: string;
};

export function improveDraftFromResponse(r: AiImproveGoalResponse): ImproveDraft {
  return {
    summary: r.summary ?? "",
    successSignals: (r.successSignals ?? []).join("\n"),
    actionCandidates: normalizeAiActionCandidates(r.actionCandidates ?? []).map((a) => a.text).join("\n"),
    reviewQuestions: (r.reviewQuestions ?? []).join("\n")
  };
}

export function improveResponseFromDraft(draft: ImproveDraft, original: AiImproveGoalResponse): AiImproveGoalResponse {
  const splitLines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    summary: original.summary !== undefined ? draft.summary.trim() || undefined : undefined,
    successSignals: original.successSignals !== undefined ? splitLines(draft.successSignals) : undefined,
    actionCandidates: original.actionCandidates !== undefined ? splitLines(draft.actionCandidates) : undefined,
    reviewQuestions: original.reviewQuestions !== undefined ? splitLines(draft.reviewQuestions) : undefined,
    warnings: original.warnings
  };
}

const responseSchemas = {
  improve: improveGoalResponseSchema,
  subgoals: suggestSubgoalsResponseSchema,
  diagnose: diagnoseBranchResponseSchema,
  weekly: suggestWeeklyActionsResponseSchema
} as const;

const improveFieldLabels: Record<ImproveField, string> = {
  summary: "目标定义",
  successSignals: "成功信号",
  actionCandidates: "行动候选",
  reviewQuestions: "复盘问题"
};

export function buildImproveGoalPatch(
  goal: GoalNode,
  response: AiImproveGoalResponse,
  selected: Partial<Record<ImproveField, boolean>>
): GoalPatchInput {
  const patch: GoalPatchInput = {};

  if (selected.summary && response.summary !== undefined) {
    patch.summary = response.summary.trim();
  }
  if (selected.successSignals && response.successSignals) {
    patch.successSignals = response.successSignals;
  }
  if (selected.actionCandidates && response.actionCandidates && !isPrimaryGoalNode(goal)) {
    patch.actionCandidates = normalizeAiActionCandidates(response.actionCandidates);
  }
  if (selected.reviewQuestions && response.reviewQuestions) {
    patch.reviewQuestions = response.reviewQuestions;
  }

  return patch;
}

export function selectedSubgoalSuggestionsForCreate(
  response: AiSuggestSubgoalsResponse,
  selected: SelectionMap,
  drafts: SubgoalDraft[]
): AiSubgoalSuggestion[] {
  return (response.subgoals ?? []).flatMap((subgoal, index) => {
    if (!selected[`subgoal-${index}`]) return [];
    const draft = drafts[index] ?? { title: subgoal.title, summary: subgoal.summary ?? "" };
    if (!draft.title.trim()) throw new Error("子目标标题不能为空");
    return [{
      ...subgoal,
      title: draft.title.trim(),
      summary: draft.summary.trim() || undefined
    }];
  });
}

export function selectedWeeklyActionInputsForCreate(
  response: AiSuggestWeeklyActionsResponse,
  selected: SelectionMap,
  drafts: WeeklyDraft[],
  fallbackGoalTitle: string
): ActionCreateInput[] {
  return (response.weeklyActions ?? []).flatMap((action, index) => {
    if (!selected[`weekly-${index}`]) return [];
    const draft = drafts[index] ?? { description: action.description, due: action.due ?? "" };
    if (!draft.description.trim()) throw new Error("行动描述不能为空");
    return [{
      description: draft.description.trim(),
      goal: action.goal || fallbackGoalTitle,
      due: draft.due.trim() || undefined
    }];
  });
}

export function goalContextFromNode(goal: GoalNode): AiGoalContext {
  return {
    id: goal.id,
    title: goal.title,
    status: goal.status,
    horizon: goal.horizon,
    domain: goal.domain,
    parent: goal.parent,
    priority: goal.priority,
    clarity: goal.clarity,
    progress: goal.progress,
    color: goal.color,
    summary: goal.sections.summary,
    directions: goal.sections.directions,
    successSignals: goal.sections.successSignals,
    actionCandidates: goal.sections.actionCandidates,
    reviewQuestions: goal.sections.reviewQuestions
  };
}

type ResolveAiAssistantResponseInput = {
  tab: AiTab;
  response: AiResponse;
  goal: GoalNode;
  allowClarification: boolean;
  selectDefaults?: (tab: AiTab, response: AiResponse, goal: GoalNode) => SelectionMap;
};

type AiAssistantResponseTransition =
  | { kind: "formal"; response: AiResponse; selected: SelectionMap }
  | { kind: "clarification"; clarifyingQuestion: AiClarifyingQuestion }
  | { kind: "protocol-error"; error: string };

export function resolveAiAssistantResponse({
  tab,
  response,
  goal,
  allowClarification,
  selectDefaults = defaultSelections
}: ResolveAiAssistantResponseInput): AiAssistantResponseTransition {
  if (isClarificationOnlyResponse(response)) {
    if (!allowClarification) {
      return {
        kind: "protocol-error",
        error: "AI returned a clarification question after clarification was disabled."
      };
    }
    return { kind: "clarification", clarifyingQuestion: response.clarifyingQuestion };
  }

  return {
    kind: "formal",
    response,
    selected: selectDefaults(tab, response, goal)
  };
}

export function AiAssistantDialog({
  goal,
  flatGoals,
  saving,
  onClose,
  onBeforeGenerate,
  onPatchGoal,
  onCreateGoal,
  onCreateGoals,
  onCreateWeeklyAction
}: {
  goal: GoalNode;
  flatGoals: GoalNode[];
  saving: boolean;
  onClose: () => void;
  onBeforeGenerate?: () => Promise<void>;
  onPatchGoal: (goalId: string, patch: GoalPatchInput) => Promise<boolean>;
  onCreateGoal: (input: GoalCreateInput) => Promise<boolean>;
  onCreateGoals?: (inputs: GoalCreateInput[]) => Promise<boolean>;
  onCreateWeeklyAction: (input: ActionCreateInput) => Promise<boolean>;
}) {
  const [lastTarget, setLastTarget] = useState<AiTab | null>(null);
  const [responseTarget, setResponseTarget] = useState<AiTab | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [response, setResponse] = useState<AiResponse | null>(null);
  const [selected, setSelected] = useState<SelectionMap>({});
  const [messages, setMessages] = useState<AiConversationMessage[]>([]);
  const [clarifyingQuestion, setClarifyingQuestion] = useState<AiClarifyingQuestion | null>(null);
  const [clarificationSource, setClarificationSource] = useState<ClarificationSource | null>(null);
  const [clarificationAnswered, setClarificationAnswered] = useState(false);
  const [improveDraft, setImproveDraft] = useState<ImproveDraft | null>(null);
  const [subgoalDrafts, setSubgoalDrafts] = useState<SubgoalDraft[]>([]);
  const [weeklyDrafts, setWeeklyDrafts] = useState<WeeklyDraft[]>([]);
  const primaryGoal = isPrimaryGoalNode(goal);

  useEffect(() => {
    setResponse(null);
    setResponseTarget(null);
    setError("");
    setNotice("");
    setSelected({});
    setMessages([]);
    setClarifyingQuestion(null);
    setClarificationSource(null);
    setClarificationAnswered(false);
    setImproveDraft(null);
    setSubgoalDrafts([]);
    setWeeklyDrafts([]);
    setLastTarget(null);
  }, [goal.id]);

  const canApply = Boolean(response) && responseTarget !== "diagnose";

  const resetDrafts = () => {
    setImproveDraft(null);
    setSubgoalDrafts([]);
    setWeeklyDrafts([]);
  };

  const seedDraftsForResponse = (target: AiTab, nextResponse: AiResponse) => {
    setImproveDraft(target === "improve" ? improveDraftFromResponse(nextResponse as AiImproveGoalResponse) : null);
    setSubgoalDrafts(
      target === "subgoals"
        ? ((nextResponse as AiSuggestSubgoalsResponse).subgoals ?? []).map((subgoal) => ({ title: subgoal.title, summary: subgoal.summary ?? "" }))
        : []
    );
    setWeeklyDrafts(
      target === "weekly"
        ? ((nextResponse as AiSuggestWeeklyActionsResponse).weeklyActions ?? []).map((action) => ({ description: action.description, due: action.due ?? "" }))
        : []
    );
  };

  const currentResponseWithDrafts = (target: AiTab, current: AiResponse): AiResponse => {
    if (target === "improve") {
      return improveDraft ? improveResponseFromDraft(improveDraft, current as AiImproveGoalResponse) : current;
    }
    if (target === "subgoals") {
      const subgoals = ((current as AiSuggestSubgoalsResponse).subgoals ?? []).map((subgoal, index) => {
        const draft = subgoalDrafts[index];
        if (!draft) return subgoal;
        return {
          ...subgoal,
          title: draft.title.trim() || subgoal.title,
          summary: draft.summary.trim() || undefined
        };
      });
      return { ...(current as AiSuggestSubgoalsResponse), subgoals };
    }
    if (target === "weekly") {
      const weeklyActions = ((current as AiSuggestWeeklyActionsResponse).weeklyActions ?? []).map((action, index) => {
        const draft = weeklyDrafts[index];
        if (!draft) return action;
        return {
          ...action,
          description: draft.description.trim() || action.description,
          due: draft.due.trim() || undefined
        };
      });
      return { ...(current as AiSuggestWeeklyActionsResponse), weeklyActions };
    }
    return current;
  };

  const handleAiResponse = (target: AiTab, nextResponse: AiResponse, allowClarification: boolean, nextMessages: AiConversationMessage[]) => {
    const transition = resolveAiAssistantResponse({
      tab: target,
      response: nextResponse,
      goal,
      allowClarification
    });

    if (transition.kind === "protocol-error") {
      setError(transition.error);
      return;
    }

    if (transition.kind === "clarification") {
      setClarifyingQuestion(transition.clarifyingQuestion);
      setClarificationSource("tool");
      setMessages([...nextMessages, { role: "assistant", content: transition.clarifyingQuestion.question }]);
      return;
    }

    setClarifyingQuestion(null);
    setClarificationSource(null);
    setResponse(transition.response);
    setResponseTarget(target);
    setSelected(transition.selected);
    seedDraftsForResponse(target, transition.response);
    setMessages(nextMessages);
  };

  const runTurn = async (
    target: AiTab,
    turn: AiTurn,
    nextMessages: AiConversationMessage[],
    options: { clearOnError?: boolean; skipBeforeGenerate?: boolean } = {}
  ) => {
    setMessages(nextMessages);
    setLoading(true);
    setError("");
    setNotice("");

    try {
      if (!options.skipBeforeGenerate) {
        await onBeforeGenerate?.();
      }
      const nextResponse = await requestAi(target, buildAiRequest(target, goal, flatGoals, turn));
      handleAiResponse(target, nextResponse, turn.allowClarification === true, nextMessages);
    } catch (nextError) {
      if (options.clearOnError) {
        setResponse(null);
        setResponseTarget(null);
        setSelected({});
        setClarifyingQuestion(null);
        setClarificationSource(null);
        resetDrafts();
      }
      setError(aiErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  };

  const runCommand = (commandId: string) => {
    const command = assistantCommands.find((item) => item.target === commandId);
    if (!command) return;

    setLastTarget(command.target);
    setResponse(null);
    setResponseTarget(null);
    setSelected({});
    setClarifyingQuestion(null);
    setClarificationSource(null);
    resetDrafts();
    const nextParentChain = parentChain(goal, flatGoals);
    const nextSiblings = siblingGoals(goal, flatGoals);
    const allowClarification = shouldAllowGoalClarification({
      target: command.target,
      goal,
      parentChain: nextParentChain,
      children: goal.children,
      siblings: nextSiblings,
      hasClarificationAnswer: clarificationAnswered
    });

    const nextMessages: AiConversationMessage[] = [...messages, { role: "user", content: command.label }];
    void runTurn(
      command.target,
      buildAssistantCommandTurn(allowClarification),
      nextMessages,
      { clearOnError: true }
    );
  };

  const applySelected = async () => {
    if (!response || !responseTarget) return;
    setApplying(true);
    setError("");
    setNotice("");

    try {
      if (responseTarget === "improve") {
        const effectiveResponse = currentResponseWithDrafts(responseTarget, response) as AiImproveGoalResponse;
        const patch = buildImproveGoalPatch(goal, effectiveResponse, selected);
        if (Object.keys(patch).length === 0) throw new Error("请先勾选要应用的建议");
        const ok = await onPatchGoal(goal.id, patch);
        if (!ok) throw new Error("目标更新失败");
      }

      if (responseTarget === "subgoals") {
        const subgoals = selectedSubgoalSuggestionsForCreate(response as AiSuggestSubgoalsResponse, selected, subgoalDrafts);
        if (subgoals.length === 0) throw new Error("请先勾选要创建的子目标");
        const inputs = subgoals.map((subgoal) => createSubgoalInput(goal, subgoal));
        if (onCreateGoals) {
          const ok = await onCreateGoals(inputs);
          if (!ok) throw new Error("子目标创建失败");
        } else {
          for (const input of inputs) {
            const ok = await onCreateGoal(input);
            if (!ok) throw new Error(`子目标创建失败：${input.title}`);
          }
        }
      }

      if (responseTarget === "weekly") {
        const actions = selectedWeeklyActionInputsForCreate(response as AiSuggestWeeklyActionsResponse, selected, weeklyDrafts, goal.title);
        if (actions.length === 0) throw new Error("请先勾选要创建的周行动");
        for (const action of actions) {
          const ok = await onCreateWeeklyAction(action);
          if (!ok) throw new Error(`周行动创建失败：${action.description}`);
        }
      }

      setNotice("已应用勾选的建议");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "应用建议失败");
    } finally {
      setApplying(false);
    }
  };

  const toggleSelection = (key: string) => {
    setSelected((current) => ({ ...current, [key]: !current[key] }));
  };

  const runTaskMessage = (
    target: AiTab,
    inferred: boolean,
    message: string,
    nextMessages: AiConversationMessage[],
    options: { skipBeforeGenerate?: boolean } = {}
  ) => {
    const nextParentChain = parentChain(goal, flatGoals);
    const nextSiblings = siblingGoals(goal, flatGoals);
    const allowClarification =
      !response &&
      shouldAllowGoalClarification({
        target,
        goal,
        parentChain: nextParentChain,
        children: goal.children,
        siblings: nextSiblings,
        hasClarificationAnswer: clarificationAnswered
      });
    setClarifyingQuestion(null);
    setClarificationSource(null);
    setLastTarget(target);
    if (inferred && target !== responseTarget) {
      setResponse(null);
      setResponseTarget(null);
      setSelected({});
      setClarifyingQuestion(null);
      resetDrafts();
    }
    void runTurn(
      target,
      buildAiTurn({
        intent: "message",
        message,
        allowClarification,
        conversation: nextMessages,
        currentResponse: target === responseTarget && response ? currentResponseWithDrafts(target, response) : undefined
      }),
      nextMessages,
      options
    );
  };

  const runAgentMessage = async (
    message: string,
    nextMessages: AiConversationMessage[],
    fallbackRoute: AiAssistantMessageRoute
  ) => {
    setMessages(nextMessages);
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const decision = await requestAgent(
        buildAgentRequest(goal, flatGoals, message, {
          conversation: nextMessages,
          lastTarget,
          activeTarget: responseTarget,
          currentResponse: response && responseTarget ? currentResponseWithDrafts(responseTarget, response) : undefined
        }),
        { beforeGenerate: onBeforeGenerate }
      );

      if (decision.kind === "chat") {
        setClarifyingQuestion(null);
        setClarificationSource(null);
        setMessages([...nextMessages, { role: "assistant", content: agentMessageText(decision) }]);
        setLoading(false);
        return;
      }

      if (decision.kind === "clarify") {
        const nextQuestion = agentClarifyingQuestionFromDecision(decision);
        if (nextQuestion) {
          setClarifyingQuestion(nextQuestion);
          setClarificationSource("agent");
          setMessages([...nextMessages, { role: "assistant", content: decision.message }]);
        } else {
          setClarifyingQuestion(null);
          setClarificationSource(null);
          setMessages([...nextMessages, { role: "assistant", content: decision.message }]);
        }
        setLoading(false);
        return;
      }

      const taskMessages: AiConversationMessage[] = decision.message
        ? [...nextMessages, { role: "assistant", content: decision.message }]
        : nextMessages;
      setLoading(false);
      runTaskMessage(decision.target, true, message, taskMessages, { skipBeforeGenerate: true });
    } catch (nextError) {
      if (nextError instanceof AiAgentPreparationError) {
        setError(aiErrorMessage(nextError.originalError));
        setLoading(false);
        return;
      }

      if (fallbackRoute.kind === "task") {
        setLoading(false);
        runTaskMessage(fallbackRoute.target, fallbackRoute.inferred, message, nextMessages, { skipBeforeGenerate: true });
        return;
      }

      setMessages([...nextMessages, { role: "assistant", content: fallbackRoute.reply }]);
      const errorMessage = aiErrorMessage(nextError);
      setError(errorMessage === "AI 后端尚未配置" ? "" : errorMessage);
      setLoading(false);
    }
  };

  const sendMessage = (message: string) => {
    const fallbackRoute = resolveAssistantMessageRoute(lastTarget, message);
    const nextMessages: AiConversationMessage[] = [...messages, { role: "user", content: message }];

    if (clarificationSource === "agent") {
      setClarifyingQuestion(null);
      setClarificationSource(null);
    }

    if (!shouldUseAgentRouterForRoute(fallbackRoute)) {
      runTaskMessage(fallbackRoute.target, fallbackRoute.inferred, message, nextMessages);
      return;
    }

    void runAgentMessage(message, nextMessages, fallbackRoute);
  };

  const quickAdjust = (adjustment: AiQuickAdjustment) => {
    const target = responseTarget ?? lastTarget;
    if (!target) {
      setError("请先选择一个快捷指令");
      return;
    }

    const nextMessages: AiConversationMessage[] = [...messages, { role: "user", content: quickAdjustmentLabel(adjustment) }];
    setClarifyingQuestion(null);
    setClarificationSource(null);
    void runTurn(
      target,
      buildAiTurn({
        intent: "quick-adjust",
        quickAdjustment: adjustment,
        allowClarification: false,
        conversation: nextMessages,
        currentResponse: response ? currentResponseWithDrafts(target, response) : undefined
      }),
      nextMessages
    );
  };

  const answerClarification = (answer: AiClarificationAnswer) => {
    const target = lastTarget;
    if (!target) {
      setError("请先选择一个快捷指令");
      return;
    }

    setClarificationAnswered(true);
    const nextMessages: AiConversationMessage[] = [...messages, { role: "user", content: answer.label }];
    void runTurn(
      target,
      buildAiTurn({
        intent: "clarification-answer",
        allowClarification: false,
        clarificationAnswer: answer,
        conversation: nextMessages,
        currentResponse: response ? currentResponseWithDrafts(target, response) : undefined
      }),
      nextMessages
    );
  };

  const skipClarification = () => {
    if (!clarifyingQuestion) return;
    answerClarification({
      questionId: clarifyingQuestion.id,
      optionId: "skip",
      label: "按现有信息生成"
    });
  };

  const answerVisibleClarification = (answer: AiClarificationAnswer) => {
    if (clarificationSource === "agent") {
      setClarifyingQuestion(null);
      setClarificationSource(null);
      sendMessage(answer.label);
      return;
    }

    answerClarification(answer);
  };

  const skipVisibleClarification = () => {
    if (clarificationSource === "agent") {
      setClarifyingQuestion(null);
      setClarificationSource(null);
      return;
    }

    skipClarification();
  };

  const busy = loading || applying;
  const { dialogRef, onBackdropPointerDown, onBackdropClick } = useModalDialog<HTMLElement>({
    onDismiss: onClose,
    canDismiss: !busy
  });
  const dialogMotion = useDialogMotion();

  return (
    <motion.div className="dialog-backdrop" role="presentation" onPointerDown={onBackdropPointerDown} onClick={onBackdropClick} variants={dialogMotion.backdrop} initial="initial" animate="animate" exit="exit">
      <motion.section ref={dialogRef} tabIndex={-1} className="ai-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-dialog-title" variants={dialogMotion.panel}>
        <div className="dialog-head">
          <div>
            <p className="eyebrow">AI 助手</p>
            <h2 id="ai-dialog-title">{goal.title}</h2>
          </div>
          <button type="button" className="icon-button compact" aria-label="关闭 AI 助手" disabled={busy} onClick={onClose}>
            <X />
          </button>
        </div>

        <div className="ai-dialog-body">
          <div className="ai-context">
            <Sparkles />
            <span>选择快捷指令开始，或在已有指令后继续输入补充要求。AI 只会生成候选内容，写入前仍需要你确认。</span>
          </div>

          {error && (
            <div className="ai-error" role="alert">
              <AlertCircle />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="ai-notice" role="status">
              <CheckCircle2 />
              <span>{notice}</span>
            </div>
          )}

          <AiConversationControls
            messages={messages}
            commands={assistantCommands.map((command) => ({ id: command.target, label: command.label }))}
            quickAdjustments={responseTarget ? availableQuickAdjustmentsForTarget(responseTarget) : []}
            clarifyingQuestion={clarifyingQuestion ?? undefined}
            busy={busy || saving}
            pending={loading}
            showSkipClarification={clarificationSource !== "agent"}
            intro={{
              title: "AI",
              body: "告诉我你想怎么处理这个目标。我可以直接优化目标、拆解子目标、体检分支或安排本周行动。"
            }}
            inputPlaceholder="输入任务，例如：帮我优化这个目标，或安排本周行动"
            onCommand={runCommand}
            onSendMessage={sendMessage}
            onQuickAdjust={quickAdjust}
            onAnswerClarification={answerVisibleClarification}
            onSkipClarification={skipVisibleClarification}
          >
            {response && responseTarget && (
              <>
                <div className="ai-suggestion-list">
                  {renderResponse(responseTarget, response, selected, primaryGoal, toggleSelection, {
                    improveDraft,
                    subgoalDrafts,
                    weeklyDrafts,
                    setImproveDraft,
                    setSubgoalDrafts,
                    setWeeklyDrafts
                  })}
                  {renderWarnings(response)}
                </div>
                {canApply && (
                  <div className="ai-result-actions">
                    <button type="button" className="secondary-button" disabled={loading || applying || saving} onClick={() => void applySelected()}>
                      {applying ? <Loader2 className="spin" /> : <CheckCircle2 />}
                      执行选中任务
                    </button>
                  </div>
                )}
              </>
            )}
          </AiConversationControls>
        </div>
      </motion.section>
    </motion.div>
  );
}

type DraftState = {
  improveDraft: ImproveDraft | null;
  subgoalDrafts: SubgoalDraft[];
  weeklyDrafts: WeeklyDraft[];
  setImproveDraft: (draft: ImproveDraft) => void;
  setSubgoalDrafts: React.Dispatch<React.SetStateAction<SubgoalDraft[]>>;
  setWeeklyDrafts: React.Dispatch<React.SetStateAction<WeeklyDraft[]>>;
};

function renderResponse(
  tab: AiTab,
  response: AiResponse,
  selected: SelectionMap,
  primaryGoal: boolean,
  onToggle: (key: string) => void,
  drafts: DraftState
) {
  if (tab === "improve") {
    return renderImproveResponse(response as AiImproveGoalResponse, selected, primaryGoal, onToggle, drafts.improveDraft, drafts.setImproveDraft);
  }
  if (tab === "subgoals") {
    return renderSubgoalResponse(response as AiSuggestSubgoalsResponse, selected, onToggle, drafts.subgoalDrafts, drafts.setSubgoalDrafts);
  }
  if (tab === "diagnose") {
    return renderDiagnosisResponse(response as AiDiagnoseBranchResponse);
  }
  return renderWeeklyResponse(response as AiSuggestWeeklyActionsResponse, selected, onToggle, drafts.weeklyDrafts, drafts.setWeeklyDrafts);
}

function renderImproveResponse(
  response: AiImproveGoalResponse,
  selected: SelectionMap,
  primaryGoal: boolean,
  onToggle: (key: string) => void,
  draft: ImproveDraft | null,
  setDraft: (draft: ImproveDraft) => void
) {
  const fields: ImproveField[] = ["summary", "successSignals", "actionCandidates", "reviewQuestions"];
  const visibleFields = fields.filter((field) => response[field] !== undefined);

  if (visibleFields.length === 0) {
    return <p className="muted-text">这次没有可应用的优化建议。</p>;
  }

  return visibleFields.map((field) => {
    const disabled = field === "actionCandidates" && primaryGoal;
    const updateDraft = (value: string) => {
      if (!draft) return;
      setDraft({ ...draft, [field]: value });
    };
    return (
      <label key={field} className={disabled ? "ai-suggestion-item disabled" : "ai-suggestion-item"}>
        <input type="checkbox" checked={!disabled && Boolean(selected[field])} disabled={disabled} onChange={() => onToggle(field)} />
        <span>
          <strong>{improveFieldLabels[field]}</strong>
          {field === "summary" && (
            draft
              ? <textarea className="ai-draft-textarea" value={draft.summary} rows={3} onChange={(event) => updateDraft(event.target.value)} />
              : <p>{response.summary}</p>
          )}
          {field === "successSignals" && (
            draft
              ? <textarea className="ai-draft-textarea" value={draft.successSignals} rows={3} placeholder="每行一条" onChange={(event) => updateDraft(event.target.value)} />
              : <InlineList items={response.successSignals ?? []} />
          )}
          {field === "actionCandidates" && (
            draft
              ? <textarea className="ai-draft-textarea" value={draft.actionCandidates} rows={3} placeholder="每行一条" onChange={(event) => updateDraft(event.target.value)} />
              : <InlineList items={normalizeAiActionCandidates(response.actionCandidates ?? []).map((action) => action.text)} />
          )}
          {field === "reviewQuestions" && (
            draft
              ? <textarea className="ai-draft-textarea" value={draft.reviewQuestions} rows={3} placeholder="每行一条" onChange={(event) => updateDraft(event.target.value)} />
              : <InlineList items={response.reviewQuestions ?? []} />
          )}
          {disabled && <small>一级目标不写入行动候选。</small>}
        </span>
      </label>
    );
  });
}

function renderSubgoalResponse(
  response: AiSuggestSubgoalsResponse,
  selected: SelectionMap,
  onToggle: (key: string) => void,
  drafts: SubgoalDraft[],
  setDrafts: React.Dispatch<React.SetStateAction<SubgoalDraft[]>>
) {
  const subgoals = response.subgoals ?? [];
  if (subgoals.length === 0) {
    return <p className="muted-text">这次没有建议创建的子目标。</p>;
  }

  return subgoals.map((subgoal, index) => {
    const draft = drafts[index] ?? { title: subgoal.title, summary: subgoal.summary ?? "" };
    const updateDraft = (patch: Partial<SubgoalDraft>) => {
      setDrafts((current) => {
        const next = [...current];
        next[index] = { ...draft, ...patch };
        return next;
      });
    };
    return (
      <label key={`${subgoal.title}-${index}`} className="ai-suggestion-item">
        <input type="checkbox" checked={Boolean(selected[`subgoal-${index}`])} onChange={() => onToggle(`subgoal-${index}`)} />
        <span>
          <input type="text" className="ai-draft-input" value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} />
          <textarea className="ai-draft-textarea" value={draft.summary} rows={2} placeholder="摘要（可选）" onChange={(event) => updateDraft({ summary: event.target.value })} />
          {subgoal.successSignals?.length ? <InlineList items={subgoal.successSignals} /> : null}
        </span>
      </label>
    );
  });
}

function renderDiagnosisResponse(response: AiDiagnoseBranchResponse) {
  const findings = response.findings ?? [];
  if (findings.length === 0) {
    return <p className="muted-text">这次没有发现需要处理的问题。</p>;
  }

  return findings.map((finding, index) => (
    <FindingCard key={`${finding.title}-${index}`} finding={finding} />
  ));
}

function renderWeeklyResponse(
  response: AiSuggestWeeklyActionsResponse,
  selected: SelectionMap,
  onToggle: (key: string) => void,
  drafts: WeeklyDraft[],
  setDrafts: React.Dispatch<React.SetStateAction<WeeklyDraft[]>>
) {
  const actions = response.weeklyActions ?? [];
  if (actions.length === 0) {
    return <p className="muted-text">这次没有建议创建的周行动。</p>;
  }

  return actions.map((action, index) => {
    const draft = drafts[index] ?? { description: action.description, due: action.due ?? "" };
    const updateDraft = (patch: Partial<WeeklyDraft>) => {
      setDrafts((current) => {
        const next = [...current];
        next[index] = { ...draft, ...patch };
        return next;
      });
    };
    return (
      <label key={`${action.description}-${index}`} className="ai-suggestion-item">
        <input type="checkbox" checked={Boolean(selected[`weekly-${index}`])} onChange={() => onToggle(`weekly-${index}`)} />
        <span>
          <input type="text" className="ai-draft-input" value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} />
          <p>{action.goal || "当前目标"}</p>
          <input type="text" className="ai-draft-input ai-draft-due" value={draft.due} placeholder="YYYY-MM-DD" onChange={(event) => updateDraft({ due: event.target.value })} />
        </span>
      </label>
    );
  });
}

function renderWarnings(response: AiResponse) {
  const warnings = "warnings" in response ? response.warnings ?? [] : [];
  if (warnings.length === 0) return null;

  return (
    <div className="ai-warning-list">
      <strong>注意</strong>
      <InlineList items={warnings} />
    </div>
  );
}

function InlineList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul>
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function FindingCard({ finding }: { finding: AiFinding }) {
  return (
    <article className={`ai-finding ${finding.severity}`}>
      <strong>{finding.title}</strong>
      <p>{finding.detail}</p>
      {finding.recommendation && <small>{finding.recommendation}</small>}
    </article>
  );
}

function defaultSelections(tab: AiTab, response: AiResponse, goal: GoalNode): SelectionMap {
  if (tab === "improve") {
    const improve = response as AiImproveGoalResponse;
    return {
      summary: improve.summary !== undefined,
      successSignals: improve.successSignals !== undefined,
      actionCandidates: improve.actionCandidates !== undefined && !isPrimaryGoalNode(goal),
      reviewQuestions: improve.reviewQuestions !== undefined
    };
  }

  if (tab === "subgoals") {
    return Object.fromEntries(((response as AiSuggestSubgoalsResponse).subgoals ?? []).map((_, index) => [`subgoal-${index}`, true]));
  }

  if (tab === "weekly") {
    return Object.fromEntries(((response as AiSuggestWeeklyActionsResponse).weeklyActions ?? []).map((_, index) => [`weekly-${index}`, true]));
  }

  return {};
}

function createSubgoalInput(parent: GoalNode, suggestion: AiSubgoalSuggestion): GoalCreateInput {
  return {
    title: suggestion.title,
    goalMapId: parent.goalMapId,
    parent: parent.title,
    domain: titleFromWikilink(parent.domain) || parent.title,
    horizon: suggestion.horizon || parent.horizon,
    priority: suggestion.priority ?? 50,
    clarity: suggestion.clarity ?? 1,
    progress: 0,
    color: resolveGoalThemeColor(parent),
    summary: suggestion.summary,
    successSignals: suggestion.successSignals,
    actionCandidates: normalizeAiActionCandidates(suggestion.actionCandidates ?? []),
    reviewQuestions: suggestion.reviewQuestions
  };
}

export function buildAiRequest(tab: AiTab, goal: GoalNode, flatGoals: GoalNode[], turn?: AiTurn) {
  const base = {
    goalId: goal.id,
    goal: goalContextFromNode(goal),
    parentChain: parentChain(goal, flatGoals).map(goalContextFromNode),
    children: goal.children.map(goalContextFromNode),
    siblings: siblingGoals(goal, flatGoals).map(goalContextFromNode),
    ...(turn ? { turn } : {})
  };

  return base;
}

export function buildAgentRequest(
  goal: GoalNode,
  flatGoals: GoalNode[],
  message: string,
  options: {
    conversation?: AiConversationMessage[];
    lastTarget?: AiTab | null;
    activeTarget?: AiTab | null;
    currentResponse?: unknown;
  } = {}
): AiAgentRequest {
  return {
    goalId: goal.id,
    goal: goalContextFromNode(goal),
    parentChain: parentChain(goal, flatGoals).map(goalContextFromNode),
    children: goal.children.map(goalContextFromNode),
    siblings: siblingGoals(goal, flatGoals).map(goalContextFromNode),
    message,
    conversation: options.conversation,
    lastTarget: options.lastTarget ?? null,
    activeTarget: options.activeTarget ?? null,
    currentResponse: options.currentResponse
  };
}

async function requestAi(tab: AiTab, payload: unknown): Promise<AiResponse> {
  const endpoint = endpointForAssistantTarget(tab);
  const contract = aiRouteContracts[endpoint];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_CLIENT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(contract.path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("AI 请求超时，请重试");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 501) {
    throw new Error("AI 后端尚未配置");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "AI 请求失败");
  }

  const body = await response.json();
  return responseSchemas[tab].parse(body) as AiResponse;
}

export async function requestAgent(payload: AiAgentRequest, options: RequestAgentOptions = {}): Promise<AiAgentResponse> {
  try {
    await options.beforeGenerate?.();
  } catch (error) {
    throw new AiAgentPreparationError(error);
  }

  const contract = aiRouteContracts.agent;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_CLIENT_TIMEOUT_MS);
  const fetchImpl = options.fetch ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(contract.path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("AI 请求超时，请重试");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 501) {
    throw new Error("AI 后端尚未配置");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "AI 请求失败");
  }

  const body = await response.json();
  return aiAgentResponseSchema.parse(body);
}

function agentMessageText(decision: Extract<AiAgentResponse, { kind: "chat" | "clarify" }>) {
  if (decision.kind !== "clarify" || !decision.options?.length) return decision.message;
  return `${decision.message}\n${decision.options.map((option) => `- ${option}`).join("\n")}`;
}

function aiErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "AI 请求失败";
  return message === "AI provider not configured" ? "AI 后端尚未配置" : message;
}

function parentChain(goal: GoalNode, flatGoals: GoalNode[]) {
  const chain: GoalNode[] = [];
  const seen = new Set<string>([goal.id]);
  let cursor: GoalNode | undefined = goal;

  while (cursor) {
    const parentTitle = titleFromWikilink(cursor.parent);
    if (!parentTitle) break;
    const parent = flatGoals.find((candidate) => candidate.title === parentTitle);
    if (!parent || seen.has(parent.id)) break;
    chain.unshift(parent);
    seen.add(parent.id);
    cursor = parent;
  }

  return chain;
}

function siblingGoals(goal: GoalNode, flatGoals: GoalNode[]) {
  const parentTitle = titleFromWikilink(goal.parent);
  const domainTitle = titleFromWikilink(goal.domain);
  return flatGoals.filter((candidate) => {
    if (candidate.id === goal.id) return false;
    return titleFromWikilink(candidate.parent) === parentTitle && titleFromWikilink(candidate.domain) === domainTitle;
  });
}

function titleFromWikilink(value: string | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "");
}
