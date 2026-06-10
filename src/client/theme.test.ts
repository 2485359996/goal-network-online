import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  applyThemePreference,
  nextThemePreference,
  normalizeThemePreference,
  readStoredTheme,
  resolvedTheme,
  THEME_STORAGE_KEY,
  writeStoredTheme
} from "./theme";

function storageWith(value?: string) {
  const values = new Map<string, string>();
  if (value !== undefined) values.set(THEME_STORAGE_KEY, value);
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, nextValue: string) => values.set(key, nextValue))
  };
}

function clientStyles() {
  return readFileSync(new URL("./styles.css", import.meta.url), "utf8");
}

function clientMainSource() {
  return readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
}

describe("theme preference", () => {
  it("defaults unknown values to system", () => {
    expect(normalizeThemePreference(undefined)).toBe("system");
    expect(normalizeThemePreference("unknown")).toBe("system");
  });

  it("cycles through system, light, and dark", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
  });

  it("resolves system from the current media query state", () => {
    expect(resolvedTheme("system", true)).toBe("dark");
    expect(resolvedTheme("system", false)).toBe("light");
    expect(resolvedTheme("light", true)).toBe("light");
    expect(resolvedTheme("dark", false)).toBe("dark");
  });

  it("reads and writes the stored preference", () => {
    const storage = storageWith("dark");

    expect(readStoredTheme(storage)).toBe("dark");
    writeStoredTheme("light", storage);

    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "light");
    expect(readStoredTheme(storage)).toBe("light");
  });

  it("applies resolved theme and original preference to the root element", () => {
    const root = { dataset: {}, style: {} } as HTMLElement;

    applyThemePreference("system", { root, systemPrefersDark: true });

    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.themePreference).toBe("system");
    expect(root.style.colorScheme).toBe("dark");
  });
});

describe("theme styles", () => {
  it("keeps the goalscape center title black in dark mode", () => {
    const styles = clientStyles();

    expect(styles).toMatch(/:root\[data-theme="dark"\]\s+\.goalscape-center-title\s*{\s*fill:\s*#000000;/);
  });

  it("keeps the sunburst center title black in dark mode", () => {
    const styles = clientStyles();

    expect(styles).toMatch(/:root\[data-theme="dark"\]\s+\.sunburst-center-title\s*{\s*fill:\s*#000000;/);
  });

  it("uses theme tokens for the notes and actions drawer colors", () => {
    const styles = clientStyles();

    expect(styles).toMatch(/:root\[data-theme="dark"\]\s*{[\s\S]*--notes-actions-background:\s*rgba\(15,\s*23,\s*42,\s*0\.92\);/);
    expect(styles).toMatch(/\.notes-actions-drawer\s*{[\s\S]*background:\s*var\(--notes-actions-background\);/);
    expect(styles).not.toMatch(/\.detail-panel:has\(\.notes-actions-drawer\)\s+\.notes-actions-drawer\s*{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.96\);/);
  });
});

describe("floating AI assistant", () => {
  it("mounts the AI entry outside the detail panel", () => {
    const source = clientMainSource();

    expect(source).toContain("const floatingAiGoal = useMemo");
    expect(source).toContain("selectedGoalFull ?? (selectedId === mapCenterId ? visibleTree[0] : undefined)");
    expect(source).toContain("<FloatingAiAssistantButton goal={floatingAiGoal}");
    expect(source).not.toContain("onOpenAi");
    expect(source).not.toContain("ai-entry-row");
  });

  it("styles the assistant as a draggable floating control below dialogs", () => {
    const styles = clientStyles();

    expect(styles).toMatch(/\.floating-ai-assistant\s*{[\s\S]*position:\s*fixed;/);
    expect(styles).toMatch(/\.floating-ai-assistant\s*{[\s\S]*z-index:\s*40;/);
    expect(styles).toMatch(/\.floating-ai-assistant\s*{[\s\S]*touch-action:\s*none;/);
    expect(styles).toMatch(/\.dialog-backdrop\s*{[\s\S]*z-index:\s*50;/);
    expect(styles).not.toMatch(/\.ai-entry-row/);
  });
});
