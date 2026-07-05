import { Extension, type Editor } from "@tiptap/core";
import { buildSearchRegex } from "@/lib/text-search";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Node as PmNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface SearchResult {
  from: number;
  to: number;
}

export interface SearchState {
  results: SearchResult[];
  currentIndex: number;
  searchTerm: string;
  caseSensitive: boolean;
  useRegex: boolean;
  wholeWord: boolean;
  regexError: string | null;
}

export interface SearchOptions {
  searchTerm: string;
  caseSensitive: boolean;
  useRegex: boolean;
  wholeWord: boolean;
}

const searchPluginKey = new PluginKey("searchAndReplace");

function scrollToMatch(editor: { view: { coordsAtPos: (pos: number) => { top: number; bottom: number; left: number; right: number }; domAtPos: (pos: number) => { node: Node; offset: number }; dom: HTMLElement } }, match: SearchResult) {
  const coords = editor.view.coordsAtPos(match.from);
  const scrollEl = editor.view.dom.closest('.markd-editor-scroll');
  if (scrollEl) {
    const rect = scrollEl.getBoundingClientRect();
    scrollEl.scrollTo({
      top: coords.top - rect.top + scrollEl.scrollTop - rect.height / 2,
      behavior: 'smooth',
    });
    return;
  }
  const dom = editor.view.domAtPos(match.from);
  const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function findMatches(
  doc: PmNode,
  opts: SearchOptions,
): { results: SearchResult[]; error: string | null } {
  if (!opts.searchTerm) return { results: [], error: null };

  const chars: string[] = [];
  const posMap: number[] = [];
  let prevEnd = -1;

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const t = node.text;
      if (prevEnd >= 0 && pos > prevEnd) {
        chars.push("\n");
        posMap.push(-1);
      }
      for (let i = 0; i < t.length; i++) {
        chars.push(t.charAt(i));
        posMap.push(pos + i);
      }
      prevEnd = pos + t.length;
    }
  });

  const haystack = chars.join("");
  const results: SearchResult[] = [];

  // Shared with the source-mode textarea backend — one builder, one meaning
  // of "a match" across both modes (text-search.ts).
  const { regex, error } = buildSearchRegex(opts);
  if (!regex) return { results: [], error };

  let match: RegExpExecArray | null;
  while ((match = regex.exec(haystack)) !== null) {
    const idx = match.index;
    const len = match[0].length;
    if (len === 0) {
      regex.lastIndex++;
      continue;
    }
    const from = posMap[idx]!;
    const to = posMap[idx + len - 1]!;
    if (from >= 0 && to >= 0) {
      results.push({ from, to: to + 1 });
    }
  }

  return { results, error: null };
}

function createDecorations(
  doc: PmNode,
  results: SearchResult[],
  currentIndex: number,
): DecorationSet {
  const decorations: Decoration[] = [];

  results.forEach((result, i) => {
    const className =
      i === currentIndex
        ? "markd-search-highlight markd-search-current"
        : "markd-search-highlight";

    decorations.push(
      Decoration.inline(result.from, result.to, { class: className }),
    );
  });

  return DecorationSet.create(doc, decorations);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    searchAndReplace: {
      setSearchTerm: (term: string) => ReturnType;
      setCaseSensitive: (caseSensitive: boolean) => ReturnType;
      setUseRegex: (useRegex: boolean) => ReturnType;
      setWholeWord: (wholeWord: boolean) => ReturnType;
      nextMatch: () => ReturnType;
      previousMatch: () => ReturnType;
      replaceCurrentMatch: (replacement: string) => ReturnType;
      replaceAllMatches: (replacement: string) => ReturnType;
      clearDecorations: () => ReturnType;
      clearSearch: () => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
    };
  }
}

