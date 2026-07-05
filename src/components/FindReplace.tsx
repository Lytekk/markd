import { useState, useEffect, useRef, useCallback } from "react";
import type { SearchBackend } from "@/lib/search-backend";

/**
 * The find/replace panel's full UI state. App.tsx keeps one per tab
 * (session-only) so reopening Ctrl+F/Ctrl+H recalls what was last typed
 * for THAT tab; the panel is keyed by tab id and re-initializes from it.
 */
export interface FindUiState {
  searchTerm: string;
  replaceTerm: string;
  caseSensitive: boolean;
  useRegex: boolean;
  wholeWord: boolean;
}

interface FindReplaceProps {
  /** Where matches live: the PM editor (rendered) or the textarea (source).
   * The panel is mode-agnostic — see search-backend.ts. */
  backend: SearchBackend | null;
  showReplace: boolean;
  onClose: () => void;
  initialState?: FindUiState;
  onStateChange?: (state: FindUiState) => void;
}

export function FindReplace({
  backend,
  showReplace,
  onClose,
  initialState,
  onStateChange,
}: FindReplaceProps) {
  const [searchTerm, setSearchTerm] = useState(initialState?.searchTerm ?? "");
  const [replaceTerm, setReplaceTerm] = useState(initialState?.replaceTerm ?? "");
  const [caseSensitive, setCaseSensitive] = useState(initialState?.caseSensitive ?? false);
  const [useRegex, setUseRegex] = useState(initialState?.useRegex ?? false);
  const [wholeWord, setWholeWord] = useState(initialState?.wholeWord ?? false);
  const [replaceVisible, setReplaceVisible] = useState(showReplace);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Report the full UI state upward on every change (ref'd so a re-rendered
  // parent callback can't re-trigger the effect).
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  useEffect(() => {
    onStateChangeRef.current?.({ searchTerm, replaceTerm, caseSensitive, useRegex, wholeWord });
  }, [searchTerm, replaceTerm, caseSensitive, useRegex, wholeWord]);

  // Sync showReplace prop
  useEffect(() => {
    setReplaceVisible(showReplace);
  }, [showReplace]);

  // Focus search input on mount and on Ctrl+F re-press
  useEffect(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleFindFocus = () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener("markd:find-focus", handleFindFocus);
    return () => window.removeEventListener("markd:find-focus", handleFindFocus);
  }, []);

  // Ctrl+F3 with the panel already open pushes the word under the caret in —
  // the keyed remount path only reads initialState on mount.
  useEffect(() => {
    const handleSeed = (e: Event) => {
      const term = (e as CustomEvent<string>).detail;
      if (typeof term === "string" && term) setSearchTerm(term);
    };
    window.addEventListener("markd:find-seed", handleSeed);
    return () => window.removeEventListener("markd:find-seed", handleSeed);
  }, []);

  // One effect drives the backend for term + options (it diffs internally,
  // so the cost matches the old per-option command effects). The search-term
  // event keeps App's lastSearchTermRef fresh for F3 reuse.
  useEffect(() => {
    if (!backend) return;
    backend.apply({ searchTerm, caseSensitive, useRegex, wholeWord });
    // Meta transactions never re-render this panel — bump so the count reads
    // the post-apply state now…
    setSearchVersion((v) => v + 1);
    // …and refresh once next frame: a mount-time apply can land inside the
    // editor-view attach window (verified live — decorations only stick after
    // the next tick when the panel mounts in the same commit as the editor).
    const raf = requestAnimationFrame(() => {
      backend.refresh();
      setSearchVersion((v) => v + 1);
    });
    if (searchTerm) {
      window.dispatchEvent(new CustomEvent("markd:search-term", { detail: searchTerm }));
    }
    return () => cancelAnimationFrame(raf);
  }, [backend, searchTerm, caseSensitive, useRegex, wholeWord]);

  // Re-render when the buffer changes under us so the match count stays fresh
  const [, setSearchVersion] = useState(0);
  useEffect(() => {
    if (!backend) return;
    return backend.subscribe(() => setSearchVersion((v) => v + 1));
  }, [backend]);

  // Clear highlights on unmount (the backend preserves the term for F3 reuse)
  useEffect(() => {
    return () => {
      backend?.clear();
    };
  }, [backend]);

  const view = backend?.getState() ?? { count: 0, currentIndex: -1, error: null };
  const matchCount = view.count;
  const currentIndex = view.currentIndex;
  const regexError = view.error;

  const handleNext = useCallback(() => {
    backend?.next();
  }, [backend]);

  const handlePrevious = useCallback(() => {
    backend?.prev();
  }, [backend]);

  const handleReplace = useCallback(() => {
    backend?.replace(replaceTerm);
  }, [backend, replaceTerm]);

  const handleReplaceAll = useCallback(() => {
    backend?.replaceAll(replaceTerm);
  }, [backend, replaceTerm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          handlePrevious();
        } else {
          handleNext();
        }
      }
    },
    [onClose, handleNext, handlePrevious],
  );

  if (!backend) return null;

  return (
    <div className="markd-find-replace" role="search" aria-label="Find and replace" onKeyDown={handleKeyDown}>
      <div className="markd-find-row">
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Find..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className={`markd-find-input ${useRegex && regexError ? "markd-find-input-error" : ""}`}
          aria-invalid={useRegex && regexError ? true : undefined}
        />
        <span className="markd-find-count" aria-live="polite">
          {matchCount > 0
            ? `${currentIndex + 1} of ${matchCount}`
            : searchTerm
              ? "No results"
              : ""}
        </span>
        <button
          onClick={() => setCaseSensitive((c) => !c)}
          className={`markd-find-btn ${caseSensitive ? "active" : ""}`}
          title="Case Sensitive"
          aria-pressed={caseSensitive}
        >
          Aa
        </button>
        <button
          onClick={() => setUseRegex((r) => !r)}
          className={`markd-find-btn ${useRegex ? "active" : ""}`}
          title="Regular Expression"
          aria-label="Regular expression toggle"
          aria-pressed={useRegex}
        >
          .*
        </button>
        <button
          onClick={() => setWholeWord((w) => !w)}
          className={`markd-find-btn ${wholeWord ? "active" : ""}`}
          title="Whole Word (ASCII boundaries)"
          aria-label="Whole word toggle"
          aria-pressed={wholeWord}
        >
          W
        </button>
        <button onClick={handlePrevious} className="markd-find-btn" title="Previous (Shift+Enter)">
          &#x25B2;
        </button>
        <button onClick={handleNext} className="markd-find-btn" title="Next (Enter)">
          &#x25BC;
        </button>
        <button
          onClick={() => setReplaceVisible((v) => !v)}
          className={`markd-find-btn ${replaceVisible ? "active" : ""}`}
          title="Toggle Replace"
        >
          &#x21C4;
        </button>
        <button onClick={onClose} className="markd-find-btn" title="Close (Escape)">
          &#x2715;
        </button>
      </div>
      {replaceVisible && (
        <div className="markd-find-row">
          <input
            type="text"
            placeholder="Replace..."
            value={replaceTerm}
            onChange={(e) => setReplaceTerm(e.target.value)}
            className="markd-find-input"
          />
          <button onClick={handleReplace} className="markd-find-btn" title="Replace">
            Replace
          </button>
          <button onClick={handleReplaceAll} className="markd-find-btn" title="Replace All">
            All
          </button>
        </div>
      )}
    </div>
  );
}
