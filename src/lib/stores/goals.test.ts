import { describe, expect, it } from "vitest";
import { buildGoalsResponse, SupabaseGoalStore, type GoalDbRow, type GoalMapDbRow } from "./goals";

function goalRow(patch: Partial<GoalDbRow> & Pick<GoalDbRow, "id" | "legacy_id" | "title">): GoalDbRow {
  return {
    workspace_id: "workspace-1",
    goal_map_id: "map-1",
    file_path: `goals/${patch.title}.md`,
    status: "active",
    horizon: "medium",
    domain_title: patch.title,
    priority: 50,
    clarity: 1,
    progress: 0,
    color: "",
    map_x: null,
    map_y: null,
    map_positions: null,
    sections: {},
    tags: ["goal-network"],
    last_reviewed: "",
    last_progress: "",
    ...patch
  };
}

function goalMapRow(patch: Partial<GoalMapDbRow> & Pick<GoalMapDbRow, "id" | "name">): GoalMapDbRow {
  return {
    workspace_id: "workspace-1",
    sort_order: 0,
    ...patch
  };
}

type FakeTables = Record<string, Array<Record<string, any>>>;

class FakeQuery {
  private filters: Array<(row: Record<string, any>) => boolean> = [];
  private limitCount: number | null = null;
  private orderKeys: Array<{ column: string; ascending: boolean }> = [];
  private operation: "select" | "insert" | "update" | "delete" = "select";
  private payload: any;

  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly table: string
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: any[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.orderKeys.push({ column, ascending: options.ascending !== false });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  insert(payload: any) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: any) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  async maybeSingle() {
    const result = this.execute();
    return { data: result.data[0] ?? null, error: null };
  }

