import { describe, expect, it } from "vitest";
import { PRIMARY_GOAL_TITLES } from "../shared/goalRules";
import type { GoalMap, GoalNode } from "../shared/types";
import {
  buildCreateGoalAiRequest,
  buildInitialCreateGoalDraft,
  canSubmitCreateGoalDraft,
  createGoalPayloadFromDraft,
  mergeAiDraft,
  resolveCreateGoalAiResponse,
  shouldShowCreateGoalProgress,
  type CreateGoalDialogContext
} from "./CreateGoalDialog";
import { availableDraftCommands, shouldAllowDraftClarification } from "./aiConversation";
import { GOAL_THEME_COLORS } from "./goalUtils";

const goalMap: GoalMap = { id: "map-1", name: "目标网络", sortOrder: 0 };

function goalFixture(patch: Partial<GoalNode> = {}): GoalNode {
  return {
    id: "goal-career",
    title: "Career",
    goalMapId: "map-1",
    filePath: "goals/career.md",
    status: "active",
    horizon: "long",
    domain: "[[Career]]",
    parent: "",
    priority: 50,
    clarity: 2,
    progress: 20,
    color: "#2563eb",
    last_reviewed: "",
    last_progress: "",
    tags: ["goal-network"],
    sections: {
      summary: "",
      directions: [],
      directionHeading: "子方向",
      successSignals: [],
      actionCandidates: [],
      reviewQuestions: []
    },
    children: [],
    ...patch
  };
}

function context(patch: Partial<CreateGoalDialogContext> = {}): CreateGoalDialogContext {
  return {
    mode: "top",
    goalMap,
    existingGoals: [],
    domainCandidates: ["Career", "Growth"],
    siblings: [],
    ...patch
  };
}

