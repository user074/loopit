import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const daemon = await readFile(
  new URL("../scripts/loopit-daemon.mjs", import.meta.url),
  "utf8",
);

test("construction separates building a product from operating it", () => {
  assert.match(daemon, /The product, system, organization, or outcome being described/);
  assert.match(daemon, /The work that this loop itself should repeatedly advance/);
  assert.match(daemon, /default to a development loop/);
  assert.match(daemon, /future product behavior becomes capability requirements/);
  assert.match(daemon, /whether the loop should build and improve the system or operate it/);
});

test("fresh-agent rehearsal rejects a loop built at the wrong layer", () => {
  assert.match(daemon, /Fail a loop that chose the wrong layer/);
  assert.match(daemon, /operational job searching when the user's stated intent is to build/);
  assert.match(daemon, /do not mix development with operation/);
});

test("construction requires objective-grounded frontier replenishment", () => {
  assert.match(daemon, /Define a frontier replenishment contract/);
  assert.match(daemon, /Every newly created frontier item must cite the objective criterion/);
  assert.match(daemon, /Never replenish the frontier with unrelated ideas/);
  assert.match(daemon, /Define the empty-frontier protocol/);
  assert.match(daemon, /a back edge without a replenishment source is not a continuing loop/);
});

test("rehearsal exhausts the frontier and rejects ungrounded continuation", () => {
  assert.match(daemon, /Trace every newly created frontier item back to both an objective criterion and causal evidence/);
  assert.match(daemon, /Exhaust the current frontier in rehearsal/);
  assert.match(daemon, /stops merely because its initial list is empty/);
});
