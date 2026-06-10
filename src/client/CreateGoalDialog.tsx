import { AlertCircle, CheckCircle2, Loader2, Pencil, Sparkles, X } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { isPrimaryGoalTitle } from "../shared/goalRules";
import {
  draftGoalResponseSchema,
  normalizeAiActionCandidates,
  type AiDraftGoalRequest,
  type AiDraftGoalResponse
} from "../shared/aiContracts";
import type { GoalActionCandidate, GoalCreateInput, GoalMap, GoalNode } from "../shared/types";
import { goalContextFromNode } from "./AiAssistantDialog";
import { GOAL_THEME_COLORS, nextGoalThemeColor, resolveGoalThemeColor } from "./goalUtils";
import { useModalDialog } from "./useModalDialog";

export type CreateGoalMode = "top" | "subgoal" | "sibling";

export type CreateGoalDialogContext = {
  mode: CreateGoalMode;
  goalMap: GoalMap;
  parentGoal?: GoalNode;
  sourceGoal?: GoalNode;
  siblings: GoalNode[];
  existingGoals: GoalNode[];
  domainCandidates: string[];
};

export type CreateGoalDraft = {
  title: string;
  domain: string;
  horizon: string;
  priority: number;
  progress: number;
  color: string;
  summary: string;
  successSignals: string[];
  actionCandidates: GoalActionCandidate[];
  reviewQuestions: string[];
};

const horizonOptions = [
  { value: "short", label: "短期" },
  { value: "medium", label: "中期" },
  { value: "long", label: "长期" }
];

const AI_CLIENT_TIMEOUT_MS = 60_000;

function titleFromLink(value: string | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "");
}

function cleanLines(value: string[] | undefined) {
  return (value ?? []).map((item) => item.trim()).filter(Boolean);
}

