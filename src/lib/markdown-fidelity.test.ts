import { describe, it, expect } from "vitest";
import { Editor as TiptapEditor } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import { getExtensions } from "@/lib/editor-extensions";
import {
  minimalMarkdownEscape,
  ensureTrailingNewline,
  matchLineEndings,
  resolveSaveContent,
} from "./markdown-fidelity";

// ---------------------------------------------------------------------------
// Pure escaping policy
// ---------------------------------------------------------------------------

describe("minimalMarkdownEscape", () => {
  it("always escapes backtick, backslash and opening bracket", () => {
    expect(minimalMarkdownEscape("a ` b")).toBe("a \\` b");
    expect(minimalMarkdownEscape("a \\ b")).toBe("a \\\\ b");
    expect(minimalMarkdownEscape("a [link] b")).toBe("a \\[link] b");
  });

  it("never escapes a closing bracket (inert without an unescaped opener)", () => {
    expect(minimalMarkdownEscape("a ] b")).toBe("a ] b");
  });

  it("leaves a single tilde alone but escapes doubled tildes (strikethrough)", () => {
    expect(minimalMarkdownEscape("approx ~30 files")).toBe("approx ~30 files");
    expect(minimalMarkdownEscape("not ~~strike~~ here")).toBe("not \\~\\~strike\\~\\~ here");
  });

  it("leaves whitespace-isolated * and _ alone (cannot flank per CommonMark)", () => {
    expect(minimalMarkdownEscape("5 * 3 = 15")).toBe("5 * 3 = 15");
    expect(minimalMarkdownEscape("a _ b")).toBe("a _ b");
  });

  it("escapes * and _ that touch non-whitespace (could open/close emphasis)", () => {
    expect(minimalMarkdownEscape("glob **/*.md pattern")).toBe("glob \\*\\*/\\*.md pattern");
    expect(minimalMarkdownEscape("literal *emph* text")).toBe("literal \\*emph\\* text");
  });

  it("keeps the intraword underscore exception", () => {
    expect(minimalMarkdownEscape("snake_case_name")).toBe("snake_case_name");
  });

  it("escapes * and _ at string edges (adjacent inline node unknown)", () => {
    expect(minimalMarkdownEscape("*edge")).toBe("\\*edge");
    expect(minimalMarkdownEscape("edge_")).toBe("edge\\_");
  });

  it("keeps start-of-line escapes for bullets, headings and blockquotes", () => {
    expect(minimalMarkdownEscape("- item", true)).toBe("\\- item");
    expect(minimalMarkdownEscape("# heading", true)).toBe("\\# heading");
    expect(minimalMarkdownEscape("> quote", true)).toBe("\\> quote");
    expect(minimalMarkdownEscape("1. item", true)).toBe("1\\. item");
  });

  it("applies escapeExtraCharacters when provided", () => {
    expect(minimalMarkdownEscape("a|b", false, /\|/g)).toBe("a\\|b");
  });
});

// ---------------------------------------------------------------------------
// Save-content decisions
// ---------------------------------------------------------------------------

describe("ensureTrailingNewline", () => {
  it("appends a newline when the reference file ended with one", () => {
    expect(ensureTrailingNewline("text", "old\n")).toBe("text\n");
  });

  it("does not double an existing newline", () => {
    expect(ensureTrailingNewline("text\n", "old\n")).toBe("text\n");
  });

  it("leaves output bare when the reference had no trailing newline", () => {
    expect(ensureTrailingNewline("text", "old")).toBe("text");
  });

  it("defaults to POSIX trailing newline for never-saved files", () => {
    expect(ensureTrailingNewline("text", "")).toBe("text\n");
  });

  it("keeps an empty serialization empty (no stray newline file)", () => {
    expect(ensureTrailingNewline("", "")).toBe("");
  });
});

describe("matchLineEndings", () => {
  it("converts LF serialization to CRLF when the source file used CRLF", () => {
    expect(matchLineEndings("a\nb\n", "x\r\ny\r\n")).toBe("a\r\nb\r\n");
  });

  it("leaves LF output alone for LF sources", () => {
    expect(matchLineEndings("a\nb\n", "x\ny\n")).toBe("a\nb\n");
  });

  it("does not double-convert existing CRLF", () => {
    expect(matchLineEndings("a\r\nb\n", "x\r\n")).toBe("a\r\nb\r\n");
  });
});

