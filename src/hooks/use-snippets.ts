// Reactive snippet store backing the manager + picker. Wraps the pure
// load/save in snippets.ts with React state; a ref mirror keeps successive
// mutations off stale closures (same pattern as use-file-tabs) and lets each
// mutator persist exactly once (no side effects inside a setState updater).

import { useState, useCallback, useRef } from "react";
import { loadSnippets, saveSnippets, DEFAULT_SNIPPETS, type Snippet } from "@/lib/snippets";

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the non-crypto id */
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useSnippets() {
  const [snippets, setSnippets] = useState<Snippet[]>(loadSnippets);
  const ref = useRef(snippets);
  ref.current = snippets;

  const persist = useCallback((next: Snippet[]) => {
    ref.current = next;
    setSnippets(next);
    saveSnippets(next);
  }, []);

  const addSnippet = useCallback(
    (draft: Omit<Snippet, "id">) => persist([...ref.current, { ...draft, id: newId() }]),
    [persist],
  );

  const updateSnippet = useCallback(
    (id: string, patch: Partial<Omit<Snippet, "id">>) =>
      persist(ref.current.map((s) => (s.id === id ? { ...s, ...patch } : s))),
    [persist],
  );

  const deleteSnippet = useCallback(
    (id: string) => persist(ref.current.filter((s) => s.id !== id)),
    [persist],
  );

  const resetSnippets = useCallback(
    () => persist(DEFAULT_SNIPPETS.map((s) => ({ ...s }))),
    [persist],
  );

  return { snippets, addSnippet, updateSnippet, deleteSnippet, resetSnippets };
}
