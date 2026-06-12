export interface TextStats {
  words: number;
  chars: number;
}

/**
 * Word/char counts shown in the status bar. Words are whitespace-separated
 * runs. Shared by the rendered-mode stats dispatch (doc.textContent), the
 * source-mode dispatch (raw markdown body), and the open-time baseline so all
 * three count identically.
 */
export function computeTextStats(text: string): TextStats {
  return {
    words: text.split(/\s+/).filter(Boolean).length,
    chars: text.length,
  };
}
