import { describe, it, expect } from "vitest";
import {
  extractTitle,
  chunkMarkdown,
  CHUNK_TARGET,
  CHUNK_OVERLAP,
} from "./chunk";

describe("extractTitle", () => {
  it("extracts an H1 from simple markdown", () => {
    expect(extractTitle("# My Title\n\nSome content")).toBe("My Title");
  });

  it("extracts the first H1 when multiple exist", () => {
    expect(extractTitle("# First\n\n# Second")).toBe("First");
  });

  it("returns null when no H1 is present", () => {
    expect(extractTitle("## Not an H1\n\nSome content")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractTitle("")).toBeNull();
  });

  it("trims whitespace from the title", () => {
    expect(extractTitle("#   Padded Title   \n\nBody")).toBe("Padded Title");
  });

  it("handles H1 not at the start of the doc", () => {
    expect(extractTitle("Some preamble\n\n# Later Title\n\nBody")).toBe(
      "Later Title",
    );
  });
});

describe("chunkMarkdown", () => {
  it("returns empty array for empty input", () => {
    expect(chunkMarkdown("")).toEqual([]);
  });

  it("returns a single chunk for short content", () => {
    const result = chunkMarkdown("Hello world");
    expect(result).toEqual(["Hello world"]);
  });

  it("keeps paragraphs together when they fit in one chunk", () => {
    const content = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
    const result = chunkMarkdown(content, 200);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Paragraph one.");
    expect(result[0]).toContain("Paragraph two.");
    expect(result[0]).toContain("Paragraph three.");
  });

  it("splits into multiple chunks when content exceeds target", () => {
    const block = "A".repeat(100);
    const content = [block, block, block, block].join("\n\n");
    const result = chunkMarkdown(content, 250, 50);
    expect(result.length).toBeGreaterThan(1);
  });

  it("includes overlap from the previous chunk", () => {
    const blockA = "A".repeat(200);
    const blockB = "B".repeat(200);
    const blockC = "C".repeat(200);
    const content = [blockA, blockB, blockC].join("\n\n");
    const result = chunkMarkdown(content, 250, 50);
    expect(result.length).toBeGreaterThan(1);
    // The second chunk should start with tail from the first chunk (overlap)
    const firstChunkTail = result[0].slice(-50);
    expect(result[1].startsWith(firstChunkTail)).toBe(true);
  });

  it("uses default target and overlap values", () => {
    expect(CHUNK_TARGET).toBe(800);
    expect(CHUNK_OVERLAP).toBe(120);
  });

  it("handles content with no blank-line separators", () => {
    const content = "Single block with no paragraph breaks at all.";
    const result = chunkMarkdown(content);
    expect(result).toEqual([content]);
  });

  it("strips extra whitespace from blocks", () => {
    const content = "  Block one  \n\n  Block two  ";
    const result = chunkMarkdown(content, 1000);
    expect(result).toEqual(["Block one\n\nBlock two"]);
  });

  it("skips empty blocks between separators", () => {
    const content = "Block one\n\n\n\n\n\nBlock two";
    const result = chunkMarkdown(content, 1000);
    expect(result).toEqual(["Block one\n\nBlock two"]);
  });

  it("always puts the first block in the buffer even if it exceeds target", () => {
    const longBlock = "X".repeat(2000);
    const result = chunkMarkdown(longBlock, 100, 20);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(longBlock);
  });

  it("adds a first block that exceeds target, then splits subsequent blocks", () => {
    const longBlock = "X".repeat(500);
    const shortBlock = "Y".repeat(50);
    const content = [longBlock, shortBlock].join("\n\n");
    const result = chunkMarkdown(content, 100, 20);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(longBlock);
  });
});
