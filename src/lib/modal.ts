// In-app modal controller.
//
// All user-facing notices, choices, and text prompts render as ordinary DOM so
// Markd has one consistent surface and WebView2 cannot suppress them. Native
// Tauri dialogs are reserved for OS-owned file/folder/save pickers and print.
//
// A single ModalHost subscribes; calling a modal before a host mounts resolves
// rather than hanging. Normal requests are queued by ModalHost. The sole
// replaceable request class is an unattended automatic update offer.

export type ModalPolicy = "normal" | "replaceable";
export type ModalTone = "info" | "warning" | "error";

export interface ModalButton {
  label: string;
  value: string;
  variant?: "primary" | "danger";
}

export type ModalRequest =
  | {
      kind: "prompt";
      id: number;
      policy: "normal";
      title: string;
      label?: string;
      defaultValue: string;
      placeholder?: string;
      okLabel: string;
      validate?: (value: string) => string | null;
      /** Optional ownership gate checked immediately before the request renders. */
      isCurrent?: () => boolean;
      resolve: (value: string | null) => void;
    }
  | {
      kind: "confirm";
      id: number;
      policy: ModalPolicy;
      title: string;
      message: string;
      buttons: ModalButton[];
      tone?: ModalTone;
      /** Optional ownership gate checked immediately before the request renders. */
      isCurrent?: () => boolean;
      /** Button value triggered by Enter and given initial focus (the safe default). */
      defaultValue: string;
      resolve: (value: string | null) => void;
    };

type Listener = (req: ModalRequest | null) => void;

let listener: Listener | null = null;
let counter = 0;
const pendingRequestIds = new Set<number>();

/** Synchronous guard for app-wide shortcuts while any modal promise is pending. */
export function isModalOpen(): boolean {
  return (
    pendingRequestIds.size > 0 ||
    (typeof document !== "undefined" && document.querySelector('[aria-modal="true"]') !== null)
  );
}

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
  isCurrent?: () => boolean;
}): Promise<string | null> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(null);
      return;
    }
    const id = ++counter;
    pendingRequestIds.add(id);
    listener({
      kind: "prompt",
      id,
      policy: "normal",
      title: opts.title,
      label: opts.label,
      defaultValue: opts.defaultValue ?? "",
      placeholder: opts.placeholder,
      okLabel: opts.okLabel ?? "OK",
      validate: opts.validate,
      isCurrent: opts.isCurrent,
      resolve: (value) => {
        pendingRequestIds.delete(id);
        resolve(value);
      },
    });
  });
}

/** Multi-button confirm. Resolves with the chosen button's value, or null if dismissed. */
export function confirmModal(opts: {
  title: string;
  message: string;
  buttons: ModalButton[];
  defaultValue: string;
  tone?: ModalTone;
  policy?: ModalPolicy;
  isCurrent?: () => boolean;
}): Promise<string | null> {
  if (!opts.buttons.some((button) => button.value === opts.defaultValue)) {
    console.error(
      `[modal] defaultValue "${opts.defaultValue}" does not match a button in "${opts.title}"`,
    );
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    if (!listener) {
      resolve(null);
      return;
    }
    const id = ++counter;
    pendingRequestIds.add(id);
    listener({
      kind: "confirm",
      id,
      policy: opts.policy ?? "normal",
      title: opts.title,
      message: opts.message,
      buttons: opts.buttons,
      defaultValue: opts.defaultValue,
      tone: opts.tone,
      isCurrent: opts.isCurrent,
      resolve: (value) => {
        pendingRequestIds.delete(id);
        resolve(value);
      },
    });
  });
}

/** One-button in-app notice. File/folder/print pickers remain native. */
export async function messageModal(
  message: string,
  opts: { title?: string; kind?: ModalTone } = {},
): Promise<void> {
  await confirmModal({
    title: opts.title ?? "Markd",
    message,
    buttons: [{ label: "OK", value: "ok", variant: "primary" }],
    defaultValue: "ok",
    tone: opts.kind,
  });
}