export const SearchAndReplace = Extension.create({
  name: "searchAndReplace",

  addStorage() {
    return {
      results: [] as SearchResult[],
      currentIndex: 0,
      searchTerm: "",
      caseSensitive: false,
      useRegex: false,
      wholeWord: false,
      regexError: null,
    } satisfies SearchState;
  },

  addCommands() {
    const getOpts = (storage: SearchState): SearchOptions => ({
      searchTerm: storage.searchTerm,
      caseSensitive: storage.caseSensitive,
      useRegex: storage.useRegex,
      wholeWord: storage.wholeWord,
    });

    const runSearch = (editor: Editor, storage: SearchState) => {
      const { results, error } = findMatches(editor.state.doc, getOpts(storage));
      storage.results = results;
      storage.regexError = error;
      storage.currentIndex = results.length > 0 ? 0 : -1;
      editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, true));
      const first = results[0];
      if (first) {
        scrollToMatch(editor, first);
      }
    };

    return {
      setSearchTerm:
        (term: string) =>
        ({ editor }) => {
          editor.storage.searchAndReplace.searchTerm = term;
          runSearch(editor, editor.storage.searchAndReplace as SearchState);
          return true;
        },

      setCaseSensitive:
        (caseSensitive: boolean) =>
        ({ editor }) => {
          editor.storage.searchAndReplace.caseSensitive = caseSensitive;
          runSearch(editor, editor.storage.searchAndReplace as SearchState);
          return true;
        },

      setUseRegex:
        (useRegex: boolean) =>
        ({ editor }: { editor: Editor }) => {
          editor.storage.searchAndReplace.useRegex = useRegex;
          runSearch(editor, editor.storage.searchAndReplace as SearchState);
          return true;
        },

      setWholeWord:
        (wholeWord: boolean) =>
        ({ editor }: { editor: Editor }) => {
          editor.storage.searchAndReplace.wholeWord = wholeWord;
          runSearch(editor, editor.storage.searchAndReplace as SearchState);
          return true;
        },

      nextMatch:
        () =>
        ({ editor }) => {
          const storage = editor.storage.searchAndReplace as SearchState;
          if (storage.results.length === 0) return false;
          storage.currentIndex =
            (storage.currentIndex + 1) % storage.results.length;
          editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, true));
          const match = storage.results[storage.currentIndex];
          if (match) {
            editor.commands.setTextSelection(match.from);
            scrollToMatch(editor, match);
          }
          return true;
        },

      previousMatch:
        () =>
        ({ editor }) => {
          const storage = editor.storage.searchAndReplace as SearchState;
          if (storage.results.length === 0) return false;
          storage.currentIndex =
            (storage.currentIndex - 1 + storage.results.length) %
            storage.results.length;
          editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, true));
          const match = storage.results[storage.currentIndex];
          if (match) {
            editor.commands.setTextSelection(match.from);
            scrollToMatch(editor, match);
          }
          return true;
        },

      replaceCurrentMatch:
        (replacement: string) =>
        ({ editor }) => {
          const storage = editor.storage.searchAndReplace as SearchState;
          if (storage.results.length === 0 || storage.currentIndex < 0)
            return false;
          const match = storage.results[storage.currentIndex];
          if (!match) return false;

          editor
            .chain()
            .focus()
            .insertContentAt({ from: match.from, to: match.to }, replacement)
            .run();

          const { results: newResults } = findMatches(
            editor.state.doc,
            getOpts(storage),
          );
          storage.results = newResults;
          storage.currentIndex =
            newResults.length > 0
              ? Math.min(storage.currentIndex, newResults.length - 1)
              : -1;
          editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, true));
          return true;
        },

      replaceAllMatches:
        (replacement: string) =>
        ({ editor }) => {
          const storage = editor.storage.searchAndReplace as SearchState;
          if (storage.results.length === 0) return false;

          const sorted = [...storage.results].sort(
            (a, b) => b.from - a.from,
          );
          const { tr } = editor.state;
          for (const match of sorted) {
            tr.insertText(replacement, match.from, match.to);
          }
          editor.view.dispatch(tr);

          storage.results = [];
          storage.currentIndex = -1;
          editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, true));
          return true;
        },

      clearDecorations:
        () =>
        ({ editor }: { editor: Editor }) => {
          const storage = editor.storage.searchAndReplace as SearchState;
          storage.results = [];
          storage.currentIndex = -1;
          editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, true));
          return true;
        },

      clearSearch:
        () =>
        ({ editor }) => {
          const storage = editor.storage.searchAndReplace as SearchState;
          storage.searchTerm = "";
          storage.results = [];
          storage.currentIndex = -1;
          storage.regexError = null;
          editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, true));
          return true;
        },

      findNext:
        () =>
        ({ editor }: { editor: Editor }) => {
          const storage = editor.storage.searchAndReplace as SearchState;
          if (storage.results.length === 0 && storage.searchTerm) {
            runSearch(editor, storage);
          }
          if (storage.results.length === 0) return false;
          storage.currentIndex =
            (storage.currentIndex + 1) % storage.results.length;
          editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, true));
          const match = storage.results[storage.currentIndex];
          if (match) {
            editor.commands.setTextSelection(match.from);
            scrollToMatch(editor, match);
          }
          return true;
        },

      findPrevious:
        () =>
        ({ editor }: { editor: Editor }) => {
          const storage = editor.storage.searchAndReplace as SearchState;
          if (storage.results.length === 0 && storage.searchTerm) {
            runSearch(editor, storage);
          }
          if (storage.results.length === 0) return false;
          storage.currentIndex =
            (storage.currentIndex - 1 + storage.results.length) %
            storage.results.length;
          editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, true));
          const match = storage.results[storage.currentIndex];
          if (match) {
            editor.commands.setTextSelection(match.from);
            scrollToMatch(editor, match);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const extensionThis = this;

    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, _oldState) {
            if (tr.getMeta(searchPluginKey)) {
              const storage = extensionThis.storage as SearchState;
              return createDecorations(
                tr.doc,
                storage.results,
                storage.currentIndex,
              );
            }
            // If the document changed, recompute
            if (tr.docChanged) {
              const storage = extensionThis.storage as SearchState;
              if (storage.searchTerm) {
                const { results } = findMatches(tr.doc, {
                  searchTerm: storage.searchTerm,
                  caseSensitive: storage.caseSensitive,
                  useRegex: storage.useRegex,
                  wholeWord: storage.wholeWord,
                });
                storage.results = results;
                if (
                  storage.currentIndex >= results.length
                ) {
                  storage.currentIndex = results.length > 0 ? 0 : -1;
                }
                return createDecorations(
                  tr.doc,
                  results,
                  storage.currentIndex,
                );
              }
            }
            return _oldState;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
