import { describe, it, expect, vi } from "vitest";
import {
  promptModal,
  confirmModal,
  messageModal,
  isModalOpen,
  _subscribeModal,
} from "./modal";

describe("modal controller", () => {
  it("resolves null when no host is subscribed", async () => {
    await expect(promptModal({ title: "x" })).resolves.toBeNull();
    await expect(
      confirmModal({
        title: "x",
        message: "m",
        buttons: [{ label: "OK", value: "ok" }],
        defaultValue: "ok",
      }),
    ).resolves.toBeNull();
    await expect(messageModal("m", { title: "x" })).resolves.toBeUndefined();
  });

  it("delivers a prompt request to the host and resolves with its result", async () => {
    const unsub = _subscribeModal((req) => {
      if (req?.kind === "prompt") req.resolve("https://example.com");
    });
    await expect(promptModal({ title: "URL", defaultValue: "" })).resolves.toBe(
      "https://example.com",
    );
    unsub();
  });

  it("delivers a confirm request and resolves with the chosen button value", async () => {
    const unsub = _subscribeModal((req) => {
      if (req?.kind === "confirm") req.resolve("discard");
    });
    await expect(
      confirmModal({
        title: "Unsaved",
        message: "Discard?",
        buttons: [
          { label: "Cancel", value: "cancel" },
          { label: "Discard", value: "discard", variant: "danger" },
        ],
        defaultValue: "cancel",
      }),
    ).resolves.toBe("discard");
    unsub();
  });

  it("reports a pending request synchronously until the host settles it", async () => {
    const delivered: Array<NonNullable<Parameters<Parameters<typeof _subscribeModal>[0]>[0]>> = [];
    const unsub = _subscribeModal((req) => {
      if (req) delivered.push(req);
    });
    const pending = confirmModal({
      title: "Delete",
      message: "Delete it?",
      buttons: [{ label: "Cancel", value: "cancel" }],
      defaultValue: "cancel",
    });
    expect(isModalOpen()).toBe(true);
    delivered[0]!.resolve("cancel");
    await expect(pending).resolves.toBe("cancel");
    expect(isModalOpen()).toBe(false);
    unsub();
  });

  it("also reports an already-rendered app overlay as modal", () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("aria-modal", "true");
    document.body.append(overlay);
    expect(isModalOpen()).toBe(true);
    overlay.remove();
    expect(isModalOpen()).toBe(false);
  });

  it("delivers an in-app one-button message with its title, tone, and safe default", async () => {
    let delivered: Parameters<Parameters<typeof _subscribeModal>[0]>[0] = null;
    const unsub = _subscribeModal((req) => {
      delivered = req;
      if (req?.kind === "confirm") req.resolve("ok");
    });
    await expect(
      messageModal("The file could not be opened.", {
        title: "Open Failed",
        kind: "error",
      }),
    ).resolves.toBeUndefined();
    expect(delivered).toMatchObject({
      kind: "confirm",
      title: "Open Failed",
      message: "The file could not be opened.",
      defaultValue: "ok",
      tone: "error",
      policy: "normal",
      buttons: [{ label: "OK", value: "ok", variant: "primary" }],
    });
    unsub();
  });

  it("fails closed when a confirm default does not name one of its buttons", async () => {
    const delivered = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const unsub = _subscribeModal(delivered);
    await expect(
      confirmModal({
        title: "Unsafe",
        message: "Choose",
        buttons: [{ label: "Cancel", value: "cancel" }],
        defaultValue: "missing",
      }),
    ).resolves.toBeNull();
    expect(delivered).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    unsub();
  });
});
