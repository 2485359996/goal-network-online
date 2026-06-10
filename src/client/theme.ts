export const THEME_STORAGE_KEY = "goal-network-theme";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

type ApplyThemeOptions = {
  root?: HTMLElement;
  systemPrefersDark?: boolean;
};

const themePreferences: ThemePreference[] = ["system", "light", "dark"];

export function safeLocalStorage(): ThemeStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function normalizeThemePreference(value: unknown): ThemePreference {
  return themePreferences.includes(value as ThemePreference) ? (value as ThemePreference) : "system";
}

export function nextThemePreference(current: ThemePreference): ThemePreference {
  const currentIndex = themePreferences.indexOf(current);
  return themePreferences[(currentIndex + 1) % themePreferences.length];
}

export function resolvedTheme(preference: ThemePreference, systemPrefersDark = false): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function readStoredTheme(storage = safeLocalStorage()): ThemePreference {
  if (!storage) return "system";

  try {
    return normalizeThemePreference(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function writeStoredTheme(preference: ThemePreference, storage = safeLocalStorage()) {
  if (!storage) return;

  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable in private mode or locked-down embedded views.
  }
}

export function applyThemePreference(preference: ThemePreference, options: ApplyThemeOptions = {}) {
  const root = options.root ?? globalThis.document?.documentElement;
  if (!root) return;

  const nextTheme = resolvedTheme(preference, options.systemPrefersDark);
  root.dataset.theme = nextTheme;
  root.dataset.themePreference = preference;
  root.style.colorScheme = nextTheme;
}
