import { AlertCircle, CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import React, { useEffect, useState } from "react";
import { isPrimaryGoalNode } from "../shared/goalRules";
import type { ActionCreateInput, GoalCreateInput, GoalNode, GoalPatchInput } from "../shared/types";
import { AiConversationControls } from "./AiConversationControls";
import {
  availableAssistantCommands,
  availableQuickAdjustmentsForTarget,
  buildAssistantCommandTurn,
  buildAiTurn,
  endpointForAssistantTarget,
  isClarificationOnlyResponse,
  quickAdjustmentLabel,
  resolveAssistantMessageRoute,
  type AiAssistantTarget,
  shouldAllowGoalClarification
} from "./aiConversation";
import { resolveGoalThemeColor } from "./goalUtils";
import { useModalDialog } from "./useModalDialog";
import {
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

const assistantCommands = availableAssistantCommands();

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
  onCreateWeeklyAction
}: {
  goal: GoalNode;
  flatGoals: GoalNode[];
  saving: boolean;
  onClose: () => void;
  onBeforeGenerate?: () => Promise<void>;
  onPatchGoal: (goalId: string, patch: GoalPatchInput) => Promise<boolean>;
  onCreateGoal: (input: GoalCreateInput) => Promise<boolean>;
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
  const [clarificationAnswered, setClarificationAnswered] = useState(false);
  const primaryGoal = isPrimaryGoalNode(goal);

  useEffect(() => {
    setResponse(null);
    setResponseTarget(null);
    setError("");
    setNotice("");
    setSelected({});
    setMessages([]);
    setClarifyingQuestion(null);
    setClarificationAnswered(false);
    setLastTarget(null);
  }, [goal.id]);

  const canApply = Boolean(response) && responseTarget !== "diagnose";

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
      setMessages([...nextMessages, { role: "assistant", content: transition.clarifyingQuestion.question }]);
      return;
    }

    setClarifyingQuestion(null);
    setResponse(transition.response);
    setResponseTarget(target);
    setSelected(transition.selected);
    setMessages(nextMessages);
  };

  const runTurn = async (
    target: AiTab,
    turn: AiTurn,
    nextMessages: AiConversationMessage[],
    options: { clearOnError?: boolean } = {}
  ) => {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      await onBeforeGenerate?.();
      const nextResponse = await requestAi(target, buildAiRequest(target, goal, flatGoals, turn));
      handleAiResponse(target, nextResponse, turn.allowClarification === true, nextMessages);
    } catch (nextError) {
      if (options.clearOnError) {
        setResponse(null);
        setResponseTarget(null);
        setSelected({});
        setClarifyingQuestion(null);
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
        const patch = buildImproveGoalPatch(goal, response as AiImproveGoalResponse, selected);
        if (Object.keys(patch).length === 0) throw new Error("请先勾选要应用的建议");
        const ok = await onPatchGoal(goal.id, patch);
        if (!ok) throw new Error("目标更新失败");
      }

      if (responseTarget === "subgoals") {
        const subgoals = ((response as AiSuggestSubgoalsResponse).subgoals ?? []).filter((_, index) => selected[`subgoal-${index}`]);
        if (subgoals.length === 0) throw new Error("请先勾选要创建的子目标");
        for (const subgoal of subgoals) {
          const ok = await onCreateGoal(createSubgoalInput(goal, subgoal));
          if (!ok) throw new Error(`子目标创建失败：${subgoal.title}`);
        }
      }

      if (responseTarget === "weekly") {
        const actions = ((response as AiSuggestWeeklyActionsResponse).weeklyActions ?? []).filter((_, index) => selected[`weekly-${index}`]);
        if (actions.length === 0) throw new Error("请先勾选要创建的周行动");
        for (const action of actions) {
          const ok = await onCreateWeeklyAction({
            description: action.description,
            goal: action.goal || goal.title,
            due: action.due
          });
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

  const sendMessage = (message: string) => {
    const route = resolveAssistantMessageRoute(lastTarget, message);
    const nextMessages: AiConversationMessage[] = [...messages, { role: "user", content: message }];

    if (route.kind !== "task") {
      setError("");
      setNotice("");
      setMessages([...nextMessages, { role: "assistant", content: route.reply }]);
      return;
    }

    const nextParentChain = parentChain(goal, flatGoals);
    const nextSiblings = siblingGoals(goal, flatGoals);
    const allowClarification =
      !response &&
      shouldAllowGoalClarification({
        target: route.target,
        goal,
        parentChain: nextParentChain,
        children: goal.children,
        siblings: nextSiblings,
        hasClarificationAnswer: clarificationAnswered
      });
    setLastTarget(route.target);
    if (route.inferred && route.target !== responseTarget) {
      setResponse(null);
      setResponseTarget(null);
      setSelected({});
      setClarifyingQuestion(null);
    }
    void runTurn(
      route.target,
      buildAiTurn({
        intent: "message",
        message,
        allowClarification,
        conversation: nextMessages,
        currentResponse: route.target === responseTarget ? response ?? undefined : undefined
      }),
      nextMessages
    );
  };

  const quickAdjust = (adjustment: AiQuickAdjustment) => {
    const target = responseTarget ?? lastTarget;
    if (!target) {
      setError("请先选择一个快捷指令");
      return;
    }

    const nextMessages: AiConversationMessage[] = [...messages, { role: "user", content: quickAdjustmentLabel(adjustment) }];
    void runTurn(
      target,
      buildAiTurn({
        intent: "quick-adjust",
        quickAdjustment: adjustment,
        allowClarification: false,
        conversation: nextMessages,
        currentResponse: response ?? undefined
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
        currentResponse: response ?? undefined
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

  const busy = loading || applying;
  const { dialogRef, onBackdropPointerDown, onBackdropClick } = useModalDialog<HTMLElement>({
    onDismiss: onClose,
    canDismiss: !busy
  });

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onBackdropPointerDown} onClick={onBackdropClick}>
      <section ref={dialogRef} tabIndex={-1} className="ai-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-dialog-title">
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
            intro={{
              title: "AI",
              body: "告诉我你想怎么处理这个目标。我可以直接优化目标、拆解子目标、体检分支或安排本周行动。"
            }}
            inputPlaceholder="输入任务，例如：帮我优化这个目标，或安排本周行动"
            onCommand={runCommand}
            onSendMessage={sendMessage}
            onQuickAdjust={quickAdjust}
            onAnswerClarification={answerClarification}
            onSkipClarification={skipClarification}
          >
            {response && responseTarget && (
              <>
                <div className="ai-suggestion-list">
                  {renderResponse(responseTarget, response, selected, primaryGoal, toggleSelection)}
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
      </section>
    </div>
  );
}

function renderResponse(
  tab: AiTab,
  response: AiResponse,
  selected: SelectionMap,
  primaryGoal: boolean,
  onToggle: (key: string) => void
) {
  if (tab === "improve") {
    return renderImproveResponse(response as AiImproveGoalResponse, selected, primaryGoal, onToggle);
  }
  if (tab === "subgoals") {
    return renderSubgoalResponse(response as AiSuggestSubgoalsResponse, selected, onToggle);
  }
  if (tab === "diagnose") {
    return renderDiagnosisResponse(response as AiDiagnoseBranchResponse);
  }
  return renderWeeklyResponse(response as AiSuggestWeeklyActionsResponse, selected, onToggle);
}

function renderImproveResponse(
  response: AiImproveGoalResponse,
  selected: SelectionMap,
  primaryGoal: boolean,
  onToggle: (key: string) => void
) {
  const fields: ImproveField[] = ["summary", "successSignals", "actionCandidates", "reviewQuestions"];
  const visibleFields = fields.filter((field) => response[field] !== undefined);

  if (visibleFields.length === 0) {
    return <p className="muted-text">这次没有可应用的优化建议。</p>;
  }

  return visibleFields.map((field) => {
    const disabled = field === "actionCandidates" && primaryGoal;
    return (
      <label key={field} className={disabled ? "ai-suggestion-item disabled" : "ai-suggestion-item"}>
        <input type="checkbox" checked={!disabled && Boolean(selected[field])} disabled={disabled} onChange={() => onToggle(field)} />
        <span>
          <strong>{improveFieldLabels[field]}</strong>
          {field === "summary" && <p>{response.summary}</p>}
          {field === "successSignals" && <InlineList items={response.successSignals ?? []} />}
          {field === "actionCandidates" && <InlineList items={normalizeAiActionCandidates(response.actionCandidates ?? []).map((action) => action.text)} />}
          {field === "reviewQuestions" && <InlineList items={response.reviewQuestions ?? []} />}
          {disabled && <small>一级目标不写入行动候选。</small>}
        </span>
      </label>
    );
  });
}

function renderSubgoalResponse(response: AiSuggestSubgoalsResponse, selected: SelectionMap, onToggle: (key: string) => void) {
  const subgoals = response.subgoals ?? [];
  if (subgoals.length === 0) {
    return <p className="muted-text">这次没有建议创建的子目标。</p>;
  }

  return subgoals.map((subgoal, index) => (
    <label key={`${subgoal.title}-${index}`} className="ai-suggestion-item">
      <input type="checkbox" checked={Boolean(selected[`subgoal-${index}`])} onChange={() => onToggle(`subgoal-${index}`)} />
      <span>
        <strong>{subgoal.title}</strong>
        {subgoal.summary && <p>{subgoal.summary}</p>}
        {subgoal.successSignals?.length ? <InlineList items={subgoal.successSignals} /> : null}
      </span>
    </label>
  ));
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

function renderWeeklyResponse(response: AiSuggestWeeklyActionsResponse, selected: SelectionMap, onToggle: (key: string) => void) {
  const actions = response.weeklyActions ?? [];
  if (actions.length === 0) {
    return <p className="muted-text">这次没有建议创建的周行动。</p>;
  }

  return actions.map((action, index) => (
    <label key={`${action.description}-${index}`} className="ai-suggestion-item">
      <input type="checkbox" checked={Boolean(selected[`weekly-${index}`])} onChange={() => onToggle(`weekly-${index}`)} />
      <span>
        <strong>{action.description}</strong>
        <p>{action.goal || "当前目标"}{action.due ? ` · ${action.due}` : ""}</p>
      </span>
    </label>
  ));
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

function buildAiRequest(tab: AiTab, goal: GoalNode, flatGoals: GoalNode[], turn?: AiTurn) {
  const base = {
    goalId: goal.id,
    goal: goalContextFromNode(goal),
    parentChain: parentChain(goal, flatGoals).map(goalContextFromNode),
    children: goal.children.map(goalContextFromNode),
    siblings: siblingGoals(goal, flatGoals).map(goalContextFromNode),
    ...(turn ? { turn } : {})
  };

  if (tab === "diagnose" || tab === "weekly") {
    return {
      ...base,
      branchGoals: flattenBranch(goal).map(goalContextFromNode)
    };
  }

  return base;
}

async function requestAi(tab: AiTab, payload: unknown): Promise<AiResponse> {
  const endpoint = endpointForAssistantTarget(tab);
  const contract = aiRouteContracts[endpoint];
  const response = await fetch(contract.path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

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

function flattenBranch(goal: GoalNode) {
  const result: GoalNode[] = [];
  const visit = (node: GoalNode) => {
    result.push(node);
    node.children.forEach(visit);
  };
  visit(goal);
  return result;
}

function titleFromWikilink(value: string | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "");
}
