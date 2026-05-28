import type { GoalNode } from "./types";

export const PRIMARY_GOAL_TITLES = ["职业发展", "个人成长", "幸福生活"] as const;

const primaryGoalTitleSet = new Set<string>(PRIMARY_GOAL_TITLES);

export function normalizedGoalTitle(value: string | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "");
}

export function isPrimaryGoalTitle(title: string | undefined) {
  return primaryGoalTitleSet.has(normalizedGoalTitle(title));
}

export function isPrimaryGoalNode(goal: Pick<GoalNode, "title" | "parent">) {
  return isPrimaryGoalTitle(goal.title) && !normalizedGoalTitle(goal.parent);
}
