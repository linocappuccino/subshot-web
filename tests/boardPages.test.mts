// 2026-11-23 «Seiten»: projecting one page of the board and merging the edited page back
import { test } from "node:test";
import assert from "node:assert/strict";
import { clonePageContents, mergePage, pageDescendants, pagePath, projectPage, resolvePages } from "../lib/boardPages.ts";

const t = (id: string, page?: string) => ({ id, type: "text", x: 0, y: 0, w: 10, h: 10, z: 1, html: "x", color: "default", ...(page ? { page } : {}) }) as any;
const p = (id: string, page?: string) => ({ id, type: "page", x: 0, y: 0, w: 10, h: 10, z: 1, title: id, ...(page ? { page } : {}) }) as any;
const board = () => ({
  elements: [t("a"), p("p1"), t("b", "p1"), p("p2", "p1"), t("c", "p2"), t("d", "p2")],
  connectors: [{ id: "k1", from: "c", to: "d" }, { id: "k2", from: "a", to: "p1" }],
}) as any;

test("old board without pages: projection is the board", () => {
  const full = { elements: [t("a"), t("b")], connectors: [{ id: "k", from: "a", to: "b" }] } as any;
  const view = projectPage(full, null);
  assert.deepEqual(view.elements.map((e: any) => e.id), ["a", "b"]);
  const merged = mergePage(full, view, null);
  assert.deepEqual(merged.elements.map((e: any) => e.id).sort(), ["a", "b"]);
  assert.equal(merged.connectors.length, 1);
  assert.ok(merged.elements.every((e: any) => !("page" in e)));
});

test("each page shows only its nodes and connectors", () => {
  const full = board();
  assert.deepEqual(projectPage(full, null).elements.map((e: any) => e.id), ["a", "p1"]);
  assert.deepEqual(projectPage(full, "p1").elements.map((e: any) => e.id), ["b", "p2"]);
  const p2 = projectPage(full, "p2");
  assert.deepEqual(p2.elements.map((e: any) => e.id), ["c", "d"]);
  assert.deepEqual(p2.connectors.map((c: any) => c.id), ["k1"]);
  assert.deepEqual(pagePath(full.elements, "p2").map((e: any) => e.id), ["p1", "p2"]);
  assert.deepEqual([...pageDescendants(full.elements, "p1")].sort(), ["b", "c", "d", "p2"]);
});

test("a node added on a page gets the page, other pages stay untouched", () => {
  const full = board();
  const view = projectPage(full, "p2");
  const merged = mergePage(full, { ...view, elements: [...view.elements, t("new")] }, "p2");
  const byId = new Map(merged.elements.map((e: any) => [e.id, e]));
  assert.equal(byId.get("new").page, "p2");
  assert.equal(merged.elements.length, 7);
  assert.deepEqual(merged.connectors.map((c: any) => c.id).sort(), ["k1", "k2"]);
});

test("deleting a page node deletes everything inside (sub-pages too); undo brings it back", () => {
  const full = board();
  const grave = new Map();
  const root = projectPage(full, null);
  const merged = mergePage(full, { ...root, elements: root.elements.filter((e: any) => e.id !== "p1") }, null, {}, grave);
  assert.deepEqual(merged.elements.map((e: any) => e.id), ["a"]);
  assert.equal(merged.connectors.length, 0);
  assert.deepEqual([...grave.keys()].sort(), ["b", "c", "d", "p2"]);
  const back = mergePage(merged, root, null, {}, grave);
  assert.deepEqual(back.elements.map((e: any) => e.id).sort(), ["a", "b", "c", "d", "p1", "p2"]);
  assert.equal(grave.size, 0);
});

test("changes to nodes on other pages (chained scene times) are merged", () => {
  const full = board();
  const merged = mergePage(full, projectPage(full, null), null, { patches: new Map([["c", { html: "neu" }]]) });
  assert.equal((merged.elements.find((e: any) => e.id === "c") as any).html, "neu");
});

test("duplicating a page copies its contents with new ids", () => {
  const full = board();
  let n = 0;
  const { add, connectors } = clonePageContents(full, new Map([["p1", "P1"]]), () => `n${++n}`);
  assert.equal(add.length, 4);
  const sub = add.find((e: any) => e.type === "page") as any;
  assert.equal(sub.page, "P1");
  assert.ok(add.filter((e: any) => e.type === "text" && e.page === sub.id).length === 2);
  assert.equal(connectors.length, 1);
});

test("a page cycle is broken (like the server), nothing is lost", () => {
  const els = [p("x", "y"), p("y", "x"), t("z", "x")];
  const { kept, dropped } = resolvePages(els);
  assert.equal(kept.length, 3);
  assert.equal(dropped.length, 0);
});
