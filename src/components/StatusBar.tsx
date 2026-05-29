import { useState, useEffect } from "react";

interface StatusBarProps {
  fileName: string;
  isDirty: boolean;
  theme: string;
  lastSaved: number | null;
  sourceMode: boolean;
  focusMode: boolean;
  fullWidth: boolean;
  lineNumbers: boolean;
  onThemeChange: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  onToggleSource: () => void;
  onToggleFocusMode: () => void;
  onToggleFullWidth: () => void;
  onToggleLineNumbers: () => void;
  zoom: number;
}

export function StatusBar({
  fileName,
  isDirty,
  theme,
  lastSaved,
  sourceMode,
  focusMode,
  fullWidth,
  lineNumbers,
  onThemeChange,
  onExportHtml,
  onExportPdf,
  onToggleSource,
  onToggleFocusMode,
  onToggleFullWidth,
  onToggleLineNumbers,
  zoom,
}: StatusBarProps) {
  const [stats, setStats] = useState({ words: 0, chars: 0 });
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

  return (
    <div className="markd-status-bar">
      <div className="left">
        <span>
          {fileName}
          {isDirty ? " \u2022" : ""}
        </span>
        {showSaved && <span className="markd-saved-indicator">Saved</span>}
      </div>
      <div className="right">
        <span>{stats.words} words</span>
        <span>{stats.chars} chars</span>
        <button
          onClick={onToggleFocusMode}
          style={btnStyle}
          className={focusMode ? "status-btn-active" : ""}
          title="Toggle Focus Mode"
        >
          Focus
        </button>
        <button onClick={onToggleSource} style={btnStyle} title="Toggle Source (Ctrl+/)">
          {sourceMode ? "WYSIWYG" : "Source"}
        </button>
        <button
          onClick={onToggleFullWidth}
          style={btnStyle}
          className={fullWidth ? "status-btn-active" : ""}
          title="Toggle Full Width"
        >
          {fullWidth ? "Column" : "Full"}
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
