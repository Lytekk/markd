// Snippet insert picker (Ctrl+Space): reuses CommandPalette as a generic fuzzy
// list. Snippets map to Commands (label → label, trigger → hint + searchable
// keywords); a muted second line previews the body via renderItem. Picking a row
// calls onInsert(body); the actual caret-safe insertion lives in snippet-insert.ts
// (rendered mode) / App.tsx (source mode).

import { useMemo } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import type { Command } from "@/lib/command-palette";
import type { Snippet } from "@/lib/snippets";

interface SnippetPickerProps {
  open: boolean;
  snippets: Snippet[];
  onInsert: (body: string) => void;
  onClose: () => void;
  /** Optional: appends a "Manage snippets…" row that opens the manager. */
  onManage?: () => void;
}

export function SnippetPicker({ open, snippets, onInsert, onClose, onManage }: SnippetPickerProps) {
  const commands: Command[] = useMemo(() => {
    const rows: Command[] = snippets.map((s) => ({
      id: s.id,
      label: s.label,
      keywords: s.trigger, // searchable by trigger; not shown in the label
      hint: s.trigger,
      run: () => onInsert(s.body),
    }));
    if (onManage) {
      rows.push({
        id: "__manage",
        label: "➕ New snippet…",
        keywords: "create add new custom manage edit delete reuse",
        run: onManage,
      });
    }
    return rows;
  }, [snippets, onInsert, onManage]);

  const previewById = useMemo(
    () => new Map(snippets.map((s) => [s.id, s.body])),
    [snippets],
  );

  const renderItem = (command: Command) => {
    const body = previewById.get(command.id) ?? "";
    const preview = body.replace(/\s+/g, " ").trim().slice(0, 80);
    return (
      <span className="markd-snippet-row">
        <span className="markd-snippet-line">
          <span className="markd-command-label">{command.label}</span>
          {command.hint && <span className="markd-command-hint">{command.hint}</span>}
        </span>
        {preview && <span className="markd-snippet-preview">{preview}</span>}
      </span>
    );
  };

  return (
    <CommandPalette
      open={open}
      commands={commands}
      onClose={onClose}
      renderItem={renderItem}
      itemClassName={(c) => (c.id === "__manage" ? "markd-command-action" : undefined)}
      placeholder="Insert a snippet…"
      label="Insert snippet"
    />
  );
}
