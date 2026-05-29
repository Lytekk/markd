import { Node as PmNode, Schema } from "@tiptap/pm/model";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 } },
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    },
    codeBlock: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      defining: true,
      attrs: { language: { default: null } },
      toDOM: (node) => [
        "pre",
        ["code", node.attrs.language ? { class: `language-${node.attrs.language}` } : {}, 0],
      ],
    },
    text: { group: "inline", inline: true },
  },
});

export function createTestDoc(
  blocks: { type: "heading" | "paragraph" | "code"; text: string; level?: number; language?: string }[],
): PmNode {
  const nodes = blocks.map((b) => {
    if (b.type === "heading") {
      return schema.nodes.heading!.create({ level: b.level ?? 1 }, b.text ? schema.text(b.text) : undefined);
    }
    if (b.type === "code") {
      return schema.nodes.codeBlock!.create(
        { language: b.language ?? null },
        b.text ? schema.text(b.text) : undefined,
      );
    }
    return schema.nodes.paragraph!.create({}, b.text ? schema.text(b.text) : undefined);
  });
  return schema.nodes.doc!.create({}, nodes);
}
