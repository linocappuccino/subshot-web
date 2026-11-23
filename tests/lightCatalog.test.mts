// 2026-11-21 (light plot v4): the camera / light catalogue — sensor sizes give the right angle of view, anamorphic
// frames, and the catalogue lists stay complete (they are mirrored in subshot-api app/light_plot.py)
import { test } from "node:test";
import assert from "node:assert/strict";
import { FABRICS, FLAG_SIZES, FRAMES, frameAspect, GENERIC_FIXTURES, LENSES, MODIFIER_KEYS, RIGS, SENSORS, SQUEEZES } from "../lib/lightCatalog.ts";

const fov = (mm: number, w: number) => (2 * Math.atan(w / (2 * mm)) * 180) / Math.PI;

test("angle of view from sensor width + focal length", () => {
  assert.equal(fov(50, SENSORS.ff.w).toFixed(1), "39.6");     // 50 mm full frame
  assert.equal(fov(50, SENSORS.s35.w).toFixed(1), "28.0");    // 50 mm Super 35 — the crop factor 1.45
  assert.ok(Math.abs(SENSORS.ff.w / SENSORS.s35.w - 1.446) < 0.01);
  assert.ok(fov(24, SENSORS.mft.w) > 39 && fov(24, SENSORS.mft.w) < 40);
});

test("anamorphic frame: wider, at most 2.39:1; spherical stays 16:9", () => {
  assert.equal(frameAspect("s35", 1), 16 / 9);
  assert.equal(frameAspect("s35", 2), 2.39);
  assert.ok(Math.abs(frameAspect("s35", 1.33) - (24.89 * 1.33) / 18.66) < 1e-9);
  assert.deepEqual([...SQUEEZES], [1, 1.33, 1.5, 1.8, 2]);
});

test("catalogue complete", () => {
  assert.equal(GENERIC_FIXTURES.length, 41);
  assert.equal(new Set(GENERIC_FIXTURES.map((g) => g.name)).size, 41);
  for (const g of GENERIC_FIXTURES) assert.ok(g.watts > 0 && g.k[1] <= g.k[0] && g.k[0] <= g.k[2], g.name);
  for (const k of ["softbox_s", "strip", "octa", "para_m", "dome", "grid", "snoot", "barndoors", "projector"]) assert.ok(MODIFIER_KEYS.includes(k as never), k);
  assert.deepEqual(Object.keys(FRAMES), ["4x4", "6x6", "8x8", "12x12", "20x20"]);
  assert.equal(Object.keys(FABRICS).length, 12);
  assert.deepEqual(Object.keys(FLAG_SIZES), ["18x24", "24x36", "floppy", "cutter"]);
  assert.equal(Object.keys(LENSES).length, 12);
  assert.equal(RIGS.length, 7);
  for (const f of Object.values(FABRICS)) assert.ok(f.t > 0 && f.t <= 1 && f.d >= 0 && f.d <= 1);
});
