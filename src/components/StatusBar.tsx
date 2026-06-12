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
   * Word/char counts captured when the file was opened (null = unknown).
   * Deltas against it render vivid while dirty, faded once saved, and hide at
   * zero (e.g. after undoing back to the open-time state).
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
  faded,
}: {
  current: number;
  baseline: number;
  faded: boolean;
}) {
  const delta = current - baseline;
  if (delta === 0) return null;
  const cls = `markd-stat-delta ${delta > 0 ? "plus" : "minus"}${faded ? " faded" : ""}`;
  return <span className={cls}>{delta > 0 ? `+${delta}` : `${delta}`}</span>;
}

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

  // Source mode counts raw markdown while the baseline counted rendered text —
  // a delta across those bases is noise, so suppress it there.
  const showDeltas = statsBaseline !== null && !sourceMode;

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
            <StatDelta current={stats.words} baseline={statsBaseline.words} faded={!isDirty} />
          )}
        </span>
        <span>
          {stats.chars} chars
          {showDeltas && (
            <StatDelta current={stats.chars} baseline={statsBaseline.chars} faded={!isDirty} />
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
        <button
          onClick={onToggleLineNumbers}
          style={btnStyle}
          className={lineNumbers ? "status-btn-active" : ""}
          title="Toggle Line Numbers"
        >
          {lineNumbers ? "Lines" : "No Lines"}
        </button>
        <button onClick={onExportHtml} style={btnStyle} title="Export as HTML">
          HTML
        </button>
        <button onClick={onExportPdf} style={btnStyle} title="Export as PDF">
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