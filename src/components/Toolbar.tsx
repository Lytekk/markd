import { useCallback, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";

interface ToolbarProps {
  editor: Editor | null;
  heldModifier: "ctrl" | "alt" | null;
  /** Source mode: the buttons drive the (hidden, stale) ProseMirror doc, so
   * they must not accept input while the textarea owns the buffer. */
  disabled?: boolean;
}

interface ToolbarButton {
  label: string;
  shortcut?: string;
  icon: ReactNode;
  action: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
}

// Shortcut field uses compact symbols (⇧=Shift, ⌥=Alt). Expand for native tooltip display.
function formatTitle(label: string, shortcut?: string): string {
  if (!shortcut) return label;
  let combo: string;
  if (shortcut.startsWith("⌥")) combo = `Alt+${shortcut.slice(1)}`;
  else if (shortcut.startsWith("⇧")) combo = `Ctrl+Shift+${shortcut.slice(1)}`;
  else combo = `Ctrl+${shortcut}`;
  return `${label} (${combo})`;
}

/* ── SVG Icons (16x16, currentColor) ─────────────────────────────── */

const BoldIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M4 2h5a3 3 0 0 1 2.1 5.1A3.5 3.5 0 0 1 9.5 14H4V2zm2 5h3a1 1 0 0 0 0-2H6v2zm0 2v3h3.5a1.5 1.5 0 0 0 0-3H6z" />
  </svg>
);

const ItalicIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M6 2h6v2h-2.2l-2.6 8H9v2H3v-2h2.2l2.6-8H6V2z" />
  </svg>
);

const StrikethroughIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 8h12v1.5H2V8zM5.5 3h5a2.5 2.5 0 0 1 1.7 4.3H3.8A2.5 2.5 0 0 1 5.5 3zm0 10h5a2.5 2.5 0 0 0 1.7-4.3H3.8A2.5 2.5 0 0 0 5.5 13z" />
  </svg>
);

const CodeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="5.5 4.5 2 8 5.5 11.5" />
    <polyline points="10.5 4.5 14 8 10.5 11.5" />
  </svg>
);

const H1Icon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 3h1.5v4H6V3h1.5v10H6V8.5H2.5V13H1V3zm9.5 1.5V13H9V5.7L7.5 6.5V5l2-1.5h1z" />
  </svg>
);

const H2Icon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 3h1.5v4H6V3h1.5v10H6V8.5H2.5V13H1V3zm8 5.5a2.5 2.5 0 0 1 5 0c0 1-.4 1.7-1.2 2.5L10 13h4v1.5H8.5V13l3-3c.5-.5.7-1 .7-1.5a1 1 0 0 0-2 0H9z" />
  </svg>
);

const H3Icon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 3h1.5v4H6V3h1.5v10H6V8.5H2.5V13H1V3zm8 1.5h4.5V7L11.5 8a2 2 0 0 1-1 3.8V13.5a2.5 2.5 0 0 0 2.5-2.5h1.5A4 4 0 0 1 10.5 15 3.5 3.5 0 0 1 9 8.5l2-1V6H9V4.5z" />
  </svg>
);

const BulletListIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <circle cx="3" cy="4" r="1.5" />
    <circle cx="3" cy="8" r="1.5" />
    <circle cx="3" cy="12" r="1.5" />
    <rect x="6" y="3" width="8" height="2" rx="0.5" />
    <rect x="6" y="7" width="8" height="2" rx="0.5" />
    <rect x="6" y="11" width="8" height="2" rx="0.5" />
  </svg>
);

const OrderedListIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <text x="1" y="5.5" fontSize="5" fontFamily="sans-serif" fontWeight="600">1</text>
    <text x="1" y="9.5" fontSize="5" fontFamily="sans-serif" fontWeight="600">2</text>
    <text x="1" y="13.5" fontSize="5" fontFamily="sans-serif" fontWeight="600">3</text>
    <rect x="6" y="3" width="8" height="2" rx="0.5" />
    <rect x="6" y="7" width="8" height="2" rx="0.5" />
    <rect x="6" y="11" width="8" height="2" rx="0.5" />
  </svg>
);

const TaskListIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="1.5" y="2.5" width="5" height="5" rx="1" />
    <polyline points="3 5.5 4 6.5 6 3.5" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
    <line x1="9" y1="5" x2="14.5" y2="5" strokeLinecap="round" />
    <line x1="9" y1="12" x2="14.5" y2="12" strokeLinecap="round" />
  </svg>
);

const BlockquoteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M3 3h2.5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H4v1.5c0 .83.67 1.5 1.5 1.5H6v2h-.5A3.5 3.5 0 0 1 2 10.5V5a2 2 0 0 1 1-1.73V3zm7 0h2.5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H11v1.5c0 .83.67 1.5 1.5 1.5H13v2h-.5A3.5 3.5 0 0 1 9 10.5V5a2 2 0 0 1 1-1.73V3z" />
  </svg>
);

const CodeBlockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="none" />
    <polyline points="5 6 3 8 5 10" />
    <polyline points="11 6 13 8 11 10" />
    <line x1="9" y1="5" x2="7" y2="11" />
  </svg>
);

const HorizontalRuleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <rect x="1" y="7" width="14" height="2" rx="1" />
  </svg>
);

/* ── Button definitions ──────────────────────────────────────────── */

const BUTTONS: (ToolbarButton | "separator")[] = [
  {
    label: "Bold",
    shortcut: "B",
    icon: <BoldIcon />,
    action: (e) => e.chain().focus().toggleBold().run(),
    isActive: (e) => e.isActive("bold"),
  },
  {
    label: "Italic",
    shortcut: "I",
    icon: <ItalicIcon />,
    action: (e) => e.chain().focus().toggleItalic().run(),
    isActive: (e) => e.isActive("italic"),
  },
  {
    label: "Strikethrough",
    shortcut: "⇧X",
    icon: <StrikethroughIcon />,
    action: (e) => e.chain().focus().toggleStrike().run(),
    isActive: (e) => e.isActive("strike"),
  },
  {
    label: "Code",
    shortcut: "E",
    icon: <CodeIcon />,
    action: (e) => e.chain().focus().toggleCode().run(),
    isActive: (e) => e.isActive("code"),
  },
  "separator",
  {
    label: "Heading 1",
    shortcut: "⌥1",
    icon: <H1Icon />,
    action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    isActive: (e) => e.isActive("heading", { level: 1 }),
  },
  {
    label: "Heading 2",
    shortcut: "⌥2",
    icon: <H2Icon />,
    action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    isActive: (e) => e.isActive("heading", { level: 2 }),
  },
  {
    label: "Heading 3",
    shortcut: "⌥3",
    icon: <H3Icon />,
    action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    isActive: (e) => e.isActive("heading", { level: 3 }),
  },
  "separator",
  {
    label: "Bullet List",
    shortcut: "⇧8",
    icon: <BulletListIcon />,
    action: (e) => e.chain().focus().toggleBulletList().run(),
    isActive: (e) => e.isActive("bulletList"),
  },
  {
    label: "Ordered List",
    shortcut: "⇧7",
    icon: <OrderedListIcon />,
    action: (e) => e.chain().focus().toggleOrderedList().run(),
    isActive: (e) => e.isActive("orderedList"),
  },
  {
    label: "Task List",
    shortcut: "⇧9",
    icon: <TaskListIcon />,
    action: (e) => e.chain().focus().toggleTaskList().run(),
    isActive: (e) => e.isActive("taskList"),
  },
  "separator",
  {
    label: "Blockquote",
    shortcut: "⇧B",
    icon: <BlockquoteIcon />,
    action: (e) => e.chain().focus().toggleBlockquote().run(),
    isActive: (e) => e.isActive("blockquote"),
  },
  {
    label: "Code Block",
    shortcut: "⌥C",
    icon: <CodeBlockIcon />,
    action: (e) => e.chain().focus().toggleCodeBlock().run(),
    isActive: (e) => e.isActive("codeBlock"),
  },
  {
    label: "Horizontal Rule",
    icon: <HorizontalRuleIcon />,
    action: (e) => e.chain().focus().setHorizontalRule().run(),
  },
];

export function Toolbar({ editor, heldModifier, disabled = false }: ToolbarProps) {
  const handleClick = useCallback(
    (btn: ToolbarButton) => {
      if (editor && !disabled) btn.action(editor);
    },
    [editor, disabled],
  );

  if (!editor) return null;

  return (
    <div className="markd-toolbar">
      {BUTTONS.map((btn, i) => {
        if (btn === "separator") {
          return <div key={i} className="separator" />;
        }
        const active = !disabled && (btn.isActive?.(editor) ?? false);
        return (
          <button
            key={btn.label}
            title={disabled ? `${btn.label} — rendered mode only` : formatTitle(btn.label, btn.shortcut)}
            className={active ? "active" : ""}
            disabled={disabled}
            onClick={() => handleClick(btn)}
          >
            {btn.icon}
            {heldModifier === "ctrl" && btn.shortcut && (
              <span className="markd-hotkey-hint">{btn.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
