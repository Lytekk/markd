import { useState, useCallback, useEffect, useRef } from "react";

export const THEMES = [
  { id: "day", name: "Day" },
  { id: "night", name: "Night" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const STORAGE_KEY = "markd-theme";

// Window during which a global color transition is active on a day/night swap.
// Kept just above the CSS transition (0.3s) so the fade isn't cut off, then the
// class is removed so the transition never lags ordinary hovers/UI afterward.
const THEME_TRANSITION_MS = 350;

function getInitialTheme(): ThemeId {
  const stored = localStorage.getItem(STORAGE_KEY);
  const migrated = stored === "markd" ? "day" : stored;
  if (migrated !== stored && stored !== null) localStorage.setItem(STORAGE_KEY, migrated!);
  if (migrated && THEMES.some((t) => t.id === migrated)) return migrated as ThemeId;
  return "day";
}

export function useTheme() {
  const [activeTheme, setActiveTheme] = useState<ThemeId>(getInitialTheme);
  const firstRun = useRef(true);

  // Apply data-theme on mount and on change. The very first application is
  // instant (no fade in from the default palette on load); subsequent swaps add
  // a transient `.theme-transition` class so colors cross-fade instead of
  // snapping (jarring to the eyes), then drop it so it can't lag later UI.
  useEffect(() => {
    const html = document.documentElement;
    if (firstRun.current) {
      firstRun.current = false;
      html.dataset.theme = activeTheme;
      return;
    }
    html.classList.add("theme-transition");
    html.dataset.theme = activeTheme;
    const timer = window.setTimeout(
      () => html.classList.remove("theme-transition"),
      THEME_TRANSITION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [activeTheme]);

  const switchTheme = useCallback((id: ThemeId) => {
    setActiveTheme(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  return { activeTheme, switchTheme, themes: THEMES };
}