describe("CreateGoalDialog helpers", () => {
  it("builds top, subgoal, and sibling defaults from the create context", () => {
    const parent = goalFixture({ id: "goal-parent", title: "Launch", domain: "[[Career]]", horizon: "medium" });
    const selected = goalFixture({ id: "goal-selected", title: "Release notes", parent: "[[Launch]]", domain: "[[Career]]", horizon: "short" });

    expect(buildInitialCreateGoalDraft(context()).domain).toBe("Career");
    expect(buildInitialCreateGoalDraft(context({ mode: "subgoal", parentGoal: parent, sourceGoal: parent })).domain).toBe("Career");
    expect(
      buildInitialCreateGoalDraft(
        context({
          mode: "sibling",
          parentGoal: parent,
          sourceGoal: selected,
          siblings: [selected]
        })
      )
    ).toMatchObject({
      domain: "Career",
      horizon: "short",
      priority: 50
    });
  });

  it("falls back to context domain and only requires title plus importance", () => {
    const draft = buildInitialCreateGoalDraft(context());
    const payload = createGoalPayloadFromDraft(context(), {
      ...draft,
      title: "  Improve release confidence  ",
      domain: "",
      priority: 60,
      summary: "",
      successSignals: [],
      actionCandidates: [],
      reviewQuestions: []
    });

    expect(canSubmitCreateGoalDraft({ ...draft, title: "", priority: 60 })).toBe(false);
    expect(canSubmitCreateGoalDraft({ ...draft, title: "Goal", priority: Number.NaN })).toBe(false);
    expect(canSubmitCreateGoalDraft({ title: "Goal", priority: 60 })).toBe(true);
    expect(payload).toMatchObject({
      title: "Improve release confidence",
      goalMapId: "map-1",
      domain: "Career",
      priority: 60
    });
  });

  it("defaults top-level goal color to the first unused theme color", () => {
    const draft = buildInitialCreateGoalDraft(
      context({
        siblings: [
          goalFixture({ id: "goal-one", title: "One", color: GOAL_THEME_COLORS[0].value }),
          goalFixture({ id: "goal-two", title: "Two", color: GOAL_THEME_COLORS[1].value })
        ]
      })
    );

    expect(draft.color).toBe(GOAL_THEME_COLORS[2].value);
  });

  it("includes the selected theme color when creating top-level goals", () => {
    const topContext = context();
    const draft = {
      ...buildInitialCreateGoalDraft(topContext),
      title: "New top goal",
      color: GOAL_THEME_COLORS[4].value
    };

    expect(createGoalPayloadFromDraft(topContext, draft)).toMatchObject({
      color: GOAL_THEME_COLORS[4].value
    });
  });

  it("inherits parent color for non-top goals and ignores draft color", () => {
    const parent = goalFixture({ id: "goal-parent", title: "Parent", color: GOAL_THEME_COLORS[3].value });
    const childContext = context({
      mode: "subgoal",
      parentGoal: parent,
      sourceGoal: parent
    });
    const draft = {
      ...buildInitialCreateGoalDraft(childContext),
      title: "Child goal",
      color: GOAL_THEME_COLORS[5].value
    };

    expect(createGoalPayloadFromDraft(childContext, draft)).toMatchObject({
      parent: "Parent",
      color: GOAL_THEME_COLORS[3].value
    });
  });

  it("only includes progress for non-primary leaf goal drafts", () => {
    const topContext = context();
    const topDraft = {
      ...buildInitialCreateGoalDraft(topContext),
      title: PRIMARY_GOAL_TITLES[0],
      progress: 80
    };
    const childContext = context({
      mode: "subgoal",
      parentGoal: goalFixture({ title: "Career" }),
      sourceGoal: goalFixture({ title: "Career" })
    });
    const childDraft = {
      ...buildInitialCreateGoalDraft(childContext),
      title: "Improve release confidence",
      progress: 80
    };

    expect(shouldShowCreateGoalProgress(topContext, topDraft)).toBe(false);
    expect(createGoalPayloadFromDraft(topContext, topDraft).progress).toBeUndefined();
    expect(shouldShowCreateGoalProgress(childContext, childDraft)).toBe(true);
    expect(createGoalPayloadFromDraft(childContext, childDraft)).toMatchObject({
      progress: 80,
      clarity: 4
    });
  });

  it("builds draft-goal AI requests from context and current draft", () => {
    const parent = goalFixture({ title: "Launch" });
    const request = buildCreateGoalAiRequest(
      context({
        mode: "subgoal",
        parentGoal: parent,
        sourceGoal: parent,
        existingGoals: [parent],
        siblings: []
      }),
      {
        ...buildInitialCreateGoalDraft(context()),
        title: "Improve release confidence"
      }
    );

    expect(request).toMatchObject({
      mode: "subgoal",
      goalMap: { id: "map-1", name: "目标网络" },
      existingTitles: ["Launch"],
      draft: { title: "Improve release confidence" }
    });
    expect(request.parentGoal?.title).toBe("Launch");
  });

  it("includes optional turns in draft-goal AI requests", () => {
    const draft = {
      ...buildInitialCreateGoalDraft(context()),
      title: "Improve release confidence"
    };
    const turn = {
      intent: "message" as const,
      allowClarification: false,
      message: "Make it smaller",
      currentResponse: { title: draft.title }
    };

    expect(buildCreateGoalAiRequest(context(), draft, turn)).toMatchObject({
      turn: {
        intent: "message",
        allowClarification: false,
        message: "Make it smaller",
        currentResponse: { title: "Improve release confidence" }
      }
    });
  });

  it("uses draft-specific commands in the create goal AI conversation", () => {
    expect(availableDraftCommands()).toEqual([
      { id: "draft-goal", label: "AI 辅助填写" }
    ]);
  });

  it("keeps the selected color when merging AI draft updates", () => {
    const current = {
      ...buildInitialCreateGoalDraft(context()),
      title: "Current title",
      color: GOAL_THEME_COLORS[4].value
    };

    expect(
      mergeAiDraft(current, {
        title: "AI title",
        summary: "AI summary"
      })
    ).toMatchObject({
      title: "AI title",
      summary: "AI summary",
      color: GOAL_THEME_COLORS[4].value
    });
  });

  it("does not allow draft clarification after an answer was already supplied", () => {
    const parent = goalFixture({ title: "Launch" });
    const draft = {
      ...buildInitialCreateGoalDraft(context({ parentGoal: parent })),
      title: "",
      horizon: "long",
      summary: "",
      successSignals: [],
      actionCandidates: [],
      reviewQuestions: []
    };

    expect(
      shouldAllowDraftClarification({
        draft,
        parentGoal: parent,
        sourceGoal: parent,
        hasClarificationAnswer: true
      })
    ).toBe(false);
  });

  it("allows draft clarification for sparse sibling drafts when no answer exists", () => {
    const selected = goalFixture({ title: "Release notes", horizon: "medium" });
    const siblingContext = context({
      mode: "sibling",
      sourceGoal: selected,
      siblings: [selected]
    });
    const draft = {
      ...buildInitialCreateGoalDraft(siblingContext),
      title: "",
      summary: "",
      successSignals: [],
      actionCandidates: [],
      reviewQuestions: []
    };

    expect(
      shouldAllowDraftClarification({
        draft,
        sourceGoal: selected,
        hasClarificationAnswer: false
      })
    ).toBe(true);
  });

  it("does not overwrite the current draft on disallowed clarification responses", () => {
    const current = {
      ...buildInitialCreateGoalDraft(context()),
      title: "Keep this draft",
      color: GOAL_THEME_COLORS[3].value
    };
    const transition = resolveCreateGoalAiResponse({
      currentDraft: current,
      response: {
        clarifyingQuestion: {
          id: "scope",
          question: "你更想先调整哪一部分？",
          options: [
            { id: "scope", label: "缩小范围" },
            { id: "cadence", label: "降低频率" }
          ]
        }
      },
      allowClarification: false
    });

    expect(transition.kind).toBe("protocol-error");
    expect(transition).toMatchObject({
      kind: "protocol-error",
      draft: current
    });
  });
});
