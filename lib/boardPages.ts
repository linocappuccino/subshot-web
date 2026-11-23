/** 2026-11-23, Lino: «Seiten» — sub-pages on the idea board («Unterseiten … Seiten in Seiten»).
 *
 * The whole board (every page) stays ONE document, exactly like the server stores it (app/idea_board.py
 * resolve_pages): a «page» node sits on its parent page and every node carries `page` = the id of the page
 * node it sits on (missing = the board itself). The board editor only ever works on ONE page: it gets
 * `projectPage(full, page)` and every change it makes is put back with `mergePage` — nodes of the other
 * pages are kept untouched, new nodes get the current page, and the nodes of a deleted page (sub-pages
 * too) are dropped. Live sync, saving, undo and the R2 trash therefore see one normal board document. */

import type { BoardData, BoardElement, BoardView, Connector, PageElement } from "./board";

export type PageId = string | null;

export const pageOf = (el: { page?: string | null }): PageId => el.page ?? null;

export function isPage(el: BoardElement | undefined): el is PageElement {
  return !!el && el.type === "page";
}

/** the nodes of one page (and only the connectors / saved views of that page) */
export function projectPage(full: BoardData, page: PageId): BoardData {
  const elements = full.elements.filter((e) => pageOf(e) === page);
  const ids = new Set(elements.map((e) => e.id));
  const out: BoardData = {
    ...full,
    elements,
    connectors: full.connectors.filter((c) => ids.has(c.from) && ids.has(c.to)),
  };
  if (full.views) out.views = full.views.filter((v) => (v.page ?? null) === page);
  return out;
}

/** nodes whose page doesn't exist any more (also nested) are dropped; mirrors idea_board.resolve_pages */
export function resolvePages(elements: BoardElement[]): { kept: BoardElement[]; dropped: BoardElement[] } {
  // a page that would sit inside itself (cycle) moves to the board — like the server does
  const parent = new Map(elements.filter(isPage).map((p) => [p.id, pageOf(p)]));
  const moved = new Set<string>();
  for (const pid of parent.keys()) {
    const seen = new Set([pid]);
    let cur = parent.get(pid) ?? null;
    while (cur && parent.has(cur)) {
      if (seen.has(cur)) {
        parent.set(pid, null);
        moved.add(pid);
        break;
      }
      seen.add(cur);
      cur = parent.get(cur) ?? null;
    }
  }
  if (moved.size) elements = elements.map((e) => (moved.has(e.id) ? (({ page: _p, ...rest }) => rest as BoardElement)(e as BoardElement & { page?: string }) : e));
  const pages = new Map(elements.filter(isPage).map((p) => [p.id, p]));
  const alive = new Map<string, boolean>();
  const ok = (pid: PageId, depth = 0): boolean => {
    if (!pid) return true;
    const known = alive.get(pid);
    if (known !== undefined) return known;
    const p = pages.get(pid);
    alive.set(pid, false); // a cycle reads as dead while it is being checked
    const res = !!p && depth < 200 && ok(pageOf(p), depth + 1);
    alive.set(pid, res);
    return res;
  };
  const kept: BoardElement[] = [];
  const dropped: BoardElement[] = [];
  for (const e of elements) (ok(pageOf(e)) ? kept : dropped).push(e);
  return { kept, dropped };
}

/** ids of everything inside a page (nodes, sub-pages and their nodes) — not the page node itself */
export function pageDescendants(elements: BoardElement[], pageId: string): Set<string> {
  const out = new Set<string>();
  const todo = [pageId];
  while (todo.length) {
    const cur = todo.pop()!;
    for (const e of elements) {
      if (pageOf(e) === cur && !out.has(e.id)) {
        out.add(e.id);
        if (e.type === "page") todo.push(e.id);
      }
    }
  }
  return out;
}

/** breadcrumb: the pages from the board down to `page` (empty for the board itself) */
export function pagePath(elements: BoardElement[], page: PageId): PageElement[] {
  const pages = new Map(elements.filter(isPage).map((p) => [p.id, p]));
  const out: PageElement[] = [];
  let cur = page;
  while (cur && pages.has(cur) && out.length < 200) {
    const p = pages.get(cur)!;
    out.push(p);
    cur = pageOf(p);
  }
  return out.reverse();
}

