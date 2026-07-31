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

  // Apply data-theme on mount and on change. Subsequent swaps add a transient
  // `.theme-transition` class so colors cross-fade instead of snapping (jarring
  // to the eyes), then drop it so it can't lag later UI.
  //
  // The very first application is instant ONLY when the document already boots
  // on the right theme. index.html deliberately boots dark to keep startup from
  // flashing white, and records the real target in data-boot-theme — so a
  // day-theme user arrives here mid-journey and gets the cross-fade instead,
  // which is the difference between a polished hand-off and a snap to white.
  useEffect(() => {
    const html = document.documentElement;
    let frame = 0;
    let timer = 0;

    const applyWithCrossFade = () => {
      html.classList.add("theme-transition");
      html.dataset.theme = activeTheme;
      timer = window.setTimeout(
        () => html.classList.remove("theme-transition"),
        THEME_TRANSITION_MS,
      );
    };

    if (firstRun.current) {
      firstRun.current = false;
      const bootTarget = html.dataset.bootTheme;
      const bootedOn = html.dataset.theme;
      delete html.dataset.bootTheme;
      if (!bootTarget || bootedOn === activeTheme) {
        // Either the document already boots on the right theme, or the boot
        // script never ran at all (a future CSP, a storage failure, or any host
        // that is not index.html — the tests included). Apply instantly: there
        // is no painted "from" state to fade from, and inventing one would show
        // a transition the user did not cause.
        html.dataset.theme = activeTheme;
        return;
      }
      // Boot theme is not the user's, so this IS a transition. Wait one frame
      // first: a cross-fade needs its "from" state to have been painted, and
      // mount effects run before the browser has committed a paint of anything
      // React just rendered. Without this it would snap.
      frame = requestAnimationFrame(applyWithCrossFade);
    } else {
      applyWithCrossFade();
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
    };
  }, [activeTheme]);

  const switchTheme = useCallback((id: ThemeId) => {
    setActiveTheme(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  return { activeTheme, switchTheme, themes: THEMES };
}
