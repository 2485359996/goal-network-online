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

function clientMotionSource() {
  return readFileSync(new URL("./motion.ts", import.meta.url), "utf8");
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

    expect(styles).toMatch(/:root\[data-theme="dark"\]\s*{[\s\S]*--notes-actions-background:\s*rgba\(11,\s*16,\s*32,\s*0\.92\);/);
    expect(styles).toMatch(/\.notes-actions-drawer\s*{[\s\S]*background:\s*var\(--notes-actions-background\);/);
    expect(styles).not.toMatch(/\.detail-panel:has\(\.notes-actions-drawer\)\s+\.notes-actions-drawer\s*{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.96\);/);
  });

  it("anchors the dark theme to the midnight observatory palette", () => {
    const styles = clientStyles();
    const darkRoot = styles.match(/:root\[data-theme="dark"\]\s*{([\s\S]*?)\n}/)?.[1] ?? "";

    expect(darkRoot).toContain("--bg: #090f1c;");
    expect(darkRoot).toContain("--surface: #101827;");
    expect(darkRoot).toContain("--surface-raised: #172235;");
    expect(darkRoot).toContain("--ink: #f4f7fb;");
    expect(darkRoot).toContain("--accent: #6bd3c1;");
    expect(darkRoot).toContain("--accent-strong: #9be7dc;");
    expect(darkRoot).toContain("--accent-soft: rgba(107, 211, 193, 0.14);");
    expect(darkRoot).toContain("--dream-bg: #090f1c;");
    expect(darkRoot).toContain("--core-bloom: rgba(107, 211, 193, 0.32);");
  });

  it("turns off decorative goal map background layers in dark mode", () => {
    const styles = clientStyles();

    expect(styles).toMatch(/:root\[data-theme="dark"\]\s+\.map-pane\s*{[\s\S]*background:\s*var\(--bg\);[\s\S]*box-shadow:\s*0 22px 44px -30px rgba\(0,\s*0,\s*0,\s*0\.72\);[\s\S]*backdrop-filter:\s*none;/);
    expect(styles).toMatch(/:root\[data-theme="dark"\]\s+\.map-pane::before\s*{\s*opacity:\s*0;\s*}/);
    expect(styles).toMatch(/:root\[data-theme="dark"\]\s+\.map-canvas::after\s*{[\s\S]*opacity:\s*0;/);
    expect(styles).toMatch(/:root\[data-theme="dark"\]\s+\.starfield\s*{\s*opacity:\s*0;\s*animation:\s*none;\s*}/);
    expect(styles).toMatch(/:root\[data-theme="dark"\]\s+\.starfield::before\s*{\s*animation:\s*none;\s*}/);
    expect(styles).toMatch(/:root\[data-theme="dark"\]\s+\.sunburst-sky-wash,\s*\n:root\[data-theme="dark"\]\s+\.sunburst-background-ring\s*{\s*opacity:\s*0;\s*}/);
  });

  it("aligns the app header with the workspace edges across breakpoints", () => {
    const styles = clientStyles();
    const sharedHeaderWidth = "width: calc(100% - var(--app-inline-padding) - var(--app-inline-padding));";

    expect(styles).toMatch(/\.app-shell\s*{[\s\S]*--app-inline-padding:\s*clamp\(18px,\s*3vw,\s*40px\);/);
    expect(styles).toMatch(/\.app-header\s*{[\s\S]*width:\s*calc\(100% - var\(--app-inline-padding\) - var\(--app-inline-padding\)\);/);
    expect(styles).toMatch(/\.map-workspace\s*{[\s\S]*--workspace-padding:\s*16px var\(--app-inline-padding\) 28px;/);
    expect(styles).toMatch(/@media \(max-width: 1120px\)\s*{[\s\S]*?\.app-shell\s*{[\s\S]*?--app-inline-padding:\s*clamp\(16px,\s*4vw,\s*28px\);[\s\S]*?\.map-workspace\s*{[\s\S]*?--workspace-padding:\s*18px var\(--app-inline-padding\) 28px;/);
    expect(styles).toMatch(/@media \(max-width: 680px\)\s*{[\s\S]*?\.app-shell\s*{[\s\S]*?--app-inline-padding:\s*12px;[\s\S]*?\.map-workspace\s*{[\s\S]*?--workspace-padding:\s*var\(--app-inline-padding\);/);
    expect(styles).toMatch(/@media \(min-width: 1121px\)\s*{[\s\S]*?\.app-shell\s*{[\s\S]*?--app-inline-padding:\s*40px;[\s\S]*?\.map-workspace\s*{[\s\S]*?--workspace-padding:\s*16px var\(--app-inline-padding\) 32px;/);
    expect(styles.match(new RegExp(sharedHeaderWidth.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(4);
  });
});

describe("presentation labels", () => {
  it("uses planet and sundial names for goal map modes", () => {
    const source = clientMainSource();

    expect(source).toContain("<span>目标星球</span>");
    expect(source).toContain("<span>目标日晷</span>");
    expect(source).toContain("{centerDisplayTitle}目标日晷");
    expect(source).not.toContain("目标圆球");
    expect(source).not.toContain("目标旭日图");
  });
});

describe("pane resizer", () => {
  it("keeps the touch hit area large enough for mobile dragging", () => {
    const styles = clientStyles();

    expect(styles).toMatch(/\.pane-resizer\s*{[\s\S]*touch-action:\s*none;/);
    expect(styles).toMatch(/@media \(pointer: coarse\)\s*{[\s\S]*?\.pane-resizer\.vertical\s*{[\s\S]*?width:\s*44px;[\s\S]*?min-width:\s*44px;/);
    expect(styles).toMatch(/@media \(pointer: coarse\)\s*{[\s\S]*?\.pane-resizer\.horizontal\s*{[\s\S]*?height:\s*44px;[\s\S]*?min-height:\s*44px;/);
    expect(styles).toMatch(/@media \(max-width: 1120px\) and \(pointer: coarse\)\s*{[\s\S]*?\.pane-resizer\.vertical,\s*\n\s*\.pane-resizer\.horizontal\s*{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*44px;[\s\S]*?min-height:\s*44px;[\s\S]*?cursor:\s*row-resize;/);
  });

  it("captures and filters the active pointer while resizing panels", () => {
    const source = clientMainSource();

    expect(source).toContain("const pointerId = event.pointerId;");
    expect(source).toContain("resizer.setPointerCapture(pointerId);");
    expect(source).toContain("moveEvent.pointerId !== pointerId");
    expect(source).toContain("upEvent.pointerId !== pointerId");
    expect(source).toContain("resizer.hasPointerCapture(pointerId)");
    expect(source).toContain("resizer.releasePointerCapture(pointerId)");
  });
});

describe("visual motion contracts", () => {
  it("keeps motion easing centralized and free of disallowed easing words", () => {
    const motionSource = clientMotionSource();
    const styles = clientStyles();

    expect(motionSource).toContain("EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]");
    expect(motionSource).toContain('type: "tween"');
    for (const source of [motionSource, styles]) {
      expect(source).not.toContain('type: "spring"');
      expect(source).not.toContain("bounce");
      expect(source).not.toContain("elastic");
    }
  });

  it("keeps animated banners horizontally centered", () => {
    const motionSource = clientMotionSource();

    expect(motionSource).toContain('initial: { opacity: 0, x: "-50%"');
    expect(motionSource).toContain('animate: { opacity: 1, x: "-50%"');
    expect(motionSource).toContain('exit: { opacity: 0, x: "-50%"');
  });

  it("keeps light theme atmosphere tokens available", () => {
    const styles = clientStyles();
    const lightRoot = styles.match(/:root\s*{([\s\S]*?)\n}/)?.[1] ?? "";
    const tokens = [
      "--starfield-dot",
      "--starfield-dot-soft",
      "--starfield-haze",
      "--nebula-cyan",
      "--nebula-violet",
      "--nebula-beam",
      "--map-pane-atmosphere",
      "--map-pane-atmosphere-opacity",
      "--starfield-opacity",
      "--starfield-beam-opacity",
      "--starfield-after-opacity",
      "--starfield-vignette",
      "--noise-opacity"
    ];

    for (const token of tokens) {
      expect(lightRoot).toContain(token);
    }
  });

  it("uses tokenized layers for the goal map atmosphere", () => {
    const styles = clientStyles();

    expect(styles).toMatch(/\.map-pane::before\s*{[\s\S]*background:\s*var\(--map-pane-atmosphere\);[\s\S]*opacity:\s*var\(--map-pane-atmosphere-opacity\);/);
    expect(styles).toMatch(/\.starfield\s*{[\s\S]*opacity:\s*var\(--starfield-opacity\);/);
    expect(styles).toMatch(/\.starfield::before\s*{[\s\S]*opacity:\s*var\(--starfield-beam-opacity\);/);
    expect(styles).toMatch(/\.starfield::after\s*{[\s\S]*var\(--starfield-vignette\);[\s\S]*opacity:\s*var\(--starfield-after-opacity\);/);
  });

  it("keeps new ambient animation periods slow and reduced-motion aware", () => {
    const styles = clientStyles();
    const reducedMotionBlock = styles.match(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\r?\n}\r?\n\r?\n@keyframes starfield-drift/)?.[1] ?? "";

    expect(styles).toMatch(/\.starfield\s*{[\s\S]*animation:\s*starfield-drift 56s linear infinite;/);
    expect(styles).toMatch(/\.starfield::before\s*{[\s\S]*animation:\s*starfield-beam-hue 12s cubic-bezier\(0\.16, 1, 0\.3, 1\) infinite;/);
    expect(styles).toMatch(/\.goal-starlight-core\s*{[\s\S]*animation:\s*core-breathe 4\.8s cubic-bezier\(0\.16, 1, 0\.3, 1\) infinite;/);
    expect(styles).toMatch(/\.goalscape-bridge-glow\s*{[\s\S]*animation:\s*bridge-glow-breathe 5\.8s cubic-bezier\(0\.16, 1, 0\.3, 1\) infinite;/);
    for (const selector of [".starfield", ".starfield::before", ".starfield::after", ".goal-starlight-core", ".goalscape-bridge-glow"]) {
      expect(reducedMotionBlock).toContain(selector);
    }
  });

  it("anchors liquid surface polish to the rendered progress surface class", () => {
    const styles = clientStyles();
    const progressSurface = styles.match(/\.goalscape-node-progress-surface\s*{[\s\S]*?\n}/)?.[0] ?? "";
    const inactiveLiquidSurface = styles.match(/\.goalscape-node-liquid-surface\s*{[\s\S]*?\n}/)?.[0] ?? "";

    expect(progressSurface).toContain('stroke: url("#goalscape-liquid-specular")');
    expect(styles).toMatch(/\.goalscape-node\.active\s+\.goalscape-node-progress-surface\s*{[\s\S]*stroke-width:\s*2\.7;/);
    expect(inactiveLiquidSurface).not.toContain("goalscape-liquid-specular");
  });

  it("uses explicit tween layout transitions for DOM list items", () => {
    const source = clientMainSource();
    const motionSource = clientMotionSource();

    expect(motionSource).toContain("layout: { type: \"tween\", ease: EASE, duration: 0.3 }");
    expect(source).toContain("transition={listItemTransition}");
    expect(source).toContain("useListItemMotion");
  });

  it("keeps goalscape node selection as a quiet focus state without burst animations", () => {
    const styles = clientStyles();
    const activeHalo = styles.match(/\.goalscape-node\.active\s+\.goalscape-node-halo\s*{[\s\S]*?\n}/)?.[0] ?? "";
    const activeCore = styles.match(/\.goalscape-node\.active\s+\.goal-starlight-core\s*{[\s\S]*?\n}/)?.[0] ?? "";

    expect(styles).not.toContain("node-select-burst");
    expect(styles).not.toContain("node-core-burst");
    expect(activeHalo).not.toContain("animation:");
    expect(activeCore).not.toContain("node-core-burst");
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

  it("starts the draggable assistant from the bottom-right default instead of stale storage", () => {
    const source = clientMainSource();

    expect(source).toContain("setPosition(defaultFloatingAiAssistantPosition(size));");
    expect(source).not.toContain("setPosition(readFloatingAiAssistantPosition(size) ?? defaultFloatingAiAssistantPosition(size));");
    expect(source).not.toContain("readFloatingAiAssistantPosition");
    expect(source).not.toContain("writeFloatingAiAssistantPosition");
  });

  it("names the sphere presentation as the goal planet", () => {
    const source = clientMainSource();

    expect(source).toContain("<span>目标星球</span>");
    expect(source).not.toContain("目标圆球");
  });

  it("styles the AI thinking state as quiet motion with reduced-motion support", () => {
    const styles = clientStyles();
    const reducedMotionBlock = styles.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n}/)?.[0] ?? "";

    expect(styles).toMatch(/\.ai-thinking-message\s*{[\s\S]*border-color:/);
    expect(styles).toContain("@keyframes ai-thinking-breathe");
    expect(styles).toContain("@keyframes ai-thinking-scan");
    expect(reducedMotionBlock).toContain(".ai-thinking-message::after");
    expect(reducedMotionBlock).toContain(".ai-thinking-orbit");
  });
});
