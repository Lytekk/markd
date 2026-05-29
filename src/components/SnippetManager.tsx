// Snippet manager modal: add / edit / delete custom snippets + reset to
// defaults. Reuses the .markd-modal* CSS primitive and confirmModal for the
// destructive actions (the modal.ts ModalRequest union stays prompt|confirm —
// a multi-field editor doesn't fit it, so this is a dedicated dialog).

import { useState } from "react";
import { confirmModal } from "@/lib/modal";
import { validateSnippet, type Snippet } from "@/lib/snippets";

interface SnippetManagerProps {
  open: boolean;
  snippets: Snippet[];
  onAdd: (draft: Omit<Snippet, "id">) => void;
  onUpdate: (id: string, patch: Omit<Snippet, "id">) => void;
  onDelete: (id: string) => void;
  onReset: () => void;
  onClose: () => void;
}

interface FormState {
  trigger: string;
  label: string;
  body: string;
}
const EMPTY: FormState = { trigger: "", label: "", body: "" };

export function SnippetManager({
  open,
  snippets,
  onAdd,
  onUpdate,
  onDelete,
  onReset,
  onClose,
}: SnippetManagerProps) {
  // editing: null → list only; { id: null } → adding; { id } → editing that one.
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const openAdd = () => {
    setEditing({ id: null });
    setForm(EMPTY);
    setError(null);
  };
  const openEdit = (s: Snippet) => {
    setEditing({ id: s.id });
    setForm({ trigger: s.trigger, label: s.label, body: s.body });
    setError(null);
  };
  const cancel = () => {
    setEditing(null);
    setError(null);
  };
  const save = () => {
    const err = validateSnippet(form);
    if (err) {
      setError(err);
      return;
    }
    if (editing && editing.id !== null) onUpdate(editing.id, { ...form });
    else onAdd({ ...form });
    setEditing(null);
    setError(null);
  };
  const del = (s: Snippet) => {
    void confirmModal({
      title: "Delete snippet",
      message: `Delete “${s.label}”? This can't be undone.`,
      buttons: [
        { label: "Delete", value: "delete", variant: "danger" },
        { label: "Cancel", value: "cancel" },
      ],
      defaultValue: "cancel",
    }).then((v) => {
      if (v === "delete") onDelete(s.id);
    });
  };
  const reset = () => {
    void confirmModal({
      title: "Reset snippets",
      message: "Replace all snippets with the built-in defaults? Your custom snippets will be removed.",
      buttons: [
        { label: "Reset", value: "reset", variant: "danger" },
        { label: "Cancel", value: "cancel" },
      ],
      defaultValue: "cancel",
    }).then((v) => {
      if (v === "reset") onReset();
    });
  };

  return (
    <div className="markd-modal-backdrop" onMouseDown={onClose}>
      <div
        className="markd-snippet-manager"
        role="dialog"
        aria-modal="true"
        aria-label="Manage snippets"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="markd-snippet-manager-head">
          <h2>Snippets</h2>
          <button className="markd-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <ul className="markd-snippet-manager-list">
          {snippets.map((s) => (
            <li key={s.id} className="markd-snippet-manager-item">
              <span className="markd-snippet-manager-label">{s.label}</span>
              <span className="markd-snippet-manager-trigger">{s.trigger}</span>
              <span className="markd-snippet-manager-actions">
                <button type="button" onClick={() => openEdit(s)}>
                  Edit
                </button>
                <button type="button" onClick={() => del(s)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
          {snippets.length === 0 && (
            <li className="markd-snippet-manager-empty">No snippets — add one below or reset to defaults.</li>
          )}
        </ul>

        {editing ? (
          <form
            className="markd-snippet-form"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label className="markd-snippet-field">
              <span>Trigger</span>
              <input
                aria-label="Trigger"
                value={form.trigger}
                maxLength={24}
                placeholder="e.g. sig"
                onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))}
              />
            </label>
            <label className="markd-snippet-field">
              <span>Label</span>
              <input
                aria-label="Label"
                value={form.label}
                placeholder="Shown in the picker"
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </label>
            <label className="markd-snippet-field">
              <span>Body — use $1 for the caret, {"{{date}}"} / {"{{time}}"} / {"{{datetime}}"} for tokens</span>
              <textarea
                aria-label="Body"
                value={form.body}
                rows={5}
                spellCheck={false}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              />
            </label>
            {error && <div className="markd-modal-error">{error}</div>}
            <div className="markd-snippet-form-actions">
              <button type="submit" className="markd-modal-btn primary">
                Save
              </button>
              <button type="button" className="markd-modal-btn" onClick={cancel}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="markd-snippet-manager-foot">
            <button type="button" className="markd-modal-btn primary" onClick={openAdd}>
              Add snippet
            </button>
            <button type="button" className="markd-modal-btn" onClick={reset}>
              Reset to defaults
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
