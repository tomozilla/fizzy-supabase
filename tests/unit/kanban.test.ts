import { describe, expect, it } from "vitest";
import {
  nameMatchesHandle,
  nextPosition,
  parseMentionHandles,
  slugify,
} from "@/lib/kanban";

describe("nextPosition", () => {
  it("returns 0 for an empty list", () => {
    expect(nextPosition([])).toBe(0);
  });

  it("returns one more than the highest existing position", () => {
    expect(nextPosition([{ position: 0 }, { position: 3 }, { position: 1 }])).toBe(4);
  });

  it("handles a single item", () => {
    expect(nextPosition([{ position: 5 }])).toBe(6);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Tomo's Workspace", "abcd1234")).toBe("tomo-s-workspace-abcd1234");
  });

  it("strips leading/trailing hyphens from punctuation", () => {
    expect(slugify("!!!Weird Name!!!", "xyz")).toBe("weird-name-xyz");
  });

  it("falls back to 'workspace' if the name has no alphanumerics", () => {
    expect(slugify("!!!", "abc")).toBe("workspace-abc");
  });
});

describe("parseMentionHandles", () => {
  it("extracts a single mention", () => {
    expect(parseMentionHandles("hi @Ada, can you look at this?")).toEqual(["ada"]);
  });

  it("extracts multiple distinct mentions, deduplicated", () => {
    expect(parseMentionHandles("@Bob and @ada, also @bob again")).toEqual(["bob", "ada"]);
  });

  it("returns an empty array when there are no mentions", () => {
    expect(parseMentionHandles("no mentions here")).toEqual([]);
  });
});

describe("nameMatchesHandle", () => {
  it("matches case- and space-insensitively", () => {
    expect(nameMatchesHandle("Ada Lovelace", "adalovelace")).toBe(true);
  });

  it("does not match a different name", () => {
    expect(nameMatchesHandle("Ada Lovelace", "bobsmith")).toBe(false);
  });

  it("handles null/undefined full names safely", () => {
    expect(nameMatchesHandle(null, "ada")).toBe(false);
    expect(nameMatchesHandle(undefined, "ada")).toBe(false);
  });
});
