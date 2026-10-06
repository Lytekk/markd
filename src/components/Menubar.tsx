import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { messageModal } from "@/lib/modal";

export interface MenuItem {
  label: string;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  checked?: boolean;
  children?: MenuEntry[];
}

export type MenuEntry = MenuItem | "separator";

export interface Menu {
  label: string;
  items: MenuEntry[];
}

interface MenubarProps {
  editor: TiptapEditor | null;
  sidebarCollapsed: boolean;
  sourceMode: boolean;
  focusMode: boolean;
  fullWidth: boolean;
  activeTheme: string;
  themes: readonly { id: string; name: string }[];
  onNew: () => void;
  onOpen: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  onFind: () => void;
  onReplace: () => void;
  onToggleSidebar: () => void;
  onToggleSource: () => void;
  onToggleFocusMode: () => void;
  onToggleFullWidth: () => void;
  onThemeSelect: (id: string) => void;
  onCheckForUpdates: () => void;
  onNewTab: () => void;
  onCloseTab: () => void;
  onNextTab: () => void;
  onPrevTab: () => void;
}

function runExec(cmd: "cut" | "copy" | "paste"): void {
  // document.execCommand is deprecated in spec but still supported by WebView2
  // and WKWebView; it remains the simplest way to trigger clipboard ops on the
  // focused editor without requiring clipboard-read permissions.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  (document as Document).execCommand(cmd);
}

export function Menubar(props: MenubarProps) {
  const {
    editor,
    sidebarCollapsed,
    sourceMode,
    focusMode,
    fullWidth,
    activeTheme,
    themes,
    onNew,
    onOpen,
    onOpenFolder,
    onSave,
    onSaveAs,
    onExportHtml,
    onExportPdf,
    onFind,
    onReplace,
    onToggleSidebar,
    onToggleSource,
    onToggleFocusMode,
    onToggleFullWidth,
    onThemeSelect,
    onCheckForUpdates,
    onNewTab,
    onCloseTab,
    onNextTab,
    onPrevTab,
  } = props;

  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const focusActive = () => {
    if (sourceMode) document.querySelector<HTMLTextAreaElement>(".markd-source-textarea")?.focus({ preventScroll: true });
    else editor?.commands.focus(undefined, { scrollIntoView: false });
  };
  const clipboard = (command: "cut" | "copy" | "paste") => { focusActive(); runExec(command); };
  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "New", shortcut: "Ctrl+N", onSelect: onNew },
        { label: "Open…", shortcut: "Ctrl+O", onSelect: onOpen },
        { label: "Open Folder…", onSelect: onOpenFolder },
        "separator",
        { label: "Save", shortcut: "Ctrl+S", onSelect: onSave },
        { label: "Save As…", shortcut: "Ctrl+Shift+S", onSelect: onSaveAs },
        "separator",
        { label: "New Tab", shortcut: "Ctrl+T", onSelect: onNewTab },
        { label: "Close Tab", shortcut: "Ctrl+W", onSelect: onCloseTab },
        { label: "Next Tab", shortcut: "Ctrl+Tab", onSelect: onNextTab },
        { label: "Previous Tab", shortcut: "Ctrl+Shift+Tab", onSelect: onPrevTab },
        "separator",
        { label: "Export as HTML…", onSelect: onExportHtml },
        { label: "Export as PDF…", onSelect: onExportPdf },
      ],
    },
    {
      label: "Edit",
      items: [
        {
          label: "Undo",
          shortcut: "Ctrl+Z",
          onSelect: () => { focusActive(); editor?.commands.undo(); },
          disabled: !editor?.can().undo(),
        },
        {
          label: "Redo",
          shortcut: "Ctrl+Shift+Z",
          onSelect: () => { focusActive(); editor?.commands.redo(); },
          disabled: !editor?.can().redo(),
        },
        "separator",
        {
          label: "Cut",
          shortcut: "Ctrl+X",
          onSelect: () => clipboard("cut"),
        },
        {
          label: "Copy",
          shortcut: "Ctrl+C",
          onSelect: () => clipboard("copy"),
        },
        {
          label: "Paste",
          shortcut: "Ctrl+V",
          onSelect: () => clipboard("paste"),
        },
        {
          label: "Select All",
          shortcut: "Ctrl+A",
          onSelect: () => { focusActive(); if (sourceMode) document.querySelector<HTMLTextAreaElement>(".markd-source-textarea")?.select(); else editor?.commands.selectAll(); },
        },
        "separator",
        { label: "Find…", shortcut: "Ctrl+F", onSelect: onFind },
        { label: "Replace…", shortcut: "Ctrl+H", onSelect: onReplace },
      ],
    },
    {
      label: "View",
      items: [
        {
          label: sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar",
          shortcut: "Ctrl+\\",
          onSelect: onToggleSidebar,
          checked: !sidebarCollapsed,
        },
        {
          label: "Toggle Source Mode",
          shortcut: "Ctrl+/",
          onSelect: onToggleSource,
          checked: sourceMode,
        },
        {
          label: "Full Width",
          onSelect: onToggleFullWidth,
          checked: fullWidth,
        },
        {
          label: "Focus Mode",
          onSelect: onToggleFocusMode,
          checked: focusMode,
        },
        "separator",
        {
          label: "Theme",
          children: themes.map((t) => ({
            label: t.name,
            onSelect: () => onThemeSelect(t.id),
            checked: t.id === activeTheme,
          })),
        },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Check for Updates…", onSelect: onCheckForUpdates },
        "separator",
        {
          label: "About Markd",
          onSelect: () =>
            void messageModal(
              `Markd ${__APP_VERSION__}\n\nA distraction-free markdown editor.`,
              { title: "About Markd" },
            ),
        },
      ],
    },
  ];

  const close = useCallback(() => setOpenIndex(null), []);

  useEffect(() => {
    if (openIndex === null) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openIndex, close]);

  const handleTopClick = (i: number) => {
    setOpenIndex((cur) => (cur === i ? null : i));
  };

  const handleTopEnter = (i: number) => {
    if (openIndex !== null) setOpenIndex(i);
  };

  const handleSelect = (item: MenuItem) => {
    if (item.disabled || item.children) return;
    item.onSelect?.();
    close();
  };

  return (
    <div className="markd-menubar" ref={rootRef} onMouseDown={(e) => e.preventDefault()}>
      {menus.map((menu, i) => (
        <div
          key={menu.label}
          className={`markd-menubar-root ${openIndex === i ? "open" : ""}`}
        >
          <button
            className="markd-menubar-label"
            onClick={() => handleTopClick(i)}
            onMouseEnter={() => handleTopEnter(i)}
          >
            {menu.label}
          </button>
          {openIndex === i && (
            <DropdownList items={menu.items} onSelect={handleSelect} />
          )}
        </div>
      ))}
    </div>
  );
}