export type OffPage = {
  /** changes to nodes on OTHER pages (e.g. scene times moved by «Zeiten verketten», a swapped scene number) */
  patches?: Map<string, Record<string, unknown>>;
  /** nodes to add on other pages (the contents of a duplicated / pasted page) — they carry their `page` */
  add?: BoardElement[];
  connectors?: Connector[];
};

/** Puts the edited page back into the whole board. `graveyard` keeps the nodes of a page that was deleted
 *  here, so an undo that brings the page node back brings its contents back too. */
export function mergePage(full: BoardData, edited: BoardData, page: PageId, off: OffPage = {}, graveyard?: Map<string, BoardElement>): BoardData {
  const editedIds = new Set(edited.elements.map((e) => e.id));
  const stamp = (e: BoardElement): BoardElement => {
    if (pageOf(e) === page) return e;
    const copy = { ...e } as BoardElement & { page?: string };
    if (page) copy.page = page;
    else delete copy.page;
    return copy;
  };
  const patch = (e: BoardElement): BoardElement => {
    const p = off.patches?.get(e.id);
    if (!p) return e;
    const next: Record<string, unknown> = { ...e };
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    return next as unknown as BoardElement;
  };
  const others = full.elements.filter((e) => pageOf(e) !== page && !editedIds.has(e.id)).map(patch);
  let elements = [...others, ...edited.elements.map(stamp), ...(off.add ?? [])];
  // contents of a page deleted earlier come back with their page node (undo)
  if (graveyard?.size) {
    const have = new Set(elements.map((e) => e.id));
    const back = [...graveyard.values()].filter((e) => !have.has(e.id));
    if (back.length) {
      const res = resolvePages([...elements, ...back]);
      const returned = new Set(back.map((e) => e.id));
      for (const e of res.kept) if (returned.has(e.id)) graveyard.delete(e.id);
      elements = res.kept;
    }
  }
  const { kept, dropped } = resolvePages(elements);
  if (graveyard) for (const e of dropped) graveyard.set(e.id, e);
  const ids = new Set(kept.map((e) => e.id));
  const pageNow = new Map(kept.map((e) => [e.id, pageOf(e)]));
  // connectors of the other pages stay; this page's come from the edited page
  const wasOn = new Map(full.elements.map((e) => [e.id, pageOf(e)]));
  const otherConnectors = full.connectors.filter((c) => wasOn.has(c.from) && wasOn.get(c.from) !== page);
  const connectors = [...otherConnectors, ...edited.connectors, ...(off.connectors ?? [])].filter(
    (c, i, all) => ids.has(c.from) && ids.has(c.to) && pageNow.get(c.from) === pageNow.get(c.to) && all.findIndex((x) => x.id === c.id) === i,
  );
  const out: BoardData = { ...full, ...edited, elements: kept, connectors };
  const views: BoardView[] = [...(full.views ?? []).filter((v) => (v.page ?? null) !== page), ...(edited.views ?? []).map((v) => (page ? { ...v, page } : (({ page: _p, ...rest }) => rest)(v)))];
  if (views.length || full.views || edited.views) out.views = views;
  else delete out.views;
  return out;
}

/** copies of the contents of the given pages with new ids (for duplicating / pasting a page node):
 *  `pageMap` old page id → id of its copy. Returns the copies and their connectors. */
export function clonePageContents(full: BoardData, pageMap: Map<string, string>, newId: () => string): { add: BoardElement[]; connectors: Connector[] } {
  const map = new Map(pageMap);
  const add: BoardElement[] = [];
  const todo = [...pageMap.keys()];
  const idMap = new Map<string, string>();
  while (todo.length) {
    const src = todo.pop()!;
    for (const e of full.elements) {
      if (pageOf(e) !== src) continue;
      const id = newId();
      idMap.set(e.id, id);
      if (e.type === "page") {
        map.set(e.id, id);
        todo.push(e.id);
      }
      add.push({ ...e, id, page: map.get(src)! } as BoardElement);
    }
  }
  const fixed = add.map((e) => (e.type === "group" ? ({ ...e, children: e.children.map((c) => idMap.get(c) ?? c) } as BoardElement) : e));
  const connectors = full.connectors
    .filter((c) => idMap.has(c.from) && idMap.has(c.to))
    .map((c) => ({ ...c, id: newId(), from: idMap.get(c.from)!, to: idMap.get(c.to)! }));
  return { add: fixed, connectors };
}
