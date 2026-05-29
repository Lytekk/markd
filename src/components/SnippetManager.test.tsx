import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SnippetManager } from "./SnippetManager";
import type { Snippet } from "@/lib/snippets";

// confirmModal needs a mounted ModalHost; mock it to auto-confirm with the first
// (danger) button's value so destructive paths are unit-testable in isolation.
vi.mock("@/lib/modal", () => ({
  confirmModal: vi.fn((opts: { buttons: { value: string }[] }) =>
    Promise.resolve(opts.buttons?.[0]?.value ?? null),
  ),
}));

const snippets: Snippet[] = [
  { id: "h1", trigger: "h1", label: "Heading 1", body: "# $1" },
  { id: "link", trigger: "link", label: "Link", body: "[text](https://)" },
];

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true,
    snippets,
    onAdd: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onReset: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<SnippetManager {...props} />);
  return props;
}

describe("SnippetManager", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <SnippetManager
        open={false}
        snippets={snippets}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector(".markd-snippet-manager")).toBeNull();
  });

  it("lists existing snippets", () => {
    setup();
    expect(screen.getByText("Heading 1")).toBeTruthy();
    expect(screen.getByText("Link")).toBeTruthy();
  });

  it("adds a new snippet via the form", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /add snippet/i }));
    fireEvent.change(screen.getByLabelText(/trigger/i), { target: { value: "sig" } });
    fireEvent.change(screen.getByLabelText(/^label$/i), { target: { value: "Signature" } });
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: "— me" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(props.onAdd).toHaveBeenCalledWith({ trigger: "sig", label: "Signature", body: "— me" });
  });

  it("shows a validation error and does not save an empty trigger", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /add snippet/i }));
    fireEvent.change(screen.getByLabelText(/^label$/i), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(props.onAdd).not.toHaveBeenCalled();
    expect(screen.getByText(/trigger is required/i)).toBeTruthy();
  });

  it("loads a snippet into the form for editing and updates it", () => {
    const props = setup();
    fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]!);
    const label = screen.getByLabelText(/^label$/i) as HTMLInputElement;
    expect(label.value).toBe("Heading 1");
    fireEvent.change(label, { target: { value: "H1" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(props.onUpdate).toHaveBeenCalledWith("h1", { trigger: "h1", label: "H1", body: "# $1" });
  });

  it("deletes after confirmation", async () => {
    const props = setup();
    fireEvent.click(screen.getAllByRole("button", { name: /^delete$/i })[0]!);
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith("h1"));
  });

  it("resets to defaults after confirmation", async () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await waitFor(() => expect(props.onReset).toHaveBeenCalled());
  });

  it("opens directly on the add form when startInAdd is set", () => {
    setup({ startInAdd: true });
    // form fields present without first clicking "Add snippet"
    expect(screen.getByLabelText(/trigger/i)).toBeTruthy();
    expect(screen.getByLabelText(/^label$/i)).toBeTruthy();
    expect(screen.getByLabelText(/body/i)).toBeTruthy();
  });
});