  async single() {
    const result = this.execute();
    return { data: result.data[0] ?? null, error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute() {
    const table = this.client.tables[this.table] ?? [];

    if (this.operation === "insert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((row) => this.client.insertRow(this.table, row));
      return { data: rows, error: null };
    }

    if (this.operation === "update") {
      const rows = this.filtered(table);
      rows.forEach((row) => Object.assign(row, this.payload));
      return { data: rows, error: null };
    }

    if (this.operation === "delete") {
      const rows = this.filtered(table);
      this.client.tables[this.table] = table.filter((row) => !rows.includes(row));
      return { data: rows, error: null };
    }

    return { data: this.applyOrderAndLimit(this.filtered(table)), error: null };
  }

  private filtered(table: Array<Record<string, any>>) {
    return table.filter((row) => this.filters.every((filter) => filter(row)));
  }

  private applyOrderAndLimit(rows: Array<Record<string, any>>) {
    const sorted = [...rows];
    for (const { column, ascending } of [...this.orderKeys].reverse()) {
      sorted.sort((a, b) => {
        const direction = ascending ? 1 : -1;
        return String(a[column] ?? "").localeCompare(String(b[column] ?? "")) * direction;
      });
    }
    return this.limitCount === null ? sorted : sorted.slice(0, this.limitCount);
  }
}

class FakeSupabaseClient {
  tables: FakeTables;
  rpcCalls: Array<{ name: string; args: Record<string, any> }> = [];

  constructor(tables: Partial<FakeTables> = {}) {
    this.tables = {
      goal_maps: [],
      goals: [],
      goal_relations: [],
      audit_events: [],
      sync_jobs: [],
      ...tables
    };
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  async rpc(name: string, args: Record<string, any>) {
    this.rpcCalls.push({ name, args });
    if (name === "set_goal_map_positions") return this.setGoalMapPositionsRpc(args);
    if (name === "clear_goal_map_positions") return this.clearGoalMapPositionsRpc(args);
    return { data: null, error: new Error(`Unknown RPC: ${name}`) };
  }

  insertRow(table: string, row: Record<string, any>) {
    const next = {
      id: row.id ?? `${table}-${this.tables[table].length + 1}`,
      ...row
    };
    this.tables[table].push(next);
    return next;
  }

  private setGoalMapPositionsRpc(args: Record<string, any>) {
    const contextId = String(args.p_map_context_id ?? "").trim();
    const byGoalId = new Map<string, { x: number; y: number }>();
    for (const item of args.p_positions ?? []) {
      const id = String(item.id ?? "").trim();
      if (id) byGoalId.set(id, { x: Number(item.position.x), y: Number(item.position.y) });
    }
    const goalIds = Array.from(byGoalId.keys());
    const rows = this.tables.goals.filter((row) => row.workspace_id === args.p_workspace_id && goalIds.includes(row.legacy_id));
    const missingId = goalIds.find((id) => !rows.some((row) => row.legacy_id === id));
    if (missingId) return { data: null, error: new Error(`Goal not found: ${missingId}`) };

    for (const row of rows) {
      row.map_positions = this.mergeMapPositions(row.map_positions, { [contextId]: byGoalId.get(row.legacy_id) });
    }
    if (rows.length) this.insertAuditAndSync(args, "goal.map_positions.set", rows[0].id, goalIds, rows.length);
    return { data: { updatedCount: rows.length }, error: null };
  }

  private clearGoalMapPositionsRpc(args: Record<string, any>) {
    const contextId = String(args.p_map_context_id ?? "").trim();
    const goalIds: string[] = Array.from(
      new Set<string>((args.p_ids ?? []).map((id: string) => String(id).trim()).filter(Boolean))
    );
    const rows = this.tables.goals.filter((row) => row.workspace_id === args.p_workspace_id && goalIds.includes(row.legacy_id));
    const missingId = goalIds.find((id) => !rows.some((row) => row.legacy_id === id));
    if (missingId) return { data: null, error: new Error(`Goal not found: ${missingId}`) };

    const updatedRows = rows.filter((row) => {
      const hasScopedPosition = Boolean(row.map_positions && Object.prototype.hasOwnProperty.call(row.map_positions, contextId));
      const clearsLegacyRootPosition = contextId === "root" && (row.map_x !== null || row.map_y !== null);
      return hasScopedPosition || clearsLegacyRootPosition;
    });

    for (const row of updatedRows) {
      row.map_positions = this.mergeMapPositions(row.map_positions, { [contextId]: null });
      if (contextId === "root") {
        row.map_x = null;
        row.map_y = null;
      }
    }
    if (updatedRows.length) this.insertAuditAndSync(args, "goal.map_positions.clear", updatedRows[0].id, goalIds, updatedRows.length);
    return { data: { updatedCount: updatedRows.length }, error: null };
  }

  private mergeMapPositions(current: any, patch: Record<string, any>) {
    const next = { ...(current ?? {}) };
    for (const [contextId, value] of Object.entries(patch)) {
      if (value === null) delete next[contextId];
      else next[contextId] = value;
    }
    return Object.keys(next).length ? next : null;
  }

  private insertAuditAndSync(args: Record<string, any>, action: string, entityId: string, ids: string[], updatedCount: number) {
    this.insertRow("audit_events", {
      workspace_id: args.p_workspace_id,
      actor_user_id: args.p_actor_user_id,
      action,
      entity_type: "goal",
      entity_id: entityId,
      payload: {
        ids,
        mapContextId: args.p_map_context_id,
        updatedCount
      }
    });
    this.insertRow("sync_jobs", {
      workspace_id: args.p_workspace_id,
      kind: "github_export_pending",
      status: "pending",
      payload: { reason: action, entityId }
    });
  }
}

describe("buildGoalsResponse", () => {
  it("builds the existing UI response shape from Supabase rows, relations, and goal maps", () => {
    const response = buildGoalsResponse(
      [
        goalRow({
          id: "db-root",
          legacy_id: "goal-career",
          title: "Career",
          goal_map_id: "map-1",
          file_path: "goals/Career/Career.md",
          horizon: "long",
          domain_title: "Career",
          priority: 70,
          clarity: 3,
          progress: null,
          color: "#0284c7",
          sections: {
            summary: "Root summary",
            directions: ["Grow"],
            directionHeading: "中期目标",
            successSignals: ["Signal"],
            actionCandidates: [{ text: "hidden on root", done: false }],
            reviewQuestions: ["Review?"]
          },
          tags: ["goal-network", "goal-domain"]
        }),
        goalRow({
          id: "db-child",
          legacy_id: "goal-career-skill",
          title: "Skill",
          goal_map_id: "map-1",
          file_path: "goals/Career/Skill.md",
          domain_title: "Career",
          priority: 30,
          clarity: 2,
          progress: 40,
          color: "#0284c7",
          map_positions: { root: { x: 1, y: 2 } },
          sections: {
            summary: "Child summary",
            directions: [],
            successSignals: [],
            actionCandidates: [{ text: "Do it", done: false }],
            reviewQuestions: []
          }
        })
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
      "workspace-1",
      [goalMapRow({ id: "map-1", name: "目标网络" })]
    );

    expect(response.workspaceId).toBe("workspace-1");
    expect(response.goalMaps).toEqual([{ id: "map-1", name: "目标网络", sortOrder: 0 }]);
    expect(response.goals).toHaveLength(1);
    expect(response.goals[0].goalMapId).toBe("map-1");
    expect(response.goals[0].children[0].title).toBe("Skill");
    expect(response.goals[0].sections.actionCandidates).toEqual([]);
    expect(response.goals[0].children[0].supports).toEqual(["[[Career]]"]);
    expect(response.graph.edges.map((edge) => edge.type).sort()).toEqual(["parent", "supports"]);
  });
});

describe("SupabaseGoalStore goal maps", () => {
  it("creates and renames goal maps", async () => {
    const client = new FakeSupabaseClient({
      goal_maps: [goalMapRow({ id: "map-1", name: "目标网络", sort_order: 4 })]
    });
    const store = new SupabaseGoalStore(client as any, "workspace-1", "user-1");

    const created = await store.createGoalMap({ name: "  新地图  " });
    expect(created).toEqual({ id: "goal_maps-2", name: "新地图", sortOrder: 5 });

    const renamed = await store.patchGoalMap(created.id, { name: "年度目标" });
    expect(renamed.name).toBe("年度目标");
    expect(client.tables.audit_events.map((row) => row.entity_type)).toEqual(["goal_map", "goal_map"]);
  });

  it("rejects duplicate goal map names", async () => {
    const client = new FakeSupabaseClient({
      goal_maps: [goalMapRow({ id: "map-1", name: "目标网络" })]
    });
    const store = new SupabaseGoalStore(client as any, "workspace-1", "user-1");

    await expect(store.createGoalMap({ name: " 目标网络 " })).rejects.toThrow("Goal map already exists");
  });

  it("deletes a goal map with its goals and relations", async () => {
    const client = new FakeSupabaseClient({
      goal_maps: [goalMapRow({ id: "map-1", name: "目标网络" }), goalMapRow({ id: "map-2", name: "副地图" })],
      goals: [
        goalRow({ id: "db-parent", legacy_id: "goal-parent", title: "Parent", goal_map_id: "map-1" }),
        goalRow({ id: "db-child", legacy_id: "goal-child", title: "Child", goal_map_id: "map-1" }),
        goalRow({ id: "db-other", legacy_id: "goal-other", title: "Other", goal_map_id: "map-2" })
      ],
      goal_relations: [
        { id: "rel-child", workspace_id: "workspace-1", source_goal_id: "db-child", target_goal_id: "db-parent", relation_type: "parent" },
        { id: "rel-cross", workspace_id: "workspace-1", source_goal_id: "db-other", target_goal_id: "db-parent", relation_type: "depends_on" },
        { id: "rel-keep", workspace_id: "workspace-1", source_goal_id: "db-other", target_goal_id: "db-other", relation_type: "depends_on" }
      ]
    });
    const store = new SupabaseGoalStore(client as any, "workspace-1", "user-1");

    await store.deleteGoalMap("map-1");

    expect(client.tables.goal_maps.map((row) => row.id)).toEqual(["map-2"]);
    expect(client.tables.goals.map((row) => row.id)).toEqual(["db-other"]);
    expect(client.tables.goal_relations.map((row) => row.id)).toEqual(["rel-keep"]);
    expect(client.tables.audit_events).toContainEqual(
      expect.objectContaining({
        action: "goal_map.delete",
        entity_type: "goal_map",
        entity_id: "map-1",
        payload: { name: "目标网络", deletedGoalCount: 2 }
      })
    );
  });
});

describe("SupabaseGoalStore goal creation", () => {
  it("requires an existing goal map", async () => {
    const store = new SupabaseGoalStore(new FakeSupabaseClient() as any, "workspace-1", "user-1");

    await expect(store.createGoal({ title: "Skill", goalMapId: "missing", domain: "Career" })).rejects.toThrow("Goal map not found");
  });

  it("rejects parent goals from another map and accepts parents in the same map", async () => {
    const client = new FakeSupabaseClient({
      goal_maps: [goalMapRow({ id: "map-1", name: "目标网络" }), goalMapRow({ id: "map-2", name: "副地图" })],
      goals: [
        goalRow({ id: "db-parent-other", legacy_id: "goal-parent-other", title: "Other Parent", goal_map_id: "map-2" }),
        goalRow({ id: "db-parent", legacy_id: "goal-parent", title: "Parent", goal_map_id: "map-1" })
      ]
    });
    const store = new SupabaseGoalStore(client as any, "workspace-1", "user-1");

    await expect(
      store.createGoal({ title: "Child A", goalMapId: "map-1", parent: "Other Parent", domain: "Career" })
    ).rejects.toThrow("Parent goal not found in current goal map");

    await store.createGoal({ title: "Child B", goalMapId: "map-1", parent: "Parent", domain: "Career", progress: 0 });

    const child = client.tables.goals.find((row) => row.title === "Child B");
    expect(child?.goal_map_id).toBe("map-1");
    expect(client.tables.goal_relations).toContainEqual(
      expect.objectContaining({
        source_goal_id: child?.id,
        target_goal_id: "db-parent",
        relation_type: "parent"
      })
    );
  });
});

describe("SupabaseGoalStore map positions", () => {
  it("sets scoped map positions for multiple goals with one audit event", async () => {
    const client = new FakeSupabaseClient({
      goals: [
        goalRow({
          id: "db-parent",
          legacy_id: "goal-parent",
          title: "Parent",
          map_positions: {
            focus: { x: 300, y: 400 }
          }
        }),
        goalRow({
          id: "db-child",
          legacy_id: "goal-child",
          title: "Child",
          map_positions: {
            "map-2": { x: 700, y: 800 }
          }
        })
      ]
    });
    const store = new SupabaseGoalStore(client as any, "workspace-1", "user-1");

    await store.setGoalMapPositions(
      [
        { id: "goal-parent", position: { x: 100, y: 200 } },
        { id: "goal-child", position: { x: 500, y: 600 } },
        { id: "goal-child", position: { x: 510, y: 610 } }
      ],
      "map-1"
    );

    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0]).toMatchObject({
      name: "set_goal_map_positions",
      args: {
        p_workspace_id: "workspace-1",
        p_actor_user_id: "user-1",
        p_map_context_id: "map-1"
      }
    });
    expect(client.tables.goals.find((row) => row.legacy_id === "goal-parent")?.map_positions).toEqual({
      "map-1": { x: 100, y: 200 },
      focus: { x: 300, y: 400 }
    });
    expect(client.tables.goals.find((row) => row.legacy_id === "goal-child")?.map_positions).toEqual({
      "map-1": { x: 510, y: 610 },
      "map-2": { x: 700, y: 800 }
    });
    expect(client.tables.audit_events).toHaveLength(1);
    expect(client.tables.sync_jobs).toHaveLength(1);
    expect(client.tables.audit_events[0]).toMatchObject({
      action: "goal.map_positions.set",
      payload: {
        ids: ["goal-parent", "goal-child"],
        mapContextId: "map-1",
        updatedCount: 2
      }
    });
  });

  it("clears scoped map positions for multiple goals with one audit event", async () => {
    const client = new FakeSupabaseClient({
      goals: [
        goalRow({
          id: "db-parent",
          legacy_id: "goal-parent",
          title: "Parent",
          map_positions: {
            "map-1": { x: 100, y: 200 },
            focus: { x: 300, y: 400 }
          }
        }),
        goalRow({
          id: "db-child",
          legacy_id: "goal-child",
          title: "Child",
          map_positions: {
            "map-1": { x: 500, y: 600 }
          }
        }),
        goalRow({
          id: "db-other",
          legacy_id: "goal-other",
          title: "Other",
          map_positions: {
            "map-2": { x: 700, y: 800 }
          }
        })
      ]
    });
    const store = new SupabaseGoalStore(client as any, "workspace-1", "user-1");

    await store.clearGoalMapPositions(["goal-parent", "goal-child", "goal-child"], "map-1");

    expect(client.rpcCalls).toHaveLength(1);
    expect(client.rpcCalls[0]).toMatchObject({
      name: "clear_goal_map_positions",
      args: {
        p_workspace_id: "workspace-1",
        p_actor_user_id: "user-1",
        p_map_context_id: "map-1",
        p_ids: ["goal-parent", "goal-child"]
      }
    });
    expect(client.tables.goals.find((row) => row.legacy_id === "goal-parent")?.map_positions).toEqual({
      focus: { x: 300, y: 400 }
    });
    expect(client.tables.goals.find((row) => row.legacy_id === "goal-child")?.map_positions).toBeNull();
    expect(client.tables.goals.find((row) => row.legacy_id === "goal-other")?.map_positions).toEqual({
      "map-2": { x: 700, y: 800 }
    });
    expect(client.tables.audit_events).toHaveLength(1);
    expect(client.tables.sync_jobs).toHaveLength(1);
    expect(client.tables.audit_events[0]).toMatchObject({
      action: "goal.map_positions.clear",
      payload: {
        ids: ["goal-parent", "goal-child"],
        mapContextId: "map-1",
        updatedCount: 2
      }
    });
  });
});
