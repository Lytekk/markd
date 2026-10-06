import Link from "@tiptap/extension-link";
import { PasteRule } from "@tiptap/core";

/** `.md` is a real TLD. Keep upstream URL detection and safety checks, but
 * don't turn the tail of a filesystem path into a separate domain link. */
export const PathAwareLink = Link.extend({
  addPasteRules() {
    return (this.parent?.() ?? []).map(rule => new PasteRule({
      find: rule.find,
      handler: props => {
        // Read the document, not only the clipboard: the path prefix may have
        // already been typed before its filename was pasted.
        const from = props.state.doc.resolve(props.range.from);
        const preceding = from.parent.textBetween(Math.max(0, from.parentOffset - 1), from.parentOffset);
        if (preceding === "/" || preceding === "\\") return;
        return rule.handler(props);
      },
    }));
  },
});
