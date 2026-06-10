import { AlertCircle, CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { isPrimaryGoalNode } from "../shared/goalRules";
import type { ActionCreateInput, GoalCreateInput, GoalNode, GoalPatchInput } from "../shared/types";
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
  type AiEndpoint,
  type AiFinding,
  type AiGoalContext,
  type AiImproveGoalResponse,
  type AiSubgoalSuggestion,
  type AiSuggestSubgoalsResponse,
  type AiSuggestWeeklyActionsResponse,
  type AiWeeklyActionSuggestion
} from "../shared/aiContracts";

type AiTab = "improve" | "subgoals" | "diagnose" | "weekly";
type AiResponse =
  | AiImproveGoalResponse
  | AiSuggestSubgoalsResponse
  | AiDiagnoseBranchResponse
  | AiSuggestWeeklyActionsResponse;
type SelectionMap = Record<string, boolean>;
type ImproveField = "summary" | "successSignals" | "actionCandidates" | "reviewQuestions";

const AI_CLIENT_TIMEOUT_MS = 60_000;

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
  const splitLines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return {
    summary: original.summary !== undefined ? draft.summary.trim() || undefined : undefined,
    successSignals: original.successSignals !== undefined ? splitLines(draft.successSignals) : undefined,
    actionCandidates: original.actionCandidates !== undefined ? splitLines(draft.actionCandidates) : undefined,
    reviewQuestions: original.reviewQuestions !== undefined ? splitLines(draft.reviewQuestions) : undefined,
    warnings: original.warnings
  };
}