describe("resolveSaveContent", () => {
  it("re-applies the source's CRLF convention on dirty saves", () => {
    expect(resolveSaveContent(true, "old\r\nfile\r\n", () => "new\n\ntext")).toBe(
      "new\r\n\r\ntext\r\n",
    );
  });

  it("writes savedContent VERBATIM when the buffer is clean — never re-serializes", () => {
    const serialize = () => {
      throw new Error("must not serialize a clean buffer");
    };
    expect(resolveSaveContent(false, "exact\nbytes\n", serialize)).toBe("exact\nbytes\n");
  });

  it("serializes (with trailing-newline preservation) when dirty", () => {
    expect(resolveSaveContent(true, "old\n", () => "new text")).toBe("new text\n");
  });

  it("serializes for a dirty never-saved buffer", () => {
    expect(resolveSaveContent(true, "", () => "draft")).toBe("draft\n");
  });
});

// ---------------------------------------------------------------------------
// Round-trip fidelity through the real app pipeline
// ---------------------------------------------------------------------------

function roundTrip(md: string): string {
  const editor = new TiptapEditor({
    extensions: [
      ...getExtensions({ getFileDir: () => "" }),
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: "-",
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
  });
  try {
    editor.commands.setContent(md, false);
    // Mirror the save path: serialize + preserve the source's newline convention.
    return ensureTrailingNewline(editor.storage.markdown.getMarkdown() as string, md);
  } finally {
    editor.destroy();
  }
}

describe("round-trip fidelity (app extension pipeline)", () => {
  const IDENTICAL: Record<string, string> = {
    "angle brackets in plain text": "Use a < b and a > b in prose.\n",
    "tilde in plain text": "approx ~30 files\n",
    "whitespace-isolated asterisk": "5 * 3 = 15\n",
    "intraword underscores": "use snake_case_name here\n",
    "bold containing code": "**bold with `code` inside**\n",
    "strikethrough still works": "~~gone~~ kept\n",
    "trailing newline": "last line\n",
    "adjacent blocks": "para one\n\n> quote\n\npara two\n",
    "adjacent lists": "- a\n- b\n\n1. x\n2. y\n",
    "heading + table": "## H\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n",
    "fenced code with magic chars": "```bash\nrg -n \"<x>\" *.md ~/dir\n```\n",
  };

  for (const [name, src] of Object.entries(IDENTICAL)) {
    it(`byte-identical: ${name}`, () => {
      expect(roundTrip(src)).toBe(src);
    });
  }

  // Literal markup-looking text that arrived ESCAPED in the source must stay
  // escaped — minimal escaping must not under-escape into semantic drift.
  it("re-escapes literal emphasis markers that touch words", () => {
    const src = "literal \\*not em\\* text\n";
    expect(roundTrip(src)).toBe(src);
  });

  // Accepted NORMALIZATIONS (not corruption): the serializer may rewrite
  // these once, but a second round-trip must be a fixed point — otherwise
  // every save churns the diff again.
  const NORMALIZED: Record<string, string> = {
    "underscore emphasis": "some _emphasis_ here\n",
    "asterisk bullets": "* a\n* b\n",
  };

  for (const [name, src] of Object.entries(NORMALIZED)) {
    it(`idempotent after one normalization: ${name}`, () => {
      const once = roundTrip(src);
      expect(roundTrip(once)).toBe(once);
    });
  }

  // Raw HTML preservation — markdown-it html_inline/html_block tokens are
  // bridged into raw-HTML atom nodes (same pattern as the KaTeX data-latex
  // bridge in math.ts) and serialized verbatim. Before this, raw tags were
  // silently DELETED at parse time (actual data loss).
  it("raw inline html placeholder survives", () => {
    const src = "Run `cmd` with <placeholder> args.\n";
    expect(roundTrip(src)).toBe(src);
  });

  it("raw inline html span with attributes survives (open and close tags)", () => {
    const src = 'A <span data-x="1">kept</span> span.\n';
    expect(roundTrip(src)).toBe(src);
  });

  it("raw inline html inside bold survives (CAPABILITIES.md regression)", () => {
    const src = "**Call convention: pass `path`=<abs repo root>, OMIT `cwd`**\n";
    expect(roundTrip(src)).toBe(src);
  });

  it("raw html block survives", () => {
    const src = "before\n\n<details>\n<summary>More</summary>\ntext\n</details>\n\nafter\n";
    expect(roundTrip(src)).toBe(src);
  });

  it("raw html round-trip is idempotent", () => {
    const src = "Mix <kbd>Ctrl</kbd>+<kbd>S</kbd> keys.\n";
    const once = roundTrip(src);
    expect(roundTrip(once)).toBe(once);
  });

  it("multi-line raw html block inside a blockquote keeps the quote prefixes", () => {
    const src = "> <details>\n> <summary>S</summary>\n> body\n> </details>\n";
    expect(roundTrip(src)).toBe(src);
  });

  it("preserves a raw <br> as source (KNOWN one-time churn: adjacent soft newline collapses)", () => {
    // Pre-patch, <br> was rewritten to a backslash hard-break (byte drift +
    // the original form lost). Now the tag survives verbatim; the soft
    // newline next to it is collapsed by DOM parsing once, then stable.
    const once = roundTrip("line one<br>\nline two\n");
    expect(once).toBe("line one<br>line two\n");
    expect(roundTrip(once)).toBe(once);
  });

  // KNOWN LOSSES in tables — tiptap-markdown's cell serializer (a) skips
  // cells whose only content is an atom (textContent.trim() guard) and
  // (b) doesn't pipe-escape inline-code content. Both PRE-DATE this patch
  // (raw HTML in cells was deleted everywhere before; \| in cell code was
  // already corrupted at HEAD). Fixing them means forking the table
  // serializer — pinned here so CI flips loudly when that lands.
  it.fails("KNOWN LOSS: raw-html-only table cell survives", () => {
    const src = "| <br> | x |\n| --- | --- |\n| 1 | 2 |\n";
    expect(roundTrip(src)).toBe(src);
  });

  it.fails("KNOWN LOSS: pipe inside code in a table cell survives", () => {
    const src = "| `a\\|b` | x |\n| --- | --- |\n| 1 | 2 |\n";
    expect(roundTrip(src)).toBe(src);
  });

  // The HTML export embeds editor.getHTML() verbatim (file-system.ts), so
  // its safety rests on PM's DOMSerializer escaping the raw-html source.
  // Pin that second layer: hostile sources must never parse to executable
  // elements.
  it("hostile raw html stays inert through getHTML (export-path guard)", () => {
    const editor = new TiptapEditor({
      extensions: [
        ...getExtensions({ getFileDir: () => "" }),
        Markdown.configure({ html: true, tightLists: true, bulletListMarker: "-" }),
      ],
    });
    try {
      editor.commands.setContent(
        'Hit <img src=x onerror=alert(1)> and\n\n<script>alert(2)</script>\n',
        false,
      );
      const dom = new DOMParser().parseFromString(editor.getHTML(), "text/html");
      expect(dom.querySelector("script")).toBeNull();
      expect(dom.querySelector("img")).toBeNull();
    } finally {
      editor.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// Acceptance: real-file round-trip (local only — files are machine-specific
// and private, never committed as fixtures). Run with:
//   ROUNDTRIP_FILES="$HOME/.claude/CLAUDE.md:$HOME/.claude/CAPABILITIES.md" \
//     pnpm exec vitest run src/lib/markdown-fidelity.test.ts
// ---------------------------------------------------------------------------

const acceptanceFiles = (process.env.ROUNDTRIP_FILES ?? "").split(":").filter(Boolean);

describe.runIf(acceptanceFiles.length > 0)("real-file round-trip acceptance", () => {
  for (const path of acceptanceFiles) {
    it(`byte-identical: ${path}`, async () => {
      const { readFileSync } = await import("node:fs");
      const src = readFileSync(path, "utf-8");
      expect(roundTrip(src)).toBe(src);
    });
  }
});
