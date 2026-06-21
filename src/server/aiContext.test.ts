import { describe, expect, it } from "vitest";
import type { AiBranchContextSummary } from "../shared/aiContracts";
import type { GoalNode, GoalsResponse } from "../shared/types";
import {
  branchSourceHash,
  buildBranchContextSummary,
  buildServerAiRequest,
  type AiContextSummaryCache
} from "./aiContext";

function goalNode(patch: Partial<GoalNode> & Pick<GoalNode, "id" | "title">): GoalNode {
  const { id, title, ...rest } = patch;
  return {
    id,
    goalMapId: "map-1",
    title,
    filePath: `goals/${id}.md`,
    status: "active",
    horizon: "medium",
    domain: "[[Career]]",
    parent: "",
    priority: 50,
    clarity: 3,
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
    ...rest
  };
}

function goalResponse(root: GoalNode, parent: GoalNode, sibling: GoalNode): GoalsResponse {
  return {
    workspaceId: "workspace-1",
    goalMaps: [{ id: "map-1", name: "目标网络", sortOrder: 0 }],
    goals: [parent],
    flatGoals: [parent, root, ...root.children, sibling],
    graph: { nodes: [], edges: [] }
  };
}

function sampleTree() {
  const child = goalNode({
    id: "goal-child",
    title: "Delivery Child",
    parent: "[[Delivery]]",
    priority: 80,
    clarity: 2,
    progress: 10,
    sections: {
      summary: "Clarify and ship one demo slice.",
      directions: ["Narrow scope"],
      directionHeading: "子方向",
      successSignals: ["Demo slice accepted"],
      actionCandidates: [{ text: "Draft demo checklist", done: false }],
      reviewQuestions: ["What is blocking the demo?"]
    }
  });
  const root = goalNode({
    id: "goal-delivery",
    title: "Delivery",
    parent: "[[Career]]",
    priority: 70,
    clarity: 3,
    sections: {
      summary: "Ship the current project.",
      directions: ["Clarify scope"],
      directionHeading: "子方向",
      successSignals: ["Project accepted"],
      actionCandidates: [{ text: "Review release risks", done: true }],
      reviewQuestions: ["What changed?"]
    },
    children: [child]
  });
  const sibling = goalNode({
    id: "goal-research",
    title: "Research",
    parent: "[[Career]]"
  });
  const parent = goalNode({
    id: "career",
    title: "Career",
    domain: "[[Career]]",
    children: [root, sibling]
  });
  return { parent, root, child, sibling };
}

class MemorySummaryCache implements AiContextSummaryCache {
  reads: Array<{ goalId: string; sourceHash: string }> = [];
  writes: Array<{ goalId: string; sourceHash: string }> = [];
  private readonly rows = new Map<string, { sourceHash: string; summary: AiBranchContextSummary }>();

  async read(key: { goalId: string; sourceHash: string }) {
    this.reads.push({ goalId: key.goalId, sourceHash: key.sourceHash });
    const row = this.rows.get(key.goalId);
    return row?.sourceHash === key.sourceHash ? row.summary : null;
  }

  async write(key: { goalId: string; sourceHash: string }, summary: AiBranchContextSummary) {
    this.writes.push({ goalId: key.goalId, sourceHash: key.sourceHash });
    this.rows.set(key.goalId, { sourceHash: key.sourceHash, summary });
  }
}

describe("AI server context", () => {
  it("rebuilds trusted goal context and reuses a cached branch summary on stable hashes", async () => {
    const { parent, root, sibling } = sampleTree();
    const cache = new MemorySummaryCache();
    const request = {
      goalId: root.id,
      goal: goalNode({ id: "client-stale", title: "Client stale goal" }),
      parentChain: [],
      children: [],
      siblings: [],
      branchGoals: Array.from({ length: 50 }, (_, index) => goalNode({ id: `client-${index}`, title: `Client ${index}` }))
    };

    const options = {
      client: {} as any,
      workspaceId: "workspace-1",
      actorUserId: "user-1",
      readGoals: async () => goalResponse(root, parent, sibling),
      cache
    };

    const first = await buildServerAiRequest("diagnose-branch", request, options) as Record<string, any>;
    const second = await buildServerAiRequest("diagnose-branch", request, options) as Record<string, any>;

    expect(first.goal).toMatchObject({ id: root.id, title: "Delivery" });
    expect(first.parentChain).toEqual([expect.objectContaining({ id: "career" })]);
    expect(first.siblings).toEqual([expect.objectContaining({ id: "goal-research" })]);
    expect(first.branchGoals).toBeUndefined();
    expect(first.branchSummary).toMatchObject({
      rootGoalId: root.id,
      goalCount: 2,
      openActionCount: 1,
      completedActionCount: 1
    });
    expect(second.branchSummary).toEqual(first.branchSummary);
    expect(cache.reads).toHaveLength(2);
    expect(cache.writes).toHaveLength(1);
  });

  it("refreshes the cache when goal content changes the source hash", async () => {
    const { parent, root, sibling } = sampleTree();
    const cache = new MemorySummaryCache();
    let currentRoot = root;
    const request = {
      goalId: root.id,
      goal: goalNode({ id: root.id, title: root.title }),
      parentChain: [],
      children: [],
      siblings: [],
      branchGoals: []
    };
    const options = {
      client: {} as any,
      workspaceId: "workspace-1",
      actorUserId: "user-1",
      readGoals: async () => goalResponse(currentRoot, parent, sibling),
      cache
    };

    await buildServerAiRequest("suggest-weekly-actions", request, options);
    currentRoot = {
      ...root,
      children: [{
        ...root.children[0],
        sections: {
          ...root.children[0].sections,
          summary: "Changed summary after a goal edit."
        }
      }]
    };
    await buildServerAiRequest("suggest-weekly-actions", request, options);

    expect(cache.writes).toHaveLength(2);
    expect(cache.writes[0].sourceHash).not.toBe(cache.writes[1].sourceHash);
  });

  it("changes source hashes when branch relations change", () => {
    const { root } = sampleTree();
    const withChildHash = buildBranchContextSummary(root).sourceHash;
    const withoutChildHash = buildBranchContextSummary({ ...root, children: [] }).sourceHash;

    expect(withChildHash).not.toBe(withoutChildHash);
    expect(branchSourceHash([root])).not.toBe(branchSourceHash([{ ...root, sections: { ...root.sections, summary: "Changed" } }]));
  });

  it("returns 404 when the requested goal is not in the authenticated workspace", async () => {
    const { parent, root, sibling } = sampleTree();

    await expect(buildServerAiRequest("agent", {
      goalId: "missing-goal",
      goal: goalNode({ id: "missing-goal", title: "Missing" }),
      parentChain: [],
      children: [],
      siblings: [],
      message: "帮我看看"
    }, {
      client: {} as any,
      workspaceId: "workspace-1",
      actorUserId: "user-1",
      readGoals: async () => goalResponse(root, parent, sibling),
      cache: new MemorySummaryCache()
    })).rejects.toMatchObject({ message: "Goal not found", status: 404 });
  });
});
