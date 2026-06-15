import { describe, expect, it } from "vitest";
import { deleteGoalWarningText } from "./main";

describe("deleteGoalWarningText", () => {
  it("describes deleting goal data without mentioning Markdown", () => {
    const warning = deleteGoalWarningText(0);

    expect(warning).toBe("这会直接删除目标数据。此操作无法在应用内撤销。");
    expect(warning).not.toMatch(/markdown/i);
  });

  it("includes the child goal count without mentioning Markdown", () => {
    const warning = deleteGoalWarningText(3);

    expect(warning).toBe("这会直接删除目标数据，并一并删除 3 个子目标。此操作无法在应用内撤销。");
    expect(warning).not.toMatch(/markdown/i);
  });
});
