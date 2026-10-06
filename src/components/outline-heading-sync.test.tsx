import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getExtensions } from "@/lib/editor-extensions";
import { OutlinePanel } from "./OutlinePanel";

let editor: Editor;
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => window.setTimeout(() => fn(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  editor = new Editor({ extensions: getExtensions({ getFileDir: () => "" }), content: "<h1>One</h1><p>body</p><h2>Two</h2>" });
});
afterEach(() => { cleanup(); editor?.destroy(); if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll); else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function view(source = false, showOutline = true) {
  return <><div className="markd-editor-scroll"><EditorContent editor={editor} /></div>
    {showOutline && <OutlinePanel editor={editor} sourceHeadings={source ? [{ id: "src-0", pos: 0, level: 1, text: "Source" }] : null} />}</>;
}

it("uses the same active heading for the sidebar and rendered document on scroll and click", () => {
  const { container } = render(view());
  const scroller = container.querySelector<HTMLElement>(".markd-editor-scroll")!;
  Object.defineProperties(scroller, { clientHeight: { value: 300 }, scrollHeight: { value: 1200 } });
  expect(container.querySelector(".markd-outline-item.active .markd-outline-text")?.textContent).toBe("One");
  expect(container.querySelector(".markd-outline-heading-active")?.textContent).toBe("One");
  act(() => { scroller.scrollTop = 900; fireEvent.scroll(scroller); vi.advanceTimersByTime(1); });
  expect(container.querySelector(".markd-outline-item.active .markd-outline-text")?.textContent).toBe("Two");
  expect(container.querySelectorAll(".markd-outline-heading-active")).toHaveLength(1);
  expect(container.querySelector(".markd-outline-heading-active")?.textContent).toBe("Two");
  fireEvent.click(container.querySelectorAll(".markd-outline-item")[0]!);
  expect(container.querySelector(".markd-outline-heading-active")?.textContent).toBe("One");
  act(() => { vi.advanceTimersByTime(4000); });
  expect(container.querySelector(".markd-outline-heading-active")?.textContent).toBe("One");
});

it("clears the rendered highlight in source mode and when the outline unmounts", () => {
  const mounted = render(view());
  expect(mounted.container.querySelector(".markd-outline-heading-active")).not.toBeNull();
  mounted.rerender(view(true));
  expect(mounted.container.querySelector(".markd-outline-heading-active")).toBeNull();
  mounted.rerender(view());
  expect(mounted.container.querySelector(".markd-outline-heading-active")).not.toBeNull();
  mounted.rerender(view(false, false));
  expect(mounted.container.querySelector(".markd-outline-heading-active")).toBeNull();
});

it("follows source scrolling and clamps both ends", () => {
  const heads = [{ id: "a", pos: 0, level: 1, text: "First" }, { id: "b", pos: 20, level: 1, text: "Last" }];
  const { container } = render(<><textarea className="markd-source-textarea" defaultValue={"# First\nbody\n\n# Last"} /><OutlinePanel editor={editor} sourceHeadings={heads} /></>);
  const ta = container.querySelector("textarea")!;
  Object.defineProperties(ta, { clientHeight: { value: 300 }, scrollHeight: { value: 1200 } });
  act(() => { ta.scrollTop = 900; fireEvent.scroll(ta); vi.advanceTimersByTime(1); });
  expect(container.querySelector(".markd-outline-item.active")?.textContent).toContain("Last");
  act(() => { ta.scrollTop = 0; fireEvent.scroll(ta); vi.advanceTimersByTime(1); });
  expect(container.querySelector(".markd-outline-item.active")?.textContent).toContain("First");
});
