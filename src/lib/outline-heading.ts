import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const outlineHeadingKey = new PluginKey<number | null>("outlineHeading");
export const OUTLINE_HEADING_CLASS = "markd-outline-heading-active";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    outlineHeading: {
      /** Mirror the sidebar's active heading; null clears the highlight. */
      setOutlineHeading: (pos: number | null) => ReturnType;
    };
  }
}

/** Presentation only: no document marks, selection changes, or undo steps. */
export const OutlineHeading = Extension.create({
  name: "outlineHeading",
  addCommands() {
    return {
      setOutlineHeading: pos => ({ state, tr, dispatch }) => {
        if (outlineHeadingKey.getState(state) !== pos && dispatch) {
          tr.setMeta(outlineHeadingKey, pos).setMeta("addToHistory", false);
        }
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin<number | null>({
      key: outlineHeadingKey,
      state: {
        init: () => null,
        apply(tr, previous) {
          const explicit = tr.getMeta(outlineHeadingKey) as number | null | undefined;
          let pos = explicit === undefined ? previous : explicit;
          if (pos === null) return null;
          if (explicit === undefined && tr.docChanged) {
            // Whole-document loads must never inherit the departing tab's row.
            if (tr.getMeta("preventUpdate")) return null;
            const mapped = tr.mapping.mapResult(pos);
            if (mapped.deleted) return null;
            pos = mapped.pos;
          }
          return pos >= 0 && pos < tr.doc.content.size && tr.doc.nodeAt(pos)?.type.name === "heading"
            ? pos : null;
        },
      },
      props: {
        decorations(state) {
          const pos = outlineHeadingKey.getState(state);
          if (pos == null) return null;
          const node = state.doc.nodeAt(pos);
          return node?.type.name === "heading" ? DecorationSet.create(state.doc, [
            Decoration.node(pos, pos + node.nodeSize, { class: OUTLINE_HEADING_CLASS }),
          ]) : null;
        },
      },
    })];
  },
});