function linesFromText(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function actionCandidatesFromText(value: string): GoalActionCandidate[] {
  return linesFromText(value).map((text) => ({ text, done: false }));
}

function clampNumber(value: number, min: number, max: number) {
  const next = Number(value);
  if (!Number.isFinite(next)) return min;
  return Math.min(max, Math.max(min, Math.round(next)));
}

function uniqueTitle(base: string, goals: GoalNode[]) {
  const titles = new Set(goals.map((goal) => goal.title.trim()).filter(Boolean));
  if (!titles.has(base)) return base;
  let index = 2;
  while (titles.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function defaultDomain(context: CreateGoalDialogContext, draftTitle?: string) {
  return (
    titleFromLink(context.sourceGoal?.domain) ||
    titleFromLink(context.parentGoal?.domain) ||
    context.domainCandidates.find((item) => item.trim())?.trim() ||
    draftTitle?.trim() ||
    context.goalMap.name.trim() ||
    "目标"
  );
}

function defaultGoalThemeColor(context: CreateGoalDialogContext) {
  if (context.parentGoal) return resolveGoalThemeColor(context.parentGoal, nextGoalThemeColor(context.siblings));
  return nextGoalThemeColor(context.siblings);
}

function canChooseGoalThemeColor(context: CreateGoalDialogContext) {
  return context.mode === "top" && !context.parentGoal;
}

export function buildInitialCreateGoalDraft(context: CreateGoalDialogContext): CreateGoalDraft {
  const source = context.sourceGoal ?? context.parentGoal;
  return {
    title: uniqueTitle("新目标", context.existingGoals),
    domain: defaultDomain(context),
    horizon: source?.horizon || "medium",
    priority: 50,
    progress: 0,
    color: defaultGoalThemeColor(context),
    summary: "",
    successSignals: [],
    actionCandidates: [],
    reviewQuestions: []
  };
}

export function canSubmitCreateGoalDraft(draft: Pick<CreateGoalDraft, "title" | "priority">) {
  return draft.title.trim().length > 0 && Number.isFinite(Number(draft.priority));
}

export function shouldShowCreateGoalProgress(context: CreateGoalDialogContext, draft: Pick<CreateGoalDraft, "title">) {
  return Boolean(context.parentGoal) || !isPrimaryGoalTitle(draft.title.trim());
}

export function createGoalPayloadFromDraft(context: CreateGoalDialogContext, draft: CreateGoalDraft): GoalCreateInput {
  const title = draft.title.trim();
  if (!title) throw new Error("请输入目标名称");
  if (!Number.isFinite(Number(draft.priority))) throw new Error("请输入重要性");

  const progress = clampNumber(draft.progress, 0, 100);
  const payload: GoalCreateInput = {
    title,
    goalMapId: context.goalMap.id,
    parent: context.parentGoal?.title || "",
    domain: draft.domain.trim() || defaultDomain(context, title),
    horizon: draft.horizon.trim() || context.sourceGoal?.horizon || context.parentGoal?.horizon || "medium",
    priority: clampNumber(draft.priority, 0, 100),
    clarity: 1
  };

  if (shouldShowCreateGoalProgress(context, draft)) {
    payload.progress = progress;
    payload.clarity = Math.max(1, Math.ceil(progress / 20));
  }

  const summary = draft.summary.trim();
  const successSignals = cleanLines(draft.successSignals);
  const actionCandidates = normalizeAiActionCandidates(draft.actionCandidates);
  const reviewQuestions = cleanLines(draft.reviewQuestions);

  if (summary) payload.summary = summary;
  if (successSignals.length) payload.successSignals = successSignals;
  if (actionCandidates.length) payload.actionCandidates = actionCandidates;
  if (reviewQuestions.length) payload.reviewQuestions = reviewQuestions;
  payload.color = context.parentGoal
    ? resolveGoalThemeColor(context.parentGoal, draft.color)
    : resolveGoalThemeColor({ title, domain: payload.domain, color: draft.color }, nextGoalThemeColor(context.siblings));

  return payload;
}

export function buildCreateGoalAiRequest(context: CreateGoalDialogContext, draft: CreateGoalDraft): AiDraftGoalRequest {
  const { color: _color, ...aiDraft } = draft;
  return {
    mode: context.mode,
    goalMap: {
      id: context.goalMap.id,
      name: context.goalMap.name
    },
    parentGoal: context.parentGoal ? goalContextFromNode(context.parentGoal) : undefined,
    sourceGoal: context.sourceGoal ? goalContextFromNode(context.sourceGoal) : undefined,
    siblings: context.siblings.map(goalContextFromNode),
    existingTitles: context.existingGoals.map((goal) => goal.title),
    domainCandidates: context.domainCandidates,
    draft: aiDraft
  };
}

function mergeAiDraft(current: CreateGoalDraft, response: AiDraftGoalResponse): CreateGoalDraft {
  return {
    ...current,
    title: response.title?.trim() || current.title,
    domain: response.domain?.trim() ?? current.domain,
    horizon: response.horizon?.trim() ?? current.horizon,
    priority: response.priority ?? current.priority,
    progress: response.progress ?? current.progress,
    summary: response.summary?.trim() ?? current.summary,
    successSignals: response.successSignals ? cleanLines(response.successSignals) : current.successSignals,
    actionCandidates: response.actionCandidates
      ? normalizeAiActionCandidates(response.actionCandidates)
      : current.actionCandidates,
    reviewQuestions: response.reviewQuestions ? cleanLines(response.reviewQuestions) : current.reviewQuestions
  };
}

async function requestGoalDraft(context: CreateGoalDialogContext, draft: CreateGoalDraft): Promise<AiDraftGoalResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_CLIENT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("/api/ai/draft-goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(buildCreateGoalAiRequest(context, draft))
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("AI 请求超时，请重试");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 501) throw new Error("AI 后端尚未配置");
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "AI 请求失败");
  }

  return draftGoalResponseSchema.parse(await response.json());
}

