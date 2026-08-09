import { useState, useEffect } from "react";
import type { TextStats } from "@/lib/text-stats";

interface StatusBarProps {
  /** Display name matching the active tab's label (incl. parent-dir prefix). */
  fileName: string;
  /** Full path of the active file — surfaced as a tooltip. */
  filePath: string | null;
  isDirty: boolean;
  theme: string;
  lastSaved: number | null;
  sourceMode: boolean;
  focusMode: boolean;
  fullWidth: boolean;
  lineNumbers: boolean;
  /**
   * Visible-text counts derived from authoritative savedContent (null =
   * unknown). Deltas against it render only while the buffer is dirty.
   */
  statsBaseline: TextStats | null;
  onThemeChange: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  onToggleSource: () => void;
  onToggleFocusMode: () => void;
  onToggleFullWidth: () => void;
  onToggleLineNumbers: () => void;
  zoom: number;
}

function StatDelta({
  current,
  baseline,
}: {
  current: number;
  baseline: number;
}) {
  const delta = current - baseline;
  if (delta === 0) return null;
  const cls = `markd-stat-delta ${delta > 0 ? "plus" : "minus"}`;
  return <span className={cls}>{delta > 0 ? `+${delta}` : `${delta}`}</span>;
}

// Download/export glyph shared by the HTML & PDF actions — the icon + bordered
// `markd-status-action` styling signal "one-shot action", distinct from the
// borderless toggles that fill in when active.
const ExportIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M8 2v8" />
    <path d="M5 7l3 3 3-3" />
    <path d="M3 13h10" />
  </svg>
);

export function StatusBar({
  fileName,
  filePath,
  isDirty,
  theme,
  lastSaved,
  sourceMode,
  focusMode,
  fullWidth,
  lineNumbers,
  statsBaseline,
  onThemeChange,
  onExportHtml,
  onExportPdf,
  onToggleSource,
  onToggleFocusMode,
  onToggleFullWidth,
  onToggleLineNumbers,
  zoom,
}: StatusBarProps) {
  const [stats, setStats] = useState<TextStats>({ words: 0, chars: 0 });
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setStats(detail);
    };
    window.addEventListener("markd:stats", handler);
    return () => window.removeEventListener("markd:stats", handler);
  }, []);

  // Flash "Saved" for 2 seconds after each save
  useEffect(() => {
    if (!lastSaved) return;
    setShowSaved(true);
    const timer = setTimeout(() => setShowSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [lastSaved]);

  const showDeltas = statsBaseline !== null && isDirty;

  return (
    <div className="markd-status-bar">
      <div className="left">
        <span className="markd-status-filename" title={filePath ?? undefined}>
          {fileName}
          {isDirty && <span className="markd-dirty-bullet">●</span>}
        </span>
        {showSaved && <span className="markd-saved-indicator">Saved</span>}
      </div>
      <div className="right">
        <span>
          {stats.words} words
          {showDeltas && (
            <StatDelta current={stats.words} baseline={statsBaseline.words} />
          )}
        </span>
        <span>
          {stats.chars} chars
          {showDeltas && (
            <StatDelta current={stats.chars} baseline={statsBaseline.chars} />
          )}
        </span>
        <button
          onClick={onToggleFocusMode}
          style={btnStyle}
          className={focusMode ? "status-btn-active" : ""}
          title="Toggle Focus Mode"
        >
          Focus
        </button>
        <button
          onClick={onToggleSource}
          style={btnStyle}
          className={sourceMode ? "status-btn-active" : ""}
          title="Toggle Source (Ctrl+/)"
        >
          Source
        </button>
        <button
          onClick={onToggleFullWidth}
          style={btnStyle}
          className={fullWidth ? "status-btn-active" : ""}
          title="Toggle Full Width"
        >
          {fullWidth ? "Full" : "Column"}
        </button>
        {sourceMode && (
          <button
            onClick={onToggleLineNumbers}
            style={btnStyle}
            className={lineNumbers ? "status-btn-active" : ""}
            title="Toggle Source Line Numbers"
          >
            {lineNumbers ? "Lines" : "No Lines"}
          </button>
        )}
        <span className="markd-status-divider" aria-hidden="true" />
        <button onClick={onExportHtml} className="markd-status-action" title="Export as HTML">
          <ExportIcon />
          HTML
        </button>
        <button onClick={onExportPdf} className="markd-status-action" title="Export as PDF">
          <ExportIcon />
          PDF
        </button>
        <button onClick={onThemeChange} style={btnStyle} title="Toggle Theme">
          {theme}
        </button>
        <span style={{ opacity: zoom === 100 ? 0.5 : 0.7 }} title="Zoom level (Ctrl+0 to reset)">
          {zoom}%
        </span>
        <span className="markd-version">v{__APP_VERSION__}</span>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "inherit",
  cursor: "pointer",
  fontSize: "inherit",
  padding: "2px 6px",
  borderRadius: 3,
};
