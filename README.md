# Markd

A distraction-free WYSIWYG markdown editor for Windows. Similar in spirit to Typora: rendered view by default, fenced source mode on demand, live preview of images and syntax-highlighted code blocks.

Built on [Tauri 2](https://v2.tauri.app/) (Rust) + [TipTap 2](https://tiptap.dev/) (React 19).

## Status

**A personal project, built for daily writing and shared publicly. Best-effort — no SLA, no warranty.**

Published publicly because it solves a real problem and a few people asked. If it works for you, great. If not, patches welcome — see below.

## Features

- WYSIWYG rendered view with a keyboard-shortcut source-mode toggle (Ctrl+/)
- File / Edit / View / Help menubar with native shortcuts
- Multi-tab editing with middle-click close, dirty indicators, Ctrl+T / Ctrl+W / Ctrl+Tab shortcuts, and an overflowing tab strip that follows the active tab
- Unsaved changes show a dot on the tab (hover swaps it for the close button) that clears when you save — or undo back to the saved state
- Live word/char counts with +/− deltas from the last successful save — identical in rendered and source modes, and cleared when saved
- Tab session persistence — tabs and scroll position survive Ctrl+R refresh and app restarts
- Per-tab scroll position remembered across tab switches
- External file modification detection — prompts to reload when a file changes on disk
- Recent files, folder-tree sidebar, outline panel with scroll-aware active heading highlight, and collapsible heading sections — the outline stays live in source mode too (parsed from the raw markdown, click to jump)
- Create, rename, and delete files/folders from the file-tree right-click menu (delete moves to the OS recycle bin, so it's recoverable)
- Drag-to-reorder document sections from the outline sidebar (or keyboard Alt+Up/Down)
- Find + replace (Ctrl+F / Ctrl+H) with regex, whole-word, and case-sensitive toggles — each tab remembers its last search, so reopening the panel picks up where you left off; works in source mode too, with in-text match highlighting, and the panel survives toggling between views
- F3 / Shift+F3 to find next/previous without reopening the panel; Ctrl+F3 to select word and search (both also work in source mode)
- Ctrl+R to reload active tab from disk; Ctrl+Shift+R to reload all tabs; Ctrl+Shift+S to save all
- Alt+1 / Alt+2 to switch sidebar between Files and Outline tabs
- Hotkey hint ribbon — hold Ctrl to see toolbar shortcuts, hold Alt to see sidebar shortcuts
- Auto-save every 30 seconds for named files
- Unsaved work is guarded on every exit — closing the window, closing a tab, Close All, and reloading from disk all prompt before anything is discarded
- Close All is recoverable: Ctrl+Shift+T walks back through the tabs it closed
- Opening a file from Explorer/Finder shows that document first, then restores the rest of your session behind it
- Exact logical line numbers in source mode (toggle via the source-mode status bar)
- Window size and position remembered across restarts
- Auto-update — checks GitHub Releases on startup (Ed25519-signed); choose **Install Now**, **Remind Me Later**, or **Skip This Version** (skip is per-version; a newer release prompts again)
- Two themes (Day, Night) — extendable via CSS custom properties. Startup always paints dark first so launching never flashes white; a Day-theme window cross-fades to light once the app is up
- Syntax highlighting for fenced code blocks (via [lowlight](https://github.com/wooorm/lowlight)), each with a hover copy button + language badge
- Mermaid diagrams — fenced ` ```mermaid ` blocks render as live SVG diagrams below the source (lazy-loaded; bad syntax shows an inline error, never a crash)
- LaTeX math via [KaTeX](https://katex.org) — inline `$x$` and block `$$...$$`; double-click a rendered formula to edit its source
- Slash menu — type `/` to insert headings, lists, tables, quotes, code blocks, dividers, and math at the caret
- Customizable text snippets (Ctrl+Space) with `{{date}}`/`{{time}}`/`{{datetime}}` tokens and an add/edit/delete manager
- Command palette (Ctrl+Shift+P) for quick command access
- Links — Ctrl+K to add/edit, Ctrl/Cmd-click to open in your system browser
- Relative image paths resolve against the current file's directory — your markdown stays portable
- Round-trip faithful saves — an untouched file saves byte-identical (no markdown normalization churn), raw HTML like `<placeholder>` or `<details>` blocks is preserved verbatim (shown as muted source chips), and `**bold with `code` inside**` survives
- Single-instance: opening a file while Markd is running opens it in a new tab
- `.md` / `.markdown` / `.mdx` / `.txt` file associations on install
- Full width toggle (Ctrl+Shift+F → status bar toggle) for the editor column
- PDF export via print-to-file with chrome-less print stylesheet

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+N | New file |
| Ctrl+O | Open file |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save all open tabs |
| Ctrl+W | Close tab |
| Ctrl+Shift+W | Close all tabs |
| Ctrl+T | New tab |
| Ctrl+Shift+T | Reopen last closed tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Cycle tabs |
| Ctrl+Shift+E | Quick-switch tabs (fuzzy search) |
| Ctrl+R | Reload active tab from disk |
| Ctrl+Shift+R | Reload all tabs from disk |
| Ctrl+/ | Toggle source mode |
| Ctrl+\\ | Toggle sidebar |
| Ctrl+F | Find |
| Ctrl+H | Find and replace |
| Ctrl+F3 | Find word at cursor |
| F3 / Shift+F3 | Find next / previous |
| Ctrl+Shift+X | Toggle strikethrough |
| Ctrl+Shift+P | Command palette |
| Ctrl+Space | Insert snippet (customizable) |
| / (in editor) | Slash menu — insert block (heading, list, table, code, math…) |
| Ctrl+K | Add / edit link |
| Alt+1 | Sidebar: Files |
| Alt+2 | Sidebar: Outline |
| Alt+Up/Down | Reorder section (in outline) |
| Hold Ctrl | Show toolbar shortcut hints |
| Hold Alt | Show sidebar shortcut hints |

## Known Issues

- UNC paths from WSL (`\\wsl.localhost\...`) work for opening markdown files and for the asset protocol that serves relative images, but they can be slow or flaky. Keep files on a local drive if you hit issues.
- Devtools are enabled in the current release binary. To disable, drop `"devtools"` from the `tauri` dependency's feature list in `src-tauri/Cargo.toml` — keep `"protocol-asset"`, which `assetProtocol.enable` requires; removing it fails the build.

## Install

Grab the latest release from [Releases](../../releases):

### Windows

- **MSI** — for IT-managed installs.
- **NSIS** (`Markd_*-setup.exe`) — for individual users. Uninstaller lands in *Apps & Features*.

Or run the bare `markd.exe` without installation — it's portable.

### macOS

- **DMG** (`Markd_*_universal.dmg`) — universal binary (Intel + Apple Silicon).

The macOS build is **not Apple-notarized** (no Apple Developer certificate), so Gatekeeper will warn on first launch: right-click the app → **Open** → **Open**, or clear the quarantine flag with `xattr -cr /Applications/Markd.app`. Auto-updates are still cryptographically verified (Ed25519) on every platform.

Known macOS limitations (Markd is primarily developed on Windows):
- Double-clicking an `.md` file in Finder opens Markd but may not load the file — use **Ctrl+O** inside the app.
- Custom shortcuts currently use **Ctrl**, not **Cmd** (TipTap's built-in formatting shortcuts respect Cmd).

## Build from Source

Requirements: [Node.js 20+](https://nodejs.org), [pnpm 10+](https://pnpm.io), [Rust toolchain](https://rustup.rs), [Visual Studio Build Tools with C++ workload](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Windows), [WebView2 runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (usually already installed on Windows 10/11).

```bash
pnpm install
pnpm tauri build
```

Output lands in `src-tauri/target/release/` — `markd.exe`, plus MSI and NSIS installers under `bundle/`.

For development with hot reload:

```bash
pnpm tauri dev
```

Tests:

```bash
pnpm exec tsc --noEmit                                   # typecheck
pnpm test:run                                            # frontend (vitest)
cargo test --manifest-path src-tauri/Cargo.toml --lib    # filesystem boundary (Rust)
```

All three run in CI on every push and pull request.

### Building from WSL

If you're on WSL, `pnpm tauri build` from ext4 fails because Node (WSL) invokes `cargo.exe` (Windows) and the tauri-cli mangles the returned UNC paths. Workaround: rsync the project to a Windows path first.

```bash
rsync -a --exclude=node_modules --exclude='src-tauri/target' --exclude=dist --exclude=.git . /mnt/c/temp/markd-build/
cmd.exe /c "cd /d C:\temp\markd-build && pnpm install && pnpm tauri build"
```

## Contributing

Bug reports with a minimal reproduction are appreciated — use the issue template. Feature requests are likely to be closed with a polite "not now"; this is a personal-scratch project, not a product.

Pull requests are welcome for:

- Bug fixes
- Themes (add a new CSS file under `src/styles/themes/` and it'll show up in the View menu)
- Accessibility improvements
- Documentation

Please don't open a PR for a large feature without opening an issue first — I'd rather save you the time if it's not going to merge.

## License

MIT — see [LICENSE](./LICENSE).

## Acknowledgments

- [Tauri](https://v2.tauri.app/) — the Rust + webview framework
- [TipTap](https://tiptap.dev/) — the editor engine
- [tiptap-markdown](https://github.com/aguingand/tiptap-markdown) — markdown parser/serializer on top of TipTap
- [lowlight](https://github.com/wooorm/lowlight) — syntax highlighting
- [Typora](https://typora.io/) — for the design target
