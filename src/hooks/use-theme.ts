import { useState, useCallback, useEffect, useRef } from "react";

export const THEMES = [
  { id: "day", name: "Day" },
  { id: "night", name: "Night" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const STORAGE_KEY = "markd-theme";

// Window during which a global color transition is active on a day/night swap.
// Kept just above the CSS transition (0.5s) so the fade isn't cut off, then the
// class is removed so the transition never lags ordinary hovers/UI afterward.
const THEME_TRANSITION_MS = 600;

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

  // Apply data-theme on mount and on change. Subsequent swaps use one native
  // root snapshot where available, or a transient bounded fallback class, so
  // colors cross-fade without turning a large document into thousands of
  // independent animations.
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
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        html.dataset.theme = activeTheme;
        return;
      }

      // WebView2 and current WebKit can cross-fade one compositor snapshot of
      // the app. This stays smooth even for documents with thousands of table
      // cells, where assigning a CSS transition to every descendant stalls the
      // main thread instead of animating it.
      if (typeof document.startViewTransition === "function") {
        document.startViewTransition(() => {
          html.dataset.theme = activeTheme;
        });
        return;
      }

      // Older webviews use the bounded CSS fallback in base.css.
      html.classList.add("theme-transition");
      // Install and resolve the transition rules while the old palette is
      // still active. Changing data-theme in this same rendering step lets the
      // browser coalesce both style changes, which turns the intended fade into
      // a snap. The next frame is the ownership boundary between old and new.
      frame = requestAnimationFrame(() => {
        void html.offsetWidth;
        html.dataset.theme = activeTheme;
        timer = window.setTimeout(
          () => html.classList.remove("theme-transition"),
          THEME_TRANSITION_MS,
        );
      });
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
      // Boot theme is not the user's, so this IS a transition. The shared path
      // retains the dark frame until the transition is installed and painted.
      applyWithCrossFade();
    } else {
      applyWithCrossFade();
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
      html.classList.remove("theme-transition");
    };
  }, [activeTheme]);

  const switchTheme = useCallback((id: ThemeId) => {
    setActiveTheme(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  return { activeTheme, switchTheme, themes: THEMES };
}
