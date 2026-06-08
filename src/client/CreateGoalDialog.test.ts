import { describe, expect, it } from "vitest";
import { PRIMARY_GOAL_TITLES } from "../shared/goalRules";
import type { GoalMap, GoalNode } from "../shared/types";
import {
  buildCreateGoalAiRequest,
  buildInitialCreateGoalDraft,
  canSubmitCreateGoalDraft,
  createGoalPayloadFromDraft,
  shouldShowCreateGoalProgress,
  type CreateGoalDialogContext
} from "./CreateGoalDialog";

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
    supports: [],
    depends_on: [],
    conflicts_with: [],
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
});
