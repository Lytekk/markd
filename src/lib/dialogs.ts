// Native dialog helpers.
//
// WebView2 silently suppresses window.confirm/alert/prompt — they return falsy
// without ever showing UI. That broke the tab-close save guards, the
// external-modification reload prompt, and the About box. These helpers route
// through @tauri-apps/plugin-dialog (Win32, immune to WebView2 focus-gating) in
// the packaged app, and fall back to the window.* equivalents only in the
// browser dev server where there is no Tauri bridge.

import { isTauri } from "./file-system";

export type DialogKind = "info" | "warning" | "error";

export async function askDialog(
  message: string,
  opts: { title?: string; kind?: DialogKind; okLabel?: string; cancelLabel?: string } = {},
): Promise<boolean> {
  if (!isTauri()) return window.confirm(message);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(message, opts);
}

export async function messageDialog(
  message: string,
  opts: { title?: string; kind?: DialogKind } = {},
): Promise<void> {
  if (!isTauri()) {
    window.alert(message);
    return;
  }
  const { message: showMessage } = await import("@tauri-apps/plugin-dialog");
  await showMessage(message, opts);
}
