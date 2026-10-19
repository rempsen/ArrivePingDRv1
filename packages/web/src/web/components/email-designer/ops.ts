/**
 * Pure edits on an email's block list. Blocks are found by id anywhere,
 * including inside a two-column block, so the canvas and inspector can act on
 * a nested block the same way as a top-level one.
 */
import { COLUMN_CHILD_TYPES, newBlockId, type Block } from "../../../shared/email/design";

export interface Found {
  block: Block;
  /** The columns block holding it, when nested. */
  parent?: Extract<Block, { type: "columns" }>;
  col?: 0 | 1;
  index: number;
}

export function findBlock(blocks: Block[], id: string | null | undefined): Found | null {
  if (!id) return null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.id === id) return { block: b, index: i };
    if (b.type === "columns") {
      for (const c of [0, 1] as const) {
        const j = b.cols[c].findIndex((x) => x.id === id);
        if (j >= 0) return { block: b.cols[c][j]!, parent: b, col: c, index: j };
      }
    }
  }
  return null;
}

/** Apply fn to the list that holds `id` (top level or a column), rebuilding parents. */
function inList(blocks: Block[], id: string, fn: (list: Block[], index: number) => Block[]): Block[] {
  const top = blocks.findIndex((b) => b.id === id);
  if (top >= 0) return fn(blocks, top);
  return blocks.map((b) => {
    if (b.type !== "columns") return b;
    for (const c of [0, 1] as const) {
      const j = b.cols[c].findIndex((x) => x.id === id);
      if (j >= 0) {
        const cols: [Block[], Block[]] = [b.cols[0], b.cols[1]];
        cols[c] = fn(b.cols[c], j);
        return { ...b, cols };
      }
    }
    return b;
  });
}

export function updateBlock(blocks: Block[], id: string, patch: Partial<Block> | ((b: Block) => Block)): Block[] {
  return inList(blocks, id, (list, i) => {
    const cur = list[i]!;
    const next = typeof patch === "function" ? patch(cur) : ({ ...cur, ...patch } as Block);
    // keys set to undefined are removed, so the stored JSON stays tidy
    for (const k of Object.keys(next)) if ((next as any)[k] === undefined) delete (next as any)[k];
    return list.map((x, j) => (j === i ? next : x));
  });
}

export function removeBlock(blocks: Block[], id: string): Block[] {
  return inList(blocks, id, (list, i) => list.filter((_, j) => j !== i));
}

function cloneFresh(b: Block): Block {
  const copy = JSON.parse(JSON.stringify(b)) as Block;
  copy.id = newBlockId();
  if (copy.type === "columns") copy.cols = [copy.cols[0].map(cloneFresh), copy.cols[1].map(cloneFresh)];
  return copy;
}

export function duplicateBlock(blocks: Block[], id: string): { blocks: Block[]; id: string | null } {
  let newId: string | null = null;
  const next = inList(blocks, id, (list, i) => {
    const copy = cloneFresh(list[i]!);
    newId = copy.id;
    return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
  });
  return { blocks: next, id: newId };
}

/**
 * Add a block after `afterId` (the selected block). Inside a column it goes
 * into that column when the type is allowed there; otherwise after the
 * columns block. No selection: at the end.
 */
export function insertAfter(blocks: Block[], afterId: string | null, block: Block): Block[] {
  const f = findBlock(blocks, afterId);
  if (!f) return [...blocks, block];
  if (f.parent) {
    if (COLUMN_CHILD_TYPES.includes(block.type)) return inList(blocks, f.block.id, (list, i) => [...list.slice(0, i + 1), block, ...list.slice(i + 1)]);
    const p = blocks.findIndex((b) => b.id === f.parent!.id);
    return [...blocks.slice(0, p + 1), block, ...blocks.slice(p + 1)];
  }
  return [...blocks.slice(0, f.index + 1), block, ...blocks.slice(f.index + 1)];
}

/** Add at a top-level position (drag from the palette). */
export function insertAt(blocks: Block[], index: number, block: Block): Block[] {
  const i = Math.max(0, Math.min(index, blocks.length));
  return [...blocks.slice(0, i), block, ...blocks.slice(i)];
}

/** Add to the end of one side of a columns block. */
export function addToColumn(blocks: Block[], columnsId: string, col: 0 | 1, block: Block): Block[] {
  if (!COLUMN_CHILD_TYPES.includes(block.type)) return blocks;
  return blocks.map((b) => {
    if (b.id !== columnsId || b.type !== "columns") return b;
    const cols: [Block[], Block[]] = [b.cols[0], b.cols[1]];
    cols[col] = [...cols[col], block];
    return { ...b, cols };
  });
}

/** Drag-reorder at the top level: put `fromId` where `toId` is. */
export function moveBlock(blocks: Block[], fromId: string, toId: string): Block[] {
  const from = blocks.findIndex((b) => b.id === fromId);
  const to = blocks.findIndex((b) => b.id === toId);
  if (from < 0 || to < 0 || from === to) return blocks;
  const next = [...blocks];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it!);
  return next;
}

/** Keyboard / button move by one, within its own list. */
export function nudgeBlock(blocks: Block[], id: string, dir: -1 | 1): Block[] {
  return inList(blocks, id, (list, i) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  });
}
