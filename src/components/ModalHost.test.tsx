import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { StrictMode, useEffect, useRef } from "react";
import { ModalHost } from "./ModalHost";
import { promptModal, confirmModal, messageModal } from "@/lib/modal";

/**
 * Open a modal inside act(): promptModal/confirmModal synchronously push the
 * request into ModalHost state, which React requires to be act()-wrapped.
 */
function openModal<T>(open: () => Promise<T>): Promise<T> {
  let p!: Promise<T>;
  act(() => {
    p = open();
  });
  return p;
}

describe("ModalHost", () => {
  it("renders a prompt and resolves with the typed value on OK", async () => {
    render(<ModalHost />);
    const p = openModal(() => promptModal({ title: "Image URL", okLabel: "Insert" }));
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "https://x/y.png" } });
    fireEvent.click(screen.getByText("Insert"));
    await expect(p).resolves.toBe("https://x/y.png");
  });

  it("resolves null when cancelled", async () => {
    render(<ModalHost />);
    const p = openModal(() => promptModal({ title: "URL" }));
    await screen.findByRole("textbox");
    fireEvent.click(screen.getByText("Cancel"));
    await expect(p).resolves.toBeNull();
  });

  it("blocks submit while validate reports an error", async () => {
    render(<ModalHost />);
    const p = openModal(() =>
      promptModal({ title: "URL", validate: (v) => (v ? null : "Required") }),
    );
    const input = await screen.findByRole("textbox", { name: "URL" });
    fireEvent.click(screen.getByText("OK"));
    const validation = screen.getByRole("alert");
    expect(validation.textContent).toBe("Required");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(validation.id);
    fireEvent.change(input, { target: { value: "ok" } });
    fireEvent.click(screen.getByText("OK"));
    await expect(p).resolves.toBe("ok");
  });

  it("renders a confirm and resolves with the chosen button value", async () => {
    render(<ModalHost />);
    const p = openModal(() => confirmModal({
      title: "Unsaved Changes",
      message: "Save before closing?",
      buttons: [
        { label: "Don't Save", value: "discard", variant: "danger" },
        { label: "Save", value: "save", variant: "primary" },
      ],
      defaultValue: "discard",
    }));
    const message = await screen.findByText("Save before closing?");
    const dialog = screen.getByRole("dialog", { name: "Unsaved Changes" });
    expect(dialog.getAttribute("aria-describedby")).toBe(message.id);
    fireEvent.click(screen.getByText("Don't Save"));
    await expect(p).resolves.toBe("discard");
  });

  it("a confirm dialog resolves its defaultValue on Enter (safe default)", async () => {
    render(<ModalHost />);
    const p = openModal(() => confirmModal({
      title: "Unsaved Changes",
      message: "has unsaved changes",
      defaultValue: "cancel",
      buttons: [
        { label: "Save", value: "save", variant: "primary" },
        { label: "Don't Save", value: "discard", variant: "danger" },
        { label: "Cancel", value: "cancel" },
      ],
    }));
    await screen.findByText("has unsaved changes");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    await expect(p).resolves.toBe("cancel");
  });

  it("owns keyboard input instead of leaking shortcuts to the app behind it", async () => {
    const behindModal = vi.fn();
    window.addEventListener("keydown", behindModal);
    render(<ModalHost />);
    const pending = openModal(() => confirmModal({
      title: "Delete",
      message: "Delete it?",
      buttons: [{ label: "Cancel", value: "cancel" }],
      defaultValue: "cancel",
    }));
    const dialog = await screen.findByRole("dialog", { name: "Delete" });
    fireEvent.keyDown(dialog, { key: "t", ctrlKey: true });
    expect(behindModal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel"));
    await pending;
    window.removeEventListener("keydown", behindModal);
  });

  it("traps focus and makes the covered app inert until the modal settles", async () => {
    const { container } = render(
      <>
        <button>Behind before</button>
        <ModalHost />
        <button>Behind after</button>
      </>,
    );
    const before = screen.getByRole("button", { name: "Behind before" });
    const after = screen.getByRole("button", { name: "Behind after" });
    const pending = openModal(() => confirmModal({
      title: "Confirm action",
      message: "Choose safely",
      buttons: [
        { label: "Proceed", value: "proceed" },
        { label: "Cancel", value: "cancel" },
      ],
      defaultValue: "cancel",
    }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm action" });
    const proceed = screen.getByRole("button", { name: "Proceed" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect((before as HTMLElement & { inert: boolean }).inert).toBe(true);
    expect((after as HTMLElement & { inert: boolean }).inert).toBe(true);

    cancel.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(proceed);
    proceed.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);

    fireEvent.click(cancel);
    await pending;
    expect((before as HTMLElement & { inert: boolean }).inert).toBe(false);
    expect((after as HTMLElement & { inert: boolean }).inert).toBe(false);
    expect(container.querySelector("[aria-modal=true]")).toBeNull();
  });

  it("renders notices inside Markd and closes the one-button modal on Enter", async () => {
    render(<ModalHost />);
    const p = openModal(() => messageModal("Export failed.", {
      title: "Export Failed",
      kind: "error",
    }));
    const dialog = await screen.findByRole("dialog", { name: "Export Failed" });
    expect(dialog.classList.contains("tone-error")).toBe(true);
    fireEvent.keyDown(dialog, { key: "Enter" });
    await expect(p).resolves.toBeUndefined();
  });

  it("queues normal requests in FIFO order instead of losing the first notice", async () => {
    render(<ModalHost />);
    const first = openModal(() => confirmModal({
      title: "First Notice",
      message: "First message",
      buttons: [{ label: "OK", value: "ok", variant: "primary" }],
      defaultValue: "ok",
    }));
    await screen.findByText("First message");
    const second = openModal(() => confirmModal({
      title: "Second Notice",
      message: "Second message",
      buttons: [{ label: "Done", value: "done", variant: "primary" }],
      defaultValue: "done",
    }));
    expect(screen.queryByText("Second message")).toBeNull();
    fireEvent.click(screen.getByText("OK"));
    await expect(first).resolves.toBe("ok");
    await screen.findByText("Second message");
    fireEvent.click(screen.getByText("Done"));
    await expect(second).resolves.toBe("done");
  });

  it("drops a queued request whose owner is stale before it reaches the screen", async () => {
    render(<ModalHost />);
    const first = openModal(() => confirmModal({
      title: "Blocking Notice",
      message: "First",
      buttons: [{ label: "OK", value: "ok" }],
      defaultValue: "ok",
    }));
    await screen.findByText("First");

    let isCurrent = true;
    const stale = openModal(() => confirmModal({
      title: "Changed File",
      message: "Stale watcher prompt",
      buttons: [{ label: "Keep", value: "keep" }],
      defaultValue: "keep",
      isCurrent: () => isCurrent,
    }));
    isCurrent = false;
    fireEvent.click(screen.getByText("OK"));

    await expect(first).resolves.toBe("ok");
    await expect(stale).resolves.toBeNull();
    expect(screen.queryByText("Stale watcher prompt")).toBeNull();
  });

  it("dismisses a visible request that becomes stale and advances its queue on rerender", async () => {
    let isCurrent = true;
    const view = render(
      <>
        <button>Original focus</button>
        <ModalHost />
      </>,
    );
    const original = screen.getByRole("button", { name: "Original focus" });
    original.focus();
    const stale = openModal(() => confirmModal({
      title: "Changed File",
      message: "Visible watcher prompt",
      buttons: [{ label: "Keep", value: "keep" }],
      defaultValue: "keep",
      isCurrent: () => isCurrent,
    }));
    await screen.findByText("Visible watcher prompt");
    const next = openModal(() => confirmModal({
      title: "Next Notice",
      message: "Queued behind watcher",
      buttons: [{ label: "Done", value: "done" }],
      defaultValue: "done",
    }));

    isCurrent = false;
    view.rerender(
      <>
        <button>Original focus</button>
        <ModalHost />
      </>,
    );

    expect(screen.queryByText("Visible watcher prompt")).toBeNull();
    expect(screen.getByText("Queued behind watcher")).toBeTruthy();
    await expect(stale).resolves.toBeNull();
    const done = screen.getByRole("button", { name: "Done" });
    expect(document.activeElement).toBe(done);
    fireEvent.click(done);
    await expect(next).resolves.toBe("done");
    expect(document.activeElement).toBe(original);
  });

  it("restores the pre-modal focus after the entire FIFO queue closes", async () => {
    render(
      <>
        <button>Original focus</button>
        <ModalHost />
      </>,
    );
    const original = screen.getByRole("button", { name: "Original focus" });
    original.focus();
    const first = openModal(() => confirmModal({
      title: "First",
      message: "First",
      buttons: [{ label: "Next", value: "next" }],
      defaultValue: "next",
    }));
    const second = openModal(() => confirmModal({
      title: "Second",
      message: "Second",
      buttons: [{ label: "Done", value: "done" }],
      defaultValue: "done",
    }));
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    await first;
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    await second;
    expect(document.activeElement).toBe(original);
  });

  it("lets a normal request preempt an unattended replaceable update", async () => {
    render(<ModalHost />);
    const first = openModal(() => confirmModal({
      title: "Update Available",
      message: "Markd 0.4.9 is available.",
      buttons: [{ label: "Later", value: "later" }],
      defaultValue: "later",
      policy: "replaceable",
    }));
    await screen.findByText("Markd 0.4.9 is available.");
    const second = openModal(() => confirmModal({
      title: "Delete File",
      message: "Really delete?",
      buttons: [{ label: "Cancel", value: "cancel" }],
      defaultValue: "cancel",
    }));
    await expect(first).resolves.toBeNull();
    fireEvent.click(await screen.findByText("Cancel"));
    await expect(second).resolves.toBe("cancel");
  });

  it("does not let an already-stale normal request preempt a replaceable update", async () => {
    render(<ModalHost />);
    const update = openModal(() => confirmModal({
      title: "Update Available",
      message: "Update remains visible",
      buttons: [{ label: "Later", value: "later" }],
      defaultValue: "later",
      policy: "replaceable",
    }));
    await screen.findByText("Update remains visible");

    const stale = openModal(() => confirmModal({
      title: "Stale watcher",
      message: "Must never render",
      buttons: [{ label: "Keep", value: "keep" }],
      defaultValue: "keep",
      isCurrent: () => false,
    }));

    await expect(stale).resolves.toBeNull();
    expect(screen.queryByText("Must never render")).toBeNull();
    expect(screen.getByText("Update remains visible")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    await expect(update).resolves.toBe("later");
  });

  it("restores the pre-modal focus after a replaceable request is preempted", async () => {
    render(
      <>
        <button>Original focus</button>
        <ModalHost />
      </>,
    );
    const original = screen.getByRole("button", { name: "Original focus" });
    original.focus();
    const update = openModal(() => confirmModal({
      title: "Update",
      message: "Update",
      buttons: [{ label: "Later", value: "later" }],
      defaultValue: "later",
      policy: "replaceable",
    }));
    const normal = openModal(() => confirmModal({
      title: "Normal",
      message: "Normal",
      buttons: [{ label: "Close", value: "close" }],
      defaultValue: "close",
    }));
    await expect(update).resolves.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    await normal;
    expect(document.activeElement).toBe(original);
  });

  it("drops a replaceable automatic update instead of hiding a real dialog", async () => {
    render(<ModalHost />);
    const first = openModal(() => confirmModal({
      title: "Unsaved Changes",
      message: "Keep editing?",
      buttons: [{ label: "Cancel", value: "cancel" }],
      defaultValue: "cancel",
    }));
    await screen.findByText("Keep editing?");
    const update = openModal(() => confirmModal({
      title: "Update Available",
      message: "Markd 0.4.9 is available.",
      buttons: [{ label: "Later", value: "later" }],
      defaultValue: "later",
      policy: "replaceable",
    }));
    await expect(update).resolves.toBeNull();
    expect(screen.queryByText("Markd 0.4.9 is available.")).toBeNull();
    fireEvent.click(screen.getByText("Cancel"));
    await expect(first).resolves.toBe("cancel");
  });

  it("settles the active and queued requests when the host unmounts", async () => {
    const { unmount } = render(<ModalHost />);
    const first = openModal(() => confirmModal({
      title: "First",
      message: "First",
      buttons: [{ label: "OK", value: "ok" }],
      defaultValue: "ok",
    }));
    await screen.findByRole("dialog", { name: "First" });
    const second = openModal(() => confirmModal({
      title: "Second",
      message: "Second",
      buttons: [{ label: "OK", value: "ok" }],
      defaultValue: "ok",
    }));
    unmount();
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
  });

  it("restores the session's original focus when the host itself unmounts", async () => {
    const view = render(
      <>
        <button>Original focus</button>
        <ModalHost />
      </>,
    );
    const original = screen.getByRole("button", { name: "Original focus" });
    original.focus();
    const pending = openModal(() => confirmModal({
      title: "Unmounting",
      message: "Still pending",
      buttons: [{ label: "Cancel", value: "cancel" }],
      defaultValue: "cancel",
    }));
    await screen.findByRole("dialog", { name: "Unmounting" });

    view.rerender(<button>Original focus</button>);
    await expect(pending).resolves.toBeNull();
    expect(document.activeElement).toBe(original);
  });

  it("does not dismiss an active request during StrictMode's effect replay", async () => {
    let result: Promise<string | null> | null = null;
    function OpenOnce() {
      const opened = useRef(false);
      useEffect(() => {
        if (opened.current) return;
        opened.current = true;
        result = confirmModal({
          title: "Strict Notice",
          message: "Still visible",
          buttons: [{ label: "OK", value: "ok" }],
          defaultValue: "ok",
        });
      }, []);
      return null;
    }

    render(
      <StrictMode>
        <ModalHost />
        <OpenOnce />
      </StrictMode>,
    );
    await screen.findByRole("dialog", { name: "Strict Notice" });
    fireEvent.click(screen.getByText("OK"));
    await expect(result).resolves.toBe("ok");
  });
});
