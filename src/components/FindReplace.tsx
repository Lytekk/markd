import { useState, useEffect, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type { SearchState } from "@/lib/search-and-replace";

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
  editor: Editor | null;
  showReplace: boolean;
  onClose: () => void;
  initialState?: FindUiState;
  onStateChange?: (state: FindUiState) => void;
}

export function FindReplace({
  editor,
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

  // Update search on term change and notify App for F3 reuse
  useEffect(() => {
    if (!editor) return;
    editor.commands.setSearchTerm(searchTerm);
    if (searchTerm) {
      window.dispatchEvent(new CustomEvent("markd:search-term", { detail: searchTerm }));
    }
  }, [editor, searchTerm]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.setCaseSensitive(caseSensitive);
  }, [editor, caseSensitive]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.setUseRegex(useRegex);
  }, [editor, useRegex]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.setWholeWord(wholeWord);
  }, [editor, wholeWord]);

  // Re-render when document changes so match count stays fresh
  const [, setSearchVersion] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) setSearchVersion((v) => v + 1);
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

  // Clear decorations on unmount (preserve search term for F3 reuse)
  useEffect(() => {
    return () => {
      editor?.commands.clearDecorations();
    };
  }, [editor]);

  const storage = editor?.storage.searchAndReplace as SearchState | undefined;
  const matchCount = storage?.results.length ?? 0;
  const currentIndex = storage?.currentIndex ?? -1;
  const regexError = storage?.regexError ?? null;

  const handleNext = useCallback(() => {
    editor?.commands.nextMatch();
  }, [editor]);

  const handlePrevious = useCallback(() => {
    editor?.commands.previousMatch();
  }, [editor]);

  const handleReplace = useCallback(() => {
    editor?.commands.replaceCurrentMatch(replaceTerm);
  }, [editor, replaceTerm]);

  const handleReplaceAll = useCallback(() => {
    editor?.commands.replaceAllMatches(replaceTerm);
  }, [editor, replaceTerm]);

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

  if (!editor) return null;

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
