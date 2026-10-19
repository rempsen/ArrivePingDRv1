import { describe, expect, it } from "bun:test";
import type { FormItem } from "../../../../../shared/forms/form-model";
import { duplicateItem, insertItem, moveItem, nudgeItem, removeItem, retype, updateItem } from "../form-ops";

const it_ = (id: string, type: FormItem["type"] = "short_text", extra: Partial<FormItem> = {}): FormItem => ({ id, type, label: id.toUpperCase(), ...extra });
const ids = (xs: FormItem[]) => xs.map((x) => x.id);

// S1: a b | S2: c d | S3: e
const base = [it_("s1", "section"), it_("a"), it_("b"), it_("s2", "section"), it_("c"), it_("d"), it_("s3", "section"), it_("e")];

describe("moving questions", () => {
  it("moves a question up and down", () => {
    expect(ids(moveItem(base, "d", "a"))).toEqual(["s1", "d", "a", "b", "s2", "c", "s3", "e"]);
    expect(ids(moveItem(base, "a", "c"))).toEqual(["s1", "b", "s2", "c", "a", "d", "s3", "e"]);
  });
  it("a section carries its questions", () => {
    expect(ids(moveItem(base, "s2", "s1"))).toEqual(["s2", "c", "d", "s1", "a", "b", "s3", "e"]);
    // dropping down onto a section lands after that whole section
    expect(ids(moveItem(base, "s1", "s2"))).toEqual(["s2", "c", "d", "s1", "a", "b", "s3", "e"]);
    expect(ids(moveItem(base, "s1", "s3"))).toEqual(["s2", "c", "d", "s3", "e", "s1", "a", "b"]);
  });
  it("a section dropped on a question lands at a section boundary, never mid-section", () => {
    expect(ids(moveItem(base, "s2", "a"))).toEqual(["s2", "c", "d", "s1", "a", "b", "s3", "e"]);
    expect(ids(moveItem(base, "s1", "c"))).toEqual(["s2", "c", "d", "s1", "a", "b", "s3", "e"]);
    expect(ids(moveItem(base, "s1", "e"))).toEqual(["s2", "c", "d", "s3", "e", "s1", "a", "b"]);
  });
  it("can't drop a section into itself", () => {
    expect(moveItem(base, "s2", "c")).toBe(base);
  });
  it("nudges with the keyboard", () => {
    expect(ids(nudgeItem(base, "b", -1))).toEqual(["s1", "b", "a", "s2", "c", "d", "s3", "e"]);
    expect(ids(nudgeItem(base, "s3", -1))).toEqual(["s1", "a", "b", "s3", "e", "s2", "c", "d"]);
    expect(nudgeItem(base, "s1", -1)).toBe(base);
  });
  it("drops logic that would point forward after a move", () => {
    const xs = [it_("q1", "yes_no"), it_("q2", "short_text", { showIf: { itemId: "q1", op: "is", value: "yes" } })];
    const moved = moveItem(xs, "q2", "q1");
    expect(ids(moved)).toEqual(["q2", "q1"]);
    expect(moved[0]!.showIf).toBeUndefined();
  });
});

describe("adding, editing, removing", () => {
  it("inserts below the selected question or at an index", () => {
    expect(ids(insertItem(base, "photo", { afterId: "a" }).items).indexOf("a")).toBe(1);
    const r = insertItem(base, "photo", { afterId: "a" });
    expect(r.items[2]!.id).toBe(r.item.id);
    expect(insertItem(base, "date", { index: 0 }).items[0]!.type).toBe("date");
    expect(insertItem([], "date", {}).items).toHaveLength(1);
  });
  it("removing a question also removes rules that pointed at it", () => {
    const xs = [it_("q1", "yes_no"), it_("q2", "short_text", { showIf: { itemId: "q1", op: "answered" } })];
    expect(removeItem(xs, "q1")).toEqual([{ id: "q2", type: "short_text", label: "Q2" }]);
  });
  it("updateItem drops keys set to undefined", () => {
    const x = updateItem([it_("a", "short_text", { required: true })], "a", { required: undefined });
    expect("required" in x[0]!).toBe(false);
  });
  it("duplicating a section copies its questions and re-points logic inside the copy", () => {
    const xs = [it_("s", "section"), it_("q1", "yes_no"), it_("q2", "photo", { showIf: { itemId: "q1", op: "is", value: "no" } }), it_("t", "section"), it_("z")];
    const r = duplicateItem(xs, "s");
    expect(r.items).toHaveLength(8);
    const copy = r.items.slice(3, 6);
    expect(copy[0]!.label).toBe("S (copy)");
    expect(copy[2]!.showIf!.itemId).toBe(copy[1]!.id);
    expect(ids(r.items.slice(6))).toEqual(["t", "z"]);
  });
  it("changing type keeps the wording and sensible options", () => {
    const r = retype(it_("a", "single_choice", { options: ["X", "Y"], required: true }), "checklist");
    expect(r).toMatchObject({ id: "a", type: "checklist", label: "A", options: ["X", "Y"], required: true });
    expect(retype(it_("a", "short_text", { required: true }), "section").required).toBeUndefined();
  });
});
