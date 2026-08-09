import { useState, useEffect, useRef } from "react";
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

// offset* values are integer layout pixels while getBoundingClientRect can end
// on a fractional device pixel. Keep one layout pixel of breathing room so a
// focused control is never left hairline-clipped at the rail edge.
const FOCUS_REVEAL_MARGIN_PX = 1;

function StatDelta({
  current,
  baseline,
  visible,
  label,
}: {
  current: number;
  baseline: number;
  visible: boolean;
  label: "words" | "characters";
}) {
  const delta = current - baseline;
  const hasDelta = visible && delta !== 0;
  const exactDelta = `${delta > 0 ? "+" : ""}${delta}`;
  const displayDelta = formatStatDelta(delta);
  const cls = [
    "markd-stat-delta",
    hasDelta ? (delta > 0 ? "plus" : "minus") : "is-slot-empty",
  ].join(" ");
  return (
    <span
      className={cls}
      aria-hidden={!hasDelta}
      aria-label={hasDelta ? `${delta > 0 ? "Added" : "Removed"} ${Math.abs(delta)} ${label}` : undefined}
      title={hasDelta ? `${exactDelta} ${label}` : undefined}
    >
      {hasDelta ? displayDelta : ""}
    </span>
  );
}

function formatStatDelta(delta: number): string {
  const sign = delta > 0 ? "+" : "-";
  const magnitude = Math.abs(delta);
  if (magnitude < 10_000) return `${sign}${magnitude}`;

  const units = ["k", "m", "b", "t", "q"];
  let unitIndex = Math.min(Math.floor(Math.log10(magnitude) / 3) - 1, units.length - 1);
  let scaled = magnitude / 1000 ** (unitIndex + 1);
  let rounded = scaled < 10 ? Number(scaled.toFixed(1)) : Math.round(scaled);

  // Values at the top of one unit can round into the next (999,999 → 1m).
  if (rounded >= 1000 && unitIndex < units.length - 1) {
    unitIndex += 1;
    scaled = magnitude / 1000 ** (unitIndex + 1);
    rounded = scaled < 10 ? Number(scaled.toFixed(1)) : Math.round(scaled);
  }

  return `${sign}${rounded}${units[unitIndex]}`;
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
  const rightRailRef = useRef<HTMLDivElement>(null);

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

  const revealFocusedSlot = (target: EventTarget | null) => {
    const rail = rightRailRef.current;
    const slot = target instanceof HTMLElement
      ? target.closest<HTMLElement>("[data-status-slot]")
      : null;
    if (!rail || !slot || slot.parentElement !== rail || rail.clientWidth === 0) return;
    const slotStart = slot.offsetLeft;
    const slotEnd = slotStart + slot.offsetWidth;
    const viewStart = rail.scrollLeft;
    const viewEnd = viewStart + rail.clientWidth;
    if (slotStart < viewStart) {
      rail.scrollLeft = Math.max(0, slotStart - FOCUS_REVEAL_MARGIN_PX);
    } else if (slotEnd > viewEnd) {
      rail.scrollLeft = slotEnd - rail.clientWidth + FOCUS_REVEAL_MARGIN_PX;
    }
  };

  return (
    <div className="markd-status-bar">
      <div className="left markd-status-left">
        <span
          className="markd-status-filename"
          title={filePath ?? undefined}
          aria-label={`${fileName}${isDirty ? ", unsaved changes" : ""}`}
          data-status-slot="filename"
        >
          <span className="markd-status-filename-text">{fileName}</span>
          <span
            className={`markd-dirty-bullet${isDirty ? "" : " is-slot-empty"}`}
            aria-hidden="true"
          >
            ●
          </span>
        </span>
        <span
          className={`markd-saved-indicator${showSaved ? " is-visible" : " is-slot-empty"}`}
          role="status"
          aria-live="polite"
          aria-hidden={!showSaved}
          data-status-slot="saved"
        >
          Saved
        </span>
      </div>
      <div
        ref={rightRailRef}
        className="right markd-status-right"
        onFocus={(event) => revealFocusedSlot(event.target)}
      >
        <span className="markd-status-stat" data-status-slot="words">
          <span className="markd-status-stat-value">{stats.words} words</span>
          <StatDelta
            current={stats.words}
            baseline={statsBaseline?.words ?? stats.words}
            visible={showDeltas}
            label="words"
          />
        </span>
        <span className="markd-status-stat" data-status-slot="chars">
          <span className="markd-status-stat-value">{stats.chars} chars</span>
          <StatDelta
            current={stats.chars}
            baseline={statsBaseline?.chars ?? stats.chars}
            visible={showDeltas}
            label="characters"
          />
        </span>
        <button
          onClick={onToggleFocusMode}
          className={`markd-status-toggle${focusMode ? " status-btn-active" : ""}`}
          title="Toggle Focus Mode"
          aria-pressed={focusMode}
          data-status-slot="focus"
        >
          Focus
        </button>
        <button
          onClick={onToggleSource}
          className={`markd-status-toggle${sourceMode ? " status-btn-active" : ""}`}
          title="Toggle Source (Ctrl+/)"
          aria-pressed={sourceMode}
          data-status-slot="source"
        >
          Source
        </button>
        <button
          onClick={onToggleFullWidth}
          className={`markd-status-toggle${fullWidth ? " status-btn-active" : ""}`}
          title="Toggle Full Width"
          aria-pressed={fullWidth}
          data-status-slot="width"
        >
          Full
        </button>
        <button
          onClick={onToggleLineNumbers}
          className={`markd-status-toggle markd-status-lines${
            sourceMode && lineNumbers ? " status-btn-active" : ""
          }`}
          title={sourceMode ? "Toggle Source Line Numbers" : "Lines are available in Source mode"}
          aria-label={sourceMode ? "Lines" : "Lines (available in Source mode)"}
          aria-pressed={sourceMode && lineNumbers}
          disabled={!sourceMode}
          data-status-slot="lines"
        >
          Lines
        </button>
        <span
          className="markd-status-divider"
          aria-hidden="true"
          data-status-slot="divider"
        />
        <button
          onClick={onExportHtml}
          className="markd-status-action"
          title="Export as HTML"
          data-status-slot="html"
        >
          <ExportIcon />
          HTML
        </button>
        <button
          onClick={onExportPdf}
          className="markd-status-action"
          title="Export as PDF"
          data-status-slot="pdf"
        >
          <ExportIcon />
          PDF
        </button>
        <button
          onClick={onThemeChange}
          className="markd-status-toggle"
          title="Toggle Theme"
          data-status-slot="theme"
        >
          {theme}
        </button>
        <span
          className="markd-status-zoom"
          style={{ opacity: zoom === 100 ? 0.5 : 0.7 }}
          title="Zoom level (Ctrl+0 to reset)"
          data-status-slot="zoom"
        >
          {zoom}%
        </span>
        <span className="markd-version" data-status-slot="version">
          v{__APP_VERSION__}
        </span>
      </div>
    </div>
  );
}