const tabs: Array<{ id: AiTab; label: string; endpoint: AiEndpoint }> = [
  { id: "improve", label: "优化目标", endpoint: "improve-goal" },
  { id: "subgoals", label: "拆解子目标", endpoint: "suggest-subgoals" },
  { id: "diagnose", label: "分支体检", endpoint: "diagnose-branch" },
  { id: "weekly", label: "本周行动", endpoint: "suggest-weekly-actions" }
];

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
  return ((response.subgoals ?? [])).flatMap((subgoal, index) => {
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
  return ((response.weeklyActions ?? [])).flatMap((action, index) => {
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
  const [activeTab, setActiveTab] = useState<AiTab>("improve");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [response, setResponse] = useState<AiResponse | null>(null);
  const [selected, setSelected] = useState<SelectionMap>({});
  const [improveDraft, setImproveDraft] = useState<ImproveDraft | null>(null);
  const [subgoalDrafts, setSubgoalDrafts] = useState<SubgoalDraft[]>([]);
  const [weeklyDrafts, setWeeklyDrafts] = useState<WeeklyDraft[]>([]);
  const primaryGoal = isPrimaryGoalNode(goal);

  useEffect(() => {
    setResponse(null);
    setError("");
    setNotice("");
    setSelected({});
    setImproveDraft(null);
    setSubgoalDrafts([]);
    setWeeklyDrafts([]);
  }, [activeTab, goal.id]);

  const activeConfig = useMemo(() => tabs.find((tab) => tab.id === activeTab) ?? tabs[0], [activeTab]);
  const canApply = response && activeTab !== "diagnose";

  const generate = async () => {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      await onBeforeGenerate?.();
      const nextResponse = await requestAi(activeTab, buildAiRequest(activeTab, goal, flatGoals));
      setResponse(nextResponse);
      setSelected(defaultSelections(activeTab, nextResponse, goal));

      if (activeTab === "improve") {
        setImproveDraft(improveDraftFromResponse(nextResponse as AiImproveGoalResponse));
      }
      if (activeTab === "subgoals") {
        setSubgoalDrafts(((nextResponse as AiSuggestSubgoalsResponse).subgoals ?? []).map((s) => ({ title: s.title, summary: s.summary ?? "" })));
      }
      if (activeTab === "weekly") {
        setWeeklyDrafts(((nextResponse as AiSuggestWeeklyActionsResponse).weeklyActions ?? []).map((a) => ({ description: a.description, due: a.due ?? "" })));
      }
    } catch (nextError) {
      setResponse(null);
      setSelected({});
      setImproveDraft(null);
      setSubgoalDrafts([]);
      setWeeklyDrafts([]);
      setError(aiErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  };

  const applySelected = async () => {
    if (!response) return;
    setApplying(true);
    setError("");
    setNotice("");

    try {
      if (activeTab === "improve") {
        const effectiveResponse = improveDraft
          ? improveResponseFromDraft(improveDraft, response as AiImproveGoalResponse)
          : (response as AiImproveGoalResponse);
        const patch = buildImproveGoalPatch(goal, effectiveResponse, selected);
        if (Object.keys(patch).length === 0) throw new Error("请先勾选要应用的建议");
        const ok = await onPatchGoal(goal.id, patch);
        if (!ok) throw new Error("目标更新失败");
      }

      if (activeTab === "subgoals") {
        const subgoals = selectedSubgoalSuggestionsForCreate(response as AiSuggestSubgoalsResponse, selected, subgoalDrafts);
        if (subgoals.length === 0) throw new Error("请先勾选要创建的子目标");
        for (const subgoal of subgoals) {
          const ok = await onCreateGoal(createSubgoalInput(goal, subgoal));
          if (!ok) throw new Error(`子目标创建失败：${subgoal.title}`);
        }
      }

      if (activeTab === "weekly") {
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

        <div className="ai-tabs" role="tablist" aria-label="AI 助手模式">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={tab.id === activeTab ? "ai-tab active" : "ai-tab"}
              aria-selected={tab.id === activeTab}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="ai-dialog-body">
          <div className="ai-context">
            <Sparkles />
            <span>{activeConfig.label}会基于当前目标、父链、子目标和同级目标生成结构化建议。</span>
          </div>

          <div className="ai-actions">
            <button type="button" className="primary-button" disabled={loading || applying || saving} onClick={() => void generate()}>
              {loading ? <Loader2 className="spin" /> : <Sparkles />}
              生成建议
            </button>
            {canApply && (
              <button type="button" className="secondary-button" disabled={loading || applying || saving} onClick={() => void applySelected()}>
                {applying ? <Loader2 className="spin" /> : <CheckCircle2 />}
                应用勾选
              </button>
            )}
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

          {!response && !error && <p className="muted-text">点击“生成建议”后，建议会显示在这里。当前后端未配置模型时不会触发任何写入。</p>}

          {response && (
            <div className="ai-suggestion-list">
              {renderResponse(activeTab, response, selected, primaryGoal, toggleSelection, {
                improveDraft,
                subgoalDrafts,
                weeklyDrafts,
                setImproveDraft,
                setSubgoalDrafts,
                setWeeklyDrafts
              })}
              {renderWarnings(response)}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

type DraftState = {
  improveDraft: ImproveDraft | null;
  subgoalDrafts: SubgoalDraft[];
  weeklyDrafts: WeeklyDraft[];
  setImproveDraft: (d: ImproveDraft) => void;
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
  setDraft: (d: ImproveDraft) => void
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
              ? <textarea className="ai-draft-textarea" value={draft.summary} rows={3} onChange={(e) => updateDraft(e.target.value)} />
              : <p>{response.summary}</p>
          )}
          {field === "successSignals" && (
            draft
              ? <textarea className="ai-draft-textarea" value={draft.successSignals} rows={3} placeholder="每行一条" onChange={(e) => updateDraft(e.target.value)} />
              : <InlineList items={response.successSignals ?? []} />
          )}
          {field === "actionCandidates" && (
            draft
              ? <textarea className="ai-draft-textarea" value={draft.actionCandidates} rows={3} placeholder="每行一条" onChange={(e) => updateDraft(e.target.value)} />
              : <InlineList items={normalizeAiActionCandidates(response.actionCandidates ?? []).map((action) => action.text)} />
          )}
          {field === "reviewQuestions" && (
            draft
              ? <textarea className="ai-draft-textarea" value={draft.reviewQuestions} rows={3} placeholder="每行一条" onChange={(e) => updateDraft(e.target.value)} />
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
          <input type="text" className="ai-draft-input" value={draft.title} onChange={(e) => updateDraft({ title: e.target.value })} />
          <textarea className="ai-draft-textarea" value={draft.summary} rows={2} placeholder="摘要（可选）" onChange={(e) => updateDraft({ summary: e.target.value })} />
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
          <input type="text" className="ai-draft-input" value={draft.description} onChange={(e) => updateDraft({ description: e.target.value })} />
          <p>{action.goal || "当前目标"}</p>
          <input type="text" className="ai-draft-input ai-draft-due" value={draft.due} placeholder="YYYY-MM-DD" onChange={(e) => updateDraft({ due: e.target.value })} />
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

export function buildAiRequest(tab: AiTab, goal: GoalNode, flatGoals: GoalNode[]) {
  const base = {
    goalId: goal.id,
    goal: goalContextFromNode(goal),
    parentChain: parentChain(goal, flatGoals).map(goalContextFromNode),
    children: goal.children.map(goalContextFromNode),
    siblings: siblingGoals(goal, flatGoals).map(goalContextFromNode)
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
  const endpoint = tabs.find((item) => item.id === tab)?.endpoint ?? "improve-goal";
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
