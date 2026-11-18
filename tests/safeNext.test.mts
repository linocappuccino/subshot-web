import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "../lib/safeNext.ts";
const P = "/projects/c15ead5c-1d16-4f9b-ac97-547fb244e7a4";
test("allowed", () => {
  for (const ok of ["/embed/idea/abc-1", `${P}`, `${P}/postproduction`, `${P}/deliver`, `${P}/postproduction?video=4922b7ad-f8be-4a8c-b567-8b7c7c6617de`, "/embed/idea/x?app=1"]) assert.equal(safeNext(ok), ok, ok);
});
test("blocked → /", () => {
  const bad = ["https://evil.com", "//evil.com", "/\\evil.com", "\\\\evil.com", "javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x",
    "/projects/../admin", `${P}/../../x`, "/projects/abc/postproduction", `${P}/settings`, `${P}//evil.com`, "/team", "/", "",
    `${P}?next=//evil.com`, `${P}?a=b?c`, "/embed/../x", " /embed/x", "/embed/x y", `${P}/postproduction#x`, "/%2F%2Fevil.com", "/embed/%2e%2e/x"];
  for (const b of bad) assert.equal(safeNext(b), "/", b);
});

// 2026-11-18 — the iOS app opens the board with ?media=still, after a web-process crash ?lite=1&media=still, then ?lite=1&media=off
const E = "/embed/idea/c15ead5c-1d16-4f9b-ac97-547fb244e7a4/61f61ef1-0000-4000-8000-000000000000";
test("embed board with media / lite parameters", () => {
  for (const q of ["media=still", "media=off", "lite=1", "lite=1&media=still", "lite=1&media=off", "media=still&lite=1", "media=full"]) {
    assert.equal(safeNext(`${E}?${q}`), `${E}?${q}`, q);
  }
});
test("still blocked with media / lite parameters", () => {
  for (const b of [`//evil.com/embed/idea/x?media=still`, `https://evil.com${E}?lite=1`, `${E}?media=still?x=1`, `${E}?media=//evil.com`, `${E}?media=still#x`, `${E}/../../team?lite=1`, `/projects/x?media=still`]) {
    assert.equal(safeNext(b), "/", b);
  }
});
