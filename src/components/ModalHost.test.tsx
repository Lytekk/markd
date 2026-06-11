import { describe, it, expect } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { ModalHost } from "./ModalHost";
import { promptModal, confirmModal } from "@/lib/modal";

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
    const input = await screen.findByRole("textbox");
    fireEvent.click(screen.getByText("OK"));
    expect(screen.getByText("Required")).toBeTruthy();
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
    }));
    await screen.findByText("Save before closing?");
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

  it("a second request resolves the displaced modal with null instead of orphaning it", async () => {
    // Regression guard: the startup auto-update prompt sits open unattended;
    // any user-triggered modal displaces it. The displaced promise must settle
    // (as a dismissal), never hang forever.
    render(<ModalHost />);
    const first = openModal(() => confirmModal({
      title: "Update Available",
      message: "Markd 0.3.14 is available.",
      buttons: [{ label: "Install Now", value: "install", variant: "primary" }],
    }));
    await screen.findByText("Markd 0.3.14 is available.");
    const second = openModal(() => confirmModal({
      title: "Delete File",
      message: "Really delete?",
      buttons: [{ label: "Delete", value: "delete", variant: "danger" }],
    }));
    await expect(first).resolves.toBeNull();
    fireEvent.click(await screen.findByText("Delete"));
    await expect(second).resolves.toBe("delete");
  });
});