function DropdownList({
  items,
  onSelect,
}: {
  items: MenuEntry[];
  onSelect: (item: MenuItem) => void;
}) {
  return (
    <div className="markd-menubar-dropdown">
      {items.map((entry, i) => {
        if (entry === "separator") {
          return <div key={`sep-${i}`} className="markd-menubar-separator" />;
        }
        return (
          <MenuItemRow key={entry.label} item={entry} onSelect={onSelect} />
        );
      })}
    </div>
  );
}

function MenuItemRow({
  item,
  onSelect,
}: {
  item: MenuItem;
  onSelect: (item: MenuItem) => void;
}) {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const hasChildren = !!item.children?.length;

  return (
    <div
      className={`markd-menubar-item ${item.disabled ? "disabled" : ""}`}
      onMouseEnter={() => hasChildren && setSubmenuOpen(true)}
      onMouseLeave={() => hasChildren && setSubmenuOpen(false)}
      onClick={() => onSelect(item)}
    >
      <span className="markd-menubar-check">{item.checked ? "\u2713" : ""}</span>
      <span className="markd-menubar-item-label">{item.label}</span>
      {item.shortcut && (
        <span className="markd-menubar-shortcut">{item.shortcut}</span>
      )}
      {hasChildren && <span className="markd-menubar-chevron">{"\u25B8"}</span>}
      {hasChildren && submenuOpen && item.children && (
        <div className="markd-menubar-submenu">
          <DropdownList items={item.children} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}
