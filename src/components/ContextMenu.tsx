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
}

type MenuEntry = MenuItem | "separator";

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
    action: async (e) => {
      // window.prompt is suppressed by WebView2 — use the in-app modal.
      const url = await promptModal({
        title: "Insert Image",
        label: "Image URL or path",
        placeholder: "https://…  or  ./image.png",
        okLabel: "Insert",
        validate: (v) => (v ? null : "Enter a URL or path"),
      });
      if (url) e.chain().focus().setImage({ src: url }).run();
    },
  },
  {
    label: "Insert Code Block",
    action: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
];

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
      {MENU_ITEMS.map((item, i) => {
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
