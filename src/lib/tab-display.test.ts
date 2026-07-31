import { describe, it, expect } from "vitest";
import { tabDisplayInfo, orderTabsByMru, switcherOrder } from "./tab-display";
import type { FileTab } from "@/hooks/use-file-tabs";

const tab = (over: Partial<FileTab> & { id: string }): FileTab => ({
  fileName: "Untitled",
  filePath: null,
  content: "",
  isDirty: false,
  savedContent: "",
  scrollTop: 0,
  isHydrated: true,
  ...over,
});

describe("tabDisplayInfo", () => {
  it("leaves parentDir null when fileNames are unique", () => {
    const tabs = [
      tab({ id: "a", fileName: "notes.md", filePath: "/home/me/notes.md" }),
      tab({ id: "b", fileName: "todo.md", filePath: "/home/me/work/todo.md" }),
    ];
    const info = tabDisplayInfo(tabs);
    expect(info.get("a")!.parentDir).toBeNull();
    expect(info.get("b")!.parentDir).toBeNull();
  });

  it("disambiguates duplicate fileNames with the parent dir segment", () => {
    const tabs = [
      tab({ id: "a", fileName: "index.md", filePath: "/home/me/docs/index.md" }),
      tab({ id: "b", fileName: "index.md", filePath: "/home/me/blog/index.md" }),
    ];
    const info = tabDisplayInfo(tabs);
    expect(info.get("a")!.parentDir).toBe("docs");
    expect(info.get("b")!.parentDir).toBe("blog");
  });

  it("normalizes Windows backslash paths for the parent dir", () => {
    const tabs = [
      tab({ id: "a", fileName: "index.md", filePath: "C:\\Users\\me\\docs\\index.md" }),
      tab({ id: "b", fileName: "index.md", filePath: "C:\\Users\\me\\blog\\index.md" }),
    ];
    const info = tabDisplayInfo(tabs);
    expect(info.get("a")!.parentDir).toBe("docs");
    expect(info.get("b")!.parentDir).toBe("blog");
  });

  it("keeps parentDir null for an untitled tab even when its name is duplicated", () => {
    const tabs = [
      tab({ id: "a", fileName: "Untitled", filePath: null }),
      tab({ id: "b", fileName: "Untitled", filePath: null }),
    ];
    const info = tabDisplayInfo(tabs);
    expect(info.get("a")!.parentDir).toBeNull();
    expect(info.get("b")!.parentDir).toBeNull();
  });

  it("passes through isDirty and fileName", () => {
    const info = tabDisplayInfo([tab({ id: "a", fileName: "x.md", isDirty: true })]);
    expect(info.get("a")).toMatchObject({ fileName: "x.md", isDirty: true });
  });
});

describe("orderTabsByMru", () => {
  const tabs = [tab({ id: "a" }), tab({ id: "b" }), tab({ id: "c" })];

  it("orders tabs by the MRU id list (most-recent first)", () => {
    expect(orderTabsByMru(tabs, ["c", "a", "b"]).map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("appends tabs absent from the MRU list in tab order", () => {
    // only 'b' is known to MRU; 'a' and 'c' fall to the end in tab order
    expect(orderTabsByMru(tabs, ["b"]).map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("ignores stale MRU ids that no longer correspond to a tab", () => {
    expect(orderTabsByMru(tabs, ["gone", "b", "a"]).map((t) => t.id)).toEqual(["b", "a", "c"]);
  });
});

describe("switcherOrder", () => {
  const tabs = [tab({ id: "a" }), tab({ id: "b" }), tab({ id: "c" }), tab({ id: "d" })];

  it("swaps the current and previous tab so a bare open+Enter toggles to the previous", () => {
    // MRU most-recent-first: current='a', previous='b' → list leads with 'b'
    expect(switcherOrder(tabs, ["a", "b", "c", "d"]).map((t) => t.id)).toEqual(["b", "a", "c", "d"]);
  });

  it("returns the single tab unchanged when fewer than two", () => {
    expect(switcherOrder([tab({ id: "a" })], ["a"]).map((t) => t.id)).toEqual(["a"]);
  });

  it("returns an empty array for no tabs", () => {
    expect(switcherOrder([], [])).toEqual([]);
  });
});
