import { canonicalJsonBytes } from "@cbb/core";
import { describe, expect, it } from "vitest";
import { decodeCanonicalJson } from "./canonicalJson.js";

const encoded = (value: string) => new TextEncoder().encode(value);

describe("canonical persisted JSON decoder", () => {
  it("accepts the unique canonical encoding", () => {
    const value = { z: [true, null], a: "text" };
    expect(decodeCanonicalJson(canonicalJsonBytes(value))).toEqual(value);
  });

  it("rejects duplicate keys, whitespace, alternate numbers, and excessive depth", () => {
    expect(() => decodeCanonicalJson(encoded('{"a":1,"a":2}'))).toThrow(/canonical/);
    expect(() => decodeCanonicalJson(encoded('{ "a":1}'))).toThrow(/canonical/);
    expect(() => decodeCanonicalJson(encoded('{"a":1.0}'))).toThrow(/canonical/);
    expect(() => decodeCanonicalJson(encoded('[[[0]]]'), { maximumDepth: 2 })).toThrow(
      /nesting/,
    );
  });

  it("bounds individual strings before parsing", () => {
    expect(() => decodeCanonicalJson(encoded('"abcdef"'), {
      maximumStringBytes: 5,
    })).toThrow(/string/);
  });
});
