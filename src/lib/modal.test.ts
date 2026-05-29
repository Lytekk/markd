import { describe, it, expect } from "vitest";
import { promptModal, confirmModal, _subscribeModal } from "./modal";

describe("modal controller", () => {
  it("resolves null when no host is subscribed", async () => {
    await expect(promptModal({ title: "x" })).resolves.toBeNull();
    await expect(
      confirmModal({ title: "x", message: "m", buttons: [{ label: "OK", value: "ok" }] }),
    ).resolves.toBeNull();
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
      }),
    ).resolves.toBe("discard");
    unsub();
  });
});
