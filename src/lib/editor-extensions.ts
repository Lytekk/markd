import StarterKit from "@tiptap/starter-kit";
import { Extension } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { common, createLowlight } from "lowlight";
import { SearchAndReplace } from "@/lib/search-and-replace";
import { SectionCommands } from "@/lib/section-commands";
import { ImagePasteDrop } from "@/lib/image-paste-drop";
import { ResolvedImage } from "@/lib/resolved-image";
import { CodeBlockEnhance } from "@/lib/code-block-enhance";
import { ExternalLinkOpen } from "@/lib/external-link-open";
import { SlashMenu } from "@/lib/slash-menu";
import { FocusMode } from "@/lib/focus-mode";
import { MermaidPreview } from "@/lib/mermaid-preview";
import { InlineMath, BlockMath } from "@/lib/math";
import { HeadingFlash } from "@/lib/heading-flash";
import { applyMinimalEscaping, FaithfulCode, FaithfulText } from "@/lib/markdown-fidelity";
import { RawInlineHTML, RawBlockHTML } from "@/lib/raw-html";

const lowlight = createLowlight(common);

const StrikeShortcut = Extension.create({
  name: "strikeShortcut",
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-x": () => this.editor.commands.toggleStrike(),
    };
  },
});

export interface ExtensionOptions {
  getFileDir: () => string;
}

export function getExtensions(opts: ExtensionOptions) {
  // Round-trip fidelity: swap prosemirror-markdown's over-eager escaping for
  // the minimal policy before any serializer exists (see markdown-fidelity.ts).
  applyMinimalEscaping();
  return [
    StarterKit.configure({
      codeBlock: false, // replaced by CodeBlockLowlight
      text: false, // replaced by FaithfulText (no HTML-entity escaping on save)
      code: false, // replaced by FaithfulCode (bold/italic may wrap code spans)
    }),
    FaithfulText,
    FaithfulCode,
    RawInlineHTML,
    RawBlockHTML,
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: "plaintext",
    }),
    ResolvedImage.configure({
      inline: true,
      allowBase64: true,
      getFileDir: opts.getFileDir,
    }),
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    Placeholder.configure({
      placeholder: "Start writing…",
    }),
    Link.configure({
      // Don't navigate the webview on click (that would leave the app). Opening
      // in the system browser is a separate, capability-gated follow-up.
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
    }),
    SearchAndReplace,
    ImagePasteDrop,
    SectionCommands,
    StrikeShortcut,
    CodeBlockEnhance,
    ExternalLinkOpen,
    SlashMenu,
    FocusMode,
    HeadingFlash,
    MermaidPreview,
    InlineMath,
    BlockMath,
  ];
}
