import { describe, expect, it } from "bun:test";
import type { Block } from "../../../../shared/email/design";
import { addToColumn, duplicateBlock, findBlock, insertAfter, insertAt, moveBlock, nudgeBlock, removeBlock, updateBlock } from "../ops";

const t = (id: string): Block => ({ id, type: "text", text: id.toUpperCase() });
const base = (): Block[] => [t("a"), { id: "c", type: "columns", ratio: "1:1", cols: [[t("l1"), t("l2")], [t("r1")]] }, t("b")];
const ids = (bs: Block[]) => bs.map((b) => (b.type === "columns" ? `c[${b.cols[0].map((x) => x.id).join(",")}|${b.cols[1].map((x) => x.id).join(",")}]` : b.id));

describe("email block ops", () => {
  it("finds nested blocks", () => {
    expect(findBlock(base(), "r1")).toMatchObject({ col: 1, index: 0 });
    expect(findBlock(base(), "b")!.index).toBe(2);
    expect(findBlock(base(), "zz")).toBeNull();
  });
  it("updates and removes inside columns", () => {
    const u = updateBlock(base(), "l2", { text: "new" } as Partial<Block>);
    expect((findBlock(u, "l2")!.block as any).text).toBe("new");
    expect(ids(removeBlock(base(), "l1"))).toEqual(["a", "c[l2|r1]", "b"]);
    const cleared = updateBlock(base(), "a", { align: undefined } as Partial<Block>);
    expect("align" in cleared[0]!).toBe(false);
  });
  it("duplicates with fresh ids, nested copies too", () => {
    const r = duplicateBlock(base(), "c");
    expect(r.blocks.length).toBe(4);
    const copy = r.blocks[2] as Extract<Block, { type: "columns" }>;
    expect(copy.id).toBe(r.id!);
    expect(copy.cols[0][0]!.id).not.toBe("l1");
    const n = duplicateBlock(base(), "l1");
    expect(ids(n.blocks)[1]).toMatch(/^c\[l1,b\w+,l2\|r1\]$/);
  });
  it("inserts after the selection, into a column when allowed", () => {
    expect(ids(insertAfter(base(), "l1", t("x")))).toEqual(["a", "c[l1,x,l2|r1]", "b"]);
    expect(ids(insertAfter(base(), "l1", { id: "e", type: "eta", label: "", value: "" }))).toEqual(["a", "c[l1,l2|r1]", "e", "b"]);
    expect(ids(insertAfter(base(), null, t("x")))).toEqual(["a", "c[l1,l2|r1]", "b", "x"]);
    expect(ids(insertAt(base(), 0, t("x")))[0]).toBe("x");
    expect(ids(addToColumn(base(), "c", 1, t("x")))).toEqual(["a", "c[l1,l2|r1,x]", "b"]);
  });
  it("moves and nudges", () => {
    expect(ids(moveBlock(base(), "b", "a"))).toEqual(["b", "a", "c[l1,l2|r1]"]);
    expect(ids(nudgeBlock(base(), "l2", -1))).toEqual(["a", "c[l2,l1|r1]", "b"]);
    expect(nudgeBlock(base(), "a", -1)[0]!.id).toBe("a");
  });
});
