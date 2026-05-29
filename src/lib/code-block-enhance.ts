// Code-block enhancements: a floating toolbar (language label + copy button)
// rendered per code block via a ProseMirror widget decoration.
//
// Rendered as plain DOM through a widget decoration so it never becomes part of
// the document content — it is not serialized to markdown and not printed. The
// decoration set is rebuilt only on docChanged (mirrors search-and-replace),
// which keeps the copy button's transient "Copied!" state alive across
// selection-only transactions while still reading the live code text on copy.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Node as PmNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const codeBlockEnhanceKey = new PluginKey("codeBlockEnhance");

/** How long the button shows feedback after a copy before reverting to "Copy". */
const COPIED_RESET_MS = 1400;

/**
 * Write text to the clipboard. Prefers the async Clipboard API (available in
 * WebView2's secure context) and falls back to a hidden-textarea execCommand
 * for environments where it is missing or blocked. Resolves to whether it worked.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the execCommand fallback
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    // Accessed via cast: the typed signature is deprecated, and the method may
    // be absent (jsdom / locked-down webviews) — treat absence as failure.
    const exec = (document as unknown as { execCommand?: (commandId: string) => boolean })
      .execCommand;
    const ok = typeof exec === "function" ? exec.call(document, "copy") : false;
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Build the floating toolbar for one code block. `getText` is called at click
 * time so the copy always reflects the current code, even if the closure was
 * created before the latest edit.
 */
export function createCodeBlockToolbar(
  language: string | null,
  getText: () => string,
): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "markd-code-toolbar";
  bar.setAttribute("contenteditable", "false");

  const lang = document.createElement("span");
  lang.className = "markd-code-lang";
  lang.textContent = language && language !== "plaintext" ? language : "text";
  bar.appendChild(lang);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "markd-code-copy";
  btn.textContent = "Copy";
  // Keep the editor selection intact when the button is pressed.
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    const ok = await copyToClipboard(getText());
    btn.textContent = ok ? "Copied!" : "Failed";
    btn.classList.toggle("copied", ok);
    window.setTimeout(() => {
      btn.textContent = "Copy";
      btn.classList.remove("copied");
    }, COPIED_RESET_MS);
  });
  bar.appendChild(btn);

  return bar;
}

/** Pure: one widget decoration (the toolbar) per code block in the document. */
export function buildCodeBlockDecorations(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return undefined;
    decorations.push(
      Decoration.widget(
        pos + 1,
        () => createCodeBlockToolbar(node.attrs.language ?? null, () => node.textContent),
        { side: -1, key: `code-toolbar-${pos}`, ignoreSelection: true },
      ),
    );
    return false; // code blocks contain only text — nothing to descend into
  });
  return DecorationSet.create(doc, decorations);
}

export const CodeBlockEnhance = Extension.create({
  name: "codeBlockEnhance",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: codeBlockEnhanceKey,
        state: {
          init: (_config, { doc }) => buildCodeBlockDecorations(doc),
          apply(tr, old) {
            return tr.docChanged ? buildCodeBlockDecorations(tr.doc) : old;
          },
        },
        props: {
          decorations(state) {
            return codeBlockEnhanceKey.getState(state);
          },
        },
      }),
    ];
  },
});
