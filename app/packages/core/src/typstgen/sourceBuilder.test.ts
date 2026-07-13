import { describe, expect, it } from "vitest";

import { TypstSourceBuilder } from "./sourceBuilder.js";

describe("TypstSourceBuilder", () => {
  it("records UTF-8 byte spans and one-based lines deterministically", () => {
    const builder = new TypstSourceBuilder();
    builder.append("// 🐑\n");
    builder.mapped("title", "title", "body", (mapped) => {
      mapped.append('#text("Peace")\n');
    }, false);
    builder.mapped("footer", "footerSource", "page-foreground", (mapped) => {
      mapped.append('#text("εἰρήνη")\n');
    }, false);

    const result = builder.build();
    expect(result.source).toBe(
      '// 🐑\n#text("Peace")\n#text("εἰρήνη")\n'
    );
    expect(result.sourceMap.entries).toEqual([
      {
        resolvedId: "title",
        sourceElementId: "title",
        region: "body",
        startByte: new TextEncoder().encode("// 🐑\n").byteLength,
        endByte: new TextEncoder().encode('// 🐑\n#text("Peace")\n').byteLength,
        startLine: 2,
        endLine: 3,
      },
      {
        resolvedId: "footer",
        sourceElementId: "footerSource",
        region: "page-foreground",
        startByte: new TextEncoder().encode('// 🐑\n#text("Peace")\n').byteLength,
        endByte: new TextEncoder().encode(
          '// 🐑\n#text("Peace")\n#text("εἰρήνη")\n'
        ).byteLength,
        startLine: 3,
        endLine: 4,
      },
    ]);
  });

  it("rejects accidental CRLF output", () => {
    const builder = new TypstSourceBuilder();
    expect(() => builder.append("bad\r\n")).toThrow(/LF/);
  });

  it("returns defensive source-map arrays", () => {
    const builder = new TypstSourceBuilder();
    builder.mapped("a", "sourceA", "body", (mapped) => mapped.append("a"));
    const first = builder.build();
    const second = builder.build();
    expect(first.sourceMap.entries).not.toBe(second.sourceMap.entries);
    expect(first.sourceMap).toEqual(second.sourceMap);
  });

  it("emits escaped queryable navigation markers", () => {
    const builder = new TypstSourceBuilder();
    builder.mapped('resolved"a', "source\\a", "body", (mapped) => mapped.append("content"));
    expect(builder.build().source).toBe(
      '#metadata((resolvedId: "resolved\\"a", sourceElementId: "source\\\\a", region: "body")) <cbb-source>\ncontent',
    );
  });
});
