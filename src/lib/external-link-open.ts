// Open links in the system browser on Ctrl/Cmd-click.
//
// The Link extension runs with openOnClick:false so a plain click never
// navigates the editor's webview away from the app. This extension restores
// "open the link" as an explicit modifier-click, routed to the OS browser via
// the Tauri opener plugin (with a window.open fallback for the dev server).

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { isTauri } from "@/lib/file-system";

/** Resolve the href to open for a click event, or null if it shouldn't open. */
export function linkHrefForOpen(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  target: EventTarget | null;
}): string | null {
  if (!e.ctrlKey && !e.metaKey) return null; // plain click just moves the caret
  const el = e.target as Element | null;
  const anchor = el?.closest?.("a") ?? null;
  const href = anchor?.getAttribute("href") ?? null;
  return href || null;
}

/** Open `href` in the system browser (Tauri) or a new tab (dev-server fallback). */
export async function openExternal(href: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
  } else if (typeof window !== "undefined") {
    window.open(href, "_blank", "noopener");
  }
}

export const ExternalLinkOpen = Extension.create({
  name: "externalLinkOpen",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("externalLinkOpen"),
        props: {
          handleDOMEvents: {
            click: (_view, event) => {
              const href = linkHrefForOpen(event);
              if (!href) return false;
              event.preventDefault();
              void openExternal(href);
              return true;
            },
          },
        },
      }),
    ];
  },
});