export function CreateGoalDialog({
  context,
  saving,
  onCancel,
  onBeforeSubmit,
  onBeforeGenerate,
  onCreate
}: {
  context: CreateGoalDialogContext;
  saving: boolean;
  onCancel: () => void;
  onBeforeSubmit?: () => Promise<void>;
  onBeforeGenerate?: () => Promise<void>;
  onCreate: (input: GoalCreateInput) => Promise<boolean>;
}) {
  const initialDraft = useMemo(() => buildInitialCreateGoalDraft(context), [context]);
  const [draft, setDraft] = useState<CreateGoalDraft>(() => initialDraft);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const progressVisible = shouldShowCreateGoalProgress(context, draft);
  const colorSelectable = canChooseGoalThemeColor(context);
  const inheritedColor = colorSelectable ? "" : defaultGoalThemeColor(context);
  const busy = saving || generating || submitting;
  const canSubmit = !busy && canSubmitCreateGoalDraft(draft);
  const { dialogRef, onBackdropPointerDown, onBackdropClick } = useModalDialog<HTMLElement>({
    onDismiss: onCancel,
    canDismiss: !busy
  });

  useEffect(() => {
    setDraft(initialDraft);
    setError("");
    setNotice("");
    setWarnings([]);
    setDetailsOpen(false);
  }, [initialDraft]);

  const updateDraft = (patch: Partial<CreateGoalDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setNotice("");
    setWarnings([]);
  };

  const generateDraft = async () => {
    setGenerating(true);
    setError("");
    setNotice("");
    setWarnings([]);
    try {
      await onBeforeGenerate?.();
      const response = await requestGoalDraft(context, draft);
      setDraft((current) => mergeAiDraft(current, response));
      setWarnings(response.warnings ?? []);
      setNotice("AI 草稿已填入表单");
      setDetailsOpen(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "AI 请求失败");
    } finally {
      setGenerating(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      await onBeforeSubmit?.();
      const created = await onCreate(createGoalPayloadFromDraft(context, draft));
      if (created) onCancel();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "创建目标失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onBackdropPointerDown} onClick={onBackdropClick}>
      <section ref={dialogRef} tabIndex={-1} className="confirm-dialog create-goal-dialog" role="dialog" aria-modal="true" aria-labelledby="create-goal-dialog-title">
        <div className="dialog-head">
          <div>
            <p className="eyebrow">创建目标</p>
            <h2 id="create-goal-dialog-title">{createGoalDialogTitle(context)}</h2>
          </div>
          <button type="button" className="icon-button compact" aria-label="取消创建目标" disabled={busy} onClick={onCancel}>
            <X />
          </button>
        </div>

        <form
          className="create-goal-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void submit();
          }}
        >
          <div className="create-goal-ai-row">
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void generateDraft()}>
              {generating ? <Loader2 className="spin" /> : <Sparkles />}
              AI 辅助填写
            </button>
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
          {warnings.length > 0 && (
            <div className="ai-warning-list">
              <strong>注意</strong>
              <ul>
                {warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="create-goal-grid">
            <label className="rename-field">
              <span className="field-label">目标名称</span>
              <input
                type="text"
                value={draft.title}
                maxLength={120}
                placeholder="输入目标名称"
                required
                autoFocus
                onChange={(event) => updateDraft({ title: event.target.value })}
              />
            </label>
            <label className="rename-field">
              <span className="field-label">重要性</span>
              <input
                type="number"
                value={draft.priority}
                min={0}
                max={100}
                required
                onChange={(event) => updateDraft({ priority: Number(event.target.value) })}
              />
            </label>
            <label className="rename-field">
              <span className="field-label">领域</span>
              <input
                type="text"
                value={draft.domain}
                list="create-goal-domain-candidates"
                placeholder={defaultDomain(context, draft.title)}
                onChange={(event) => updateDraft({ domain: event.target.value })}
              />
              <datalist id="create-goal-domain-candidates">
                {context.domainCandidates.map((domain) => (
                  <option key={domain} value={domain} />
                ))}
              </datalist>
            </label>
            <label className="rename-field">
              <span className="field-label">周期</span>
              <select value={draft.horizon} onChange={(event) => updateDraft({ horizon: event.target.value })}>
                {horizonOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {colorSelectable ? (
              <fieldset className="rename-field create-goal-color-field">
                <legend className="field-label">主题色</legend>
                <div className="create-goal-color-options">
                  {GOAL_THEME_COLORS.map((color) => (
                    <label
                      key={color.value}
                      className={draft.color === color.value ? "create-goal-color-option selected" : "create-goal-color-option"}
                      title={color.label}
                      style={
                        {
                          "--goal-theme-color": color.value
                        } as React.CSSProperties & { "--goal-theme-color": string }
                      }
                    >
                      <input
                        type="radio"
                        name="create-goal-theme-color"
                        value={color.value}
                        checked={draft.color === color.value}
                        disabled={busy}
                        aria-label={color.label}
                        onChange={(event) => updateDraft({ color: event.target.value })}
                      />
                      <span className="create-goal-color-swatch" aria-hidden="true" />
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <div className="rename-field create-goal-color-field inherited">
                <span className="field-label">主题色</span>
                <span
                  className="create-goal-inherited-color"
                  style={
                    {
                      "--goal-theme-color": inheritedColor
                    } as React.CSSProperties & { "--goal-theme-color": string }
                  }
                >
                  <span className="create-goal-color-swatch" aria-hidden="true" />
                  <span>继承父级</span>
                </span>
              </div>
            )}
            {progressVisible && (
              <label className="rename-field create-goal-progress-field">
                <span className="field-label">进度</span>
                <div className="create-goal-range">
                  <input
                    type="range"
                    value={draft.progress}
                    min={0}
                    max={100}
                    onChange={(event) => updateDraft({ progress: Number(event.target.value) })}
                  />
                  <input
                    type="number"
                    value={draft.progress}
                    min={0}
                    max={100}
                    onChange={(event) => updateDraft({ progress: Number(event.target.value) })}
                  />
                  <span>%</span>
                </div>
              </label>
            )}
            <label className="rename-field create-goal-summary-field">
              <span className="field-label">摘要</span>
              <textarea
                value={draft.summary}
                rows={3}
                placeholder="这个目标为什么重要、完成后是什么样"
                onChange={(event) => updateDraft({ summary: event.target.value })}
              />
            </label>
          </div>

          <details className="create-goal-details" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
            <summary>更多目标信息</summary>
            <div className="create-goal-detail-grid">
              <label className="rename-field">
                <span className="field-label">成功信号</span>
                <textarea
                  value={draft.successSignals.join("\n")}
                  rows={3}
                  placeholder="每行一个成功信号"
                  onChange={(event) => updateDraft({ successSignals: linesFromText(event.target.value) })}
                />
              </label>
              <label className="rename-field">
                <span className="field-label">行动候选</span>
                <textarea
                  value={draft.actionCandidates.map((action) => action.text).join("\n")}
                  rows={3}
                  placeholder="每行一个下一步行动"
                  onChange={(event) => updateDraft({ actionCandidates: actionCandidatesFromText(event.target.value) })}
                />
              </label>
              <label className="rename-field create-goal-full-row">
                <span className="field-label">复盘问题</span>
                <textarea
                  value={draft.reviewQuestions.join("\n")}
                  rows={3}
                  placeholder="每行一个复盘问题"
                  onChange={(event) => updateDraft({ reviewQuestions: linesFromText(event.target.value) })}
                />
              </label>
            </div>
          </details>

          <div className="dialog-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>
              取消
            </button>
            <button type="submit" className="primary-button" disabled={!canSubmit}>
              {submitting || saving ? <Loader2 className="spin" /> : <Pencil />}
              创建
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function createGoalDialogTitle(context: CreateGoalDialogContext) {
  if (context.mode === "subgoal" && context.parentGoal) return `为「${context.parentGoal.title}」添加子目标`;
  if (context.mode === "sibling" && context.sourceGoal) return `为「${context.sourceGoal.title}」添加同级目标`;
  return `在「${context.goalMap.name}」添加目标`;
}
