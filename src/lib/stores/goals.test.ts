import { describe, expect, it } from "vitest";
import { buildGoalsResponse } from "./goals";

describe("buildGoalsResponse", () => {
  it("builds the existing UI response shape from Supabase rows and relations", () => {
    const response = buildGoalsResponse(
      [
        {
          id: "db-root",
          legacy_id: "goal-career",
          workspace_id: "workspace-1",
          title: "Career",
          file_path: "goals/Career/Career.md",
          status: "active",
          horizon: "long",
          domain_title: "Career",
          priority: 70,
          clarity: 3,
          progress: null,
          color: "#0284c7",
          map_x: null,
          map_y: null,
          map_positions: null,
          sections: {
            summary: "Root summary",
            directions: ["Grow"],
            directionHeading: "中期目标",
            successSignals: ["Signal"],
            actionCandidates: [{ text: "hidden on root", done: false }],
            reviewQuestions: ["Review?"]
          },
          tags: ["goal-network", "goal-domain"],
          last_reviewed: "",
          last_progress: ""
        },
        {
          id: "db-child",
          legacy_id: "goal-career-skill",
          workspace_id: "workspace-1",
          title: "Skill",
          file_path: "goals/Career/Skill.md",
          status: "active",
          horizon: "medium",
          domain_title: "Career",
          priority: 30,
          clarity: 2,
          progress: 40,
          color: "#0284c7",
          map_x: null,
          map_y: null,
          map_positions: { root: { x: 1, y: 2 } },
          sections: {
            summary: "Child summary",
            directions: [],
            successSignals: [],
            actionCandidates: [{ text: "Do it", done: false }],
            reviewQuestions: []
          },
          tags: ["goal-network"],
          last_reviewed: "",
          last_progress: ""
        }
      ],
      [
        {
          id: "rel-parent",
          workspace_id: "workspace-1",
          source_goal_id: "db-child",
          target_goal_id: "db-root",
          relation_type: "parent"
        },
        {
          id: "rel-support",
          workspace_id: "workspace-1",
          source_goal_id: "db-child",
          target_goal_id: "db-root",
          relation_type: "supports"
        }
      ],
      "workspace-1"
    );

    expect(response.workspaceId).toBe("workspace-1");
    expect(response.goals).toHaveLength(1);
    expect(response.goals[0].children[0].title).toBe("Skill");
    expect(response.goals[0].sections.actionCandidates).toEqual([]);
    expect(response.goals[0].children[0].supports).toEqual(["[[Career]]"]);
    expect(response.graph.edges.map((edge) => edge.type).sort()).toEqual(["parent", "supports"]);
  });
});
