import { useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, type Command } from "@/lib/command-palette";

interface CommandPaletteProps {
  open: boolean;
  commands: Command[];
  onClose: () => void;
  /** Override the row content (e.g. tab rows with a dirty dot); defaults to label + hint. */
  renderItem?: (command: Command, isSelected: boolean) => React.ReactNode;
  /** Input placeholder. Defaults to the command-palette prompt. */
  placeholder?: string;
  /** Accessible dialog label. Defaults to "Command palette". */
  label?: string;
  /** Optional extra class per row (e.g. to set off a meta-action). */
  itemClassName?: (command: Command) => string | undefined;
}

/**
 * Fuzzy command launcher (Ctrl+Shift+P). Plain DOM overlay — like ModalHost it
 * sidesteps WebView2's native-dialog suppression. The command list is supplied
 * by App.tsx so each action has one source of truth (the same handlers the
 * menubar and keyboard shortcuts call).
 */
export function CommandPalette({
  open,
  commands,
  onClose,
  renderItem,
  placeholder = "Type a command…",
  label = "Command palette",
  itemClassName,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);

  // Reset and focus each time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Keep the highlight within bounds as the filtered list shrinks/grows.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Keep the highlighted row scrolled into view. Guarded: jsdom (and some
  // webviews) don't implement scrollIntoView, and it must never break nav.
  useEffect(() => {
    const el = listRef.current?.children[selected] as HTMLElement | undefined;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  if (!open) return null;

  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    void command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[selected]);
    }
  };

  return (
    <div className="markd-modal-backdrop" onMouseDown={onClose}>
      <div
        className="markd-command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="markd-command-input"
          placeholder={placeholder}
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="markd-command-list"
          aria-autocomplete="list"
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
        />
        <ul ref={listRef} className="markd-command-list" id="markd-command-list" role="listbox">
          {filtered.length === 0 ? (
            <li className="markd-command-empty">No matching commands</li>
          ) : (
            filtered.map((command, i) => (
              <li
                key={command.id}
                role="option"
                aria-selected={i === selected}
                className={`markd-command-item${i === selected ? " selected" : ""}${
                  itemClassName?.(command) ? ` ${itemClassName(command)}` : ""
                }`}
                onMouseEnter={() => setSelected(i)}
                // mousedown (not click) so it fires before the backdrop's blur/close race
                onMouseDown={(e) => {
                  e.preventDefault();
                  run(command);
                }}
              >
                {renderItem ? (
                  renderItem(command, i === selected)
                ) : (
                  <>
                    <span className="markd-command-label">{command.label}</span>
                    {command.hint && <span className="markd-command-hint">{command.hint}</span>}
                  </>
                )}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
