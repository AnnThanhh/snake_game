import './fixtures/configure.js';
import test from "node:test";
import assert from "node:assert/strict";
import { AdaptiveQuality } from "../src/client/adaptive-quality.ts";
const policy = {
  lowFps: 42,
  highFps: 57,
  downSeconds: 2,
  upSeconds: 12,
  cooldownSeconds: 5,
  initialLevel: 2,
};
test("Auto lowers quality after sustained slow frames, then recovers with hysteresis", () => {
  const q = new AdaptiveQuality();
  assert.equal(q.update(1 / 60, policy, 4), 2);
  for (let i = 0; i < 61; i++) q.update(1 / 30, policy, 4);
  assert.equal(q.level, 1);
  for (let i = 0; i < 600; i++) q.update(1 / 60, policy, 4);
  assert.equal(q.level, 1, "brief recovery must not oscillate quality");
  for (let i = 0; i < 480; i++) q.update(1 / 60, policy, 4);
  assert.equal(q.level, 2);
});
test("Auto ignores background-tab gaps and respects available presets", () => {
  const q = new AdaptiveQuality();
  for (let i = 0; i < 100; i++) q.update(10, policy, 4);
  assert.equal(q.level, 2);
  for (let i = 0; i < 3000; i++) q.update(1 / 20, policy, 4);
  assert.equal(q.level, 0);
  for (let i = 0; i < 5000; i++) q.update(1 / 60, policy, 2);
  assert.equal(q.level, 1);
});
