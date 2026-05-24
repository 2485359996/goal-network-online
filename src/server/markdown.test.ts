import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VaultService } from "./markdown";

let root = "";

async function write(relativePath: string, content: string) {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "goal-network-test-"));
  await Promise.all(["目标", "行动", "计划", "复盘", "进展", "模板"].map((folder) => fs.mkdir(path.join(root, folder), { recursive: true })));
  await write(
    "目标/职业发展/职业发展.md",
    `---
type: goal
id: goal-职业发展
status: active
horizon: long
domain: "[[职业发展]]"
parent: ""
clarity: 2
priority: 5
progress: 40
supports: []
depends_on:
  - "[[当前交付]]"
conflicts_with: []
last_reviewed: ""
last_progress: ""
next_check_in: ""
tags:
  - goal-network
---
# 职业发展

> [!summary] 目标定义
> 获得更好的职业机会。

## 中期目标
- [[当前交付]]

## 成功信号
- 稳定交付。

## 复盘问题
- 本周是否推进？

## 行动候选
- [ ] 不应作为一级目标行动
`
  );
  await write(
    "目标/职业发展/当前交付.md",
    `---
type: goal
id: goal-职业发展-当前交付
status: active
horizon: medium
domain: "[[职业发展]]"
parent: "[[职业发展]]"
clarity: 1
priority: 5
supports:
  - "[[职业发展]]"
depends_on: []
conflicts_with: []
last_reviewed: ""
last_progress: ""
next_check_in: ""
tags:
  - goal-network
---
# 当前交付

> [!summary] 目标定义
> 完成当前实习交付。

## 子方向
- 任务完成

## 成功信号
- 有可见交付物。

## 行动候选
- [ ] 记录本周交付 goal:: [[当前交付]]

## 复盘问题
- 哪些工作形成资产？
`
  );
  await write(
    "行动/2026-W21 下周行动.md",
    `---
type: weekly-actions
week: 2026-W21
source_review: ""
tags:
  - goal-network/action
---
# 2026-W21 下周行动

## 本周焦点
- 验证目标网络

## 行动清单
- [ ] 记录本周交付 goal:: [[当前交付]] due:: 2026-05-24

## 周末检查
- 完成了什么：
`
  );
});

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("VaultService markdown operations", () => {
  it("parses goals, sections, and parent graph", async () => {
    const service = new VaultService(root);
    const response = await service.readGoals();

    expect(response.flatGoals).toHaveLength(2);
    expect(response.goals[0].title).toBe("职业发展");
    expect(response.goals[0].progress).toBeUndefined();
    expect(response.goals[0].sections.actionCandidates).toEqual([]);
    expect(response.goals[0].children[0].title).toBe("当前交付");
    expect(response.flatGoals.map((goal) => goal.filePath).sort()).toEqual([
      "目标/职业发展/当前交付.md",
      "目标/职业发展/职业发展.md"
    ]);
    expect(response.flatGoals.find((goal) => goal.title === "当前交付")?.sections.actionCandidates[0]).toEqual({
      text: "记录本周交付",
      done: false
    });
    expect(response.graph.edges.some((edge) => edge.type === "parent")).toBe(true);
  });

  it("does not persist progress or action candidates on primary root goals", async () => {
    const service = new VaultService(root);
    const before = await service.readGoals();
    const primary = before.flatGoals.find((goal) => goal.title === "职业发展");
    expect(primary).toBeDefined();

    await service.patchGoal(primary!.id, {
      progress: 80,
      actionCandidates: ["不应写入一级目标"],
      summary: "获得更好的职业机会。"
    });

    const content = await fs.readFile(path.join(root, primary!.filePath), "utf8");
    expect(content).not.toMatch(/^progress:/m);
    expect(content).not.toContain("## 行动候选");
    expect(content).not.toContain("不应写入一级目标");
  });

  it("does not persist goal date fields when writing goals", async () => {
    const service = new VaultService(root);
    const before = await service.readGoals();
    const child = before.flatGoals.find((goal) => goal.parent);
    expect(child).toBeDefined();

    await service.patchGoal(child!.id, { summary: "No goal dates" });

    const patchedContent = await fs.readFile(path.join(root, child!.filePath), "utf8");
    expect(patchedContent).not.toMatch(/^due:/m);
    expect(patchedContent).not.toMatch(/^next_check_in:/m);

    const result = await service.createGoal({
      title: "No Date Goal",
      domain: child!.domain,
      parent: child!.title
    });
    const createdContent = await fs.readFile(path.join(root, result.filePath), "utf8");
    expect(createdContent).not.toMatch(/^due:/m);
    expect(createdContent).not.toMatch(/^next_check_in:/m);
  });

  it("deletes goal files and removes relation references", async () => {
    const service = new VaultService(root);
    const before = await service.readGoals();
    const child = before.flatGoals.find((goal) => goal.parent);
    const parent = before.flatGoals.find((goal) => goal.title === "职业发展");
    expect(child).toBeDefined();
    expect(parent).toBeDefined();

    await service.deleteGoal(child!.id);

    await expect(fs.access(path.join(root, child!.filePath))).rejects.toMatchObject({ code: "ENOENT" });
    const after = await service.readGoals();
    expect(after.flatGoals).toHaveLength(1);
    expect(after.flatGoals[0].depends_on).toEqual([]);
    expect(after.flatGoals[0].sections.directions).toEqual([]);

    const parentContent = await fs.readFile(path.join(root, parent!.filePath), "utf8");
    expect(parentContent).not.toContain("[[当前交付]]");
  });

  it("updates goal ids when renaming a goal", async () => {
    const service = new VaultService(root);
    const before = await service.readGoals();
    const parent = before.flatGoals.find((goal) => goal.title === "职业发展");
    expect(parent).toBeDefined();

    await service.patchGoal(parent!.id, { title: "职业方向" });

    const after = await service.readGoals();
    const renamedParent = after.flatGoals.find((goal) => goal.title === "职业方向");
    const child = after.flatGoals.find((goal) => goal.title === "当前交付");

    expect(renamedParent?.id).toBe("goal-职业方向");
    expect(child?.parent).toBe("[[职业方向]]");
    expect(child?.id).toBe("goal-职业方向-当前交付");

    const parentContent = await fs.readFile(path.join(root, "目标/职业方向/职业方向.md"), "utf8");
    const childContent = await fs.readFile(path.join(root, "目标/职业方向/当前交付.md"), "utf8");
    expect(parentContent).toContain("id: goal-职业方向");
    expect(childContent).toContain("id: goal-职业方向-当前交付");
  });

  it("creates third-level goal files inside parent folders", async () => {
    const service = new VaultService(root);

    const result = await service.createGoal({
      title: "简历优化",
      domain: "职业发展",
      parent: "当前交付"
    });

    expect(result.filePath).toBe("目标/职业发展/当前交付/简历优化.md");
    await expect(fs.access(path.join(root, result.filePath))).resolves.toBeUndefined();
  });

  it("moves goal files when changing domain", async () => {
    const service = new VaultService(root);
    const before = await service.readGoals();
    const child = before.flatGoals.find((goal) => goal.title === "当前交付");
    expect(child).toBeDefined();

    const result = await service.patchGoal(child!.id, { domain: "个人成长" });

    expect(result.filePath).toBe("目标/个人成长/当前交付.md");
    await expect(fs.access(path.join(root, "目标/职业发展/当前交付.md"))).rejects.toMatchObject({ code: "ENOENT" });
    const content = await fs.readFile(path.join(root, result.filePath), "utf8");
    expect(content).toMatch(/domain: ['"]\[\[个人成长\]\]['"]/);
  });

  it("removes action goal metadata from target files", async () => {
    const service = new VaultService(root);
    const before = await service.readGoals();
    const child = before.flatGoals.find((goal) => goal.title === "当前交付");
    expect(child?.sections.actionCandidates).toEqual([{ text: "记录本周交付", done: false }]);

    await service.patchGoal(child!.id, { actionCandidates: ["整理交付清单"] });

    const content = await fs.readFile(path.join(root, child!.filePath), "utf8");
    expect(content).toContain("- [ ] 整理交付清单");
    expect(content).not.toContain("goal:: [[当前交付]]");
    const after = await service.readGoals();
    expect(after.flatGoals.find((goal) => goal.id === child!.id)?.sections.actionCandidates).toEqual([
      { text: "整理交付清单", done: false }
    ]);
  });

  it("preserves checked goal action candidates", async () => {
    const service = new VaultService(root);
    const before = await service.readGoals();
    const child = before.flatGoals.find((goal) => goal.title === "当前交付");

    await service.patchGoal(child!.id, { actionCandidates: [{ text: "完成复盘", done: true }] });

    const content = await fs.readFile(path.join(root, child!.filePath), "utf8");
    expect(content).toContain("- [x] 完成复盘");
    const after = await service.readGoals();
    expect(after.flatGoals.find((goal) => goal.id === child!.id)?.sections.actionCandidates).toEqual([
      { text: "完成复盘", done: true }
    ]);
  });

  it("adds stable ids when patching legacy weekly actions", async () => {
    const service = new VaultService(root);
    const before = await service.readCurrentActions("2026-W21");
    expect(before.actions[0].id).toBe("action-2026-W21-001");
    expect(before.actions[0].hasStableId).toBe(false);

    await service.patchAction("action-2026-W21-001", { done: true }, "2026-W21");
    const content = await fs.readFile(path.join(root, "行动/2026-W21 下周行动.md"), "utf8");

    expect(content).toContain("- [x] 记录本周交付 id:: action-2026-W21-001 goal:: [[当前交付]] due:: 2026-05-24");
  });

  it("creates web-ui records with durable ids", async () => {
    const service = new VaultService(root);
    const result = await service.createRecord({
      type: "progress-log",
      goals: ["当前交付"],
      summary: "完成了一次交付记录"
    });

    const content = await fs.readFile(path.join(root, result.filePath), "utf8");
    expect(content).toContain("id: record-");
    expect(content).toContain("source: web-ui");
    expect(content).toContain("[[当前交付]]");
  });
});
