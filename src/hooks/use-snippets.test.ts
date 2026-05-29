import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSnippets } from "./use-snippets";
import { DEFAULT_SNIPPETS, loadSnippets } from "@/lib/snippets";

beforeEach(() => localStorage.clear());

describe("useSnippets", () => {
  it("initializes from the defaults on first run", () => {
    const { result } = renderHook(() => useSnippets());
    expect(result.current.snippets).toEqual(DEFAULT_SNIPPETS);
  });

  it("adds a snippet with a generated id and persists it", () => {
    const { result } = renderHook(() => useSnippets());
    act(() => result.current.addSnippet({ trigger: "td", label: "TODO", body: "TODO: $1" }));
    const added = result.current.snippets.find((s) => s.trigger === "td");
    expect(added).toBeTruthy();
    expect(added!.id).toBeTruthy();
    expect(loadSnippets().some((s) => s.trigger === "td")).toBe(true);
  });

  it("updates a snippet in place and persists", () => {
    const { result } = renderHook(() => useSnippets());
    const id = result.current.snippets[0]!.id;
    act(() => result.current.updateSnippet(id, { label: "Renamed" }));
    expect(result.current.snippets.find((s) => s.id === id)!.label).toBe("Renamed");
    expect(loadSnippets().find((s) => s.id === id)!.label).toBe("Renamed");
  });

  it("deletes a snippet and persists", () => {
    const { result } = renderHook(() => useSnippets());
    const id = result.current.snippets[0]!.id;
    act(() => result.current.deleteSnippet(id));
    expect(result.current.snippets.some((s) => s.id === id)).toBe(false);
    expect(loadSnippets().some((s) => s.id === id)).toBe(false);
  });

  it("restores the defaults on reset", () => {
    const { result } = renderHook(() => useSnippets());
    act(() => result.current.deleteSnippet(result.current.snippets[0]!.id));
    act(() => result.current.resetSnippets());
    expect(result.current.snippets).toEqual(DEFAULT_SNIPPETS);
    expect(loadSnippets()).toEqual(DEFAULT_SNIPPETS);
  });

  it("supports successive mutations without stale state", () => {
    const { result } = renderHook(() => useSnippets());
    const start = result.current.snippets.length;
    act(() => {
      result.current.addSnippet({ trigger: "a", label: "A", body: "a" });
      result.current.addSnippet({ trigger: "b", label: "B", body: "b" });
    });
    expect(result.current.snippets.length).toBe(start + 2);
  });
});
