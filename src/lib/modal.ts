// In-app modal controller.
//
// WebView2 suppresses window.prompt, and Tauri's native dialog plugin has no
// text-input dialog. This provides a promise-based in-app prompt/confirm that
// renders as ordinary DOM (so it is immune to WebView2's native-dialog gating)
// and is reused by Insert-Image, the link editor (Ctrl+K), and file-tree CRUD.
//
// A single ModalHost subscribes; calling promptModal/confirmModal before a host
// mounts resolves to null rather than hanging.

export interface ModalButton {
  label: string;
  value: string;
  variant?: "primary" | "danger";
}

export type ModalRequest =
  | {
      kind: "prompt";
      id: number;
      title: string;
      label?: string;
      defaultValue: string;
      placeholder?: string;
      okLabel: string;
      validate?: (value: string) => string | null;
      resolve: (value: string | null) => void;
    }
  | {
      kind: "confirm";
      id: number;
      title: string;
      message: string;
      buttons: ModalButton[];
      resolve: (value: string | null) => void;
    };

type Listener = (req: ModalRequest | null) => void;

let listener: Listener | null = null;
let counter = 0;

export function _subscribeModal(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** Ask for a line of text. Resolves with the trimmed value, or null if cancelled. */
export function promptModal(opts: {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  okLabel?: string;
  validate?: (value: string) => string | null;
}): Promise<string | null> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(null);
      return;
    }
    listener({
      kind: "prompt",
      id: ++counter,
      title: opts.title,
      label: opts.label,
      defaultValue: opts.defaultValue ?? "",
      placeholder: opts.placeholder,
      okLabel: opts.okLabel ?? "OK",
      validate: opts.validate,
      resolve,
    });
  });
}

/** Multi-button confirm. Resolves with the chosen button's value, or null if dismissed. */
export function confirmModal(opts: {
  title: string;
  message: string;
  buttons: ModalButton[];
}): Promise<string | null> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(null);
      return;
    }
    listener({
      kind: "confirm",
      id: ++counter,
      title: opts.title,
      message: opts.message,
      buttons: opts.buttons,
      resolve,
    });
  });
}
