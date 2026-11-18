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
