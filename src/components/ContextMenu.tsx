import { useState, useEffect, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { promptModal } from "@/lib/modal";

interface ContextMenuProps {
  editor: Editor | null;
}

interface MenuPosition {
  x: number;
  y: number;
}

interface MenuItem {
  label: string;
  shortcut?: string;
  action: (editor: Editor) => void;
  /** If present, the item is shown only when this returns true for the editor. */
  when?: (editor: Editor) => boolean;
}

type MenuEntry = MenuItem | "separator";

export async function promptAndInsertImage(editor: Editor): Promise<void> {
  const ownerDoc = editor.state.doc;
  const { from, to } = editor.state.selection;
  const ownerSelection = { from, to };
  const url = await promptModal({
    title: "Insert Image",
    label: "Image URL or path",
    placeholder: "https://…  or  ./image.png",
    okLabel: "Insert",
    validate: (value) => (value ? null : "Enter a URL or path"),
    isCurrent: () => !editor.isDestroyed && editor.state.doc === ownerDoc,
  });
  if (!url || editor.isDestroyed || editor.state.doc !== ownerDoc) return;
  editor.chain().focus().setTextSelection(ownerSelection).setImage({ src: url }).run();
}

const MENU_ITEMS: MenuEntry[] = [
  {
    label: "Cut",
    shortcut: "Ctrl+X",
    action: () => document.execCommand("cut"),
  },
  {
    label: "Copy",
    shortcut: "Ctrl+C",
    action: () => document.execCommand("copy"),
  },
  {
    label: "Paste",
    shortcut: "Ctrl+V",
    action: () => document.execCommand("paste"),
  },
  {
    label: "Select All",
    shortcut: "Ctrl+A",
    action: (e) => e.commands.selectAll(),
  },
  "separator",
  {
    label: "Bold",
    shortcut: "Ctrl+B",
    action: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    label: "Italic",
    shortcut: "Ctrl+I",
    action: (e) => e.chain().focus().toggleItalic().run(),
  },
  "separator",
  {
    label: "Insert Table",
    action: (e) =>
      e
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    label: "Insert Image",
    action: (editor) => {
      // window.prompt is suppressed by WebView2 — use the in-app modal.
      void promptAndInsertImage(editor);
    },
  },
  {
    label: "Insert Code Block",
    action: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  // Table editing — only shown when the cursor is inside a table.
  "separator",
  {
    label: "Add Row Above",
    when: (e) => e.isActive("table"),
    action: (e) => e.chain().focus().addRowBefore().run(),
  },
  {
    label: "Add Row Below",
    when: (e) => e.isActive("table"),
    action: (e) => e.chain().focus().addRowAfter().run(),
  },
  {
    label: "Add Column Left",
    when: (e) => e.isActive("table"),
    action: (e) => e.chain().focus().addColumnBefore().run(),
  },
  {
    label: "Add Column Right",
    when: (e) => e.isActive("table"),
    action: (e) => e.chain().focus().addColumnAfter().run(),
  },
  {
    label: "Toggle Header Row",
    when: (e) => e.isActive("table"),
    action: (e) => e.chain().focus().toggleHeaderRow().run(),
  },
  {
    label: "Delete Row",
    when: (e) => e.isActive("table"),
    action: (e) => e.chain().focus().deleteRow().run(),
  },
  {
    label: "Delete Column",
    when: (e) => e.isActive("table"),
    action: (e) => e.chain().focus().deleteColumn().run(),
  },
  {
    label: "Delete Table",
    when: (e) => e.isActive("table"),
    action: (e) => e.chain().focus().deleteTable().run(),
  },
];

/**
 * Resolve the visible menu entries for the current editor state: drop items
 * whose `when` predicate is false, then collapse leading/trailing/duplicate
 * separators so conditional sections don't leave stray dividers.
 */
function resolveItems(all: MenuEntry[], editor: Editor): MenuEntry[] {
  const shown = all.filter(
    (it) => it === "separator" || !it.when || it.when(editor),
  );
  const out: MenuEntry[] = [];
  for (const it of shown) {
    if (it === "separator" && (out.length === 0 || out[out.length - 1] === "separator")) {
      continue;
    }
    out.push(it);
  }
  if (out[out.length - 1] === "separator") out.pop();
  return out;
}

export function ContextMenu({ editor }: ContextMenuProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      // Only show custom menu inside the editor area
      const editorEl = document.querySelector(".markd-editor-scroll");
      if (!editorEl?.contains(e.target as Node)) return;

      e.preventDefault();
      setPosition({ x: e.clientX, y: e.clientY });
    },
    [],
  );

  const handleDismiss = useCallback(() => {
    setPosition(null);
  }, []);

  useEffect(() => {
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("click", handleDismiss);
    document.addEventListener("scroll", handleDismiss, true);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleDismiss();
    };
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("click", handleDismiss);
      document.removeEventListener("scroll", handleDismiss, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [handleContextMenu, handleDismiss]);

  // Adjust position so the menu stays within the viewport
  useEffect(() => {
    if (!position || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const adjustedX =
      position.x + rect.width > window.innerWidth
        ? window.innerWidth - rect.width - 8
        : position.x;
    const adjustedY =
      position.y + rect.height > window.innerHeight
        ? window.innerHeight - rect.height - 8
        : position.y;

    if (adjustedX !== position.x || adjustedY !== position.y) {
      setPosition({ x: adjustedX, y: adjustedY });
    }
  }, [position]);

  if (!position || !editor) return null;

  return (
    <div
      ref={menuRef}
      className="markd-context-menu"
      style={{ left: position.x, top: position.y }}
    >
      {resolveItems(MENU_ITEMS, editor).map((item, i) => {
        if (item === "separator") {
          return <div key={i} className="markd-context-separator" />;
        }
        return (
          <button
            key={item.label}
            className="markd-context-item"
            onClick={(e) => {
              e.stopPropagation();
              item.action(editor);
              setPosition(null);
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="markd-context-shortcut">{item.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
