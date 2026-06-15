import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function clientMainSource() {
  return readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
}

function clientStyles() {
  return readFileSync(new URL("./styles.css", import.meta.url), "utf8");
}

describe("goal detail autosave", () => {
  it("removes the manual save button from the goal detail panel", () => {
    const source = clientMainSource();

    expect(source).not.toContain("compact-save-button");
    expect(source).not.toContain("form={editFormId}");
    expect(source).not.toContain("<Save />");
    expect(source).not.toMatch(/\bSave,\s*\n/);
  });

  it("debounces dirty goal detail drafts into the existing save queue", () => {
    const source = clientMainSource();

    expect(source).toContain("const GOAL_EDIT_AUTOSAVE_DELAY_MS = 700");
    expect(source).toContain("const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)");
    expect(source).toContain("window.setTimeout(() => {");
    expect(source).toContain("queuePendingEditSave({ silent: true })");
    expect(source).toContain("if (autoSaveTimerRef.current !== null) clearTimeout(autoSaveTimerRef.current)");
  });

  it("does not keep obsolete save-button styles", () => {
    const styles = clientStyles();

    expect(styles).not.toContain(".compact-save-button");
  });
});
