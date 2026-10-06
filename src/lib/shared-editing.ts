import { Extension, type CommandProps } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

export interface EditingBridge {
  travel: (redo: boolean, props: CommandProps) => boolean;
  isSource: () => boolean;
}
/** Replaces native history when the app provides its tab-owned edit session. */
export const SharedEditing = Extension.create<{ bridge: EditingBridge }>({
  name: "sharedEditing",
  addCommands() {
    return {
      undo: () => props => this.options.bridge.travel(false, props),
      redo: () => props => this.options.bridge.travel(true, props),
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-z": () => this.editor.commands.undo(),
      "Mod-Shift-z": () => this.editor.commands.redo(),
      "Mod-y": () => this.editor.commands.redo(),
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      props: { handleDOMEvents: { beforeinput: (_view, event) => {
        const type = (event as InputEvent).inputType;
        if (type !== "historyUndo" && type !== "historyRedo") return false;
        event.preventDefault();
        return type === "historyUndo" ? this.editor.commands.undo() : this.editor.commands.redo();
      } } },
      appendTransaction: (transactions, _old, state) => {
        if (this.options.bridge.isSource() || !transactions.some(tr => (tr.docChanged || tr.storedMarksSet) && !tr.getMeta("preventUpdate"))) return null;
        // Formatting and programmatic keyboard edits often don't request this.
        // Reuse PM's caret reveal for every real edit, never for file/mode loads.
        return state.tr.scrollIntoView();
      },
    })];
  },
});
